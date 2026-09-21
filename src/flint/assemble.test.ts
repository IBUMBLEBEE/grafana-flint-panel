import { FieldType, toDataFrame } from '@grafana/data';
import { compile as compileVegaLite } from 'vega-lite';

import { defaultFlintOptions } from '../types';
import { assemblePanelChart, buildChartAssemblyInput, inferChartType } from './assemble';
import { dataFramesToFlintTable } from './dataFrames';
import { createFrameworkOverride } from './frameworkOverride';

const size = { width: 640, height: 320 };

describe('inferChartType', () => {
  it('chooses Line Chart for time + number', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'Time', type: FieldType.time, values: [1] },
          { name: 'Value', type: FieldType.number, values: [10] },
        ],
      }),
    ]);
    expect(inferChartType(table)).toBe('Line Chart');
  });

  it('chooses Bar Chart for category + number', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'region', type: FieldType.string, values: ['North'] },
          { name: 'revenue', type: FieldType.number, values: [120] },
        ],
      }),
    ]);
    expect(inferChartType(table)).toBe('Bar Chart');
  });
});

describe('buildChartAssemblyInput', () => {
  it('infers encodings from Grafana field types', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'region', type: FieldType.string, values: ['North', 'South'] },
          { name: 'revenue', type: FieldType.number, values: [120, 90] },
        ],
      }),
    ]);

    const input = buildChartAssemblyInput(table, defaultFlintOptions, size);

    expect(input.chart_spec.chartType).toBe('Bar Chart');
    expect(input.chart_spec.encodings).toEqual({
      x: { field: 'region', type: 'nominal' },
      y: { field: 'revenue', type: 'quantitative' },
    });
    expect(input.data).toEqual({
      values: [
        { region: 'North', revenue: 120 },
        { region: 'South', revenue: 90 },
      ],
    });

    const assembled = assemblePanelChart(table, { ...defaultFlintOptions, chartType: 'Grouped Bar Chart' }, size);
    expect(assembled.payload.series).toEqual(expect.arrayContaining([expect.any(Object), expect.any(Object)]));
  });

  it('applies a Flint chart_spec JSON override without replacing Grafana data', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'region', type: FieldType.string, values: ['North'] },
          { name: 'revenue', type: FieldType.number, values: [120] },
        ],
      }),
    ]);

    const input = buildChartAssemblyInput(
      table,
      {
        ...defaultFlintOptions,
        specJson: JSON.stringify({
          chartType: 'Pie Chart',
          encodings: { color: { field: 'region' }, size: { field: 'revenue' } },
        }),
      },
      size
    );

    expect(input.chart_spec.chartType).toBe('Pie Chart');
    expect(input.data.values).toEqual([{ region: 'North', revenue: 120 }]);
  });

  it('maps Gauge Chart numeric values to Flint size instead of unsupported x/y channels', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [{ name: 'utilization', type: FieldType.number, values: [72] }],
      }),
    ]);

    const input = buildChartAssemblyInput(
      table,
      { ...defaultFlintOptions, chartType: 'Gauge Chart', yField: 'utilization' },
      size
    );

    expect(input.chart_spec.encodings).toEqual({
      size: { field: 'utilization', type: 'quantitative' },
    });
  });

  it('uses Flint static-series encodings for multiple measures', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'month', type: FieldType.string, values: ['Jan', 'Feb'] },
          { name: 'revenue', type: FieldType.number, values: [120, 140] },
          { name: 'expenses', type: FieldType.number, values: [80, 95] },
        ],
      }),
    ]);

    const input = buildChartAssemblyInput(table, { ...defaultFlintOptions, chartType: 'Grouped Bar Chart' }, size);

    expect(input.chart_spec.encodings).toEqual({
      x: { field: 'month', type: 'nominal' },
      y: [
        { field: 'revenue', type: 'quantitative' },
        { field: 'expenses', type: 'quantitative' },
      ],
    });
  });

  it('preserves a Waterfall spec while applying the Grafana Totals option', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'period', type: FieldType.string, values: ['2025-01', '2025-02'] },
          { name: 'newUsers', type: FieldType.number, values: [397986, 533739] },
        ],
      }),
    ]);
    const input = buildChartAssemblyInput(
      table,
      {
        ...defaultFlintOptions,
        chartType: 'Waterfall Chart',
        waterfallTotals: 'none',
        specJson: JSON.stringify({
          semantic_types: { period: 'YearMonth', newUsers: 'Profit' },
          chart_spec: {
            chartType: 'Waterfall Chart',
            encodings: { x: 'period', y: 'newUsers' },
            title: 'How the player base moved through 2025',
            subtitle: "Net new players each month, accumulating into the year's total",
            baseSize: { width: 560, height: 440 },
            chartProperties: { totals: 'both' },
          },
        }),
      },
      size
    );

    expect(input.semantic_types).toEqual({ period: 'YearMonth', newUsers: 'Profit' });
    expect(input.chart_spec).toEqual(
      expect.objectContaining({
        chartType: 'Waterfall Chart',
        encodings: { x: 'period', y: 'newUsers' },
        title: 'How the player base moved through 2025',
        subtitle: "Net new players each month, accumulating into the year's total",
        baseSize: { width: 560, height: 440 },
        chartProperties: { totals: 'none' },
      })
    );
  });
});

