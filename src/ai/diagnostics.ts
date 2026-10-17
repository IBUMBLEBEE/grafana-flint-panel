import type { DataFrame } from '@grafana/data';

import packageInfo from '../../package.json';
import type { FlintChartState } from '../flint/chartState';
import type { FlintPendingViz } from '../types';
import type { FlintPanelContextSnapshot } from './panelContext';
import {
  providerHttpStatus,
  type AiProviderClient,
  type ProposalPlan,
  type ProviderTransportObserver,
} from './providerClient';
import type { TemporaryChatMessage } from './temporaryChat';

const MAX_REQUESTS = 20;
const REDACTED = '[REDACTED]';

/** Also scrub text because errors and chat can contain copied authorization headers. */
function redactText(text: string): string {
  return text
    .replace(/sample=\[[^\r\n]*/g, 'sample=[OMITTED: query data]')
    .replace(/\bBearer\s+[^\s"',}]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED)
    .replace(
      /((?:api[_-]?key|password|access[_-]?token|authorization)\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
      `$1${REDACTED}`
    );
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        /^(?:.*(?:api[_-]?key|password|secret|credential)|authorization|cookie|access[_-]?token|refresh[_-]?token|secureJsonData|secureJsonFields)$/i.test(
          key
        )
          ? REDACTED
          : /^(?:sampleRows|data|values)$/.test(key) ||
              (key === 'source' && typeof child === 'string' && child.trim().startsWith('{'))
            ? '[OMITTED: query data]'
            : redact(child),
      ])
    );
  }
  return value;
}

interface DiagnosticRequest {
  operation: keyof AiProviderClient;
  providerUid: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'error' | 'cancelled';
  /** Original Panel input; retained for compatibility with v1 readers. */
  request: unknown;
  transmittedRequest?: unknown;
  requestStage: 'host-api' | 'datasource-call';
  contractVersion?: number;
  httpStatus?: number;
  response?: unknown;
  error?: string;
}

/** Bounded, editor-local trace. Captures the host API boundary, not upstream provider internals. */
export function createAiDiagnostics(client: AiProviderClient) {
  const requests: DiagnosticRequest[] = [];
  async function record<T>(
    operation: keyof AiProviderClient,
    providerUid: string,
    input: unknown,
    signal: AbortSignal | undefined,
    call: (observer: ProviderTransportObserver) => Promise<T>
  ): Promise<T> {
    const entry: DiagnosticRequest = {
      operation,
      providerUid,
      startedAt: new Date().toISOString(),
      status: 'running',
      request: redact(input),
      requestStage: 'host-api',
    };
    requests.push(entry);
    if (requests.length > MAX_REQUESTS) {
      requests.shift();
    }
    try {
      const response = await call((event) => {
        entry.requestStage = event.stage;
        entry.contractVersion = event.contractVersion;
        entry.transmittedRequest = redact(event.request);
      });
      entry.status = signal?.aborted ? 'cancelled' : 'success';
      entry.response = redact(response);
      return response;
    } catch (cause) {
      entry.status = signal?.aborted ? 'cancelled' : 'error';
      entry.httpStatus = providerHttpStatus(cause);
      entry.error = redactText(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      entry.finishedAt = new Date().toISOString();
    }
  }
  const tracedClient: AiProviderClient = {
    chat: (uid, input, signal) =>
      record('chat', uid, input, signal, (observer) => client.chat(uid, input, signal, observer)),
    plan: (uid, input, signal) =>
      record('plan', uid, input, signal, (observer) => client.plan(uid, input, signal, observer)),
    generate: (uid, input, signal) =>
      record('generate', uid, input, signal, (observer) => client.generate(uid, input, signal, observer)),
    repair: (uid, input, signal) =>
      record('repair', uid, input, signal, (observer) => client.repair(uid, input, signal, observer)),
  };
  return {
    client: tracedClient,
    snapshot: () => JSON.parse(JSON.stringify(requests)) as DiagnosticRequest[],
    clear: () => {
      requests.length = 0;
    },
  };
}

export function buildAiDiagnosticReport(input: {
  messages: TemporaryChatMessage[];
  provider?: { uid?: string; name?: string; model?: string };
  panelContext?: FlintPanelContextSnapshot;
  frames: DataFrame[];
  committed: FlintChartState;
  draft?: FlintPendingViz;
  proposalPlan?: ProposalPlan;
  requests: DiagnosticRequest[];
  history?: unknown;
  status: {
    busy?: string;
    error?: string;
    notice?: string;
    preview: unknown;
    specEditor: string;
    draftIsStale: boolean;
    canApply: boolean;
  };
  environment: { grafanaVersion?: string; pagePath: string; userAgent: string };
}) {
  return redact({
    format: 'flint-ai-diagnostics',
    version: 2,
    exportedAt: new Date().toISOString(),
    pluginVersion: packageInfo.version,
    environment: input.environment,
    scope: {
      chat: 'Retained conversation in this browser tab (up to 20 messages).',
      requests:
        'Last 20 host AI calls since this editor mounted or chat was cleared. request is the internal Panel input; transmittedRequest is observed at the datasource helper boundary after conversion. Upstream internal retries are not captured.',
      excluded: ['credentials', 'raw query rows', 'datasource configuration', 'query text'],
    },
    provider: input.provider,
    panelContext: input.panelContext,
    frames: input.frames.map((frame) => ({
      refId: frame.refId,
      name: frame.name,
      rowCount: frame.length,
      fields: frame.fields.map((field) => ({ name: field.name, type: field.type })),
    })),
    conversation: input.messages,
    chart: { committed: input.committed, draft: input.draft },
    proposalPlan: input.proposalPlan,
    history: input.history,
    status: input.status,
    requests: input.requests,
  });
}

export function downloadAiDiagnostics(report: unknown): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `flint-ai-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  // Grafana's delegated link handler must not turn this local download into navigation.
  anchor.addEventListener('click', (event) => event.stopPropagation());
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
