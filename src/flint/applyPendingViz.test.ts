import { defaultFlintOptions } from '../types';
import { applyPendingViz } from './applyPendingViz';
import { panelOptionsUpdate } from './panelOptionsUpdate';

describe('applyPendingViz', () => {
  it('explicitly clears an old palette when restoring a snapshot with default colors', () => {
    const options = { ...defaultFlintOptions, seriesColors: { revenue: '#0072B2', profit: '#009E73' } };
    const update = panelOptionsUpdate(
      options,
      applyPendingViz(options, { chartType: 'Line Chart', xField: 'quarter', yField: 'revenue' })
    );
    expect(update).toHaveProperty('seriesColors', undefined);
    expect({ ...options, ...update }.seriesColors).toBeUndefined();
  });

  it('clears removed nested source fields during an exact snapshot restore', () => {
    const options = {
      ...defaultFlintOptions,
      flintInput: {
        semantic_types: { quarter: 'Quarter', revenue: 'Amount' },
        chart_spec: {
          chartType: 'Line Chart',
          title: 'Changed',
          encodings: { x: 'quarter', y: ['revenue', 'profit'] },
        },
      },
    };
    const restored = { chart_spec: { chartType: 'Grouped Bar Chart', encodings: { x: 'quarter' } } };
    const update = panelOptionsUpdate(options, applyPendingViz(options, { flintInput: restored, bindingMode: 'auto' }));
    expect(update.flintInput.chart_spec).toHaveProperty('title', undefined);
    expect(update.flintInput.chart_spec.encodings).toHaveProperty('y', undefined);
    expect(update.flintInput).toHaveProperty('semantic_types', undefined);
    expect(JSON.parse(JSON.stringify(update.flintInput))).toEqual(restored);
    expect(options.flintInput.chart_spec.title).toBe('Changed');
  });
  it('saves semantic source only and drops obsolete compiled overrides', () => {
    const legacy = { ...defaultFlintOptions, frameworkOverrides: { echarts: { patch: [] } } };
    const result = applyPendingViz(legacy, {
      chartType: 'Bar Chart',
      xField: 'region',
      yField: 'revenue',
      colorField: '',
      specJson: '',
    });
    expect(result.flintInput?.chart_spec).toMatchObject({
      chartType: 'Bar Chart',
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    });
    for (const key of [
      'frameworkOverrides',
      'specJson',
      'chartType',
      'xField',
      'yField',
      'colorField',
      'waterfallTotals',
    ]) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result.bindingMode).toBe('auto');
  });

  it('does not persist proposal query provenance after Apply', () => {
    const result = applyPendingViz(defaultFlintOptions, {
      renderBackend: 'echarts',
      chartType: 'Bar Chart',
      xField: 'region',
      yField: 'revenue',
      colorField: '',
      specJson: '',
      context: {
        dashboardUid: 'private-dashboard',
        panelId: 12,
        bindings: [
          {
            datasource: { uid: 'private-datasource', type: 'prometheus' },
            refId: 'A',
            frameIndex: 0,
            fields: [{ name: 'revenue', type: 'number' }],
          },
        ],
        schemaFingerprint: 'schema-a',
        queryFingerprints: { saved: 'query-a' },
      },
    });

    expect(result.ai.pending).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private-dashboard');
    expect(JSON.stringify(result)).not.toContain('private-datasource');
    expect(JSON.stringify(result)).not.toContain('query-a');
  });
});