describe('assemblePanelChart', () => {
  it('compiles a Pie Chart with one datum per category', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'region', type: FieldType.string, values: ['North', 'South', 'East', 'West'] },
          { name: 'revenue', type: FieldType.number, values: [120, 90, 150, 80] },
        ],
      }),
    ]);

    const assembled = assemblePanelChart(
      table,
      { ...defaultFlintOptions, chartType: 'Pie Chart', xField: 'region', yField: 'revenue', colorField: '' },
      size
    );
    const series = assembled.payload.series as Array<Record<string, unknown>>;

    expect(series).toHaveLength(1);
    expect(series[0].data).toHaveLength(4);
    expect(series[0].data).toEqual(
      expect.arrayContaining([
        { name: 'North', value: 120 },
        { name: 'South', value: 90 },
        { name: 'East', value: 150 },
        { name: 'West', value: 80 },
      ])
    );
  });

  it('compiles a bar chart into an ECharts option', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'region', type: FieldType.string, values: ['North', 'South', 'East'] },
          { name: 'revenue', type: FieldType.number, values: [120, 90, 150] },
        ],
      }),
    ]);

    const assembled = assemblePanelChart(table, defaultFlintOptions, size);

    expect(assembled.backend).toBe('echarts');
    expect(assembled.payload).toEqual(
      expect.objectContaining({
        series: expect.any(Array),
      })
    );
    expect(JSON.stringify(assembled.payload)).not.toContain('_warnings');
  });

  it('replays the selected backend Framework override after compiling', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'region', type: FieldType.string, values: ['North', 'South'] },
          { name: 'revenue', type: FieldType.number, values: [120, 90] },
        ],
      }),
    ]);
    const options = { ...defaultFlintOptions, chartType: 'Bar Chart' };
    const generated = assemblePanelChart(table, options, size);
    const edited = {
      ...generated.payload,
      tooltip: { ...((generated.payload.tooltip as Record<string, unknown>) ?? {}), trigger: 'item' },
    };
    const override = createFrameworkOverride({
      backend: 'echarts',
      input: generated.input,
      generated: generated.payload,
      edited,
    });

    const assembled = assemblePanelChart(table, { ...options, frameworkOverrides: { echarts: override! } }, size);

    expect(assembled.payload.tooltip).toMatchObject({ trigger: 'item' });
  });

  it('compiles with the Vega-Lite backend when selected', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'region', type: FieldType.string, values: ['North', 'South'] },
          { name: 'revenue', type: FieldType.number, values: [120, 90] },
        ],
      }),
    ]);

    const assembled = assemblePanelChart(table, { ...defaultFlintOptions, renderBackend: 'vegalite' }, size);

    expect(assembled.backend).toBe('vegalite');
    expect(assembled.payload).toEqual(
      expect.objectContaining({
        mark: expect.anything(),
      })
    );
  });

  it('preserves grouping and interactions in a Vega-Lite static-series Grouped Bar Chart', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'quarter', type: FieldType.string, values: ['Q1', 'Q2', 'Q3', 'Q4'] },
          { name: 'revenue', type: FieldType.number, values: [1280, 1510, 1430, 1760] },
          { name: 'expenses', type: FieldType.number, values: [820, 910, 880, 990] },
          { name: 'profit', type: FieldType.number, values: [460, 600, 550, 770] },
        ],
      }),
    ]);

    const assembled = assemblePanelChart(
      table,
      { ...defaultFlintOptions, chartType: 'Grouped Bar Chart', renderBackend: 'vegalite' },
      size
    );
    const encoding = assembled.payload.encoding as Record<string, { field?: string }>;
    const data = assembled.payload.data as { values?: unknown[] };

    expect(data.values).toHaveLength(12);
    expect(encoding.color).toMatchObject({ field: '__flint_series_key', type: 'nominal' });
    expect(encoding.xOffset).toMatchObject({ field: '__flint_series_key', type: 'nominal' });
    expect(encoding.tooltip).toEqual([
      { field: 'quarter', type: 'nominal' },
      { field: '__flint_series_key', type: 'nominal', title: 'Series' },
      { field: '__flint_series_value', type: 'quantitative', title: 'Value' },
    ]);
    expect(assembled.payload.params).toEqual([
      {
        name: 'flint_series_selection',
        select: { type: 'point', fields: ['__flint_series_key'] },
        bind: 'legend',
      },
    ]);
    expect(encoding.opacity).toEqual({
      condition: { param: 'flint_series_selection', value: 1 },
      value: 0.2,
    });
    const compiled = compileVegaLite(assembled.payload as never).spec;
    expect(JSON.stringify(compiled.signals)).toContain('__flint_series_key_legend_symbols');
  });

  it('compiles with the Plotly backend when selected', () => {
    const table = dataFramesToFlintTable([
      toDataFrame({
        fields: [
          { name: 'region', type: FieldType.string, values: ['North', 'South'] },
          { name: 'revenue', type: FieldType.number, values: [120, 90] },
        ],
      }),
    ]);

    const assembled = assemblePanelChart(table, { ...defaultFlintOptions, renderBackend: 'plotly' }, size);

    expect(assembled.backend).toBe('plotly');
    expect(assembled.payload).toEqual(
      expect.objectContaining({
        data: expect.any(Array),
        layout: expect.any(Object),
      })
    );
    expect(JSON.stringify(assembled.payload)).not.toContain('_transform');
  });

  it.each(['echarts', 'vegalite', 'plotly', 'chartjs'] as const)(
    'compiles a Waterfall Chart with the %s backend',
    (renderBackend) => {
      const table = dataFramesToFlintTable([
        toDataFrame({
          fields: [
            { name: 'period', type: FieldType.string, values: ['2025-01', '2025-02', '2025-03'] },
            { name: 'newUsers', type: FieldType.number, values: [397986, 533739, -521212] },
          ],
        }),
      ]);

      const assembled = assemblePanelChart(
        table,
        {
          ...defaultFlintOptions,
          renderBackend,
          chartType: 'Waterfall Chart',
          xField: 'period',
          yField: 'newUsers',
        },
        size
      );

      expect(assembled.backend).toBe(renderBackend);
      expect(Object.keys(assembled.payload).length).toBeGreaterThan(0);
      expect(assembled.input.chart_spec.chartProperties).toEqual({ totals: 'auto' });
    }
  );
});
