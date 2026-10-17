import { type FlintOptions, type FlintPendingViz, type PersistedFlintOptions, sanitizeAiConfig } from './types';
import { toChartState } from './flint/chartState';

function migrateProposal(proposal?: FlintPendingViz): FlintPendingViz | undefined {
  if (!proposal) {
    return undefined;
  }
  return {
    ...toChartState(proposal),
    rationale: proposal.rationale,
    context: proposal.context,
    source: proposal.source,
    ...(proposal.baseFingerprint !== undefined ? { baseFingerprint: proposal.baseFingerprint } : {}),
  };
}

/** Upgrade source state and retire all backend overrides without changing Grafana queries. */
export function migrateFlintOptions(panel: { options: FlintOptions }): PersistedFlintOptions {
  const ai = sanitizeAiConfig(panel.options.ai);
  return {
    ...toChartState(panel.options),
    ai: { ...ai, draft: migrateProposal(ai.draft), pending: migrateProposal(ai.pending) },
  };
}

export function needsChartStateMigration(panel: { options?: unknown }): boolean {
  const raw = panel.options;
  if (!raw || typeof raw !== 'object') {
    return true;
  }
  const options = raw as Record<string, unknown>;
  const oldKeys = [
    'dataScope',
    'frameworkOverrides',
    'chartType',
    'waterfallTotals',
    'xField',
    'yField',
    'colorField',
    'specJson',
  ];
  const input = options.flintInput as { chart_spec?: Record<string, unknown> } | undefined;
  if (
    options.stateVersion !== 1 ||
    !input ||
    !['auto', 'explicit'].includes(String(options.bindingMode)) ||
    Boolean(input.chart_spec && Object.hasOwn(input.chart_spec, 'canvasSize')) ||
    oldKeys.some((key) => Object.hasOwn(options, key))
  ) {
    return true;
  }
  const ai = options.ai as { draft?: Record<string, unknown>; pending?: Record<string, unknown> } | undefined;
  return [ai?.draft, ai?.pending].some(
    (proposal) =>
      proposal &&
      (proposal.stateVersion !== 1 || !proposal.flintInput || oldKeys.some((key) => Object.hasOwn(proposal, key)))
  );
}

/** Kept for callers detecting pre-source-state dashboards. */
export const hasLegacyDataScope = needsChartStateMigration;
