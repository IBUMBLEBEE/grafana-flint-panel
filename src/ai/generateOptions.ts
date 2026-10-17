import { DataFrame } from '@grafana/data';

import { preparePanelData } from '../flint/preparePanelData';
import { assemblePanelChart, buildChartAssemblyInput } from '../flint/assemble';
import { validatePendingViz } from '../flint/validateOptions';
import { FlintOptions } from '../types';
import { parseFlintInput, toChartState, type FlintChartState } from '../flint/chartState';
import { applyPendingViz } from '../flint/applyPendingViz';
import { snapshotFingerprint } from '../flint/visualizationRevision';
import { assertRefinementAllowed, REFINEMENT_ALLOWED_PATHS } from './refinement';
import { parseSeriesColors, seriesFields, validateSeriesColors } from '../flint/seriesColors';
import { allowedChartTypes, buildDataHint } from './dataHint';
import { chartCatalogForBackend, FLINT_SEMANTIC_TYPES } from '../flint/chartTypes';
import { createManualChartDraft, encodingFields } from '../flint/manualChartDraft';
import type { RenderBackend } from '../flint/backends';
import {
  aiProviderClient,
  AiProviderClient,
  ChatMessage,
  GenerateChartResponse,
  type AiGenerationMode,
} from './providerClient';

export interface GeneratedFlintOptions extends FlintChartState {
  rationale: string;
  /** Present only when an invalid Create candidate used valid legacy field selections. */
  fallbackReason?: string;
  repairAttempts?: number;
  baseFingerprint?: string;
}

const COMPILE_SIZE = { width: 640, height: 360 };

const CHART_TYPE_ALIASES: Record<string, string> = {
  auto: 'auto',
  line: 'Line Chart',
  'line chart': 'Line Chart',
  area: 'Area Chart',
  'area chart': 'Area Chart',
  bar: 'Bar Chart',
  'bar chart': 'Bar Chart',
  grouped: 'Grouped Bar Chart',
  'grouped bar': 'Grouped Bar Chart',
  stacked: 'Stacked Bar Chart',
  'stacked bar': 'Stacked Bar Chart',
  waterfall: 'Waterfall Chart',
  'waterfall chart': 'Waterfall Chart',
  scatter: 'Scatter Plot',
  'scatter plot': 'Scatter Plot',
  pie: 'Pie Chart',
  'pie chart': 'Pie Chart',
  donut: 'Pie Chart',
  'donut chart': 'Pie Chart',
  heatmap: 'Heatmap',
  histogram: 'Histogram',
  gauge: 'Gauge Chart',
  radar: 'Radar Chart',
};

function normalizeChartType(raw: string, backend: RenderBackend): string {
  const trimmed = raw.trim();
  const allowed = new Set(allowedChartTypes(backend));
  if (allowed.has(trimmed)) {
    return trimmed;
  }
  const alias = CHART_TYPE_ALIASES[trimmed.toLowerCase()];
  if (alias && allowed.has(alias)) {
    return alias;
  }
  throw new Error(`Unsupported chartType from model: ${raw}`);
}

function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutNulls).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return value === null ? undefined : value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => [key, withoutNulls(child)] as const)
      .filter(([, child]) => child !== undefined)
  );
}

function assertProviderSource(value: unknown, fieldNameMap = false, root = true): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'data' && !fieldNameMap) {
      throw new Error('Flint source must not contain data; Grafana queries are the only data source');
    }
    assertProviderSource(
      child,
      root && Object.hasOwn(value, 'chart_spec') && (key === 'semantic_types' || key === 'field_display_names'),
      false
    );
  }
}

function assertNoProviderCanvas(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  const record = value as Record<string, unknown>;
  const spec = record.chart_spec ?? record;
  if (spec && typeof spec === 'object' && Object.hasOwn(spec, 'canvasSize')) {
    throw new Error('Flint source must not contain canvasSize; the host binds dimensions at runtime');
  }
  if (spec && typeof spec === 'object') {
    for (const key of ['title', 'subtitle']) {
      if (Object.hasOwn(spec, key) && typeof (spec as Record<string, unknown>)[key] !== 'string') {
        throw new Error(`Flint chart_spec.${key} must be a string`);
      }
    }
  }
}

function structuredSpecJson(value: unknown, preserveNulls: boolean): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI provider response chartInput must be a structured Flint object');
  }
  assertProviderSource(value);
  assertNoProviderCanvas(value);
  return JSON.stringify(preserveNulls ? value : withoutNulls(value));
}

