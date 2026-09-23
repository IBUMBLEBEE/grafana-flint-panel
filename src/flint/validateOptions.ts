import { FlintPendingViz, WATERFALL_TOTALS_MODES } from '../types';
import { RENDER_BACKENDS, type RenderBackend } from './backends';
import {
  allowedChartTypesForBackend,
  chartChannelsForBackend,
  chartPropertiesForBackend,
  FLINT_SEMANTIC_TYPES,
  requiredChartChannelsForBackend,
} from './chartTypes';
import { FlintTable } from './dataFrames';
import { validateFrameworkOverrides } from './frameworkOverride';
import type { FlintRenderOptions } from './visualizationRevision';

const MAX_SPEC_JSON_BYTES = 64 * 1024;
const ROOT_INPUT_KEYS = new Set(['chart_spec', 'semantic_types', 'field_display_names', 'options']);

function assertKnownField(name: string, fieldNames: Set<string>, label: string): void {
  if (name && !fieldNames.has(name)) {
    throw new Error(`${label} references unknown query field "${name}"`);
  }
}

function assertNoEmbeddedData(value: unknown, path = 'specJson', fieldNameMap = false): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoEmbeddedData(item, `${path}[${index}]`, fieldNameMap));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!fieldNameMap && key === 'data') {
      throw new Error(`${path} must not contain data; Grafana queries are the only data source`);
    }
    assertNoEmbeddedData(child, `${path}.${key}`, key === 'semantic_types' || key === 'field_display_names');
  }
}

