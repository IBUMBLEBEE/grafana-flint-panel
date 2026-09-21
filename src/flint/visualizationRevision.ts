import type { FlintPanelContextSnapshot } from '../ai/panelContext';
import {
  defaultFlintOptions,
  type FlintOptions,
  type FlintPendingViz,
  type FrameworkOverrides,
  type WaterfallTotalsMode,
} from '../types';
import type { RenderBackend } from './backends';

/** The complete data-free input that can affect Flint compilation or rendering. */
export interface FlintRenderOptions {
  renderBackend: RenderBackend;
  chartType: string;
  waterfallTotals: WaterfallTotalsMode;
  xField: string;
  yField: string;
  colorField: string;
  specJson: string;
  frameworkOverrides?: FrameworkOverrides;
}

export type FlintVizSnapshot = FlintRenderOptions;

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

function revisionKey(options: FlintRenderOptions): string {
  return JSON.stringify(canonicalize(options));
}

/** Resolve a proposal over committed options and identify only visual changes. */
export function resolveVisualizationRevision(options: FlintOptions, draft?: FlintPendingViz): VisualizationRevision {
  const renderOptions: FlintRenderOptions = {
    renderBackend: draft?.renderBackend ?? options.renderBackend ?? defaultFlintOptions.renderBackend,
    chartType: draft?.chartType ?? options.chartType ?? defaultFlintOptions.chartType,
    waterfallTotals: draft?.waterfallTotals ?? options.waterfallTotals ?? defaultFlintOptions.waterfallTotals,
    xField: draft?.xField ?? options.xField ?? defaultFlintOptions.xField,
    yField: draft?.yField ?? options.yField ?? defaultFlintOptions.yField,
    colorField: draft?.colorField ?? options.colorField ?? defaultFlintOptions.colorField,
    specJson: draft?.specJson ?? options.specJson ?? defaultFlintOptions.specJson,
    frameworkOverrides: draft?.frameworkOverrides ?? options.frameworkOverrides,
  };

  return { options: renderOptions, key: revisionKey(renderOptions) };
}

export function captureVizSnapshot(options: FlintOptions): FlintVizSnapshot {
  return resolveVisualizationRevision(options).options;
}

export function snapshotWithDraft(options: FlintOptions, draft: FlintPendingViz): FlintVizSnapshot {
  return resolveVisualizationRevision(options, draft).options;
}

export function snapshotFingerprint(snapshot: FlintVizSnapshot): string {
  return revisionKey(snapshot);
}

export function snapshotToPending(snapshot: FlintVizSnapshot, context?: FlintPanelContextSnapshot): FlintPendingViz {
  return {
    ...snapshot,
    rationale: 'Restored the visualization configuration from before the last AI Apply.',
    context,
    source: 'undo',
  };
}
