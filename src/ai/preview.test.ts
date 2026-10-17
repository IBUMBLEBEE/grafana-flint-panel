import { defaultFlintOptions } from '../types';
import { toChartState } from '../flint/chartState';
import { createManualChartDraft } from '../flint/manualChartDraft';
import { captureVizSnapshot, snapshotFingerprint, snapshotToPending, snapshotWithDraft } from './preview';

describe('Flint AI preview and undo snapshots', () => {
  it('previews canonical source without changing committed options', () => {
    const options = { ...defaultFlintOptions, chartType: 'Line Chart', xField: 'time', yField: 'requests' };
    const draft = toChartState({ renderBackend: 'chartjs', chartType: 'Grouped Bar Chart', xField: 'quarter' });
    expect(snapshotWithDraft(options, draft).flintInput).toEqual(draft.flintInput);
    expect(options).toMatchObject({ chartType: 'Line Chart', xField: 'time' });
  });

  it('creates an undo proposal with the complete prior semantic source', () => {
    const before = captureVizSnapshot({
      ...defaultFlintOptions,
      chartType: 'Pie Chart',
      xField: 'region',
      yField: 'revenue',
    });
    const pending = snapshotToPending(before, { panelId: 7, bindings: [], schemaFingerprint: 'schema-1' });
    expect(pending).toMatchObject({
      flintInput: {
        chart_spec: { chartType: 'Pie Chart', encodings: { color: { field: 'region' }, size: { field: 'revenue' } } },
      },
      source: 'undo',
      context: { panelId: 7, schemaFingerprint: 'schema-1' },
    });
    expect(pending).not.toHaveProperty('datasource');
  });

  it('guards Undo using semantic source changes', () => {
    const original = captureVizSnapshot(defaultFlintOptions);
    const changed = createManualChartDraft({ options: original, patch: { colorField: 'region' } });
    expect(snapshotFingerprint(original)).not.toBe(
      snapshotFingerprint(captureVizSnapshot({ ...changed, ai: { lastPrompt: '' } }))
    );
  });
});
