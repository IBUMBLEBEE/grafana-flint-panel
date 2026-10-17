import { FieldType, toDataFrame } from '@grafana/data';

import { toChartState } from '../flint/chartState';
import { planProposalFromAi, proposalChatContext, validateProposalPlan } from './proposalPlan';
import type { ChatRequest } from './providerClient';

const frames = [
  toDataFrame({
    fields: [
      { name: 'quarter', type: FieldType.string, values: ['Q1'] },
      { name: 'revenue', type: FieldType.number, values: [100] },
      { name: 'expenses', type: FieldType.number, values: [70] },
      { name: 'profit', type: FieldType.number, values: [30] },
    ],
  }),
];
const baseline = toChartState({
  bindingMode: 'auto',
  flintInput: { chart_spec: { chartType: 'Grouped Bar Chart', encodings: { x: 'quarter' } } },
});

describe('automatic proposal planning', () => {
  it('uses the whole conversation and runtime chart capabilities to resolve a short confirmation', async () => {
    const conversation = [
      { role: 'user' as const, content: '换高对比配色，保持分组柱状图' },
      { role: 'assistant' as const, content: 'revenue #0072B2, expenses #D55E00, profit #009E73' },
      { role: 'user' as const, content: '你来替换，然后我来 review' },
    ];
    const plan = jest.fn(async (_uid: string, _input: ChatRequest) => ({
      mode: 'refine' as const,
      summary: '保持当前分组柱状图；营收蓝色、支出橙色、利润绿色。',
      question: '',
    }));
    const result = await planProposalFromAi({
      providerUid: 'provider-a',
      frames,
      currentChartState: baseline,
      conversation,
      client: { plan },
    });
    expect(result.mode).toBe('refine');
    expect(plan).toHaveBeenCalledWith(
      'provider-a',
      {
        messages: conversation,
        panelContext: expect.objectContaining({
          dataHint: expect.stringContaining('Series color changes supported: true'),
        }),
      },
      undefined
    );
    expect(plan.mock.calls[0][1].panelContext?.dataHint).toContain('["revenue","expenses","profit"]');
    expect(baseline.flintInput.chart_spec.encodings).toEqual({ x: 'quarter' });
  });

  it('reports that palettes are unsupported for a single measure chart', () => {
    const context = proposalChatContext(
      frames,
      toChartState({
        flintInput: { chart_spec: { chartType: 'Bar Chart', encodings: { x: 'quarter', y: 'revenue' } } },
      })
    );
    expect(context?.dataHint).toContain('Series color changes supported: false');
  });

  it.each([
    { mode: 'refine', summary: 'Rename the chart', question: '' },
    { mode: 'create', summary: 'Replace the bars with lines', question: '' },
    { mode: 'clarify', summary: '', question: 'What would you like to change?' },
  ])('accepts a bounded $mode plan', (plan) => {
    expect(validateProposalPlan(plan)).toEqual(plan);
  });

  it.each([
    undefined,
    {},
    { mode: 'auto', summary: 'Guess', question: '' },
    { mode: 'create', summary: '', question: '' },
    { mode: 'clarify', summary: '', question: '' },
    { mode: 'refine', summary: 'Rename', question: 'Also redesign?' },
    { mode: 'create', summary: 'a'.repeat(2049), question: '' },
  ])('rejects an invalid plan without choosing a broader mode', (plan) => {
    expect(() => validateProposalPlan(plan)).toThrow(/invalid proposal plan/);
  });

  it('does not accept a plan that completes after cancellation', async () => {
    const controller = new AbortController();
    await expect(
      planProposalFromAi({
        providerUid: 'provider-a',
        frames,
        currentChartState: baseline,
        conversation: [{ role: 'user', content: 'Change colors' }],
        signal: controller.signal,
        client: {
          plan: async () => {
            controller.abort();
            return { mode: 'create', summary: 'Replace chart', question: '' };
          },
        },
      })
    ).rejects.toThrow(/cancelled/);
  });
});
