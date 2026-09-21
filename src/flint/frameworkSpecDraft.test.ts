import { FieldType, toDataFrame } from '@grafana/data';

import { defaultFlintOptions } from '../types';
import { assemblePanelChart } from './assemble';
import { dataFramesToFlintTable } from './dataFrames';
import { evaluateFrameworkSpecDraft } from './frameworkSpecDraft';

const size = { width: 640, height: 320 };
const table = dataFramesToFlintTable([
  toDataFrame({
    fields: [
      { name: 'region', type: FieldType.string, values: ['North', 'South'] },
      { name: 'revenue', type: FieldType.number, values: [120, 90] },
    ],
  }),
]);

describe('evaluateFrameworkSpecDraft', () => {
  it('turns an edited compiled spec into a data-free draft override', () => {
    const options = { ...defaultFlintOptions, chartType: 'Bar Chart' };
    const generated = assemblePanelChart(table, options, size);
    const edited = {
      ...generated.payload,
      tooltip: { ...((generated.payload.tooltip as Record<string, unknown>) ?? {}), trigger: 'item' },
    };

    const result = evaluateFrameworkSpecDraft({ text: JSON.stringify(edited), options, table, size });

    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.draft.frameworkOverrides?.echarts).toBeDefined();
      expect(JSON.stringify(result.draft.frameworkOverrides)).not.toContain('North');
      expect(JSON.stringify(result.draft.frameworkOverrides)).not.toContain('120');
      expect(result.assembled.payload.tooltip).toMatchObject({ trigger: 'item' });
    }
  });

  it('rejects invalid JSON and edits to current query values', () => {
    const options = { ...defaultFlintOptions, chartType: 'Bar Chart' };
    expect(evaluateFrameworkSpecDraft({ text: '{', options, table, size })).toMatchObject({
      status: 'invalid',
      error: expect.stringMatching(/Invalid UI Framework Spec JSON/),
    });

    const generated = assemblePanelChart(table, options, size);
    const edited = structuredClone(generated.payload);
    ((edited.series as Array<{ data: number[] }>)[0].data as number[])[0] = 9999;
    expect(evaluateFrameworkSpecDraft({ text: JSON.stringify(edited), options, table, size })).toMatchObject({
      status: 'invalid',
      error: expect.stringMatching(/query data/i),
    });
  });
});
