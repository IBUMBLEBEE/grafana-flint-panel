import { createManualChartDraft } from './manualChartDraft';
import { toChartState, type FlintInput } from './chartState';

const flintInput: FlintInput = {
  semantic_types: { region: 'Category', revenue: 'Amount', profit: 'Profit' },
  field_display_names: { revenue: 'Revenue' },
  options: { addTooltips: true },
  chart_spec: {
    chartType: 'Bar Chart',
    encodings: {
      x: { field: 'region' },
      y: { field: 'revenue', sortOrder: 'descending' },
      column: { field: 'region' },
    },
    chartProperties: { cornerRadius: 5 },
    title: 'Business results',
    baseSize: { width: 560, height: 440 },
  },
};
const options = toChartState({ flintInput, bindingMode: 'explicit' });

describe('manual chart settings draft', () => {
  it('changes the measure while retaining semantics, facets, properties and metadata', () => {
    const draft = createManualChartDraft({ options, patch: { yField: 'profit' } });
    expect(draft.flintInput).toMatchObject({
      ...flintInput,
      chart_spec: {
        ...flintInput.chart_spec,
        encodings: { ...flintInput.chart_spec.encodings, y: { field: 'profit', sortOrder: 'descending' } },
      },
    });
    expect(options.flintInput).toEqual(flintInput);
    expect(draft).not.toHaveProperty('specJson');
  });

  it('switches backends without changing the source', () => {
    const draft = createManualChartDraft({ options, patch: { renderBackend: 'plotly' } });
    expect(draft.renderBackend).toBe('plotly');
    expect(draft.flintInput).toEqual(flintInput);
  });

  it('retains unsupported source instead of silently replacing its chart type', () => {
    const draft = createManualChartDraft({
      options: toChartState({ chartType: 'Gauge Chart', yField: 'revenue' }),
      patch: { renderBackend: 'vegalite' },
    });
    expect(draft.flintInput?.chart_spec.chartType).toBe('Gauge Chart');
  });

  it('represents Auto as a missing source binding and keeps other channels', () => {
    const draft = createManualChartDraft({ options, patch: { yField: '' } });
    expect(draft.bindingMode).toBe('auto');
    expect(draft.flintInput?.chart_spec.encodings).not.toHaveProperty('y');
    expect(draft.flintInput?.chart_spec.encodings?.column).toEqual({ field: 'region' });
  });
});

it('selects an ordered subset of measures and preserves matching encoding metadata', () => {
  const draft = createManualChartDraft({ options, patch: { channelFields: { y: ['profit', 'revenue'] } } });
  expect(draft.flintInput?.chart_spec.encodings.y).toEqual([
    { field: 'profit' },
    { field: 'revenue', sortOrder: 'descending' },
  ]);
  expect(options.flintInput).toEqual(flintInput);
});

it('switches compatible mappings and keeps chart metadata and global options', () => {
  const grouped = createManualChartDraft({
    options,
    patch: { chartType: 'Grouped Bar Chart', channelFields: { group: ['region'] } },
  });
  const stacked = createManualChartDraft({ options: grouped, patch: { chartType: 'Stacked Bar Chart' } });
  expect(stacked.flintInput?.chart_spec.encodings).toMatchObject({
    x: { field: 'region' },
    y: { field: 'revenue', sortOrder: 'descending' },
    color: { field: 'region' },
    column: { field: 'region' },
  });
  expect(stacked.flintInput?.chart_spec.encodings).not.toHaveProperty('group');
  expect(stacked.flintInput?.chart_spec).toMatchObject({
    title: 'Business results',
    baseSize: { width: 560, height: 440 },
  });
  expect(stacked.flintInput?.options).toEqual({ addTooltips: true });
});

it('changes and resets a property without resetting other settings', () => {
  const draft = createManualChartDraft({
    options,
    patch: { chartProperties: { cornerRadius: 9 }, addTooltips: false },
  });
  expect(draft.flintInput?.chart_spec.chartProperties).toEqual({ cornerRadius: 9 });
  expect(draft.flintInput?.options?.addTooltips).toBe(false);
  const reset = createManualChartDraft({ options: draft, patch: { chartProperties: { cornerRadius: undefined } } });
  expect(reset.flintInput?.chart_spec.chartProperties).not.toHaveProperty('cornerRadius');
  expect(reset.flintInput?.options?.addTooltips).toBe(false);
  expect(reset.flintInput?.field_display_names).toEqual(flintInput.field_display_names);
});

it('retains a palette for compatible chart switches and removes it when the measures change', () => {
  const current = toChartState({
    flintInput: { chart_spec: { chartType: 'Line Chart', encodings: { x: 'region', y: ['revenue', 'profit'] } } },
    seriesColors: { revenue: '#111111', profit: '#222222' },
  });
  const compatible = createManualChartDraft({ options: current, patch: { chartType: 'Grouped Bar Chart' } });
  expect(compatible.seriesColors).toEqual(current.seriesColors);
  const changed = createManualChartDraft({ options: compatible, patch: { channelFields: { y: ['revenue'] } } });
  expect(changed.seriesColors).toBeUndefined();
});
