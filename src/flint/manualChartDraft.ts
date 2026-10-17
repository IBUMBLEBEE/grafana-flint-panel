import type { FlintPanelContextSnapshot } from '../ai/panelContext';
import type { FlintPendingViz, WaterfallTotalsMode } from '../types';
import { chartCatalogForBackend, chartChannelsForBackend, chartPropertiesForBackend } from './chartTypes';
import { sourceInput, toChartState, type ChartStateSource } from './chartState';
import type { RenderBackend } from './backends';
import { validateSeriesColors } from './seriesColors';
import { supportsThemePresets, validateThemePreset } from './themes';

export const MULTI_MEASURE_CHARTS = ['Line Chart', 'Area Chart', 'Bar Chart', 'Grouped Bar Chart', 'Stacked Bar Chart'];

export function encodingFields(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(encodingFields);
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (value && typeof value === 'object' && 'field' in value && typeof value.field === 'string') {
    return [value.field];
  }
  return [];
}

export interface ManualChartSettingsPatch {
  renderBackend?: RenderBackend;
  chartType?: string;
  waterfallTotals?: WaterfallTotalsMode;
  xField?: string;
  yField?: string;
  colorField?: string;
  /** Empty selections restore host inference for that channel. */
  channelFields?: Record<string, string[]>;
  /** Undefined removes an override and restores the compiler default. */
  chartProperties?: Record<string, unknown>;
  addTooltips?: boolean;
  /** Null restores Flint's default presentation. */
  themePreset?: string | null;
}

/** Edit source in place while preserving unrelated semantics, facets, options and chart properties. */
export function createManualChartDraft(args: {
  options: ChartStateSource;
  patch: ManualChartSettingsPatch;
  context?: FlintPanelContextSnapshot;
}): FlintPendingViz {
  const state = toChartState(args.options);
  const patch = args.patch;
  state.renderBackend = patch.renderBackend ?? state.renderBackend;
  if (patch.themePreset !== undefined) {
    if (!supportsThemePresets(state.renderBackend)) {
      throw new Error('Theme presets are supported only by Vega-Lite');
    }
    validateThemePreset(patch.themePreset ?? undefined);
    if (patch.themePreset === null) {
      delete state.flintInput.theme_spec;
    } else {
      state.flintInput.theme_spec = patch.themePreset;
    }
  }
  const spec = state.flintInput.chart_spec;
  const encodings = { ...spec.encodings };
  if (patch.chartType !== undefined && patch.chartType !== spec.chartType) {
    const nextType = patch.chartType;
    const channels = new Set(
      nextType === 'auto'
        ? chartCatalogForBackend(state.renderBackend).flatMap((entry) => entry.channels)
        : chartChannelsForBackend(state.renderBackend, nextType)
    );
    if (channels.has('group') && !encodings.group && encodings.color) {
      encodings.group = encodings.color;
    } else if (!channels.has('group') && channels.has('color') && encodings.group && !encodings.color) {
      encodings.color = encodings.group;
    }
    if (channels.has('size') && !channels.has('y') && encodings.y) {
      encodings.size = encodings.y;
    } else if (channels.has('y') && encodings.size) {
      encodings.y = encodings.size;
    }
    if (nextType === 'Pie Chart' && !encodings.color && encodings.x) {
      encodings.color = encodings.x;
    }
    if (spec.chartType === 'Pie Chart' && channels.has('x') && !encodings.x && encodings.color) {
      encodings.x = encodings.color;
    }
    if (nextType !== 'auto') {
      for (const channel of Object.keys(encodings)) {
        if (!channels.has(channel)) {
          delete encodings[channel];
        } else if (Array.isArray(encodings[channel]) && !MULTI_MEASURE_CHARTS.includes(nextType)) {
          delete encodings[channel];
          state.bindingMode = 'auto';
        }
      }
      const properties = new Set(chartPropertiesForBackend(state.renderBackend, nextType).map((p) => p.key));
      if (spec.chartProperties) {
        spec.chartProperties = Object.fromEntries(
          Object.entries(spec.chartProperties).filter(([key]) => properties.has(key))
        );
      }
    }
    spec.chartType = nextType;
    state.bindingMode = nextType === 'auto' ? 'auto' : state.bindingMode;
  }
  for (const [channel, fields] of Object.entries(patch.channelFields ?? {})) {
    if (!fields.length) {
      delete encodings[channel];
      state.bindingMode = 'auto';
      continue;
    }
    const previous = encodings[channel];
    const previousValues = Array.isArray(previous) ? previous : previous ? [previous] : [];
    const values = fields.map((field) => {
      const old = previousValues.find((value) => encodingFields(value).includes(field));
      return old && typeof old === 'object' ? { ...old, field } : { field };
    });
    encodings[channel] = values.length === 1 ? values[0] : values;
  }
  if (patch.chartProperties) {
    spec.chartProperties = { ...spec.chartProperties };
    for (const [key, value] of Object.entries(patch.chartProperties)) {
      if (value === undefined) {
        delete spec.chartProperties[key];
      } else {
        spec.chartProperties[key] = value;
      }
    }
  }
  if (patch.addTooltips !== undefined) {
    state.flintInput.options = { ...state.flintInput.options, addTooltips: patch.addTooltips };
  }
  const measureChannel = ['Pie Chart', 'Gauge Chart'].includes(spec.chartType) ? 'size' : 'y';
  for (const [setting, channel] of [
    ['xField', 'x'],
    ['yField', measureChannel],
    ['colorField', 'color'],
  ] as const) {
    const field = patch[setting];
    if (field === undefined) {
      continue;
    }
    if (!field) {
      delete encodings[channel];
      state.bindingMode = 'auto';
    } else {
      const old = encodings[channel];
      encodings[channel] = { ...(old && typeof old === 'object' && !Array.isArray(old) ? old : {}), field };
    }
  }
  if (patch.waterfallTotals !== undefined) {
    spec.chartProperties = { ...spec.chartProperties, totals: patch.waterfallTotals };
  }
  spec.encodings = encodings;
  state.flintInput = sourceInput(state.flintInput);
  // A palette remains meaningful only while its chart and measure bindings remain compatible.
  try {
    validateSeriesColors(state.seriesColors, state.flintInput);
  } catch {
    delete state.seriesColors;
  }
  return { ...state, rationale: 'Manually adjusted chart settings.', context: args.context, source: 'manual' };
}
