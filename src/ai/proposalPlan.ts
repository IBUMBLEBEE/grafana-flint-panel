import type { DataFrame } from '@grafana/data';

import { buildChartAssemblyInput } from '../flint/assemble';
import { toChartState, type FlintChartState } from '../flint/chartState';
import { preparePanelData } from '../flint/preparePanelData';
import { seriesFields, SERIES_COLOR_CHART_TYPES } from '../flint/seriesColors';
import { buildDataHint } from './dataHint';
import {
  aiProviderClient,
  type AiProviderClient,
  type ChatMessage,
  type ChatRequest,
  type ProposalPlan,
} from './providerClient';

/** The model selects intent; the host validates the plan before choosing generation constraints. */
export function validateProposalPlan(value: unknown): ProposalPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI provider returned an invalid proposal plan');
  }
  const plan = value as Partial<ProposalPlan>;
  if (
    !['create', 'refine', 'clarify', 'restore'].includes(plan.mode ?? '') ||
    typeof plan.summary !== 'string' ||
    typeof plan.question !== 'string' ||
    new TextEncoder().encode(plan.summary).length > 2048 ||
    new TextEncoder().encode(plan.question).length > 2048
  ) {
    throw new Error('AI provider returned an invalid proposal plan');
  }
  const summary = plan.summary.trim();
  const question = plan.question.trim();
  if (plan.mode === 'clarify' ? !question : !summary || Boolean(question)) {
    throw new Error('AI provider returned an invalid proposal plan');
  }
  if (
    plan.mode === 'restore'
      ? typeof plan.restoreRevisionId !== 'string' || !plan.restoreRevisionId || plan.restoreRevisionId.length > 128
      : Boolean(plan.restoreRevisionId)
  ) {
    throw new Error('AI provider returned an invalid restore revision');
  }
  return {
    mode: plan.mode!,
    summary,
    question,
    ...(plan.mode === 'restore' ? { restoreRevisionId: plan.restoreRevisionId } : {}),
  };
}

export function proposalChatContext(
  frames: DataFrame[],
  currentChartState: FlintChartState
): NonNullable<ChatRequest['panelContext']> {
  const table = preparePanelData(frames).table;
  const state = toChartState(currentChartState);
  const input = state.recovery ? undefined : buildChartAssemblyInput(table, state, { width: 640, height: 360 });
  const measures = input ? seriesFields(input) : [];
  const supportsColors =
    input &&
    SERIES_COLOR_CHART_TYPES.includes(input.chart_spec.chartType) &&
    measures.length > 1 &&
    measures.length <= 16 &&
    !input.chart_spec.encodings.row &&
    !input.chart_spec.encodings.column;
  let dataHint = [
    `Current chart: ${input?.chart_spec.chartType ?? 'invalid source; a replacement is needed'}`,
    `Series color changes supported: ${Boolean(supportsColors)}`,
    'Other supported local changes: chart title, subtitle and field display names.',
  ].join('\n');
  for (const detail of [
    `Current measure series: ${JSON.stringify(measures)}`,
    `Current palette: ${JSON.stringify(state.seriesColors ?? null)}`,
    buildDataHint(frames).summary,
  ]) {
    const expanded = dataHint + '\n' + detail;
    if (new TextEncoder().encode(expanded).length <= 4096) {
      dataHint = expanded;
    }
  }
  return {
    fields: table.fields.map((field) => ({ name: field.name, type: String(field.type) })),
    renderBackend: state.renderBackend,
    dataHint,
  };
}

export async function planProposalFromAi(args: {
  providerUid: string;
  frames: DataFrame[];
  currentChartState: FlintChartState;
  conversation: ChatMessage[];
  signal?: AbortSignal;
  client?: Pick<AiProviderClient, 'plan'>;
  chartHistory?: NonNullable<ChatRequest['panelContext']>['chartHistory'];
}): Promise<ProposalPlan> {
  if (args.signal?.aborted) {
    throw new Error('Request cancelled.');
  }
  const plan = await (args.client ?? aiProviderClient).plan(
    args.providerUid,
    {
      messages: args.conversation,
      panelContext: {
        ...proposalChatContext(args.frames, args.currentChartState),
        ...(args.chartHistory ? { chartHistory: args.chartHistory } : {}),
      },
    },
    args.signal
  );
  if (args.signal?.aborted) {
    throw new Error('Request cancelled.');
  }
  return validateProposalPlan(plan);
}
