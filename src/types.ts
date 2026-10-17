import { DEFAULT_RENDER_BACKEND, type RenderBackend } from './flint/backends';
import type { FlintPanelContextSnapshot } from './ai/panelContext';
import type { FlintChartState, LegacyChartFields } from './flint/chartState';

export const AUTO_CHART_TYPE = 'auto';

export const WATERFALL_TOTALS_MODES = ['auto', 'none', 'first', 'last', 'both'] as const;
export type WaterfallTotalsMode = (typeof WATERFALL_TOTALS_MODES)[number];

export type { RenderBackend };

/** Visualization fields that AI Assist can write back through ai.pending. */
export interface FlintPendingViz extends Partial<FlintChartState>, LegacyChartFields {
  /** Host-owned revision selected for a reviewed snapshot restore. Never persisted in chart source. */
  restoreRevisionId?: string;
  /** Flint renderer selected for this proposal. Optional for legacy drafts. */
  renderBackend?: RenderBackend;
  rationale?: string;
  /** Immutable evidence for the Grafana query result used to create this draft. */
  context?: FlintPanelContextSnapshot;
  source?: 'auto' | 'provider' | 'mcp' | 'manual' | 'undo';
  /** Refinement baseline guard; retained with saved drafts, removed after successful Apply. */
  baseFingerprint?: string;
}

export interface FlintAiConfig {
  /** UID of the explicitly selected Flint AI data source instance. */
  providerUid?: string;
  /** Last prompt used in the panel editor AI Assist */
  lastPrompt: string;
  /**
   * A validated AI suggestion awaiting an explicit user decision. Drafts never
   * affect the rendered panel until they are promoted to `pending`.
   */
  draft?: FlintPendingViz;
  /**
   * One-time staged visualization update from the options editor. FlintPanel
   * applies it and clears it immediately.
   * The panel applies this via onOptionsChange then clears it.
   */
  pending?: FlintPendingViz;
}

/** Canonical saved options plus read-only legacy fields accepted during migration. */
export interface FlintOptions extends Partial<FlintChartState>, LegacyChartFields {
  ai: FlintAiConfig;
}

export interface PersistedFlintOptions extends FlintChartState {
  ai: FlintAiConfig;
}

export const defaultAiConfig: FlintAiConfig = {
  lastPrompt: '',
};

const AI_CONFIG_KEYS = new Set(['providerUid', 'lastPrompt', 'draft', 'pending']);

function withoutLegacyDataScope(pending?: FlintPendingViz): FlintPendingViz | undefined {
  if (!pending) {
    return undefined;
  }
  const {
    dataScope: _legacyDataScope,
    frameworkOverrides: _overrides,
    ...current
  } = pending as FlintPendingViz & { dataScope?: unknown; frameworkOverrides?: unknown };
  return current;
}

/** Drops direct-browser provider fields from dashboards created before secure proxy support. */
export function sanitizeAiConfig(value?: FlintAiConfig): FlintAiConfig {
  return {
    lastPrompt: value?.lastPrompt ?? '',
    ...(value?.providerUid?.trim() ? { providerUid: value.providerUid.trim() } : {}),
    ...(value?.draft ? { draft: withoutLegacyDataScope(value.draft) } : {}),
    ...(value?.pending ? { pending: withoutLegacyDataScope(value.pending) } : {}),
  };
}

export function hasLegacyAiConfig(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Object.keys(value as Record<string, unknown>).some((key) => !AI_CONFIG_KEYS.has(key))
  );
}

/** Compatibility defaults for inferred UI settings; saved options use FlintChartState. */
export const defaultFlintOptions = {
  renderBackend: DEFAULT_RENDER_BACKEND,
  chartType: AUTO_CHART_TYPE,
  waterfallTotals: 'auto',
  xField: '',
  yField: '',
  colorField: '',
  specJson: '',
  ai: defaultAiConfig,
} satisfies FlintOptions;
