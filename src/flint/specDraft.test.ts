import { FieldType, toDataFrame } from '@grafana/data';

import { defaultFlintOptions } from '../types';
import { assemblePanelChart } from './assemble';
import { dataFramesToFlintTable } from './dataFrames';
import { editableFlintSpecText, evaluateFlintSpecDraft } from './specDraft';

const size = { width: 640, height: 320 };
const table = dataFramesToFlintTable([
  toDataFrame({
    fields: [
      { name: 'region', type: FieldType.string, values: ['North', 'South'] },
      { name: 'revenue', type: FieldType.number, values: [120, 90] },
    ],
  }),
]);

describe('editableFlintSpecText', () => {
  it('materializes a portable document without query data or runtime dimensions', () => {
    const assembled = assemblePanelChart(table, defaultFlintOptions, size);
    const document = JSON.parse(editableFlintSpecText(defaultFlintOptions, assembled));

    expect(document.data).toBeUndefined();
    expect(document.chart_spec.canvasSize).toBeUndefined();
    expect(document.chart_spec.baseSize).toBeUndefined();
    expect(document.chart_spec.chartType).toBe('auto');
    expect(document.chart_spec.encodings).toEqual({});
  });

  it('preserves and formats an existing authored spec instead of materializing runtime output', () => {
    const options = {
      ...defaultFlintOptions,
      specJson: '{"chartType":"Bar Chart","encodings":{"x":{"field":"region"},"y":{"field":"revenue"}}}',
    };
    const assembled = assemblePanelChart(table, options, size);

    expect(JSON.parse(editableFlintSpecText(options, assembled))).toEqual({
      chart_spec: { chartType: 'Bar Chart', encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    });
  });
});

describe('evaluateFlintSpecDraft', () => {
  it('returns a normalized manual draft after validation and compilation', () => {
    const result = evaluateFlintSpecDraft({
      text: '{"chartType":"Pie Chart","encodings":{"color":{"field":"region"},"size":{"field":"revenue"}}}',
      options: defaultFlintOptions,
      table,
      size,
    });

    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.draft.source).toBe('manual');
      expect(result.draft.renderBackend).toBe('echarts');
      expect(result.draft.flintInput?.chart_spec.chartType).toBe('Pie Chart');
      expect(result.normalizedText).toContain('"chartType": "Pie Chart"');
      expect(result.assembled.input.chart_spec.chartType).toBe('Pie Chart');
    }
  });

  it('rejects unknown fields without replacing the last valid draft', () => {
    const result = evaluateFlintSpecDraft({
      text: JSON.stringify({
        chartType: 'Bar Chart',
        encodings: { x: { field: 'country' }, y: { field: 'revenue' } },
      }),
      options: defaultFlintOptions,
      table,
      size,
    });

    expect(result).toEqual(expect.objectContaining({ status: 'invalid', error: expect.stringMatching(/country/) }));
  });

  it('rejects embedded query data', () => {
    const result = evaluateFlintSpecDraft({
      text: JSON.stringify({
        chart_spec: { chartType: 'Bar Chart', encodings: {} },
        data: { values: [{ region: 'North' }] },
      }),
      options: defaultFlintOptions,
      table,
      size,
    });

    expect(result).toEqual(
      expect.objectContaining({ status: 'invalid', error: expect.stringMatching(/must not contain data/) })
    );
  });
});

describe('Panel-only source validation', () => {
  const source = {
    chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' } },
  };
  it.each([
    [{ ...source, options: { addTooltips: 'off' } }, /options.addTooltips.*boolean/],
    [{ ...source, options: [] }, /options.*object/],
    [{ ...source, options: { tooltip: false } }, /options.tooltip.*not supported/],
    [{ ...source, options: { stepPadding: 2 } }, /options.stepPadding/],
    [{ ...source, options: { facetColumns: 1.5 } }, /options.facetColumns/],
    [{ ...source, chart_spec: { ...source.chart_spec, title: 12 } }, /chart_spec.title.*string/],
    [{ ...source, chart_spec: { ...source.chart_spec, baseSize: { width: 0, height: 100 } } }, /baseSize.width/],
    [{ ...source, chart_spec: { ...source.chart_spec, canvasSize: { width: 100, height: 100 } } }, /canvasSize.*host/],
    [{ ...source, chart_spec: { ...source.chart_spec, background: 'red' } }, /chart_spec.background/],
    [{ ...source, chart_spec: { ...source.chart_spec, encodings: { x: '', y: 'revenue' } } }, /encodings.x/],
    [
      { ...source, chart_spec: { ...source.chart_spec, encodings: { x: 'region', y: ['revenue', 'revenue'] } } },
      /y\[1\].*duplicates/,
    ],
    [
      { ...source, chart_spec: { ...source.chart_spec, encodings: { x: 'region', y: ['revenue', 'region'] } } },
      /y\[1\].*numeric/,
    ],
    [
      { ...source, chart_spec: { ...source.chart_spec, encodings: { x: 'region', y: [['revenue']] } } },
      /y\[0\].*object/,
    ],
    [
      {
        ...source,
        chart_spec: { ...source.chart_spec, encodings: { x: 'region', y: { field: 'revenue', type: 'number' } } },
      },
      /encodings.y.type/,
    ],
    [
      {
        ...source,
        chart_spec: { ...source.chart_spec, encodings: { x: 'region', y: { field: 'revenue', aggregate: 'median' } } },
      },
      /encodings.y.aggregate/,
    ],
    [
      {
        ...source,
        chart_spec: { ...source.chart_spec, encodings: { x: 'region', y: { field: 'revenue', label: 'UI' } } },
      },
      /encodings.y.label/,
    ],
    [
      { ...source, chart_spec: { ...source.chart_spec, encodings: { x: 'region', y: 'revenue', color: ['region'] } } },
      /encodings.color.*arrays/,
    ],
    [
      { ...source, semantic_types: { revenue: { semanticType: 'Amount', intrinsicDomain: [10, 0] } } },
      /intrinsicDomain/,
    ],
    [{ ...source, theme_spec: 'unofficial-theme' }, /official Flint theme/],
  ])('rejects malformed configuration without modifying the current source: %j', (input, error) => {
    const original = JSON.stringify(defaultFlintOptions);
    const result = evaluateFlintSpecDraft({ text: JSON.stringify(input), options: defaultFlintOptions, table, size });
    expect(result).toMatchObject({ status: 'invalid', error: expect.stringMatching(error as RegExp) });
    expect(JSON.stringify(defaultFlintOptions)).toBe(original);
  });

  it('accepts valid official options and semantics through the same compile path', () => {
    const input = {
      ...source,
      options: { addTooltips: false, stepPadding: 0.2, facetFixedPadding: { width: 10, height: 10 } },
      semantic_types: { revenue: { semanticType: 'Amount', unit: 'USD', divergingMidpoint: 0 } },
    };
    expect(
      evaluateFlintSpecDraft({ text: JSON.stringify(input), options: defaultFlintOptions, table, size }).status
    ).toBe('valid');
  });
});