function assertEncodingValueFields(value: unknown, fieldNames: Set<string>, path: string): void {
  if (typeof value === 'string') {
    assertKnownField(value, fieldNames, path);
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      throw new Error(`Invalid Flint spec JSON: ${path} must not be an empty array`);
    }
    value.forEach((item, index) => assertEncodingValueFields(item, fieldNames, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid Flint spec JSON: ${path} must be a field encoding`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.field !== 'string' || !record.field.trim()) {
    throw new Error(`Invalid Flint spec JSON: ${path}.field must be a query field name`);
  }
  assertKnownField(record.field, fieldNames, `${path}.field`);
}

function assertSemanticTypes(value: unknown, fieldNames: Set<string>): void {
  if (value === undefined) {
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Flint spec JSON: semantic_types must be an object');
  }
  const allowed = new Set<string>(FLINT_SEMANTIC_TYPES);
  for (const [field, annotation] of Object.entries(value as Record<string, unknown>)) {
    assertKnownField(field, fieldNames, 'semantic_types');
    const semanticType =
      typeof annotation === 'string'
        ? annotation
        : annotation && typeof annotation === 'object'
          ? (annotation as Record<string, unknown>).semanticType
          : undefined;
    if (typeof semanticType !== 'string' || !allowed.has(semanticType)) {
      throw new Error(`Invalid Flint spec JSON: semantic_types.${field} has an unsupported semantic type`);
    }
  }
}

function assertFieldDisplayNames(value: unknown, fieldNames: Set<string>): void {
  if (value === undefined) {
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Flint spec JSON: field_display_names must be an object');
  }
  for (const [field, displayName] of Object.entries(value as Record<string, unknown>)) {
    assertKnownField(field, fieldNames, 'field_display_names');
    if (typeof displayName !== 'string' || !displayName.trim()) {
      throw new Error(`Invalid Flint spec JSON: field_display_names.${field} must be a non-empty string`);
    }
  }
}

function assertChartProperties(value: unknown, backend: RenderBackend, chartType: string): void {
  if (value === undefined) {
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Flint spec JSON: chart_spec.chartProperties must be an object');
  }
  const definitions = new Map(
    chartPropertiesForBackend(backend, chartType).map((property) => [property.key, property])
  );
  for (const [key, propertyValue] of Object.entries(value as Record<string, unknown>)) {
    const definition = definitions.get(key);
    if (!definition) {
      throw new Error(`Invalid Flint spec JSON: ${chartType} does not support chartProperties.${key} for ${backend}`);
    }
    if (definition.type === 'binary' && typeof propertyValue !== 'boolean') {
      throw new Error(`Invalid Flint spec JSON: chartProperties.${key} must be boolean`);
    }
    if (
      definition.type === 'continuous' &&
      (typeof propertyValue !== 'number' ||
        !Number.isFinite(propertyValue) ||
        propertyValue < (definition.min ?? -Infinity) ||
        propertyValue > (definition.max ?? Infinity))
    ) {
      throw new Error(
        `Invalid Flint spec JSON: chartProperties.${key} must be between ${definition.min} and ${definition.max}`
      );
    }
    if (definition.type === 'discrete' && !definition.options?.some((option) => Object.is(option, propertyValue))) {
      throw new Error(`Invalid Flint spec JSON: chartProperties.${key} has an unsupported value`);
    }
  }
}

/** Validates the small panel contract agents are allowed to write. */
export function validatePendingViz(
  pending: FlintPendingViz,
  fieldNames: Iterable<string>,
  backend: RenderBackend = 'echarts'
): void {
  const knownFields = new Set(fieldNames);
  const chartTypes = new Set<string>(allowedChartTypesForBackend(backend));

  if (!chartTypes.has(pending.chartType)) {
    throw new Error(`Unsupported chartType "${pending.chartType}"`);
  }
  assertKnownField(pending.xField, knownFields, 'xField');
  assertKnownField(pending.yField, knownFields, 'yField');
  assertKnownField(pending.colorField, knownFields, 'colorField');
  validateFrameworkOverrides(pending.frameworkOverrides);

  const text = pending.specJson.trim();
  if (!text) {
    return;
  }
  if (new TextEncoder().encode(text).length > MAX_SPEC_JSON_BYTES) {
    throw new Error(`specJson exceeds the ${MAX_SPEC_JSON_BYTES / 1024} KiB limit`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Flint spec JSON: ${message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid Flint spec JSON: expected an object');
  }

  assertNoEmbeddedData(parsed);
  const record = parsed as Record<string, unknown>;
  const isAssemblyInput = Object.hasOwn(record, 'chart_spec');
  if (isAssemblyInput && Object.keys(record).some((key) => !ROOT_INPUT_KEYS.has(key))) {
    throw new Error('Invalid Flint spec JSON: ChartAssemblyInput contains unsupported root properties');
  }
  const chartSpec = isAssemblyInput ? record.chart_spec : record;
  if (!chartSpec || typeof chartSpec !== 'object' || Array.isArray(chartSpec)) {
    throw new Error('Invalid Flint spec JSON: chart_spec must be an object');
  }
  if (typeof (chartSpec as Record<string, unknown>).chartType !== 'string') {
    throw new Error('Invalid Flint spec JSON: chart_spec requires chartType');
  }
  if (!chartTypes.has((chartSpec as Record<string, unknown>).chartType as string)) {
    throw new Error(
      `Invalid Flint spec JSON: chart_spec has unsupported chartType "${(chartSpec as Record<string, unknown>).chartType}"`
    );
  }
  const specRecord = chartSpec as Record<string, unknown>;
  const specChartType = specRecord.chartType as string;
  const encodings = specRecord.encodings;
  if (encodings !== undefined && (!encodings || typeof encodings !== 'object' || Array.isArray(encodings))) {
    throw new Error('Invalid Flint spec JSON: chart_spec.encodings must be an object');
  }
  const encodingRecord = (encodings ?? {}) as Record<string, unknown>;
  const allowedChannels = new Set(chartChannelsForBackend(backend, specChartType));
  for (const channel of Object.keys(encodingRecord)) {
    if (!allowedChannels.has(channel)) {
      throw new Error(
        `Invalid Flint spec JSON: ${specChartType} does not support encoding channel "${channel}" for ${backend}`
      );
    }
    assertEncodingValueFields(encodingRecord[channel], knownFields, `chart_spec.encodings.${channel}`);
  }
  const missingChannels = requiredChartChannelsForBackend(backend, specChartType).filter(
    (channel) => encodingRecord[channel] === undefined
  );
  if (missingChannels.length) {
    throw new Error(`Invalid Flint spec JSON: ${specChartType} requires ${missingChannels.join(' and ')} encodings`);
  }
  assertChartProperties(specRecord.chartProperties, backend, specChartType);
  if (isAssemblyInput) {
    assertSemanticTypes(record.semantic_types, knownFields);
    assertFieldDisplayNames(record.field_display_names, knownFields);
  }
}

export function validateFlintOptions(options: FlintRenderOptions, table: FlintTable): void {
  if (!RENDER_BACKENDS.some((backend) => backend.value === options.renderBackend)) {
    throw new Error(`Unsupported render backend "${options.renderBackend}"`);
  }
  if (options.waterfallTotals !== undefined && !WATERFALL_TOTALS_MODES.includes(options.waterfallTotals)) {
    throw new Error(`Unsupported Waterfall totals mode "${options.waterfallTotals}"`);
  }
  validatePendingViz(
    options,
    table.fields.map((field) => field.name),
    options.renderBackend
  );
}
