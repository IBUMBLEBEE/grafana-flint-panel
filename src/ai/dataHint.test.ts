import { FieldType, toDataFrame } from '@grafana/data';

import { buildDataHint, MAX_DATA_HINT_BYTES, MAX_SAMPLE_ROWS_BYTES } from './dataHint';

describe('buildDataHint', () => {
  it('summarizes category + measure fields and suggests Bar Chart', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'region', type: FieldType.string, values: ['North', 'South'] },
        { name: 'revenue', type: FieldType.number, values: [120, 90] },
      ],
    });

    const hint = buildDataHint([frame]);
    expect(hint.suggestedChartType).toBe('Bar Chart');
    expect(hint.fieldNames).toEqual(['region', 'revenue']);
    expect(hint.querySummary).toBe('Current query: 1 frame · 2 rows · 2 fields\nregion (string), revenue (number)');
    expect(hint.summary).toContain('region');
    expect(hint.sampleRows).toHaveLength(2);
  });

  it('suggests Line Chart for time series', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'Time', type: FieldType.time, values: [1, 2] },
        { name: 'Value', type: FieldType.number, values: [10, 20] },
      ],
    });

    expect(buildDataHint([frame]).suggestedChartType).toBe('Line Chart');
  });

  it('redacts sensitive fields and caps the provider-facing hint at 4 KiB', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'api_token', type: FieldType.string, values: ['must-not-leak'] },
        ...Array.from({ length: 80 }, (_, index) => ({
          name: `long_field_${index}`,
          type: FieldType.string,
          values: ['x'.repeat(200)],
        })),
      ],
    });

    const hint = buildDataHint([frame]);
    expect(hint.summary).toContain('<redacted>');
    expect(hint.summary).not.toContain('must-not-leak');
    expect(JSON.stringify(hint.sampleRows)).toContain('<redacted>');
    expect(JSON.stringify(hint.sampleRows)).not.toContain('must-not-leak');
    expect(new TextEncoder().encode(hint.summary).length).toBeLessThanOrEqual(MAX_DATA_HINT_BYTES);
    expect(new TextEncoder().encode(JSON.stringify(hint.sampleRows)).length).toBeLessThanOrEqual(MAX_SAMPLE_ROWS_BYTES);
  });

  it('describes an empty query without exposing internal context', () => {
    expect(buildDataHint([]).querySummary).toBe('Current query: 0 frames · 0 rows · 0 fields\nNo query fields.');
  });
});
