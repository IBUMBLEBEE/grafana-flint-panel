import {
  allowedChartTypesForBackend,
  chartCatalogForBackend,
  chartChannelsForBackend,
  FLINT_SEMANTIC_TYPES,
} from './chartTypes';

describe('Flint backend chart catalog', () => {
  it('derives the ECharts Pie Chart contract from flint-chart', () => {
    expect(allowedChartTypesForBackend('echarts')).toContain('Pie Chart');
    expect(chartChannelsForBackend('echarts', 'Pie Chart')).toEqual(expect.arrayContaining(['size', 'color']));
    expect(chartChannelsForBackend('echarts', 'Pie Chart')).not.toContain('x');
    expect(chartCatalogForBackend('echarts').find((entry) => entry.chartType === 'Pie Chart')).toEqual(
      expect.objectContaining({
        requiredChannels: ['size', 'color'],
        properties: expect.arrayContaining([
          expect.objectContaining({ key: 'innerRadius', type: 'continuous', min: 0, max: 60 }),
        ]),
      })
    );
    expect(FLINT_SEMANTIC_TYPES).toEqual(expect.arrayContaining(['Category', 'Amount', 'DateTime']));
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
