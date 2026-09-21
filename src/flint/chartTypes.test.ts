import { allowedChartTypesForBackend, chartCatalogForBackend, chartChannelsForBackend } from './chartTypes';

describe('Flint backend chart catalog', () => {
  it('derives the ECharts Pie Chart contract from flint-chart', () => {
    expect(allowedChartTypesForBackend('echarts')).toContain('Pie Chart');
    expect(chartChannelsForBackend('echarts', 'Pie Chart')).toEqual(expect.arrayContaining(['size', 'color']));
    expect(chartChannelsForBackend('echarts', 'Pie Chart')).not.toContain('x');
  });

  it('returns only the Panel-supported subset for every backend', () => {
    for (const backend of ['echarts', 'vegalite', 'plotly', 'chartjs'] as const) {
      const catalog = chartCatalogForBackend(backend);
      expect(catalog.length).toBeGreaterThan(0);
      expect(new Set(catalog.map((entry) => entry.chartType)).size).toBe(catalog.length);
      expect(catalog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            chartType: 'Waterfall Chart',
            channels: expect.arrayContaining(['x', 'y', 'color']),
          }),
        ])
      );
    }
  });
});
