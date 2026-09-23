import { DataFrame } from '@grafana/data';

import { preparePanelData } from '../flint/preparePanelData';
import { assemblePanelChart } from '../flint/assemble';
import { validatePendingViz } from '../flint/validateOptions';
import { defaultFlintOptions, FlintOptions } from '../types';
import { allowedChartTypes, buildDataHint } from './dataHint';
import { chartCatalogForBackend, FLINT_SEMANTIC_TYPES } from '../flint/chartTypes';
import type { RenderBackend } from '../flint/backends';
import { aiProviderClient, AiProviderClient, ChatMessage, GenerateChartResponse } from './providerClient';

export interface GeneratedFlintOptions {
  chartType: string;
  xField: string;
  yField: string;
  colorField: string;
  specJson: string;
  rationale: string;
  /** Present when an advanced candidate was explicitly rejected and a scalar proposal was used. */
  fallbackReason?: string;
  repairAttempts?: number;
}

const COMPILE_SIZE = { width: 640, height: 360 };

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

function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutNulls).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return value === null ? undefined : value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => [key, withoutNulls(child)] as const)
      .filter(([, child]) => child !== undefined)
  );
}

function structuredSpecJson(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI provider response chartInput must be a structured Flint object');
  }
  return JSON.stringify(withoutNulls(value));
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
    specJson: structuredSpecJson(value.chartInput) ?? value.specJson ?? '',
    rationale: value.rationale ?? '',
  };
}

function scalarFallback(generated: GeneratedFlintOptions): GeneratedFlintOptions {
  return { ...generated, specJson: '', fallbackReason: undefined, repairAttempts: undefined };
}

function validateAndCompileGenerated(
  generated: GeneratedFlintOptions,
  frames: DataFrame[],
  backend: RenderBackend
): void {
  const prepared = preparePanelData(frames);
  validatePendingViz(
    generated,
    prepared.table.fields.map((field) => field.name),
    backend
  );
  if (generated.specJson.trim()) {
    const document = JSON.parse(generated.specJson) as Record<string, unknown>;
    const chartSpec = (document.chart_spec ?? document) as Record<string, unknown>;
    if (chartSpec.chartType !== generated.chartType) {
      throw new Error(
        `Advanced Flint chartType "${String(chartSpec.chartType)}" must match proposal chartType "${generated.chartType}"`
      );
    }
  }
  assemblePanelChart(
    prepared.table,
    {
      ...defaultFlintOptions,
      renderBackend: backend,
      chartType: generated.chartType,
      xField: generated.xField,
      yField: generated.yField,
      colorField: generated.colorField,
      specJson: generated.specJson,
    },
    COMPILE_SIZE
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function explicitFallback(
  fallback: GeneratedFlintOptions,
  reason: string,
  repairAttempts: number
): GeneratedFlintOptions {
  const fallbackReason = `Advanced Flint input was rejected${repairAttempts ? ' after repair' : ''}: ${reason}`;
  return {
    ...fallback,
    fallbackReason,
    repairAttempts,
    rationale: [fallback.rationale, fallbackReason, 'Using the validated chart and field selections instead.']
      .filter(Boolean)
      .join(' '),
  };
}

export async function generateFlintOptionsFromAi(args: {
  providerUid: string;
  frames: DataFrame[];
  userPrompt: string;
  renderBackend?: RenderBackend;
  conversation?: ChatMessage[];
  signal?: AbortSignal;
  client?: Pick<AiProviderClient, 'generate'> & Partial<Pick<AiProviderClient, 'repair'>>;
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
    semanticTypes: [...FLINT_SEMANTIC_TYPES],
    sampleRows: hint.sampleRows,
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
  let fallback: GeneratedFlintOptions | undefined;
  let fallbackIsValid = false;
  try {
    fallback = scalarFallback(generated);
    validateAndCompileGenerated(fallback, frames, renderBackend);
    fallbackIsValid = true;
    validateAndCompileGenerated(generated, frames, renderBackend);
    return generated;
  } catch (firstCause) {
    const firstError = errorMessage(firstCause);
    if (!client.repair) {
      if (fallback && fallbackIsValid) {
        return explicitFallback(fallback, firstError, 0);
      }
      throw firstCause;
    }

    try {
      const repairedPayload = args.signal
        ? await client.repair(
            providerUid,
            { request, candidate: payload, compileError: firstError, attempt: 1 },
            args.signal
          )
        : await client.repair(providerUid, { request, candidate: payload, compileError: firstError, attempt: 1 });
      const repaired = normalizeGenerated(repairedPayload, renderBackend);
      validateAndCompileGenerated(repaired, frames, renderBackend);
      return { ...repaired, repairAttempts: 1 };
    } catch (repairCause) {
      const repairError = errorMessage(repairCause);
      const repairedReason = `${firstError}; repair failed: ${repairError}`;
      if (fallback && fallbackIsValid) {
        return explicitFallback(fallback, repairedReason, 1);
      }
      throw new Error(`Flint proposal failed validation and repair: ${repairedReason}`);
    }
  }
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
