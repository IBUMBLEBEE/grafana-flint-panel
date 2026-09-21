import { FlintPendingViz, WATERFALL_TOTALS_MODES } from '../types';
import { RENDER_BACKENDS, type RenderBackend } from './backends';
import { allowedChartTypesForBackend, chartChannelsForBackend } from './chartTypes';
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

function assertNoEmbeddedData(value: unknown, path = 'specJson'): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoEmbeddedData(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'data') {
      throw new Error(`${path} must not contain data; Grafana queries are the only data source`);
    }
    assertNoEmbeddedData(child, `${path}.${key}`);
  }
}

function assertEncodingFields(value: unknown, fieldNames: Set<string>, path = 'chart_spec'): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertEncodingFields(item, fieldNames, `${path}[${index}]`));
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.field === 'string') {
    assertKnownField(record.field, fieldNames, `${path}.field`);
  }
  for (const [key, child] of Object.entries(record)) {
    assertEncodingFields(child, fieldNames, `${path}.${key}`);
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
  }
  if (specChartType === 'Pie Chart' && (!encodingRecord.color || !encodingRecord.size)) {
    throw new Error('Invalid Flint spec JSON: Pie Chart requires color and size encodings');
  }
  if (specChartType === 'Gauge Chart' && !encodingRecord.size) {
    throw new Error('Invalid Flint spec JSON: Gauge Chart requires a size encoding');
  }
  assertEncodingFields(chartSpec, knownFields);
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
