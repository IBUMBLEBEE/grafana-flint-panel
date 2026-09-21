import { DataFrame } from '@grafana/data';

import { preparePanelData } from '../flint/preparePanelData';
import { validatePendingViz } from '../flint/validateOptions';
import { FlintOptions } from '../types';
import { allowedChartTypes, buildDataHint } from './dataHint';
import { chartCatalogForBackend } from '../flint/chartTypes';
import type { RenderBackend } from '../flint/backends';
import { aiProviderClient, AiProviderClient, ChatMessage, GenerateChartResponse } from './providerClient';

export interface GeneratedFlintOptions {
  chartType: string;
  xField: string;
  yField: string;
  colorField: string;
  specJson: string;
  rationale: string;
}

const CHART_TYPE_ALIASES: Record<string, string> = {
  auto: 'auto',
  line: 'Line Chart',
  'line chart': 'Line Chart',
  area: 'Area Chart',
  'area chart': 'Area Chart',
  bar: 'Bar Chart',
  'bar chart': 'Bar Chart',
  grouped: 'Grouped Bar Chart',
  'grouped bar': 'Grouped Bar Chart',
  stacked: 'Stacked Bar Chart',
  'stacked bar': 'Stacked Bar Chart',
  waterfall: 'Waterfall Chart',
  'waterfall chart': 'Waterfall Chart',
  scatter: 'Scatter Plot',
  'scatter plot': 'Scatter Plot',
  pie: 'Pie Chart',
  'pie chart': 'Pie Chart',
  donut: 'Pie Chart',
  'donut chart': 'Pie Chart',
  heatmap: 'Heatmap',
  histogram: 'Histogram',
  gauge: 'Gauge Chart',
  radar: 'Radar Chart',
};

function normalizeChartType(raw: string, backend: RenderBackend): string {
  const trimmed = raw.trim();
  const allowed = new Set(allowedChartTypes(backend));
  if (allowed.has(trimmed)) {
    return trimmed;
  }
  const alias = CHART_TYPE_ALIASES[trimmed.toLowerCase()];
  if (alias && allowed.has(alias)) {
    return alias;
  }
  throw new Error(`Unsupported chartType from model: ${raw}`);
}

function normalizeGenerated(value: GenerateChartResponse, backend: RenderBackend): GeneratedFlintOptions {
  if (!value || typeof value !== 'object' || typeof value.chartType !== 'string') {
    throw new Error('AI provider response must be a Flint proposal object');
  }
  for (const key of ['xField', 'yField', 'colorField', 'specJson', 'rationale'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`AI provider response ${key} must be a string`);
    }
  }
  return {
    chartType: normalizeChartType(value.chartType, backend),
    xField: value.xField ?? '',
    yField: value.yField ?? '',
    colorField: value.colorField ?? '',
    specJson: value.specJson ?? '',
    rationale: value.rationale ?? '',
  };
}

function validateGeneratedWithSpecFallback(
  generated: GeneratedFlintOptions,
  fieldNames: Iterable<string>,
  backend: RenderBackend
): GeneratedFlintOptions {
  const names = [...fieldNames];
  const fallback = { ...generated, specJson: '' };

  // The scalar proposal is sufficient to render a chart. Validate it first so
  // an optional, provider-invented spec cannot hide invalid field selections.
  validatePendingViz(fallback, names, backend);
  if (!generated.specJson.trim()) {
    return fallback;
  }

  try {
    validatePendingViz(generated, names, backend);
    return generated;
  } catch {
    return {
      ...fallback,
      rationale: [generated.rationale, 'Ignored an incompatible specJson and used the chart and field selections.']
        .filter(Boolean)
        .join(' '),
    };
  }
}

export async function generateFlintOptionsFromAi(args: {
  providerUid: string;
  frames: DataFrame[];
  userPrompt: string;
  renderBackend?: RenderBackend;
  conversation?: ChatMessage[];
  signal?: AbortSignal;
  client?: Pick<AiProviderClient, 'generate'>;
}): Promise<GeneratedFlintOptions> {
  const { providerUid, frames, userPrompt } = args;
  if (!frames.length) {
    throw new Error('No query data yet. Run a query before asking AI.');
  }
  const renderBackend = args.renderBackend ?? 'echarts';
  const prepared = preparePanelData(frames);
  const table = prepared.table;
  const hint = buildDataHint(frames);
  const request = {
    prompt: userPrompt.trim() || 'Choose the best Flint chart for this data.',
    fields: table.fields.map((field) => ({ name: field.name, type: String(field.type) })),
    dataHint: hint.summary,
    suggestedChartType: hint.suggestedChartType,
    renderBackend,
    chartCatalog: chartCatalogForBackend(renderBackend),
    frameSummary: prepared.frames.map((frame) => ({
      frameIndex: frame.frameIndex,
      ...(frame.refId ? { refId: frame.refId } : {}),
      fields: frame.fields.map((field) => field.name),
    })),
    ...(args.conversation?.length ? { conversation: args.conversation } : {}),
  };
  const client = args.client ?? aiProviderClient;
  const payload = args.signal
    ? await client.generate(providerUid, request, args.signal)
    : await client.generate(providerUid, request);
  const generated = normalizeGenerated(payload, renderBackend);
  return validateGeneratedWithSpecFallback(generated, hint.fieldNames, renderBackend);
}

export function applyGeneratedOptions(options: FlintOptions, generated: GeneratedFlintOptions): FlintOptions {
  return {
    ...options,
    chartType: generated.chartType,
    xField: generated.xField,
    yField: generated.yField,
    colorField: generated.colorField,
    specJson: generated.specJson,
    ai: {
      ...options.ai,
      lastPrompt: options.ai?.lastPrompt ?? '',
    },
  };
}
