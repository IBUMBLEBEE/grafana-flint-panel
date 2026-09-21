import type { FrameworkOverride } from '../types';
import { createManualChartDraft } from './manualChartDraft';
import type { FlintRenderOptions } from './visualizationRevision';

const override: FrameworkOverride = {
  version: 1,
  backend: 'echarts',
  compilerVersion: 'test',
  sourceFingerprint: 'source',
  patch: [{ op: 'replace', path: '/grid/top', value: 24 }],
};

const options: FlintRenderOptions = {
  renderBackend: 'echarts',
  chartType: 'Bar Chart',
  waterfallTotals: 'auto',
  xField: 'region',
  yField: 'revenue',
  colorField: '',
  specJson: '{"chartType":"Bar Chart"}',
  frameworkOverrides: { echarts: override },
};

describe('manual chart settings draft', () => {
  it('turns semantic settings into a draft and clears conflicting expert edits', () => {
    expect(createManualChartDraft({ options, patch: { chartType: 'Line Chart' } })).toMatchObject({
      renderBackend: 'echarts',
      chartType: 'Line Chart',
      specJson: '',
      frameworkOverrides: {},
      source: 'manual',
    });
  });

  it('keeps backend-independent Flint Spec when only the renderer changes', () => {
    expect(createManualChartDraft({ options, patch: { renderBackend: 'plotly' } })).toMatchObject({
      renderBackend: 'plotly',
      chartType: 'Bar Chart',
      specJson: options.specJson,
      frameworkOverrides: options.frameworkOverrides,
      source: 'manual',
    });
  });

  it('falls back to Auto when the chart is unsupported by the selected renderer', () => {
    const draft = createManualChartDraft({
      options: { ...options, chartType: 'Gauge Chart', specJson: '' },
      patch: { renderBackend: 'vegalite' },
    });

    expect(draft.chartType).toBe('auto');
  });
});
