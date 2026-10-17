import { FieldType } from '@grafana/data';
import {
  assembleChartjs,
  assembleECharts,
  assemblePlotly,
  assembleVegaLite,
  type ChartAssemblyInput,
} from 'flint-chart';

import { DEFAULT_RENDER_BACKEND, type RenderBackend } from './backends';
import { AUTO_CHART_TYPE } from '../types';
import { FlintFieldMeta, FlintTable } from './dataFrames';
import { validateFlintOptions } from './validateOptions';
import { chartChannelsForBackend, chartPropertiesForBackend } from './chartTypes';
import { chartSettings, toChartState, type ChartStateSource } from './chartState';
import { applySeriesColors, validateSeriesColors } from './seriesColors';
import { supportsThemePresets } from './themes';

export interface PanelSize {
  width: number;
  height: number;
}

export interface AssembledChart {
  backend: RenderBackend;
  /** Backend-native payload (ECharts option / Vega-Lite spec / Chart.js config). */
  payload: Record<string, unknown>;
  warnings: string[];
  input: ChartAssemblyInput;
}

type FlintEncodingType = 'quantitative' | 'nominal' | 'ordinal' | 'temporal';
const STATIC_SERIES_CHARTS = new Set([
  'Line Chart',
  'Area Chart',
  'Bar Chart',
  'Grouped Bar Chart',
  'Stacked Bar Chart',
]);

function grafanaToFlintEncodingType(type: FieldType): FlintEncodingType {
  switch (type) {
    case FieldType.time:
      return 'temporal';
    case FieldType.number:
      return 'quantitative';
    default:
      return 'nominal';
  }
}

function grafanaToSemanticType(type: FieldType): string {
  switch (type) {
    case FieldType.time:
      return 'Date';
    case FieldType.number:
      return 'Quantity';
    default:
      return 'Category';
  }
}

function findField(table: FlintTable, name?: string): FlintFieldMeta | undefined {
  if (!name) {
    return undefined;
  }
  return table.fields.find((field) => field.name === name);
}

export function inferSemanticTypes(table: FlintTable): Record<string, string> {
  return Object.fromEntries(table.fields.map((field) => [field.name, grafanaToSemanticType(field.type)]));
}

export function inferChartType(table: FlintTable): string {
  const timeField = table.fields.find((field) => field.type === FieldType.time);
  const numberFields = table.fields.filter((field) => field.type === FieldType.number);
  const stringFields = table.fields.filter((field) => field.type === FieldType.string);

  if (timeField && numberFields.length > 0) {
    return 'Line Chart';
  }
  if (stringFields.length > 0 && numberFields.length > 0) {
    return 'Bar Chart';
  }
  if (numberFields.length >= 2) {
    return 'Scatter Plot';
  }
  return 'Bar Chart';
}

export function resolveRenderBackend(options: ChartStateSource): RenderBackend {
  return options.renderBackend || DEFAULT_RENDER_BACKEND;
}

