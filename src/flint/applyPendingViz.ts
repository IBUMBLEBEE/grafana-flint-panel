import { type FlintOptions, type FlintPendingViz, type PersistedFlintOptions, sanitizeAiConfig } from '../types';
import { toChartState } from './chartState';
import { snapshotFingerprint } from './visualizationRevision';

/** Save reviewed source and series colors; renderer output and proposal evidence are transient. */
export function applyPendingViz(options: FlintOptions, pending: FlintPendingViz): PersistedFlintOptions {
  if (pending.baseFingerprint !== undefined && pending.baseFingerprint !== snapshotFingerprint(toChartState(options))) {
    throw new Error('This proposal is stale because the chart source changed before Apply.');
  }
  const ai = sanitizeAiConfig(options.ai);
  const state = toChartState({
    ...pending,
    renderBackend: pending.renderBackend ?? options.renderBackend,
    waterfallTotals: pending.waterfallTotals ?? options.waterfallTotals,
  });
  return {
    ...state,
    ai: { ...ai, draft: undefined, pending: undefined },
  };
}
