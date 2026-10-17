import type { ChartAssemblyInput } from 'flint-chart';

import { DEFAULT_RENDER_BACKEND, type RenderBackend } from './backends';
import type { WaterfallTotalsMode } from '../types';
import { parseSeriesColors, type SeriesColors } from './seriesColors';
import { validateThemePreset } from './themes';
import { validateSourceShape } from './sourceValidation';

/** Persisted semantic source. Query rows and host canvas dimensions are bound at runtime. */
export type FlintInput = Omit<ChartAssemblyInput, 'data'>;

export interface FlintChartState {
  stateVersion: 1;
  renderBackend: RenderBackend;
  bindingMode: 'auto' | 'explicit';
  flintInput: FlintInput;
  /** Reviewed series presentation, applied after semantic compilation. */
  seriesColors?: SeriesColors;
  /** Unconvertible legacy input is retained for recovery and never rendered. */
  recovery?: { message: string; source: string };
}

/** Read-only compatibility input; these fields are never emitted by persistence. */
export interface LegacyChartFields {
  chartType?: string;
  waterfallTotals?: WaterfallTotalsMode;
  xField?: string;
  yField?: string;
  colorField?: string;
  specJson?: string;
}

export type ChartStateSource = LegacyChartFields & Partial<FlintChartState>;

function assertNoRuntimeData(value: unknown, fieldNames = false, root = true): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'data' && !fieldNames) {
      throw new Error('Flint source must not contain data; Grafana queries are the only data source');
    }
    assertNoRuntimeData(
      child,
      root && Object.hasOwn(value, 'chart_spec') && (key === 'semantic_types' || key === 'field_display_names'),
      false
    );
  }
}

/** Grafana can retain undefined deletion markers in nested option updates. */
function stripUndefinedFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedFields);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, stripUndefinedFields(child)])
  );
}

export function sourceInput(input: FlintInput): FlintInput {
  input = stripUndefinedFields(input) as FlintInput;
  assertNoRuntimeData(input);
  validateSourceShape(input);
  validateThemePreset(input.theme_spec);
  if (!input.chart_spec || typeof input.chart_spec.chartType !== 'string') {
    throw new Error('Invalid Flint spec JSON: chart_spec requires chartType');
  }
  const { canvasSize: _hostSize, ...chartSpec } = input.chart_spec;
  return JSON.parse(JSON.stringify({ ...input, chart_spec: chartSpec })) as FlintInput;
}

export function parseFlintInput(text: string, allowLegacyRuntimeDimensions = false): FlintInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Invalid Flint spec JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid Flint spec JSON: expected an object');
  }
  const record = parsed as Record<string, unknown>;
  const input = Object.hasOwn(record, 'chart_spec') ? record : { chart_spec: record };
  const chartSpec = input.chart_spec;
  if (!chartSpec || typeof chartSpec !== 'object' || Array.isArray(chartSpec)) {
    throw new Error('Invalid Flint spec JSON: chart_spec must be an object');
  }
  if (typeof (chartSpec as Record<string, unknown>).chartType !== 'string') {
    throw new Error('Invalid Flint spec JSON: chart_spec requires chartType');
  }
  if (!allowLegacyRuntimeDimensions && Object.hasOwn(chartSpec, 'canvasSize')) {
    throw new Error('Invalid Flint spec JSON: chart_spec.canvasSize is supplied by the host at runtime');
  }
  return sourceInput(input as unknown as FlintInput);
}

function legacyInput(source: ChartStateSource): FlintInput {
  const encodings: FlintInput['chart_spec']['encodings'] = {};
  const chartType = source.chartType || 'auto';
  if (source.xField && chartType !== 'Gauge Chart') {
    encodings[chartType === 'Pie Chart' ? 'color' : 'x'] = { field: source.xField };
  }
  if (source.yField) {
    encodings[chartType === 'Pie Chart' || chartType === 'Gauge Chart' ? 'size' : 'y'] = { field: source.yField };
  }
  if (source.colorField) {
    encodings.color = { field: source.colorField };
  }
  return {
    chart_spec: {
      chartType,
      encodings,
      ...(chartType === 'Waterfall Chart' ? { chartProperties: { totals: source.waterfallTotals ?? 'auto' } } : {}),
    },
  };
}

/** Resolves legacy shapes once; canonical source always wins over stale scalar fields. */
export function toChartState(source: ChartStateSource = {}): FlintChartState {
  const renderBackend = source.renderBackend ?? DEFAULT_RENDER_BACKEND;
  if (source.flintInput) {
    try {
      if (source.stateVersion !== undefined && source.stateVersion !== 1) {
        throw new Error('Unsupported Flint state version');
      }
      if (source.bindingMode !== undefined && !['auto', 'explicit'].includes(source.bindingMode)) {
        throw new Error('Unsupported Flint binding mode');
      }
      const seriesColors = parseSeriesColors(source.seriesColors);
      return {
        stateVersion: 1,
        renderBackend,
        bindingMode: source.flintInput.chart_spec.chartType === 'auto' ? 'auto' : (source.bindingMode ?? 'explicit'),
        flintInput: sourceInput(source.flintInput),
        ...(seriesColors ? { seriesColors } : {}),
        ...(source.recovery ? { recovery: source.recovery } : {}),
      };
    } catch (cause) {
      return {
        stateVersion: 1,
        renderBackend,
        bindingMode: 'auto',
        flintInput: legacyInput({}),
        recovery: {
          message: cause instanceof Error ? cause.message : String(cause),
          source: JSON.stringify(source.flintInput),
        },
      };
    }
  }
  if (source.specJson?.trim()) {
    try {
      const flintInput = parseFlintInput(source.specJson, true);
      // Old Waterfall scalar setting had precedence over the custom spec.
      if (flintInput.chart_spec.chartType === 'Waterfall Chart' && source.waterfallTotals !== undefined) {
        flintInput.chart_spec.chartProperties = {
          ...flintInput.chart_spec.chartProperties,
          totals: source.waterfallTotals,
        };
      }
      return { stateVersion: 1, renderBackend, bindingMode: 'explicit', flintInput };
    } catch (cause) {
      return {
        stateVersion: 1,
        renderBackend,
        bindingMode: 'auto',
        flintInput: legacyInput(source),
        recovery: { message: cause instanceof Error ? cause.message : String(cause), source: source.specJson },
      };
    }
  }
  return { stateVersion: 1, renderBackend, bindingMode: 'auto', flintInput: legacyInput(source) };
}

function encodingField(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const field = (value as Record<string, unknown>).field;
    return typeof field === 'string' ? field : '';
  }
  return '';
}

/** UI labels are derived from the source; they are not another saved state. */
export function chartSettings(state: FlintChartState) {
  const spec = state.flintInput.chart_spec;
  return {
    chartType: spec.chartType,
    waterfallTotals: (spec.chartProperties?.totals ?? 'auto') as WaterfallTotalsMode,
    xField: encodingField(spec.encodings?.x),
    yField: encodingField(spec.encodings?.y ?? spec.encodings?.size),
    colorField: encodingField(spec.encodings?.color),
    specJson: state.recovery?.source ?? JSON.stringify(state.flintInput),
  };
}