export function buildChartAssemblyInput(
  table: FlintTable,
  options: ChartStateSource,
  size: PanelSize
): ChartAssemblyInput {
  const state = toChartState(options);
  if (state.recovery) {
    throw new Error(state.recovery.message);
  }
  const source = state.flintInput;
  const themeInput =
    supportsThemePresets(state.renderBackend) && source.theme_spec ? { theme_spec: source.theme_spec } : {};
  const semanticTypes = { ...inferSemanticTypes(table), ...source.semantic_types };
  const specOverride = state.bindingMode === 'explicit' ? source : undefined;
  options = { ...options, ...chartSettings(state) };

  if (specOverride) {
    return {
      ...themeInput,
      data: { values: table.values },
      semantic_types: semanticTypes,
      field_display_names: specOverride.field_display_names,
      options: { addTooltips: true, ...specOverride.options },
      chart_spec: {
        ...specOverride.chart_spec,
        canvasSize: { width: size.width, height: size.height },
        baseSize: specOverride.chart_spec.baseSize ?? { width: size.width, height: size.height },
      },
    };
  }

  const timeField = table.fields.find((field) => field.type === FieldType.time);
  const numberFields = table.fields.filter((field) => field.type === FieldType.number);
  const stringFields = table.fields.filter((field) => field.type === FieldType.string);

  const chartType =
    !options.chartType || options.chartType === AUTO_CHART_TYPE ? inferChartType(table) : options.chartType;
  const yField = findField(table, options.yField) ?? numberFields[0];
  const yFields =
    !options.yField && STATIC_SERIES_CHARTS.has(chartType) && numberFields.length > 1
      ? numberFields
      : yField
        ? [yField]
        : [];
  let xField: FlintFieldMeta | undefined =
    findField(table, options.xField) ??
    (chartType === 'Histogram' ? yField : undefined) ??
    timeField ??
    stringFields[0] ??
    numberFields.find((field) => field.name !== yField?.name);
  let colorField =
    findField(table, options.colorField) ??
    stringFields.find((field) => field.name !== xField?.name) ??
    table.fields.find((field) => field.name === 'series');

  if (chartType === 'Scatter Plot' && !options.xField) {
    xField = numberFields.find((field) => field.name !== yField?.name);
  }
  if (chartType === 'Heatmap') {
    colorField = findField(table, options.colorField) ?? numberFields[0];
  }

  const encodings: ChartAssemblyInput['chart_spec']['encodings'] = {};
  const allowedChannels = new Set(chartChannelsForBackend(resolveRenderBackend(options), chartType));
  if (allowedChannels.has('x') && xField) {
    encodings.x = { field: xField.name, type: grafanaToFlintEncodingType(xField.type) };
  }
  if (allowedChannels.has('y') && yFields.length > 0) {
    encodings.y =
      yFields.length === 1
        ? { field: yFields[0].name, type: grafanaToFlintEncodingType(yFields[0].type) }
        : yFields.map((field) => ({ field: field.name, type: grafanaToFlintEncodingType(field.type) }));
  }
  if (chartType === 'Heatmap' && !options.yField) {
    const category = stringFields.find((field) => field.name !== xField?.name);
    if (category) {
      encodings.y = { field: category.name, type: grafanaToFlintEncodingType(category.type) };
    }
  }
  if (allowedChannels.has('group') && yFields.length === 1 && colorField) {
    encodings.group = { field: colorField.name, type: grafanaToFlintEncodingType(colorField.type) };
  }
  if (allowedChannels.has('size') && !allowedChannels.has('y') && yField) {
    encodings.size = { field: yField.name, type: grafanaToFlintEncodingType(yField.type) };
  }
  const categoryField = colorField ?? xField;
  if (
    allowedChannels.has('color') &&
    yFields.length <= 1 &&
    categoryField &&
    (chartType === 'Pie Chart' ||
      chartType === 'Heatmap' ||
      (categoryField.name !== xField?.name && categoryField.name !== yField?.name))
  ) {
    encodings.color = { field: categoryField.name, type: grafanaToFlintEncodingType(categoryField.type) };
  }

  for (const [channel, value] of Object.entries(source.chart_spec.encodings ?? {})) {
    if (source.chart_spec.chartType === AUTO_CHART_TYPE && !allowedChannels.has(channel)) {
      continue;
    }
    const inferred = encodings[channel];
    encodings[channel] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      inferred &&
      typeof inferred === 'object' &&
      !Array.isArray(inferred)
        ? { ...inferred, ...value }
        : value;
  }

  return {
    ...themeInput,
    data: { values: table.values },
    semantic_types: semanticTypes,
    field_display_names: source.field_display_names,
    options: { addTooltips: true, ...source.options },
    chart_spec: {
      ...source.chart_spec,
      chartType,
      encodings,
      ...(source.chart_spec.chartType === AUTO_CHART_TYPE && source.chart_spec.chartProperties
        ? {
            chartProperties: Object.fromEntries(
              Object.entries(source.chart_spec.chartProperties).filter(([key]) =>
                chartPropertiesForBackend(resolveRenderBackend(options), chartType).some(
                  (property) => property.key === key
                )
              )
            ),
          }
        : {}),
      ...(chartType === 'Waterfall Chart'
        ? { chartProperties: { ...source.chart_spec.chartProperties, totals: options.waterfallTotals ?? 'auto' } }
        : {}),
      canvasSize: { width: size.width, height: size.height },
      baseSize: source.chart_spec.baseSize ?? { width: size.width, height: size.height },
    },
  };
}

function stripMeta(assembled: Record<string, unknown>): {
  payload: Record<string, unknown>;
  warnings: string[];
} {
  const warnings = Array.isArray(assembled._warnings)
    ? (assembled._warnings as Array<{ message?: string }>)
        .map((warning) => warning.message)
        .filter((message): message is string => Boolean(message))
    : [];

  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(assembled)) {
    if (key.startsWith('_')) {
      continue;
    }
    payload[key] = value;
  }

  return { payload, warnings };
}

const FLINT_STATIC_SERIES_KEY = '__flint_series_key';
const FLINT_STATIC_SERIES_VALUE = '__flint_series_value';
const FLINT_STATIC_SERIES_SELECTION = 'flint_series_selection';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * flint-chart 0.5.1 folds array-valued measures for Vega-Lite, but its Grouped
 * Bar template filters out the synthetic color channel before it can create a
 * dodge offset or explicit interactions. Keep this adapter narrow so it
 * preserves upstream fields when Flint starts emitting them itself.
 */
