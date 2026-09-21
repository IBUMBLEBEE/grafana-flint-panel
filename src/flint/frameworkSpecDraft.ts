import type { FlintPanelContextSnapshot } from '../ai/panelContext';
import type { FlintPendingViz } from '../types';
import { assemblePanelChart, type AssembledChart, type PanelSize } from './assemble';
import type { FlintTable } from './dataFrames';
import { clearFrameworkOverride, createFrameworkOverride } from './frameworkOverride';
import type { FlintRenderOptions } from './visualizationRevision';

export type FrameworkSpecEvaluation =
  | { status: 'invalid'; error: string }
  | {
      status: 'valid';
      draft: FlintPendingViz;
      assembled: AssembledChart;
      normalizedText: string;
    };

function parseFrameworkSpec(text: string): { payload: Record<string, unknown>; normalizedText: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid UI Framework Spec JSON: ${message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid UI Framework Spec JSON: expected an object');
  }
  return {
    payload: parsed as Record<string, unknown>,
    normalizedText: JSON.stringify(parsed, null, 2),
  };
}

/** Validate a full edited compiled spec and persist only its data-free difference. */
export function evaluateFrameworkSpecDraft(args: {
  text: string;
  options: FlintRenderOptions;
  table: FlintTable;
  size: PanelSize;
  context?: FlintPanelContextSnapshot;
}): FrameworkSpecEvaluation {
  if (!args.table.values.length) {
    return { status: 'invalid', error: 'Run the Panel query before validating a UI Framework Spec.' };
  }

  try {
    const { payload: edited, normalizedText } = parseFrameworkSpec(args.text);
    const backend = args.options.renderBackend;
    const generatedOptions = {
      ...args.options,
      frameworkOverrides: clearFrameworkOverride(args.options.frameworkOverrides, backend),
    };
    const generated = assemblePanelChart(args.table, generatedOptions, args.size);
    const override = createFrameworkOverride({
      backend,
      input: generated.input,
      generated: generated.payload,
      edited,
    });
    const frameworkOverrides = override
      ? { ...args.options.frameworkOverrides, [backend]: override }
      : clearFrameworkOverride(args.options.frameworkOverrides, backend);
    const assembled = assemblePanelChart(args.table, { ...args.options, frameworkOverrides }, args.size);
    const draft: FlintPendingViz = {
      renderBackend: backend,
      chartType: args.options.chartType,
      xField: args.options.xField,
      yField: args.options.yField,
      colorField: args.options.colorField,
      specJson: args.options.specJson,
      frameworkOverrides,
      rationale: 'Manually edited UI Framework Spec.',
      context: args.context,
      source: 'manual',
    };
    return { status: 'valid', draft, assembled, normalizedText };
  } catch (cause) {
    return { status: 'invalid', error: cause instanceof Error ? cause.message : String(cause) };
  }
}
