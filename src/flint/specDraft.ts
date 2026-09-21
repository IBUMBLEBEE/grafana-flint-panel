import type { FlintPanelContextSnapshot } from '../ai/panelContext';
import type { FlintPendingViz } from '../types';
import { assemblePanelChart, type AssembledChart, type PanelSize } from './assemble';
import type { FlintTable } from './dataFrames';
import { clearFrameworkOverride } from './frameworkOverride';
import type { FlintRenderOptions } from './visualizationRevision';

export type FlintSpecEvaluation =
  | { status: 'invalid'; error: string }
  | {
      status: 'valid';
      draft: FlintPendingViz;
      assembled: AssembledChart;
      normalizedText: string;
    };

function normalizeSpecText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid Flint spec JSON: ${message}`);
  }
}

/**
 * Returns the data-free source document shown in the editable workbench.
 * Runtime data and compile dimensions must never be persisted in specJson.
 */
export function editableFlintSpecText(options: FlintRenderOptions, assembled: AssembledChart): string {
  if (options.specJson.trim()) {
    try {
      return normalizeSpecText(options.specJson);
    } catch {
      return options.specJson;
    }
  }

  const { data: _runtimeData, ...inputWithoutData } = assembled.input;
  const { canvasSize: _canvasSize, baseSize: _baseSize, ...chartSpec } = inputWithoutData.chart_spec;
  return JSON.stringify({ ...inputWithoutData, chart_spec: chartSpec }, null, 2);
}

/** Validate, compile, and normalize one manual Flint Spec revision. */
export function evaluateFlintSpecDraft(args: {
  text: string;
  options: FlintRenderOptions;
  table: FlintTable;
  size: PanelSize;
  context?: FlintPanelContextSnapshot;
}): FlintSpecEvaluation {
  if (!args.table.values.length) {
    return { status: 'invalid', error: 'Run the Panel query before validating a Flint Spec.' };
  }

  try {
    const normalizedText = normalizeSpecText(args.text);
    const frameworkOverrides = clearFrameworkOverride(args.options.frameworkOverrides, args.options.renderBackend);
    const candidateOptions = { ...args.options, specJson: normalizedText, frameworkOverrides };
    const assembled = assemblePanelChart(args.table, candidateOptions, args.size);
    const draft: FlintPendingViz = {
      renderBackend: args.options.renderBackend,
      chartType: args.options.chartType,
      xField: args.options.xField,
      yField: args.options.yField,
      colorField: args.options.colorField,
      specJson: normalizedText,
      frameworkOverrides,
      rationale: 'Manually edited Flint Spec.',
      context: args.context,
      source: 'manual',
    };
    if (normalizedText) {
      draft.chartType = assembled.input.chart_spec.chartType;
    }
    return { status: 'valid', draft, assembled, normalizedText };
  } catch (cause) {
    return { status: 'invalid', error: cause instanceof Error ? cause.message : String(cause) };
  }
}
