import { defaultFlintOptions, type FlintPendingViz } from '../types';
import {
  captureVizSnapshot,
  resolveVisualizationRevision,
  snapshotFingerprint,
  snapshotToPending,
  snapshotWithDraft,
} from './visualizationRevision';

const draft: FlintPendingViz = {
  renderBackend: 'plotly',
  chartType: 'Line Chart',
  xField: 'time',
  yField: 'requests',
  colorField: '',
  specJson: '',
  source: 'provider',
};

describe('visualizationRevision', () => {
  it('excludes AI provider and prompt state from the revision key', () => {
    const first = resolveVisualizationRevision({
      ...defaultFlintOptions,
      ai: { providerUid: 'provider-a', lastPrompt: 'first prompt' },
    });
    const second = resolveVisualizationRevision({
      ...defaultFlintOptions,
      ai: { providerUid: 'provider-b', lastPrompt: 'another prompt' },
    });

    expect(second.key).toBe(first.key);
    expect(second.options).toEqual(first.options);
    expect(second.options).not.toHaveProperty('ai');
  });

  it.each([
    ['renderBackend', 'plotly'],
    ['chartType', 'Line Chart'],
    ['waterfallTotals', 'last'],
    ['xField', 'time'],
    ['yField', 'requests'],
    ['colorField', 'region'],
    ['specJson', '{"chart_spec":{"chartType":"Line Chart"}}'],
  ] as const)('changes the revision key when %s changes', (field, value) => {
    const original = resolveVisualizationRevision(defaultFlintOptions);
    const changed = resolveVisualizationRevision({ ...defaultFlintOptions, [field]: value });

    expect(changed.key).not.toBe(original.key);
  });

  it('applies a draft without mutating the committed options', () => {
    const options = {
      ...defaultFlintOptions,
      chartType: 'Bar Chart',
      waterfallTotals: 'both' as const,
      xField: 'region',
      yField: 'revenue',
    };

    const revision = resolveVisualizationRevision(options, draft);

    expect(revision.options).toMatchObject({
      renderBackend: 'plotly',
      chartType: 'Line Chart',
      waterfallTotals: 'both',
      xField: 'time',
      yField: 'requests',
    });
    expect(options).toMatchObject({ renderBackend: 'echarts', chartType: 'Bar Chart', xField: 'region' });
  });

  it('uses stable object ordering for framework override values', () => {
    const override = {
      version: 1 as const,
      backend: 'echarts' as const,
      compilerVersion: '0.5.1',
      sourceFingerprint: 'source-a',
      patch: [{ op: 'replace' as const, path: '/textStyle', value: { fontSize: 12, color: 'red' } }],
    };
    const reordered = {
      ...override,
      patch: [{ op: 'replace' as const, path: '/textStyle', value: { color: 'red', fontSize: 12 } }],
    };

    const first = resolveVisualizationRevision({
      ...defaultFlintOptions,
      frameworkOverrides: { echarts: override },
    });
    const second = resolveVisualizationRevision({
      ...defaultFlintOptions,
      frameworkOverrides: { echarts: reordered },
    });

    expect(second.key).toBe(first.key);
  });

  it('treats a framework override deletion marker as an absent property', () => {
    const absent = resolveVisualizationRevision({ ...defaultFlintOptions, frameworkOverrides: {} });
    const deleted = resolveVisualizationRevision({
      ...defaultFlintOptions,
      frameworkOverrides: { echarts: undefined },
    });

    expect(deleted.key).toBe(absent.key);
  });

  it('captures every render field for preview and Undo', () => {
    const before = captureVizSnapshot({
      ...defaultFlintOptions,
      renderBackend: 'vegalite',
      chartType: 'Waterfall Chart',
      waterfallTotals: 'last',
      xField: 'period',
      yField: 'delta',
    });
    const pending = snapshotToPending(before);

    expect(snapshotWithDraft(defaultFlintOptions, pending)).toEqual(before);
    expect(snapshotFingerprint(before)).toBe(resolveVisualizationRevision({ ...defaultFlintOptions, ...before }).key);
    expect(pending).toMatchObject({ waterfallTotals: 'last', source: 'undo' });
  });
});
