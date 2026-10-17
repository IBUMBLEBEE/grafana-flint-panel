import type { FlintPanelContextSnapshot } from '../ai/panelContext';
import { defaultFlintOptions, type FlintOptions, type FlintPendingViz, type WaterfallTotalsMode } from '../types';
import type { RenderBackend } from './backends';
import { chartSettings, toChartState, type FlintChartState } from './chartState';

/** The complete data-free input that can affect Flint compilation or rendering. */
export interface FlintRenderOptions {
  renderBackend: RenderBackend;
  chartType: string;
  waterfallTotals: WaterfallTotalsMode;
  xField: string;
  yField: string;
  colorField: string;
  specJson: string;
  flintInput?: FlintChartState['flintInput'];
  seriesColors?: FlintChartState['seriesColors'];
  bindingMode?: FlintChartState['bindingMode'];
  stateVersion?: 1;
  recovery?: FlintChartState['recovery'];
}

export type FlintVizSnapshot = FlintChartState;

export interface VisualizationRevision {
  options: FlintRenderOptions;
  /** Stable identity of render fields only. Query data has a separate generation key. */
  key: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function revisionKey(options: FlintChartState): string {
  return JSON.stringify(canonicalize(toChartState(options)));
}

/** Resolve a proposal over committed options and identify only visual changes. */
export function resolveVisualizationRevision(options: FlintOptions, draft?: FlintPendingViz): VisualizationRevision {
  const state = toChartState(
    draft
      ? {
          ...draft,
          renderBackend: draft.renderBackend ?? options.renderBackend ?? defaultFlintOptions.renderBackend,
          waterfallTotals: draft.waterfallTotals ?? options.waterfallTotals,
        }
      : options
  );
  const renderOptions = { ...state, ...chartSettings(state) };
  return { options: renderOptions, key: JSON.stringify(canonicalize(state)) };
}

export function captureVizSnapshot(options: FlintOptions): FlintVizSnapshot {
  return toChartState(options);
}

export function snapshotWithDraft(options: FlintOptions, draft: FlintPendingViz): FlintVizSnapshot {
  return toChartState(resolveVisualizationRevision(options, draft).options);
}

export function snapshotFingerprint(snapshot: FlintVizSnapshot): string {
  return revisionKey(snapshot);
}

export function snapshotToPending(snapshot: FlintVizSnapshot, context?: FlintPanelContextSnapshot): FlintPendingViz {
  return {
    ...toChartState(snapshot),
    rationale: 'Restored the visualization configuration from before the last AI Apply.',
    context,
    source: 'undo',
  };
}
