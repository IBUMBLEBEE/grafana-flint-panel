import { FieldType, toDataFrame } from '@grafana/data';
import { compile } from 'vega-lite';

import { generateFlintOptionsFromAi } from '../ai/generateOptions';
import { defaultFlintOptions } from '../types';
import { applyPendingViz } from './applyPendingViz';
import { assemblePanelChart } from './assemble';
import { toChartState } from './chartState';
import { dataFramesToFlintTable } from './dataFrames';
import { validatePendingViz } from './validateOptions';
import {
  captureVizSnapshot,
  snapshotFingerprint,
  snapshotToPending,
  resolveVisualizationRevision,
} from './visualizationRevision';
import { parseSeriesColors } from './seriesColors';

const colors = { revenue: '#6C91C2', expenses: '#91A4B5', profit: '#C8AA64' };
const frame = toDataFrame({
  fields: [
    { name: 'quarter', type: FieldType.string, values: ['Q1', 'Q2'] },
    { name: 'revenue', type: FieldType.number, values: [100, 120] },
    { name: 'expenses', type: FieldType.number, values: [70, 80] },
    { name: 'profit', type: FieldType.number, values: [30, 40] },
  ],
});
const table = dataFramesToFlintTable([frame]);
const size = { width: 640, height: 360 };
const source = {
  semantic_types: { quarter: 'Category', revenue: 'Amount', expenses: 'Amount', profit: 'Profit' },
  chart_spec: { chartType: 'Grouped Bar Chart', encodings: { x: 'quarter', y: ['revenue', 'expenses', 'profit'] } },
};

