import { DataSourceInstanceSettings } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';

import type { FlintChartCatalogEntry } from '../flint/chartTypes';
import type { RenderBackend } from '../flint/backends';
import type { FlintChartState } from '../flint/chartState';
import {
  AI_REQUEST_CONTRACT_VERSION,
  toGenerateChartWireRequest,
  toRepairChartWireRequest,
  type GenerateChartWireRequest,
  type RepairChartWireRequest,
} from './providerWire';

export interface ProviderTransportEvent {
  stage: 'datasource-call';
  request: unknown;
  contractVersion?: number;
}
export type ProviderTransportObserver = (event: ProviderTransportEvent) => void;

export type AiGenerationMode = 'create' | 'refine';

export const FLINT_AI_DATASOURCE_PLUGIN_ID = 'ibumblebee-flintai-datasource';

export interface GenerateChartRequest {
  prompt: string;
  generationMode?: AiGenerationMode;
  currentChartState?: FlintChartState;
  allowedPaths?: string[];
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
  seriesColors?: Record<string, string> | null;
  chartType?: string;
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
    chartHistory?: {
      revisions: Array<{ id: string; label: string; createdAt: number }>;
      unavailableReason?: string;
    };
  };
}

export interface ChatResponse {
  message: string;
}

export interface ProposalPlan {
  mode: AiGenerationMode | 'clarify' | 'restore';
  restoreRevisionId?: string;
  summary: string;
  question: string;
}

export interface AiProviderClient {
  plan(
    providerUid: string,
    input: ChatRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<ProposalPlan>;
  generate(
    providerUid: string,
    input: GenerateChartRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<GenerateChartResponse>;
  repair(
    providerUid: string,
    input: RepairChartRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<GenerateChartResponse>;
  chat(
    providerUid: string,
    input: ChatRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<ChatResponse>;
}

interface ProviderDataSource {
  plan(input: ChatRequest, signal?: AbortSignal): Promise<ProposalPlan>;
  generate(input: GenerateChartWireRequest, signal?: AbortSignal): Promise<GenerateChartResponse>;
  repair(input: RepairChartWireRequest, signal?: AbortSignal): Promise<GenerateChartResponse>;
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

export function providerHttpStatus(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object') {
    return undefined;
  }
  const error = cause as { httpStatus?: unknown; status?: unknown; response?: { status?: unknown } };
  const status = error.httpStatus ?? error.status ?? error.response?.status;
  return typeof status === 'number' ? status : undefined;
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

  async plan(
    providerUid: string,
    input: ChatRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<ProposalPlan> {
    return this.callProvider(providerUid, 'plan', input, signal, observer);
  }

  async generate(
    providerUid: string,
    input: GenerateChartRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<GenerateChartResponse> {
    return this.callProvider(providerUid, 'generate', toGenerateChartWireRequest(input), signal, observer);
  }

  async chat(
    providerUid: string,
    input: ChatRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<ChatResponse> {
    return this.callProvider(providerUid, 'chat', input, signal, observer);
  }

  async repair(
    providerUid: string,
    input: RepairChartRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<GenerateChartResponse> {
    return this.callProvider(providerUid, 'repair', toRepairChartWireRequest(input), signal, observer);
  }

  private async callProvider(
    providerUid: string,
    method: 'plan',
    input: ChatRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<ProposalPlan>;
  private async callProvider(
    providerUid: string,
    method: 'generate',
    input: GenerateChartWireRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<GenerateChartResponse>;
  private async callProvider(
    providerUid: string,
    method: 'chat',
    input: ChatRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<ChatResponse>;
  private async callProvider(
    providerUid: string,
    method: 'repair',
    input: RepairChartWireRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<GenerateChartResponse>;
  private async callProvider(
    providerUid: string,
    method: 'generate' | 'repair' | 'chat' | 'plan',
    input: GenerateChartWireRequest | RepairChartRequest | ChatRequest,
    signal?: AbortSignal,
    observer?: ProviderTransportObserver
  ): Promise<GenerateChartResponse | ChatResponse | ProposalPlan> {
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

    let requestStage = 'provider-resolution';
    try {
      const dataSource = await this.service.get(uid);
      const resource = (dataSource as Partial<ProviderDataSource>)[method];
      if (typeof resource !== 'function') {
        if (method === 'plan') {
          throw new Error('Update the Flint AI datasource plugin to support automatic proposal planning.');
        }
        throw new Error(
          `Update the Flint AI datasource plugin: the selected datasource does not expose the Flint ${method} resource.`
        );
      }
      const call = resource as (
        input: GenerateChartWireRequest | RepairChartRequest | ChatRequest,
        signal?: AbortSignal,
        observer?: ProviderTransportObserver
      ) => Promise<GenerateChartResponse | ChatResponse | ProposalPlan>;
      requestStage = 'datasource-call';
      observer?.({
        stage: 'datasource-call',
        request: JSON.parse(JSON.stringify(input)),
        contractVersion: method === 'generate' || method === 'repair' ? AI_REQUEST_CONTRACT_VERSION : undefined,
      });
      return signal ? await call.call(dataSource, input, signal) : await call.call(dataSource, input);
    } catch (cause) {
      if (signal?.aborted) {
        throw new Error('Request cancelled.');
      }
      const detail = describeProviderError(cause);
      const status = providerHttpStatus(cause);
      const compatibility = /invalid (?:generate|repair) request/.test(detail)
        ? ' The datasource rejected the request contract. Check Panel/datasource compatibility and export diagnostics.'
        : '';
      throw Object.assign(new Error(`Selected Flint AI provider request failed: ${detail}${compatibility}`), {
        httpStatus: status,
        stage: requestStage,
      });
    }
  }
}

export const aiProviderClient: AiProviderClient = new GrafanaAiProviderClient();
