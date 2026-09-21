import type { ChartAssemblyInput } from 'flint-chart';

import {
  applyFrameworkOverride,
  clearFrameworkOverride,
  createFrameworkOverride,
  validateFrameworkOverrides,
} from './frameworkOverride';

const input = (chartType = 'Grouped Bar Chart'): ChartAssemblyInput => ({
  data: { values: [{ quarter: 'Q1', revenue: 1280 }] },
  semantic_types: { quarter: 'Category', revenue: 'Quantity' },
  options: { addTooltips: true },
  chart_spec: {
    chartType,
    encodings: {
      x: { field: 'quarter', type: 'nominal' },
      y: { field: 'revenue', type: 'quantitative' },
    },
    canvasSize: { width: 800, height: 450 },
    baseSize: { width: 800, height: 450 },
  },
});

describe('framework overrides', () => {
  it('replays expert style edits over freshly compiled ECharts data', () => {
    const generated = {
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: ['Q1'] },
      series: [{ name: 'revenue', type: 'bar', data: [1280], itemStyle: { color: '#5470c6' } }],
    };
    const edited = {
      ...generated,
      tooltip: { trigger: 'item' },
      series: [{ ...generated.series[0], itemStyle: { color: '#ff7800', opacity: 0.7 } }],
    };

    const override = createFrameworkOverride({ backend: 'echarts', input: input(), generated, edited });
    expect(override).toBeDefined();
    expect(JSON.stringify(override)).not.toContain('1280');
    expect(JSON.stringify(override)).not.toContain('Q1');

    const refreshed = {
      ...generated,
      xAxis: { ...generated.xAxis, data: ['Q2'] },
      series: [{ ...generated.series[0], data: [1510] }],
    };
    const result = applyFrameworkOverride({ backend: 'echarts', input: input(), generated: refreshed, override });

    expect(result.warnings).toEqual([]);
    expect(result.payload).toMatchObject({
      tooltip: { trigger: 'item' },
      xAxis: { data: ['Q2'] },
      series: [{ data: [1510], itemStyle: { color: '#ff7800', opacity: 0.7 } }],
    });
  });

  it('rejects edits to backend-owned query data', () => {
    const generated = {
      data: {
        labels: ['Q1'],
        datasets: [{ label: 'revenue', data: [1280], backgroundColor: '#36a2eb' }],
      },
      options: {},
    };
    const edited = {
      ...generated,
      data: {
        ...generated.data,
        datasets: [{ ...generated.data.datasets[0], data: [9999] }],
      },
    };

    expect(() => createFrameworkOverride({ backend: 'chartjs', input: input(), generated, edited })).toThrow(
      /query data/i
    );
  });

  it('does not apply an override after its Flint source changes', () => {
    const generated = { mark: 'bar', data: { values: [{ quarter: 'Q1', revenue: 1280 }] } };
    const edited = { ...generated, mark: { type: 'bar', cornerRadius: 4 } };
    const override = createFrameworkOverride({ backend: 'vegalite', input: input(), generated, edited });

    const result = applyFrameworkOverride({
      backend: 'vegalite',
      input: input('Line Chart'),
      generated,
      override,
    });

    expect(result.payload).toBe(generated);
    expect(result.warnings.join(' ')).toMatch(/source changed/i);
  });

  it('keeps an override valid when only query values change', () => {
    const originalInput = input();
    const refreshedInput: ChartAssemblyInput = {
      ...originalInput,
      data: { values: [{ quarter: 'Q2', revenue: 1510 }] },
    };
    const generated = {
      xAxis: { data: ['Q1'] },
      series: [{ data: [1280], itemStyle: { color: '#5470c6' } }],
    };
    const edited = {
      ...generated,
      series: [{ ...generated.series[0], itemStyle: { color: '#ff7800' } }],
    };
    const override = createFrameworkOverride({ backend: 'echarts', input: originalInput, generated, edited });
    const refreshed = {
      xAxis: { data: ['Q2'] },
      series: [{ data: [1510], itemStyle: { color: '#5470c6' } }],
    };

    const result = applyFrameworkOverride({
      backend: 'echarts',
      input: refreshedInput,
      generated: refreshed,
      override,
    });

    expect(result.warnings).toEqual([]);
    expect(result.payload).toMatchObject({
      xAxis: { data: ['Q2'] },
      series: [{ data: [1510], itemStyle: { color: '#ff7800' } }],
    });
  });

  it('ignores an override after the query schema changes', () => {
    const generated = { mark: { type: 'bar', cornerRadius: 0 } };
    const edited = { mark: { type: 'bar', cornerRadius: 6 } };
    const override = createFrameworkOverride({ backend: 'vegalite', input: input(), generated, edited });
    const changedSchema: ChartAssemblyInput = {
      ...input(),
      semantic_types: { quarter: 'Category', revenue: 'Quantity', profit: 'Quantity' },
    };

    const result = applyFrameworkOverride({
      backend: 'vegalite',
      input: changedSchema,
      generated,
      override,
    });

    expect(result.payload).toBe(generated);
    expect(result.warnings.join(' ')).toMatch(/source changed/i);
  });

  it('removes the saved override when the edited spec matches Flint output', () => {
    const generated = { type: 'bar', data: { labels: ['Q1'], datasets: [{ data: [1280] }] } };

    expect(
      createFrameworkOverride({ backend: 'chartjs', input: input(), generated, edited: generated })
    ).toBeUndefined();
  });

  it('accepts an explicit deletion marker without persisting it to JSON', () => {
    const overrides = clearFrameworkOverride(undefined, 'echarts');

    expect(() => validateFrameworkOverrides(overrides)).not.toThrow();
    expect(JSON.stringify(overrides)).toBe('{}');
  });

  describe('backend ownership matrix', () => {
    it('allows ECharts style edits and replays them over refreshed data', () => {
      const generated = {
        xAxis: { type: 'category', data: ['Q1'], name: 'quarter', axisLabel: { rotate: 0 } },
        series: [{ name: 'revenue', type: 'bar', data: [1280], itemStyle: { color: '#5470c6' } }],
      };
      const edited = {
        ...generated,
        xAxis: { ...generated.xAxis, name: 'Fiscal quarter', axisLabel: { rotate: 30 } },
        series: [{ ...generated.series[0], itemStyle: { color: '#ff7800' } }],
      };
      const override = createFrameworkOverride({ backend: 'echarts', input: input(), generated, edited });
      const refreshed = {
        ...generated,
        xAxis: { ...generated.xAxis, data: ['Q2'] },
        series: [{ ...generated.series[0], data: [1510] }],
      };

      expect(
        applyFrameworkOverride({ backend: 'echarts', input: input(), generated: refreshed, override }).payload
      ).toMatchObject({
        xAxis: { data: ['Q2'], name: 'Fiscal quarter', axisLabel: { rotate: 30 } },
        series: [{ data: [1510], itemStyle: { color: '#ff7800' } }],
      });
      expect(() =>
        createFrameworkOverride({
          backend: 'echarts',
          input: input(),
          generated,
          edited: { ...generated, xAxis: { ...generated.xAxis, data: ['forged'] } },
        })
      ).toThrow(/query data/i);
    });

    it('allows Vega-Lite mark/config edits but rejects data and runtime dimensions', () => {
      const generated = {
        width: 800,
        height: 450,
        data: { values: [{ quarter: 'Q1', revenue: 1280 }] },
        mark: { type: 'bar', tooltip: true },
        config: { view: { stroke: null } },
      };
      const edited = {
        ...generated,
        mark: { ...generated.mark, cornerRadius: 6 },
        config: { view: { stroke: '#ff7800' } },
      };
      const override = createFrameworkOverride({ backend: 'vegalite', input: input(), generated, edited });
      const refreshed = {
        ...generated,
        data: { values: [{ quarter: 'Q2', revenue: 1510 }] },
      };

      expect(
        applyFrameworkOverride({ backend: 'vegalite', input: input(), generated: refreshed, override }).payload
      ).toMatchObject({
        data: refreshed.data,
        mark: { cornerRadius: 6 },
        config: { view: { stroke: '#ff7800' } },
      });
      expect(() =>
        createFrameworkOverride({
          backend: 'vegalite',
          input: input(),
          generated,
          edited: { ...generated, width: 300 },
        })
      ).toThrow(/runtime sizing/i);
      expect(() =>
        createFrameworkOverride({
          backend: 'vegalite',
          input: input(),
          generated,
          edited: { ...generated, data: { values: [] } },
        })
      ).toThrow(/query data/i);
    });

    it('allows Plotly trace/layout styles but rejects trace data and runtime dimensions', () => {
      const generated = {
        data: [{ type: 'bar', x: ['Q1'], y: [1280], marker: { color: '#5470c6' } }],
        layout: { width: 800, height: 450, title: { text: 'Revenue' } },
      };
      const edited = {
        data: [{ ...generated.data[0], marker: { color: '#ff7800' } }],
        layout: { ...generated.layout, title: { text: 'Quarterly revenue' } },
      };
      const override = createFrameworkOverride({ backend: 'plotly', input: input(), generated, edited });
      const refreshed = {
        data: [{ ...generated.data[0], x: ['Q2'], y: [1510] }],
        layout: generated.layout,
      };

      expect(
        applyFrameworkOverride({ backend: 'plotly', input: input(), generated: refreshed, override }).payload
      ).toMatchObject({
        data: [{ x: ['Q2'], y: [1510], marker: { color: '#ff7800' } }],
        layout: { width: 800, title: { text: 'Quarterly revenue' } },
      });
      expect(() =>
        createFrameworkOverride({
          backend: 'plotly',
          input: input(),
          generated,
          edited: { ...generated, data: [{ ...generated.data[0], y: [9999] }] },
        })
      ).toThrow(/query data/i);
      expect(() =>
        createFrameworkOverride({
          backend: 'plotly',
          input: input(),
          generated,
          edited: { ...generated, layout: { ...generated.layout, width: 300 } },
        })
      ).toThrow(/runtime sizing/i);
    });

    it('allows Chart.js dataset/plugin styles but rejects labels and dataset data', () => {
      const generated = {
        data: {
          labels: ['Q1'],
          datasets: [{ label: 'revenue', data: [1280], backgroundColor: '#36a2eb' }],
        },
        options: { plugins: { legend: { position: 'top' } } },
      };
      const edited = {
        data: {
          ...generated.data,
          datasets: [{ ...generated.data.datasets[0], backgroundColor: '#ff7800' }],
        },
        options: { plugins: { legend: { position: 'bottom' } } },
      };
      const override = createFrameworkOverride({ backend: 'chartjs', input: input(), generated, edited });
      const refreshed = {
        ...generated,
        data: {
          labels: ['Q2'],
          datasets: [{ ...generated.data.datasets[0], data: [1510] }],
        },
      };

      expect(
        applyFrameworkOverride({ backend: 'chartjs', input: input(), generated: refreshed, override }).payload
      ).toMatchObject({
        data: { labels: ['Q2'], datasets: [{ data: [1510], backgroundColor: '#ff7800' }] },
        options: { plugins: { legend: { position: 'bottom' } } },
      });
      expect(() =>
        createFrameworkOverride({
          backend: 'chartjs',
          input: input(),
          generated,
          edited: { ...generated, data: { ...generated.data, labels: ['forged'] } },
        })
      ).toThrow(/query data/i);
    });
  });

  it('ignores compiler and backend mismatches without breaking rendering', () => {
    const generated = { tooltip: { trigger: 'axis' } };
    const override = createFrameworkOverride({
      backend: 'echarts',
      input: input(),
      generated,
      edited: { tooltip: { trigger: 'item' } },
    })!;

    expect(
      applyFrameworkOverride({
        backend: 'echarts',
        input: input(),
        generated,
        override: { ...override, compilerVersion: 'next' },
      })
    ).toEqual({
      payload: generated,
      warnings: ['Ignored the UI Framework override because the Flint compiler version changed.'],
    });
    expect(
      applyFrameworkOverride({
        backend: 'plotly',
        input: input(),
        generated,
        override,
      })
    ).toEqual({ payload: generated, warnings: ['Ignored an incompatible UI Framework override.'] });
  });
});
