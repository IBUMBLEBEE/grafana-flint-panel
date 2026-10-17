import { FieldType, toDataFrame } from '@grafana/data';
import { assemblePanelChart } from './assemble';
import { dataFramesToFlintTable } from './dataFrames';
import { createManualChartDraft, encodingFields } from './manualChartDraft';
import { toChartState } from './chartState';
import { applyPendingViz } from './applyPendingViz';

const size = { width: 640, height: 360 };
const table = dataFramesToFlintTable([
  toDataFrame({
    fields: [
      { name: 'quarter', type: FieldType.string, values: ['Q1', 'Q2'] },
      { name: 'region', type: FieldType.string, values: ['North', 'South'] },
      { name: 'revenue', type: FieldType.number, values: [120, 180] },
      { name: 'profit', type: FieldType.number, values: [30, 40] },
      { name: 'cost', type: FieldType.number, values: [90, 140] },
    ],
  }),
]);

it.each(['echarts', 'vegalite', 'chartjs', 'plotly'] as const)(
  'configures, compiles, applies and reloads multiple measures without AI: %s',
  (backend) => {
    const current = toChartState({ renderBackend: backend });
    const draft = createManualChartDraft({
      options: current,
      patch: {
        chartType: 'Line Chart',
        channelFields: { x: ['quarter'], y: ['profit', 'revenue'] },
        chartProperties: backend === 'chartjs' ? {} : { showPoints: true },
        addTooltips: false,
      },
    });
    const preview = assemblePanelChart(table, draft, size);
    expect(encodingFields(preview.input.chart_spec.encodings.y)).toEqual(['profit', 'revenue']);
    expect(preview.input.chart_spec.chartProperties?.showPoints).toBe(backend === 'chartjs' ? undefined : true);
    expect(preview.input.options?.addTooltips).toBe(false);
    const applied = applyPendingViz({ ...current, ai: { lastPrompt: '' } }, draft);
    const reloaded = toChartState(JSON.parse(JSON.stringify(applied)));
    expect(assemblePanelChart(table, reloaded, size).input).toEqual(preview.input);
    expect(applied.flintInput).not.toHaveProperty('data');
    expect(applied.flintInput?.chart_spec).not.toHaveProperty('canvasSize');
  }
);

it('supports grouped long-form data with an explicit group field', () => {
  const draft = createManualChartDraft({
    options: toChartState(),
    patch: { chartType: 'Grouped Bar Chart', channelFields: { x: ['quarter'], y: ['revenue'], group: ['region'] } },
  });
  const compiled = assemblePanelChart(table, draft, size);
  expect(encodingFields(compiled.input.chart_spec.encodings.group)).toEqual(['region']);
  expect(encodingFields(compiled.input.chart_spec.encodings.y)).toEqual(['revenue']);
});

it('infers numeric heatmap colors and two category axes', () => {
  const result = assemblePanelChart(table, toChartState({ chartType: 'Heatmap' }), size);
  expect(encodingFields(result.input.chart_spec.encodings.x)).toEqual(['quarter']);
  expect(encodingFields(result.input.chart_spec.encodings.y)).toEqual(['region']);
  expect(encodingFields(result.input.chart_spec.encodings.color)).toEqual(['revenue']);
});

it('maps a single measure and category through a pie switch and back', () => {
  const bar = createManualChartDraft({
    options: toChartState(),
    patch: { chartType: 'Bar Chart', channelFields: { x: ['quarter'], y: ['revenue'] } },
  });
  const pie = createManualChartDraft({
    options: bar,
    patch: { chartType: 'Pie Chart', chartProperties: { innerRadius: 40 } },
  });
  const preview = assemblePanelChart(table, pie, size);
  expect(encodingFields(preview.input.chart_spec.encodings.size)).toEqual(['revenue']);
  expect(encodingFields(preview.input.chart_spec.encodings.color)).toEqual(['quarter']);
  const back = createManualChartDraft({ options: pie, patch: { chartType: 'Bar Chart' } });
  expect(encodingFields(back.flintInput?.chart_spec.encodings.x)).toEqual(['quarter']);
  expect(encodingFields(back.flintInput?.chart_spec.encodings.y)).toEqual(['revenue']);
  expect(back.flintInput?.chart_spec.chartProperties).not.toHaveProperty('innerRadius');
  expect(assemblePanelChart(table, back, size).payload).toBeDefined();
});

it('returns to Auto after chart-specific configuration and compiles only applicable options', () => {
  const line = createManualChartDraft({
    options: toChartState(),
    patch: {
      chartType: 'Line Chart',
      channelFields: { y: ['profit', 'revenue'] },
      chartProperties: { showPoints: true },
      addTooltips: false,
    },
  });
  const auto = createManualChartDraft({ options: line, patch: { chartType: 'auto' } });
  const compiled = assemblePanelChart(table, auto, size);
  expect(auto.flintInput?.chart_spec.chartProperties?.showPoints).toBe(true);
  expect(compiled.input.chart_spec.chartProperties).not.toHaveProperty('showPoints');
  expect(compiled.input.options?.addTooltips).toBe(false);
  expect(encodingFields(compiled.input.chart_spec.encodings.y)).toEqual(['profit', 'revenue']);
});

it('keeps compatible measure bindings when switching a pie to Auto', () => {
  const pie = createManualChartDraft({
    options: toChartState(),
    patch: {
      chartType: 'Pie Chart',
      channelFields: { size: ['profit'], color: ['quarter'] },
      chartProperties: { innerRadius: 40 },
    },
  });
  const auto = createManualChartDraft({ options: pie, patch: { chartType: 'auto' } });
  const compiled = assemblePanelChart(table, auto, size);
  expect(encodingFields(compiled.input.chart_spec.encodings.y)).toEqual(['profit']);
  expect(compiled.input.chart_spec.encodings).not.toHaveProperty('size');
  expect(compiled.input.chart_spec.chartProperties).not.toHaveProperty('innerRadius');
});

it('retains a compatible option when Auto catalogs have different ranges for the same key', () => {
  const bar = createManualChartDraft({
    options: toChartState(),
    patch: { chartType: 'Bar Chart', chartProperties: { cornerRadius: 12 } },
  });
  const auto = createManualChartDraft({ options: bar, patch: { chartType: 'auto' } });
  expect(assemblePanelChart(table, auto, size).input.chart_spec.chartProperties?.cornerRadius).toBe(12);
});
