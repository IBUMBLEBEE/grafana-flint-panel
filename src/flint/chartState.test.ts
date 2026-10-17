import { FieldType, toDataFrame } from '@grafana/data';

import { applyPendingViz } from './applyPendingViz';
import { assemblePanelChart } from './assemble';
import { toChartState } from './chartState';
import { dataFramesToFlintTable } from './dataFrames';
import { createManualChartDraft } from './manualChartDraft';
import { validatePendingViz } from './validateOptions';
import { defaultFlintOptions } from '../types';

const size = { width: 640, height: 320 };
const table = (field: string, value: number) =>
  dataFramesToFlintTable([
    toDataFrame({
      fields: [
        { name: 'region', type: FieldType.string, values: ['North'] },
        { name: field, type: FieldType.number, values: [value] },
      ],
    }),
  ]);

describe('canonical Flint source lifecycle', () => {
  it('saves source, reopens it and compiles new query values without saving renderer data', () => {
    const source = toChartState({
      flintInput: {
        semantic_types: { region: 'Category', revenue: 'Amount' },
        chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' }, title: 'Revenue' },
      },
    });
    const saved = applyPendingViz(defaultFlintOptions, source);
    const serialized = JSON.stringify(saved);
    const reopened = JSON.parse(serialized);
    const before = assemblePanelChart(table('revenue', 1234), reopened, size);
    const after = assemblePanelChart(table('revenue', 5678), reopened, { width: 960, height: 480 });
    expect(before.input.data.values).toEqual([{ region: 'North', revenue: 1234 }]);
    expect(after.input.data.values).toEqual([{ region: 'North', revenue: 5678 }]);
    expect(after.input.chart_spec.canvasSize).toEqual({ width: 960, height: 480 });
    expect(after.payload).not.toEqual(before.payload);
    expect(JSON.stringify(reopened)).toBe(serialized);
    expect(serialized).not.toMatch(/1234|5678|canvasSize|series|specJson|frameworkOverrides/);
  });

  it('keeps Auto bindings dynamic across schema changes', () => {
    const saved = applyPendingViz(defaultFlintOptions, toChartState());
    const first = assemblePanelChart(table('revenue', 1), saved, size);
    const next = assemblePanelChart(table('profit', 2), saved, size);
    expect(first.input.chart_spec.encodings?.y).toMatchObject({ field: 'revenue' });
    expect(next.input.chart_spec.encodings?.y).toMatchObject({ field: 'profit' });
    expect(saved.flintInput?.chart_spec).toEqual({ chartType: 'auto', encodings: {} });
  });

  it.each(['echarts', 'vegalite', 'plotly', 'chartjs'] as const)('recompiles the same source for %s', (backend) => {
    const source = toChartState({
      flintInput: {
        chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' } },
      },
    });
    const draft = createManualChartDraft({ options: source, patch: { renderBackend: backend } });
    const compiled = assemblePanelChart(table('revenue', 10), draft, size);
    expect(compiled.backend).toBe(backend);
    expect(draft.flintInput).toEqual(source.flintInput);
  });

  it('gives canonical input precedence over obsolete duplicated fields', () => {
    const source = toChartState({ chartType: 'Bar Chart', xField: 'region', yField: 'revenue' });
    const result = toChartState({ ...source, chartType: 'Pie Chart', yField: 'invented', specJson: 'not json' });
    expect(result).toEqual(source);
  });

  it('blocks corrupt legacy backend output until the user authors a replacement source', () => {
    const source = toChartState({ specJson: '{"series":[]}' });
    expect(() => assemblePanelChart(table('revenue', 1), source, size)).toThrow(/chartType/);
    expect(source.recovery?.source).toBe('{"series":[]}');
  });

  it('rejects embedded runtime data and invented fields in structured input', () => {
    const candidate = {
      flintInput: {
        data: { values: [{ secret: 123 }] },
        chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' } },
      },
    };
    expect(() => validatePendingViz(candidate, ['region', 'revenue'])).toThrow(/must not contain data/);
    expect(() =>
      validatePendingViz(toChartState({ chartType: 'Bar Chart', yField: 'invented' }), ['region', 'revenue'])
    ).toThrow(/invented/);
  });
});