function preserveVegaLiteStaticSeriesBehavior(
  input: ChartAssemblyInput,
  assembled: Record<string, unknown>
): Record<string, unknown> {
  const staticMeasures = input.chart_spec.encodings?.y;
  if (
    input.chart_spec.chartType !== 'Grouped Bar Chart' ||
    !Array.isArray(staticMeasures) ||
    staticMeasures.length < 2 ||
    !isRecord(assembled.encoding)
  ) {
    return assembled;
  }

  const encoding = assembled.encoding;
  if (
    !isRecord(encoding.x) ||
    typeof encoding.x.field !== 'string' ||
    !isRecord(encoding.y) ||
    encoding.y.field !== FLINT_STATIC_SERIES_VALUE
  ) {
    return assembled;
  }

  const seriesEncoding = { field: FLINT_STATIC_SERIES_KEY, type: 'nominal' };
  const colorEncoding = isRecord(encoding.color) ? encoding.color : { ...seriesEncoding, title: 'Series' };
  const params = Array.isArray(assembled.params) ? assembled.params : [];
  const existingLegendSelection = params.find(
    (param) =>
      isRecord(param) &&
      typeof param.name === 'string' &&
      param.bind === 'legend' &&
      isRecord(param.select) &&
      Array.isArray(param.select.fields) &&
      param.select.fields.includes(FLINT_STATIC_SERIES_KEY)
  );
  const selectionName = isRecord(existingLegendSelection)
    ? (existingLegendSelection.name as string)
    : FLINT_STATIC_SERIES_SELECTION;
  const tooltip =
    encoding.tooltip ??
    (input.options?.addTooltips
      ? [
          {
            field: encoding.x.field,
            type: typeof encoding.x.type === 'string' ? encoding.x.type : 'nominal',
            ...(typeof encoding.x.title === 'string' ? { title: encoding.x.title } : {}),
          },
          { ...seriesEncoding, title: typeof colorEncoding.title === 'string' ? colorEncoding.title : 'Series' },
          {
            field: FLINT_STATIC_SERIES_VALUE,
            type: 'quantitative',
            title: typeof encoding.y.title === 'string' ? encoding.y.title : 'Value',
          },
        ]
      : undefined);

  return {
    ...assembled,
    params: existingLegendSelection
      ? params
      : [
          ...params,
          {
            name: selectionName,
            select: { type: 'point', fields: [FLINT_STATIC_SERIES_KEY] },
            bind: 'legend',
          },
        ],
    encoding: {
      ...encoding,
      color: colorEncoding,
      xOffset: encoding.xOffset ?? seriesEncoding,
      ...(tooltip ? { tooltip } : {}),
      opacity: encoding.opacity ?? {
        condition: { param: selectionName, value: 1 },
        value: 0.2,
      },
    },
  };
}

function compileForBackend(backend: RenderBackend, input: ChartAssemblyInput): Record<string, unknown> {
  switch (backend) {
    case 'vegalite': {
      const assembled = assembleVegaLite(input) as Record<string, unknown>;
      return preserveVegaLiteStaticSeriesBehavior(input, assembled);
    }
    case 'chartjs':
      return assembleChartjs(input) as Record<string, unknown>;
    case 'plotly':
      return assemblePlotly(input) as Record<string, unknown>;
    case 'echarts':
    default:
      return assembleECharts(input) as Record<string, unknown>;
  }
}

export function assemblePanelChart(table: FlintTable, options: ChartStateSource, size: PanelSize): AssembledChart {
  validateFlintOptions(options, table);
  const backend = resolveRenderBackend(options);
  const input = buildChartAssemblyInput(table, options, size);
  const seriesColors = toChartState(options).seriesColors;
  validateSeriesColors(seriesColors, input);
  for (const field of Object.keys(seriesColors ?? {})) {
    if (table.fields.find((candidate) => candidate.name === field)?.type !== FieldType.number) {
      throw new Error('seriesColors requires numeric measure fields');
    }
  }
  const assembled = compileForBackend(backend, input);
  const { payload, warnings } = stripMeta(assembled);
  if (toChartState(options).flintInput.theme_spec && !supportsThemePresets(backend)) {
    warnings.push(
      'Theme presets are supported only by Vega-Lite. The selected theme is retained but is not applied to this backend.'
    );
  }
  return { backend, payload: applySeriesColors(payload, backend, input, seriesColors), warnings, input };
}
