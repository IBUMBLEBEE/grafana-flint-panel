import type { RenderBackend } from './backends';
import type { FlintInput } from './chartState';

export type SeriesColors = Record<string, string>;
export const SERIES_COLOR_CHART_TYPES = ['Grouped Bar Chart', 'Stacked Bar Chart', 'Line Chart'];

/** A complete palette keyed by source measure fields; never accepts renderer configuration. */
export function parseSeriesColors(value: unknown): SeriesColors | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('seriesColors must be an object of measure fields and hex colors');
  }
  const entries = Object.entries(value).filter(([, color]) => color !== null);
  if (!entries.length) {
    return undefined;
  }
  if (
    entries.length > 16 ||
    entries.some(([field, color]) => !field || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))
  ) {
    throw new Error('seriesColors requires at most 16 colors in #RRGGBB format');
  }
  return Object.fromEntries(entries);
}

export function seriesFields(input: FlintInput): string[] {
  const encodings = input.chart_spec.encodings;
  const measures = Array.isArray(encodings?.y) ? encodings.y : Array.isArray(encodings?.x) ? encodings.x : [];
  return measures
    .map((value) => (typeof value === 'string' ? value : value.field))
    .filter((field): field is string => typeof field === 'string');
}

export function validateSeriesColors(colors: SeriesColors | undefined, input: FlintInput): void {
  if (!colors) {
    return;
  }
  const fields = seriesFields(input);
  if (
    !SERIES_COLOR_CHART_TYPES.includes(input.chart_spec.chartType) ||
    fields.length < 2 ||
    input.chart_spec.encodings?.row ||
    input.chart_spec.encodings?.column
  ) {
    throw new Error(
      'seriesColors supports unfaceted grouped bars, stacked bars and lines with multiple measure fields'
    );
  }
  if (Object.keys(colors).length !== fields.length || fields.some((field) => !Object.hasOwn(colors, field))) {
    throw new Error('seriesColors must specify exactly the measure fields used by the chart');
  }
}

/** Apply the reviewed presentation intent after Flint compiles the semantic source. */
export function applySeriesColors(
  payload: Record<string, unknown>,
  backend: RenderBackend,
  input: FlintInput,
  colors?: SeriesColors
): Record<string, unknown> {
  if (!colors) {
    return payload;
  }
  const fields = seriesFields(input);
  const colorFor = (name: unknown): string | undefined => {
    if (typeof name === 'string' && fields.includes(name)) {
      return colors[name];
    }
    const matches = fields.filter((field) => name === input.field_display_names?.[field]);
    return matches.length === 1 ? colors[matches[0]] : undefined;
  };
  const paint = (
    values: unknown,
    label: 'name' | 'label',
    update: (value: Record<string, unknown>, color: string) => Record<string, unknown>
  ) => {
    if (!Array.isArray(values)) {
      throw new Error('Compiled chart does not expose the expected series for custom colors');
    }
    return values.map((value: Record<string, unknown>) => {
      const color = colorFor(value[label]);
      if (!color) {
        throw new Error('Compiled chart series cannot be matched to the requested colors');
      }
      return update(value, color);
    });
  };
  if (backend === 'echarts') {
    return {
      ...payload,
      color: fields.map((field) => colors[field]),
      series: paint(payload.series, 'name', (series, color) => ({
        ...series,
        itemStyle: { ...(series.itemStyle as object), color },
        lineStyle: { ...(series.lineStyle as object), color },
      })),
    };
  }
  if (backend === 'chartjs') {
    const data = payload.data as Record<string, unknown>;
    return {
      ...payload,
      data: {
        ...data,
        datasets: paint(data.datasets, 'label', (dataset, color) => ({
          ...dataset,
          backgroundColor: color,
          borderColor: color,
        })),
      },
    };
  }
  if (backend === 'plotly') {
    return {
      ...payload,
      data: paint(payload.data, 'name', (trace, color) => ({
        ...trace,
        marker: { ...(trace.marker as object), color },
        line: { ...(trace.line as object), color },
      })),
    };
  }
  const encoding = payload.encoding as Record<string, unknown>;
  const color = encoding.color as Record<string, unknown> | undefined;
  return {
    ...payload,
    encoding: {
      ...encoding,
      color: {
        ...color,
        field: '__flint_series_key',
        type: 'nominal',
        scale: { ...(color?.scale as object), domain: fields, range: fields.map((field) => colors[field]) },
      },
    },
  };
}
