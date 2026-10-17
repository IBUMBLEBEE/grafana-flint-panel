import type { FlintPanelContextSnapshot } from '../ai/panelContext';
import type { FlintPendingViz } from '../types';
import { assemblePanelChart, type AssembledChart, type PanelSize } from './assemble';
import { parseFlintInput, toChartState, type ChartStateSource } from './chartState';
import type { FlintTable } from './dataFrames';

export type FlintSpecEvaluation =
  | { status: 'invalid'; error: string }
  | { status: 'valid'; draft: FlintPendingViz; assembled: AssembledChart; normalizedText: string };

/** Show the saved source, including Auto choices, without freezing inferred runtime fields. */
export function editableFlintSpecText(options: ChartStateSource, _assembled?: AssembledChart): string {
  const state = toChartState(options);
  return state.recovery?.source ?? JSON.stringify(state.flintInput, null, 2);
}

/** All Spec edits produce the same canonical state used by controls, Apply and Undo. */
export function evaluateFlintSpecDraft(args: {
  text: string;
  options: ChartStateSource;
  table: FlintTable;
  size: PanelSize;
  context?: FlintPanelContextSnapshot;
}): FlintSpecEvaluation {
  if (!args.table.values.length) {
    return { status: 'invalid', error: 'Run the Panel query before validating a Flint Spec.' };
  }
  try {
    const input = parseFlintInput(args.text);
    const state = toChartState({
      renderBackend: args.options.renderBackend,
      bindingMode: input.chart_spec.chartType === 'auto' ? 'auto' : 'explicit',
      flintInput: input,
      seriesColors: toChartState(args.options).seriesColors,
    });
    const assembled = assemblePanelChart(args.table, state, args.size);
    const draft = {
      ...state,
      rationale: 'Manually edited Flint Spec.',
      context: args.context,
      source: 'manual' as const,
    };
    return { status: 'valid', draft, assembled, normalizedText: JSON.stringify(state.flintInput, null, 2) };
  } catch (cause) {
    return { status: 'invalid', error: cause instanceof Error ? cause.message : String(cause) };
  }
}
