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
    expect(document.chart_spec.chartType).toBe('Bar Chart');
    expect(document.chart_spec.encodings.x.field).toBe('region');
  });

  it('preserves and formats an existing authored spec instead of materializing runtime output', () => {
    const options = {
      ...defaultFlintOptions,
      specJson: '{"chartType":"Bar Chart","encodings":{"x":{"field":"region"},"y":{"field":"revenue"}}}',
    };
    const assembled = assemblePanelChart(table, options, size);

    expect(JSON.parse(editableFlintSpecText(options, assembled))).toEqual({
      chartType: 'Bar Chart',
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
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
      expect(result.draft.chartType).toBe('Pie Chart');
      expect(result.draft.specJson).toContain('\n  "chartType": "Pie Chart"');
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

  it('clears the current backend override when its Flint source is edited', () => {
    const result = evaluateFlintSpecDraft({
      text: '{"chartType":"Bar Chart","encodings":{"x":{"field":"region"},"y":{"field":"revenue"}}}',
      options: {
        ...defaultFlintOptions,
        frameworkOverrides: {
          echarts: {
            version: 1,
            backend: 'echarts',
            compilerVersion: '0.5.1',
            sourceFingerprint: 'old-source',
            patch: [{ op: 'replace', path: '/tooltip/trigger', value: 'item' }],
          },
        },
      },
      table,
      size,
    });

    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.draft.frameworkOverrides?.echarts).toBeUndefined();
    }
  });
});
