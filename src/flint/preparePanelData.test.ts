import { FieldType, toDataFrame } from '@grafana/data';

import { preparePanelData } from './preparePanelData';

describe('preparePanelData', () => {
  it('returns the same all-frame table used by render and AI callers', () => {
    const prepared = preparePanelData([
      toDataFrame({ refId: 'A', fields: [{ name: 'value', type: FieldType.number, values: [1] }] }),
      toDataFrame({ refId: 'B', fields: [{ name: 'value', type: FieldType.number, values: [2] }] }),
    ]);

    expect(prepared.table.values.map((row) => row.value)).toEqual([1, 2]);
    expect(prepared.frames).toEqual([
      { frameIndex: 0, refId: 'A', fields: [{ name: 'value', type: 'number' }] },
      { frameIndex: 1, refId: 'B', fields: [{ name: 'value', type: 'number' }] },
    ]);
  });
});
