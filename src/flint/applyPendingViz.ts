import { FlintOptions, FlintPendingViz, sanitizeAiConfig } from '../types';

/** Merge staged AI visualization fields into panel root options. */
export function applyPendingViz(options: FlintOptions, pending: FlintPendingViz): FlintOptions {
  const ai = sanitizeAiConfig(options.ai);
  return {
    ...options,
    renderBackend: pending.renderBackend ?? options.renderBackend,
    chartType: pending.chartType,
    waterfallTotals: pending.waterfallTotals ?? options.waterfallTotals,
    xField: pending.xField,
    yField: pending.yField,
    colorField: pending.colorField,
    specJson: pending.specJson,
    frameworkOverrides: pending.frameworkOverrides ?? options.frameworkOverrides,
    ai: {
      ...ai,
      pending: undefined,
    },
  };
}
