import { FieldType, toDataFrame } from '@grafana/data';

import { dataFramesToFlintTable, fieldDisplayName } from './dataFrames';

describe('dataFramesToFlintTable', () => {
  it('converts a single table frame into Flint row objects', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'region', type: FieldType.string, values: ['North', 'South'] },
        { name: 'revenue', type: FieldType.number, values: [120, 90] },
      ],
    });

    expect(dataFramesToFlintTable([frame])).toEqual({
      fields: [
        { name: 'region', type: FieldType.string },
        { name: 'revenue', type: FieldType.number },
      ],
      values: [
        { region: 'North', revenue: 120 },
        { region: 'South', revenue: 90 },
      ],
    });
  });

  it('melts multiple time series frames into Time / Value / series', () => {
    const cpu = toDataFrame({
      name: 'cpu',
      fields: [
        { name: 'Time', type: FieldType.time, values: [1, 2] },
        { name: 'Value', type: FieldType.number, labels: { instance: 'a' }, values: [10, 20] },
      ],
    });
    const mem = toDataFrame({
      name: 'mem',
      fields: [
        { name: 'Time', type: FieldType.time, values: [1, 2] },
        { name: 'Value', type: FieldType.number, labels: { instance: 'b' }, values: [30, 40] },
      ],
    });

    const table = dataFramesToFlintTable([cpu, mem]);

    expect(table.fields.map((field) => field.name)).toEqual(['Time', 'series', 'Value']);
    expect(table.values).toEqual([
      { Time: 1, series: 'instance=a', Value: 10 },
      { Time: 2, series: 'instance=a', Value: 20 },
      { Time: 1, series: 'instance=b', Value: 30 },
      { Time: 2, series: 'instance=b', Value: 40 },
    ]);
  });

  it('keeps a single Time + Label + Value frame in table form', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'Time', type: FieldType.time, values: [1, 2] },
        { name: 'Label', type: FieldType.string, values: ['A', 'B'] },
        { name: 'Value', type: FieldType.number, values: [10, 20] },
      ],
    });

    expect(dataFramesToFlintTable([frame]).values).toEqual([
      { Time: 1, Label: 'A', Value: 10 },
      { Time: 2, Label: 'B', Value: 20 },
    ]);
  });

  it('concatenates compatible table frames instead of dropping later query results', () => {
    const north = toDataFrame({
      name: 'north',
      refId: 'A',
      fields: [
        { name: 'region', type: FieldType.string, values: ['North'] },
        { name: 'revenue', type: FieldType.number, values: [120] },
      ],
    });
    const south = toDataFrame({
      name: 'south',
      refId: 'B',
      fields: [
        { name: 'region', type: FieldType.string, values: ['South'] },
        { name: 'revenue', type: FieldType.number, values: [90] },
      ],
    });

    const table = dataFramesToFlintTable([north, south]);

    expect(table.values).toEqual([
      { region: 'North', revenue: 120, __grafana_frame: 'A' },
      { region: 'South', revenue: 90, __grafana_frame: 'B' },
    ]);
    expect(table.fields).toContainEqual({ name: '__grafana_frame', type: FieldType.string, internal: true });
    expect(table.warnings).toEqual([]);
  });

  it('unions heterogeneous table frames and reports that Grafana transformations may be needed', () => {
    const categories = toDataFrame({
      refId: 'A',
      fields: [{ name: 'region', type: FieldType.string, values: ['North'] }],
    });
    const measures = toDataFrame({
      refId: 'B',
      fields: [{ name: 'revenue', type: FieldType.number, values: [120] }],
    });

    const table = dataFramesToFlintTable([categories, measures]);

    expect(table.values).toHaveLength(2);
    expect(table.values[0]).toMatchObject({ region: 'North', __grafana_frame: 'A' });
    expect(table.values[1]).toMatchObject({ revenue: 120, __grafana_frame: 'B' });
    expect(table.warnings?.[0]).toContain('heterogeneous');
  });
});

describe('fieldDisplayName', () => {
  it('prefers displayNameFromDS over labels', () => {
    const frame = toDataFrame({
      fields: [
        {
          name: 'Value',
          type: FieldType.number,
          values: [1],
          config: { displayNameFromDS: 'CPU' },
          labels: { instance: 'a' },
        },
      ],
    });

    expect(fieldDisplayName(frame.fields[0])).toBe('CPU');
  });
});