/** Provider compatibility ends here: all callers receive one canonical source state. */
function normalizeGenerated(
  value: GenerateChartResponse,
  backend: RenderBackend,
  preserveNulls = false
): GeneratedFlintOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI provider response must be a Flint proposal object');
  }
  for (const key of ['xField', 'yField', 'colorField', 'specJson', 'rationale'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`AI provider response ${key} must be a string`);
    }
  }
  const text = structuredSpecJson(value.chartInput, preserveNulls) ?? value.specJson?.trim();
  if (text) {
    const raw = JSON.parse(text);
    assertProviderSource(raw);
    assertNoProviderCanvas(raw);
  }
  const state = text
    ? toChartState({ renderBackend: backend, flintInput: parseFlintInput(text), bindingMode: 'explicit' })
    : toChartState({
        renderBackend: backend,
        chartType: typeof value.chartType === 'string' ? normalizeChartType(value.chartType, backend) : undefined,
        xField: value.xField,
        yField: value.yField,
        colorField: value.colorField,
      });
  if (!text && typeof value.chartType !== 'string') {
    throw new Error('AI provider response requires chartInput or a legacy chartType');
  }
  return { ...state, seriesColors: parseSeriesColors(value.seriesColors), rationale: value.rationale ?? '' };
}

function scalarFallback(value: GenerateChartResponse, backend: RenderBackend): GeneratedFlintOptions | undefined {
  if (
    typeof value.chartType !== 'string' ||
    !['xField', 'yField', 'colorField'].some((key) => Object.hasOwn(value, key))
  ) {
    return undefined;
  }
  return normalizeGenerated(
    {
      chartType: value.chartType,
      xField: value.xField,
      yField: value.yField,
      colorField: value.colorField,
      seriesColors: value.seriesColors,
      rationale: value.rationale,
    },
    backend
  );
}

