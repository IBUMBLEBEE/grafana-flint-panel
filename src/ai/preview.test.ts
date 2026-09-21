import { defaultFlintOptions } from '../types';
import { captureVizSnapshot, snapshotFingerprint, snapshotToPending, snapshotWithDraft } from './preview';

describe('Flint AI preview and undo snapshots', () => {
  it('builds a preview snapshot without changing the committed options', () => {
    const options = { ...defaultFlintOptions, chartType: 'Line Chart', xField: 'time', yField: 'requests' };
    const draft = {
      renderBackend: 'chartjs' as const,
      chartType: 'Grouped Bar Chart',
      xField: 'quarter',
      yField: '',
      colorField: '',
      specJson: '',
    };

    expect(snapshotWithDraft(options, draft)).toEqual({
      ...draft,
      waterfallTotals: 'auto',
      frameworkOverrides: {},
    });
    expect(options).toMatchObject({ chartType: 'Line Chart', xField: 'time', yField: 'requests' });
  });

  it('creates a one-step undo proposal from the previous visualization only', () => {
    const before = captureVizSnapshot({
      ...defaultFlintOptions,
      chartType: 'Pie Chart',
      renderBackend: 'echarts',
      xField: 'region',
      yField: 'revenue',
    });
    const pending = snapshotToPending(before, {
      panelId: 7,
      bindings: [],
      schemaFingerprint: 'schema-1',
    });

    expect(pending).toMatchObject({
      chartType: 'Pie Chart',
      xField: 'region',
      yField: 'revenue',
      source: 'undo',
      context: { panelId: 7, schemaFingerprint: 'schema-1' },
    });
    expect(pending).not.toHaveProperty('datasource');
  });

  it('uses all rendered visualization fields when guarding Undo', () => {
    const original = captureVizSnapshot(defaultFlintOptions);
    const manuallyChanged = { ...original, colorField: 'region' };

    expect(snapshotFingerprint(original)).not.toBe(snapshotFingerprint(manuallyChanged));
  });

  it('includes Framework overrides in preview and Undo fingerprints', () => {
    const original = captureVizSnapshot(defaultFlintOptions);
    const customized = {
      ...original,
      frameworkOverrides: {
        echarts: {
          version: 1 as const,
          backend: 'echarts' as const,
          compilerVersion: '0.5.1',
          sourceFingerprint: 'source-a',
          patch: [{ op: 'replace' as const, path: '/tooltip/trigger', value: 'item' }],
        },
      },
    };

    expect(snapshotFingerprint(original)).not.toBe(snapshotFingerprint(customized));
    expect(snapshotToPending(customized).frameworkOverrides).toEqual(customized.frameworkOverrides);
  });
});
