import type { FlintPanelContextSnapshot } from '../ai/panelContext';
import type { FlintPendingViz } from '../types';
import { allowedChartTypesForBackend } from './chartTypes';
import { clearFrameworkOverride } from './frameworkOverride';
import type { FlintRenderOptions } from './visualizationRevision';

export type ManualChartSettingsPatch = Partial<
  Pick<FlintRenderOptions, 'renderBackend' | 'chartType' | 'waterfallTotals' | 'xField' | 'yField' | 'colorField'>
>;

const SEMANTIC_SETTINGS: Array<keyof ManualChartSettingsPatch> = [
  'chartType',
  'waterfallTotals',
  'xField',
  'yField',
  'colorField',
];

/** Creates one reviewable manual revision without mutating committed Panel options. */
export function createManualChartDraft(args: {
  options: FlintRenderOptions;
  patch: ManualChartSettingsPatch;
  context?: FlintPanelContextSnapshot;
}): FlintPendingViz {
  const next = { ...args.options, ...args.patch };
  let semanticChange = SEMANTIC_SETTINGS.some(
    (setting) => setting in args.patch && args.patch[setting] !== args.options[setting]
  );

  if (!allowedChartTypesForBackend(next.renderBackend).includes(next.chartType)) {
    next.chartType = 'auto';
    semanticChange = true;
  }

  return {
    ...next,
    specJson: semanticChange ? '' : next.specJson,
    frameworkOverrides: semanticChange
      ? clearFrameworkOverride(next.frameworkOverrides, next.renderBackend)
      : next.frameworkOverrides,
    rationale: 'Manually adjusted chart settings.',
    context: args.context,
    source: 'manual',
  };
}
