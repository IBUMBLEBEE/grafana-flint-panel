import { DataSourceInstanceSettings } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';

import type { FlintChartCatalogEntry } from '../flint/chartTypes';
import type { RenderBackend } from '../flint/backends';

export const FLINT_AI_DATASOURCE_PLUGIN_ID = 'ibumblebee-flintai-datasource';

export interface GenerateChartRequest {
  prompt: string;
  fields: Array<{ name: string; type: string }>;
  dataHint?: string;
  suggestedChartType?: string;
  renderBackend: RenderBackend;
  chartCatalog: FlintChartCatalogEntry[];
  semanticTypes: string[];
  sampleRows?: Array<Record<string, unknown>>;
  frameSummary?: Array<{
    frameIndex: number;
    refId?: string;
    fields: string[];
  }>;
  conversation?: ChatMessage[];
}

export interface GenerateChartResponse {
  chartType: string;
  xField?: string;
  yField?: string;
  colorField?: string;
  /** Preferred, data-free structured Flint authoring contract. */
  chartInput?: unknown;
  /** Legacy compatibility for older provider instances. */
  specJson?: string;
  rationale?: string;
}

export interface RepairChartRequest {
  request: GenerateChartRequest;
  candidate: GenerateChartResponse;
  compileError: string;
  attempt: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  panelContext?: {
    fields: Array<{ name: string; type: string }>;
    dataHint?: string;
    renderBackend?: RenderBackend;
  };
}

export interface ChatResponse {
  message: string;
}

export interface AiProviderClient {
  generate(providerUid: string, input: GenerateChartRequest, signal?: AbortSignal): Promise<GenerateChartResponse>;
  repair(providerUid: string, input: RepairChartRequest, signal?: AbortSignal): Promise<GenerateChartResponse>;
  chat(providerUid: string, input: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
}

interface ProviderDataSource {
  generate(input: GenerateChartRequest, signal?: AbortSignal): Promise<GenerateChartResponse>;
  repair(input: RepairChartRequest, signal?: AbortSignal): Promise<GenerateChartResponse>;
  chat(input: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
}

function describeProviderError(cause: unknown): string {
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  if (cause && typeof cause === 'object') {
    const record = cause as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message) {
      return record.message;
    }
    if (
      record.data &&
      typeof record.data === 'object' &&
      typeof (record.data as Record<string, unknown>).message === 'string'
    ) {
      return String((record.data as Record<string, unknown>).message);
    }
  }
  return String(cause);
}

interface DataSourceService {
  get(ref?: string | null): Promise<unknown>;
  getList(filters?: { all?: boolean; pluginId?: string }): DataSourceInstanceSettings[];
  getInstanceSettings(ref?: string | null): DataSourceInstanceSettings | undefined;
}

export interface AiProviderOption {
  label: string;
  value: string;
  description?: string;
}

// getDataSourceSrv remains the only public community-plugin API that can synchronously list
// and instantiate arbitrary data sources from a panel plugin.
export function listAiProviders(service: DataSourceService = getDataSourceSrv()): AiProviderOption[] {
  return service
    .getList({ all: true, pluginId: FLINT_AI_DATASOURCE_PLUGIN_ID })
    .filter((settings) => settings.type === FLINT_AI_DATASOURCE_PLUGIN_ID)
    .map((settings) => ({
      label: settings.name,
      value: settings.uid,
      description:
        typeof (settings.jsonData as Record<string, unknown>)?.model === 'string'
          ? String((settings.jsonData as Record<string, unknown>).model)
          : undefined,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export class GrafanaAiProviderClient implements AiProviderClient {
  constructor(private readonly service: DataSourceService = getDataSourceSrv()) {}

  async generate(
    providerUid: string,
    input: GenerateChartRequest,
    signal?: AbortSignal
  ): Promise<GenerateChartResponse> {
    return this.callProvider(providerUid, 'generate', input, signal);
  }

  async chat(providerUid: string, input: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    return this.callProvider(providerUid, 'chat', input, signal);
  }

  async repair(providerUid: string, input: RepairChartRequest, signal?: AbortSignal): Promise<GenerateChartResponse> {
    return this.callProvider(providerUid, 'repair', input, signal);
  }

  private async callProvider(
    providerUid: string,
    method: 'generate',
    input: GenerateChartRequest,
    signal?: AbortSignal
  ): Promise<GenerateChartResponse>;
  private async callProvider(
    providerUid: string,
    method: 'chat',
    input: ChatRequest,
    signal?: AbortSignal
  ): Promise<ChatResponse>;
  private async callProvider(
    providerUid: string,
    method: 'repair',
    input: RepairChartRequest,
    signal?: AbortSignal
  ): Promise<GenerateChartResponse>;
  private async callProvider(
    providerUid: string,
    method: 'generate' | 'repair' | 'chat',
    input: GenerateChartRequest | RepairChartRequest | ChatRequest,
    signal?: AbortSignal
  ): Promise<GenerateChartResponse | ChatResponse> {
    const uid = providerUid.trim();
    if (!uid) {
      throw new Error(
        `Choose a Flint AI provider before ${method === 'chat' ? 'sending a message' : 'generating a draft'}.`
      );
    }

    const settings = this.service.getInstanceSettings(uid);
    if (!settings || settings.type !== FLINT_AI_DATASOURCE_PLUGIN_ID) {
      throw new Error('The selected Flint AI provider is missing or inaccessible. Choose another provider.');
    }

    try {
      const dataSource = await this.service.get(uid);
      const resource = (dataSource as Partial<ProviderDataSource>)[method];
      if (typeof resource !== 'function') {
        throw new Error(`selected data source does not expose the Flint ${method} resource`);
      }
      const call = resource as (
        input: GenerateChartRequest | RepairChartRequest | ChatRequest,
        signal?: AbortSignal
      ) => Promise<GenerateChartResponse | ChatResponse>;
      return signal ? await call.call(dataSource, input, signal) : await call.call(dataSource, input);
    } catch (cause) {
      if (signal?.aborted) {
        throw new Error('Request cancelled.');
      }
      const detail = describeProviderError(cause);
      throw new Error(`Selected Flint AI provider request failed: ${detail}`);
    }
  }
}

export const aiProviderClient: AiProviderClient = new GrafanaAiProviderClient();