describe('reviewed series colors', () => {
  it.each(['echarts', 'chartjs', 'plotly', 'vegalite'] as const)(
    'paints the requested series for %s without changing semantic source or query data',
    (renderBackend) => {
      for (const chartType of ['Grouped Bar Chart', 'Stacked Bar Chart', 'Line Chart']) {
        const state = toChartState({
          renderBackend,
          flintInput: { ...source, chart_spec: { ...source.chart_spec, chartType } },
          seriesColors: colors,
        });
        const result = assemblePanelChart(table, state, size);
        expect(result.input).not.toHaveProperty('seriesColors');
        expect(result.input.data.values).toEqual(table.values);
        expect(state.flintInput.chart_spec.encodings).toEqual(source.chart_spec.encodings);
        const payload = result.payload;
        if (renderBackend === 'echarts') {
          expect(payload.series).toEqual(
            expect.arrayContaining(
              Object.entries(colors).map(([name, color]) =>
                expect.objectContaining({ name, itemStyle: expect.objectContaining({ color }) })
              )
            )
          );
        } else if (renderBackend === 'chartjs') {
          expect((payload.data as { datasets: unknown[] }).datasets).toEqual(
            expect.arrayContaining(
              Object.entries(colors).map(([label, color]) =>
                expect.objectContaining({ label, backgroundColor: color, borderColor: color })
              )
            )
          );
        } else if (renderBackend === 'plotly') {
          expect(payload.data).toEqual(
            expect.arrayContaining(
              Object.entries(colors).map(([name, color]) =>
                expect.objectContaining({ name, marker: expect.objectContaining({ color }) })
              )
            )
          );
        } else {
          expect(payload.encoding).toMatchObject({
            color: {
              field: '__flint_series_key',
              scale: { domain: Object.keys(colors), range: Object.values(colors) },
            },
          });
          expect(() => compile(payload as never)).not.toThrow();
        }
      }
    }
  );

  it('generates, previews, applies, reloads and undoes a palette-only refinement', async () => {
    const baseline = toChartState({ renderBackend: 'echarts', flintInput: source });
    const options = { ...baseline, ai: { lastPrompt: '' } };
    const before = captureVizSnapshot(options);
    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: '商务稳重，深色主题，利润用金色',
      generationMode: 'refine',
      currentChartState: baseline,
      client: {
        generate: async (_uid, request) => {
          expect(request.prompt).toContain('seriesColors');
          return { chartInput: source, seriesColors: colors };
        },
      },
    });
    expect(generated.flintInput).toEqual(baseline.flintInput);
    expect(resolveVisualizationRevision(options, generated).key).not.toBe(resolveVisualizationRevision(options).key);
    expect(options).not.toHaveProperty('seriesColors');
    const applied = applyPendingViz(options, generated);
    const reopened = JSON.parse(JSON.stringify(applied));
    expect(toChartState(reopened).seriesColors).toEqual(colors);
    expect(assemblePanelChart(table, reopened, size).payload.series).toMatchObject([
      { itemStyle: { color: colors.revenue } },
      { itemStyle: { color: colors.expenses } },
      { itemStyle: { color: colors.profit } },
    ]);
    const undone = applyPendingViz(reopened, snapshotToPending(before));
    expect(toChartState(undone).seriesColors).toBeUndefined();
    expect(undone.flintInput).toEqual(baseline.flintInput);
    expect(snapshotFingerprint(toChartState(applied))).not.toBe(snapshotFingerprint(baseline));
    expect(() => applyPendingViz({ ...options, seriesColors: colors }, generated)).toThrow(/stale/);
  });

  it('preserves an existing palette when an older provider returns only a wording change', async () => {
    const baseline = toChartState({ flintInput: source, seriesColors: colors });
    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'Update title',
      generationMode: 'refine',
      currentChartState: baseline,
      client: {
        generate: async () => ({ chartInput: { ...source, chart_spec: { ...source.chart_spec, title: 'Revenue' } } }),
      },
    });
    expect(generated.seriesColors).toEqual(colors);
  });

  it('refines runtime-inferred measure colors without persisting or freezing Auto bindings', async () => {
    const baseline = toChartState({
      bindingMode: 'auto',
      flintInput: { chart_spec: { chartType: 'Grouped Bar Chart', encodings: { x: 'quarter' } } },
    });
    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'Keep the chart; use blue, grey and gold',
      generationMode: 'refine',
      currentChartState: baseline,
      client: {
        generate: async (_uid, request) => {
          expect(request.prompt).toContain('Runtime measure series: ["revenue","expenses","profit"]');
          return { chartType: 'Grouped Bar Chart', seriesColors: colors };
        },
      },
    });
    expect(generated.flintInput).toEqual(baseline.flintInput);
    expect(generated.bindingMode).toBe('auto');
    const saved = applyPendingViz({ ...baseline, ai: { lastPrompt: '' } }, generated);
    expect(assemblePanelChart(table, saved, size).payload.series).toMatchObject([
      { itemStyle: { color: colors.revenue } },
      { itemStyle: { color: colors.expenses } },
      { itemStyle: { color: colors.profit } },
    ]);
    const changed = dataFramesToFlintTable([
      toDataFrame({ fields: frame.fields.filter((field) => field.name !== 'profit') }),
    ]);
    expect(() => assemblePanelChart(changed, saved, size)).toThrow(/exactly the measure fields/);
  });

  it('rejects incomplete, invented and unsafe palettes instead of silently rendering defaults', () => {
    for (const seriesColors of [
      { revenue: '#6C91C2' },
      { ...colors, invented: '#123456' },
      { ...colors, profit: 'url(secret)' },
    ]) {
      expect(() =>
        validatePendingViz(
          { flintInput: source, seriesColors },
          table.fields.map((field) => field.name)
        )
      ).toThrow(/seriesColors/);
    }
    expect(parseSeriesColors({ revenue: '#6C91C2', unused: null })).toEqual({ revenue: '#6C91C2' });
    expect(() =>
      validatePendingViz(
        {
          ...defaultFlintOptions,
          flintInput: { ...source, chart_spec: { ...source.chart_spec, chartType: 'Pie Chart' } },
          seriesColors: colors,
        },
        table.fields.map((field) => field.name)
      )
    ).toThrow(/seriesColors/);
  });
});