function validateAndCompileGenerated(
  generated: GeneratedFlintOptions,
  frames: DataFrame[],
  backend: RenderBackend
): void {
  const prepared = preparePanelData(frames);
  validatePendingViz(
    generated,
    prepared.table.fields.map((field) => field.name),
    backend
  );
  assemblePanelChart(prepared.table, generated, COMPILE_SIZE);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function explicitFallback(
  fallback: GeneratedFlintOptions,
  reason: string,
  repairAttempts: number
): GeneratedFlintOptions {
  const fallbackReason = `Advanced Flint input was rejected${repairAttempts ? ' after repair' : ''}: ${reason}`;
  return {
    ...fallback,
    fallbackReason,
    repairAttempts,
    rationale: [fallback.rationale, fallbackReason, 'Using the validated chart and field selections instead.']
      .filter(Boolean)
      .join(' '),
  };
}

/** Omitted settings retain their current meaning; supplied settings override compatible source. */
function preserveUnspecifiedSettings(
  baseline: FlintChartState,
  generated: GeneratedFlintOptions
): GeneratedFlintOptions {
  const compatible = toChartState(
    createManualChartDraft({
      options: baseline,
      patch: { chartType: generated.flintInput.chart_spec.chartType },
    })
  );
  const previous = compatible.flintInput;
  const next = generated.flintInput;
  const encodings = { ...previous.chart_spec.encodings };
  for (const [channel, value] of Object.entries(next.chart_spec.encodings ?? {})) {
    const old = encodings[channel];
    const previousValues = Array.isArray(old) ? old : old ? [old] : [];
    const retainDetails = (item: (typeof previousValues)[number]) => {
      const matching = previousValues.find((entry) => encodingFields(entry)[0] === encodingFields(item)[0]);
      return matching && typeof matching === 'object' && !Array.isArray(matching)
        ? { ...matching, ...(typeof item === 'object' ? item : {}) }
        : item;
    };
    encodings[channel] = Array.isArray(value) ? value.map(retainDetails) : retainDetails(value);
  }
  const missingBindings = chartCatalogForBackend(generated.renderBackend)
    .find((entry) => entry.chartType === next.chart_spec.chartType)
    ?.requiredChannels.some(
      (channel) =>
        !encodings[channel] && !(['group', 'color'].includes(channel) && encodingFields(encodings.y).length > 1)
    );
  const merged = {
    ...generated,
    bindingMode: missingBindings ? compatible.bindingMode : generated.bindingMode,
    flintInput: {
      ...previous,
      ...next,
      ...(previous.semantic_types || next.semantic_types
        ? { semantic_types: { ...previous.semantic_types, ...next.semantic_types } }
        : {}),
      ...(previous.field_display_names || next.field_display_names
        ? { field_display_names: { ...previous.field_display_names, ...next.field_display_names } }
        : {}),
      ...(previous.options || next.options ? { options: { ...previous.options, ...next.options } } : {}),
      chart_spec: {
        ...previous.chart_spec,
        ...next.chart_spec,
        encodings,
        ...(previous.chart_spec.chartProperties || next.chart_spec.chartProperties
          ? { chartProperties: { ...previous.chart_spec.chartProperties, ...next.chart_spec.chartProperties } }
          : {}),
      },
    },
    seriesColors: generated.seriesColors ?? compatible.seriesColors,
    baseFingerprint: snapshotFingerprint(baseline),
  };
  if (!generated.seriesColors) {
    try {
      validateSeriesColors(merged.seriesColors, merged.flintInput);
    } catch {
      delete merged.seriesColors;
    }
  }
  return merged;
}

export async function generateFlintOptionsFromAi(args: {
  providerUid: string;
  frames: DataFrame[];
  userPrompt: string;
  renderBackend?: RenderBackend;
  generationMode?: AiGenerationMode;
  currentChartState?: FlintChartState;
  conversation?: ChatMessage[];
  signal?: AbortSignal;
  client?: Pick<AiProviderClient, 'generate'> & Partial<Pick<AiProviderClient, 'repair'>>;
}): Promise<GeneratedFlintOptions> {
  const { providerUid, frames, userPrompt } = args;
  const requireActiveRequest = () => {
    if (args.signal?.aborted) {
      throw new Error('Request cancelled.');
    }
  };
  requireActiveRequest();
  if (!frames.length) {
    throw new Error('No query data yet. Run a query before asking AI.');
  }
  const generationMode = args.generationMode ?? 'create';
  const baseline = args.currentChartState ? toChartState(args.currentChartState) : undefined;
  if (generationMode === 'refine' && (!baseline || baseline.recovery)) {
    throw new Error('A valid current Flint source is required before refining a chart.');
  }
  const renderBackend = generationMode === 'refine' ? baseline!.renderBackend : (args.renderBackend ?? 'echarts');
  const allowedPaths = [...REFINEMENT_ALLOWED_PATHS];
  const userRequest = userPrompt.trim() || 'Choose the best Flint chart for this data.';
  const prepared = preparePanelData(frames);
  const resolvedInput =
    generationMode === 'refine' ? buildChartAssemblyInput(prepared.table, baseline!, COMPILE_SIZE) : undefined;
  const prompt =
    generationMode === 'refine'
      ? [
          userRequest,
          'Host constraint: Refine the current Flint source, not a new chart.',
          'Only chart_spec.title, chart_spec.subtitle, field_display_names and the separate seriesColors palette may change.',
          'For unfaceted Grouped Bar Chart, Stacked Bar Chart or Line Chart with an array of measure fields on x or y, seriesColors maps every measure field to a #RRGGBB color. It is outside chartInput. Do not change any field binding to set colors.',
          'For a palette-only request return seriesColors and set chartInput and specJson to null. The Panel preserves its current semantic source and Auto bindings itself.',
          'Runtime chart type: ' + (resolvedInput?.chart_spec.chartType ?? ''),
          'Runtime measure series: ' + JSON.stringify(resolvedInput ? seriesFields(resolvedInput) : []),
          'For wording changes, return the complete data-free source as chartInput. Preserve all other source fields exactly. For palette-only changes, chartInput must be null.',
          'Preserve any existing theme_spec unchanged. Do not create or change a theme. Do not emit data, canvasSize, backend output, transformation code or interaction_spec.',
          'Current Flint source:',
          JSON.stringify(baseline!.flintInput),
          'Current seriesColors: ' + JSON.stringify(baseline!.seriesColors ?? null),
        ].join('\n')
      : baseline && !baseline.recovery
        ? [
            userRequest,
            'Modify the current chart for this request. Return only the source settings that need to change; omitted compatible settings are preserved by the Panel. Preserve unrelated field bindings, semantic annotations, field display names, titles, subtitles, layout and chart options. Do not reset options merely because the chart type changes.',
            'Current Flint source:',
            JSON.stringify(baseline.flintInput),
          ].join('\n')
        : userRequest;
  const table = prepared.table;
  const hint = buildDataHint(frames);
  const request = {
    prompt,
    generationMode,
    ...(baseline && !baseline.recovery ? { currentChartState: toChartState(baseline) } : {}),
    ...(generationMode === 'refine' ? { allowedPaths } : {}),
    fields: table.fields.map((field) => ({ name: field.name, type: String(field.type) })),
    dataHint: hint.summary,
    suggestedChartType: hint.suggestedChartType,
    renderBackend,
    chartCatalog: chartCatalogForBackend(renderBackend),
    semanticTypes: [...FLINT_SEMANTIC_TYPES],
    sampleRows: hint.sampleRows,
    frameSummary: prepared.frames.map((frame) => ({
      frameIndex: frame.frameIndex,
      ...(frame.refId ? { refId: frame.refId } : {}),
      fields: frame.fields.map((field) => field.name),
    })),
    ...(args.conversation?.length ? { conversation: args.conversation } : {}),
  };
  const candidate = (payload: GenerateChartResponse): GeneratedFlintOptions => {
    const palette = parseSeriesColors(payload.seriesColors);
    let generated: GeneratedFlintOptions =
      generationMode === 'refine' && palette && !payload.chartInput && !payload.specJson
        ? { ...toChartState(baseline!), seriesColors: palette, rationale: payload.rationale ?? '' }
        : normalizeGenerated(payload, renderBackend, generationMode === 'refine');
    if (generationMode === 'create' && baseline && !baseline.recovery) {
      generated = preserveUnspecifiedSettings(baseline, generated);
    }
    if (generationMode === 'refine') {
      assertRefinementAllowed(baseline!.flintInput, generated.flintInput);
      if (!palette) {
        generated.seriesColors = baseline!.seriesColors;
      }
    }
    return generationMode === 'refine'
      ? {
          ...generated,
          stateVersion: baseline!.stateVersion,
          renderBackend: baseline!.renderBackend,
          bindingMode: baseline!.bindingMode,
          baseFingerprint: snapshotFingerprint(baseline!),
        }
      : generated;
  };
  const client = args.client ?? aiProviderClient;
  const payload = args.signal
    ? await client.generate(providerUid, request, args.signal)
    : await client.generate(providerUid, request);
  requireActiveRequest();
  let fallback: GeneratedFlintOptions | undefined;
  let fallbackIsValid = false;
  try {
    try {
      fallback = generationMode === 'create' ? scalarFallback(payload, renderBackend) : undefined;
      if (fallback) {
        if (baseline && !baseline.recovery) {
          fallback = preserveUnspecifiedSettings(baseline, fallback);
        }
        validateAndCompileGenerated(fallback, frames, renderBackend);
        fallbackIsValid = true;
      }
    } catch {
      /* A rejected fallback must never hide a valid structured source. */
    }
    const generated = candidate(payload);
    validateAndCompileGenerated(generated, frames, renderBackend);
    return generated;
  } catch (firstCause) {
    requireActiveRequest();
    const firstError = errorMessage(firstCause);
    if (!client.repair) {
      if (fallback && fallbackIsValid) {
        return explicitFallback(fallback, firstError, 0);
      }
      throw firstCause;
    }

    try {
      const repairedPayload = args.signal
        ? await client.repair(
            providerUid,
            { request, candidate: payload, compileError: firstError, attempt: 1 },
            args.signal
          )
        : await client.repair(providerUid, { request, candidate: payload, compileError: firstError, attempt: 1 });
      requireActiveRequest();
      const repaired = candidate(repairedPayload);
      validateAndCompileGenerated(repaired, frames, renderBackend);
      return { ...repaired, repairAttempts: 1 };
    } catch (repairCause) {
      requireActiveRequest();
      const repairError = errorMessage(repairCause);
      const repairedReason = `${firstError}; repair failed: ${repairError}`;
      if (fallback && fallbackIsValid) {
        return explicitFallback(fallback, repairedReason, 1);
      }
      throw new Error(`Flint proposal failed validation and repair: ${repairedReason}`);
    }
  }
}

export function applyGeneratedOptions(options: FlintOptions, generated: GeneratedFlintOptions): FlintOptions {
  return applyPendingViz(options, generated);
}
