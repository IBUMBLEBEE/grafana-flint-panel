import { DEFAULT_RENDER_BACKEND, type RenderBackend } from './flint/backends';
import type { FlintPanelContextSnapshot } from './ai/panelContext';

export const AUTO_CHART_TYPE = 'auto';

export const WATERFALL_TOTALS_MODES = ['auto', 'none', 'first', 'last', 'both'] as const;
export type WaterfallTotalsMode = (typeof WATERFALL_TOTALS_MODES)[number];

export type { RenderBackend };

export interface FrameworkPatchOperation {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
}

/** Data-free edits applied after Flint compiles one backend-native spec. */
export interface FrameworkOverride {
  version: 1;
  backend: RenderBackend;
  compilerVersion: string;
  sourceFingerprint: string;
  patch: FrameworkPatchOperation[];
}

export type FrameworkOverrides = Partial<Record<RenderBackend, FrameworkOverride>>;

/** Visualization fields that AI Assist can write back through ai.pending. */
export interface FlintPendingViz {
  /** Flint renderer selected for this proposal. Optional for legacy drafts. */
  renderBackend?: RenderBackend;
  chartType: string;
  /** Waterfall endpoint classification. Omitted proposals retain the committed value. */
  waterfallTotals?: WaterfallTotalsMode;
  xField: string;
  yField: string;
  colorField: string;
  specJson: string;
  /** Backend-specific expert edits. Runtime query data is never stored here. */
  frameworkOverrides?: FrameworkOverrides;
  rationale?: string;
  /** Immutable evidence for the Grafana query result used to create this draft. */
  context?: FlintPanelContextSnapshot;
  source?: 'auto' | 'provider' | 'mcp' | 'manual' | 'undo';
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

export interface FlintOptions {
  /** Flint compile + browser render backend */
  renderBackend: RenderBackend;
  /**
   * Flint chart type, or `auto` to infer from Grafana field types.
   */
  chartType: string;
  /** Waterfall endpoint classification. Auto delegates to Flint's data-aware inference. */
  waterfallTotals: WaterfallTotalsMode;
  xField: string;
  yField: string;
  colorField: string;
  /**
   * Optional Flint spec JSON. Data always comes from the panel query.
   * Accepts either a full ChartAssemblyInput (minus data) or a chart_spec object.
   */
  specJson: string;
  /** Backend-specific, data-free edits replayed over freshly compiled output. */
  frameworkOverrides?: FrameworkOverrides;
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
  const { dataScope: _legacyDataScope, ...current } = pending as FlintPendingViz & { dataScope?: unknown };
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

export const defaultFlintOptions: FlintOptions = {
  renderBackend: DEFAULT_RENDER_BACKEND,
  chartType: AUTO_CHART_TYPE,
  waterfallTotals: 'auto',
  xField: '',
  yField: '',
  colorField: '',
  specJson: '',
  frameworkOverrides: {},
  ai: defaultAiConfig,
};
