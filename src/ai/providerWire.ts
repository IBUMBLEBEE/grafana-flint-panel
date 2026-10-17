import type { GenerateChartRequest, RepairChartRequest } from './providerClient';
import type { RenderBackend } from '../flint/backends';

/** Versioned datasource request contract; UI models evolve independently. */
export const AI_REQUEST_CONTRACT_VERSION = 1;

export interface ChartPropertyWire {
  key: string;
  type: 'continuous' | 'discrete' | 'binary';
  min?: number;
  max?: number;
  options?: unknown[];
}

export interface GenerateChartWireRequest {
  prompt: string;
  fields: Array<{ name: string; type: string }>;
  dataHint?: string;
  suggestedChartType?: string;
  renderBackend: RenderBackend;
  chartCatalog: Array<{
    chartType: string;
    channels: string[];
    requiredChannels: string[];
    properties: ChartPropertyWire[];
  }>;
  semanticTypes: string[];
  sampleRows?: Array<Record<string, unknown>>;
  frameSummary?: Array<{ frameIndex: number; refId?: string; fields: string[] }>;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface ChartCandidateWire {
  seriesColors?: Record<string, string> | null;
  chartType?: string;
  xField?: string;
  yField?: string;
  colorField?: string;
  chartInput?: unknown;
  specJson?: string;
  rationale?: string;
}

export interface RepairChartWireRequest {
  request: GenerateChartWireRequest;
  candidate: ChartCandidateWire;
  compileError: string;
  attempt: number;
}

/** Explicit allowlists at every typed level prevent new UI metadata reaching strict decoders. */
export function toGenerateChartWireRequest(input: GenerateChartRequest): GenerateChartWireRequest {
  return {
    prompt: input.prompt,
    fields: input.fields.map(({ name, type }) => ({ name, type })),
    dataHint: input.dataHint,
    suggestedChartType: input.suggestedChartType,
    renderBackend: input.renderBackend,
    chartCatalog: input.chartCatalog.map(({ chartType, channels, requiredChannels, properties }) => ({
      chartType,
      channels: [...channels],
      requiredChannels: [...requiredChannels],
      properties: properties.map(({ key, type, min, max, options }) => ({ key, type, min, max, options })),
    })),
    semanticTypes: [...input.semanticTypes],
    sampleRows: input.sampleRows,
    frameSummary: input.frameSummary?.map(({ frameIndex, refId, fields }) => ({
      frameIndex,
      refId,
      fields: [...fields],
    })),
    conversation: input.conversation?.map(({ role, content }) => ({ role, content })),
  };
}

export function toRepairChartWireRequest(input: RepairChartRequest): RepairChartWireRequest {
  const { seriesColors, chartType, xField, yField, colorField, chartInput, specJson, rationale } = input.candidate;
  return {
    request: toGenerateChartWireRequest(input.request),
    candidate: { seriesColors, chartType, xField, yField, colorField, chartInput, specJson, rationale },
    compileError: input.compileError,
    attempt: input.attempt,
  };
}
