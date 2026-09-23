import type { DataFrame, DataQueryRequest } from '@grafana/data';
import { getBackendSrv, locationService } from '@grafana/runtime';

import { fieldDisplayName } from '../flint/dataFrames';

export interface FlintDatasourceIdentity {
  uid: string;
  type: string;
}

export interface FlintFrameBinding {
  datasource?: FlintDatasourceIdentity;
  refId?: string;
  frameIndex: number;
  fields: Array<{ name: string; type: string }>;
}

export interface FlintPanelContextSnapshot {
  dashboardUid?: string;
  panelId?: number;
  bindings: FlintFrameBinding[];
  schemaFingerprint: string;
  queryFingerprints?: {
    runtime?: string;
    saved?: string;
  };
  /** Legacy snapshots are read only long enough to invalidate old drafts safely. */
  queryFingerprint?: string;
  queryFingerprintSource?: 'runtime' | 'saved';
}

interface RegisteredPanelContext {
  dashboardUid?: string;
  panelId?: number;
  request?: DataQueryRequest;
  savedTargets?: Array<Record<string, unknown>>;
  token: symbol;
  frames: DataFrame[];
}

const panelContexts = new WeakMap<object, RegisteredPanelContext>();
const panelContextListeners = new WeakMap<object, Set<() => void>>();
const frameContexts = new WeakMap<DataFrame, RegisteredPanelContext>();
const frameContextListeners = new WeakMap<DataFrame, Set<() => void>>();

interface DashboardPanelSnapshot {
  id?: number;
  datasource?: unknown;
  targets?: Array<Record<string, unknown>>;
  panels?: DashboardPanelSnapshot[];
}

interface DashboardResponseSnapshot {
  dashboard?: { panels?: DashboardPanelSnapshot[] };
}

export type DashboardLoader = (dashboardUid: string) => Promise<unknown>;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function datasourceFromTarget(target: unknown): FlintDatasourceIdentity | undefined {
  if (!target || typeof target !== 'object') {
    return undefined;
  }
  const datasource = (target as Record<string, unknown>).datasource;
  if (!datasource || typeof datasource !== 'object') {
    return undefined;
  }
  const record = datasource as Record<string, unknown>;
  const uid = stringValue(record.uid);
  const type = stringValue(record.type);
  return uid && type ? { uid, type } : undefined;
}

function findDashboardPanel(panels: DashboardPanelSnapshot[], panelId: number): DashboardPanelSnapshot | undefined {
  for (const panel of panels) {
    if (panel.id === panelId) {
      return panel;
    }
    const nested = panel.panels ? findDashboardPanel(panel.panels, panelId) : undefined;
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function withPersistedDatasources(request: DataQueryRequest, panelId: number, response: unknown): DataQueryRequest {
  const dashboard = response as DashboardResponseSnapshot;
  const panel = findDashboardPanel(dashboard.dashboard?.panels ?? [], panelId);
  if (!panel) {
    return request;
  }
  return {
    ...request,
    targets: request.targets.map((target) => {
      if (datasourceFromTarget(target)) {
        return target;
      }
      const persisted = panel.targets?.find((candidate) => stringValue(candidate.refId) === target.refId);
      const datasource = persisted?.datasource ?? panel.datasource;
      return datasource ? { ...target, datasource } : target;
    }),
  };
}

function persistedTargets(panelId: number, response: unknown): Array<Record<string, unknown>> | undefined {
  const dashboard = response as DashboardResponseSnapshot;
  const panel = findDashboardPanel(dashboard.dashboard?.panels ?? [], panelId);
  return panel?.targets?.map((target) => ({
    ...target,
    datasource: target.datasource ?? panel.datasource,
  }));
}

function notifyPanelContext(eventBus: object, frames: DataFrame[]): void {
  const listeners = new Set(panelContextListeners.get(eventBus));
  frames.forEach((frame) => frameContextListeners.get(frame)?.forEach((listener) => listeners.add(listener)));
  listeners.forEach((listener) => listener());
}

export function loadDashboardFromGrafana(dashboardUid: string): Promise<unknown> {
  return getBackendSrv().get(`/api/dashboards/uid/${encodeURIComponent(dashboardUid)}`);
}

function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !['requestId', 'startTime', 'endTime', 'range', 'scopedVars', 'headers'].includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)])
  );
}

function queryFingerprint(request?: DataQueryRequest): string | undefined {
  return request ? fingerprint(stableValue(request.targets)) : undefined;
}

function frameFields(frame: DataFrame): Array<{ name: string; type: string }> {
  return frame.fields.map((field) => ({ name: fieldDisplayName(field, frame.name), type: String(field.type) }));
}

function schemaFingerprint(bindings: FlintFrameBinding[]): string {
  return fingerprint(
    bindings.map(({ datasource, refId, frameIndex, fields }) => ({
      ...(datasource ? { datasource } : {}),
      ...(refId ? { refId } : {}),
      frameIndex,
      fields,
    }))
  );
}

export function registerPanelQueryContext(
  eventBus: object,
  panelId: number,
  request?: DataQueryRequest,
  loadDashboard?: DashboardLoader,
  frames: DataFrame[] = []
): () => void {
  const registration: RegisteredPanelContext = {
    panelId,
    dashboardUid: request?.dashboardUID,
    request,
    token: Symbol('panel-context'),
    frames,
  };
  panelContexts.set(eventBus, registration);
  frames.forEach((frame) => frameContexts.set(frame, registration));
  notifyPanelContext(eventBus, frames);

  if (request?.dashboardUID && loadDashboard) {
    void loadDashboard(request.dashboardUID)
      .then((response) => {
        if (panelContexts.get(eventBus)?.token !== registration.token) {
          return;
        }
        registration.request = withPersistedDatasources(request, panelId, response);
        registration.savedTargets = persistedTargets(panelId, response);
        notifyPanelContext(eventBus, frames);
      })
      .catch(() => {
        // Keep Generate disabled when Grafana cannot resolve the saved DS.
        // Guessing a default datasource would break the provenance contract.
      });
  }
  return () => {
    if (panelContexts.get(eventBus)?.token === registration.token) {
      panelContexts.delete(eventBus);
      frames.forEach((frame) => {
        if (frameContexts.get(frame)?.token === registration.token) {
          frameContexts.delete(frame);
        }
      });
      notifyPanelContext(eventBus, frames);
    }
  };
}

export function subscribePanelQueryContext(
  eventBus: object,
  listener: () => void,
  frames: DataFrame[] = []
): () => void {
  const listeners = panelContextListeners.get(eventBus) ?? new Set<() => void>();
  listeners.add(listener);
  panelContextListeners.set(eventBus, listeners);
  frames.forEach((frame) => {
    const frameListeners = frameContextListeners.get(frame) ?? new Set<() => void>();
    frameListeners.add(listener);
    frameContextListeners.set(frame, frameListeners);
  });
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      panelContextListeners.delete(eventBus);
    }
    frames.forEach((frame) => {
      const frameListeners = frameContextListeners.get(frame);
      frameListeners?.delete(listener);
      if (frameListeners?.size === 0) {
        frameContextListeners.delete(frame);
      }
    });
  };
}

export function buildPanelContextSnapshot(
  frames: DataFrame[],
  eventBus?: object,
  frameIndexes: number[] = frames.map((_, index) => index)
): FlintPanelContextSnapshot | undefined {
  const registered =
    (eventBus ? panelContexts.get(eventBus) : undefined) ??
    frames.map((frame) => frameContexts.get(frame)).find(Boolean);
  const targets = registered?.request?.targets ?? [];
  const bindings: FlintFrameBinding[] = [];

  frameIndexes.forEach((frameIndex) => {
    const frame = frames[frameIndex];
    if (!frame) {
      return;
    }
    const refId = stringValue(frame.refId) || (targets.length === 1 ? stringValue(targets[0].refId) : '');
    const target =
      targets.find((candidate) => candidate.refId === refId) ?? (targets.length === 1 ? targets[0] : undefined);
    const datasource = datasourceFromTarget(target);
    bindings.push({
      ...(datasource ? { datasource } : {}),
      ...(refId ? { refId } : {}),
      frameIndex,
      fields: frameFields(frame),
    });
  });

  return {
    dashboardUid: registered?.dashboardUid,
    panelId: registered?.panelId,
    bindings,
    schemaFingerprint: schemaFingerprint(bindings),
    queryFingerprints: {
      ...(registered?.request ? { runtime: queryFingerprint(registered.request) } : {}),
      ...(registered?.savedTargets ? { saved: fingerprint(stableValue(registered.savedTargets)) } : {}),
    },
  };
}

/** Resolve a saved Panel directly when the options editor does not share the Panel runtime objects. */
export async function loadCurrentPanelContextSnapshot(
  frames: DataFrame[],
  loadDashboard: DashboardLoader = loadDashboardFromGrafana
): Promise<FlintPanelContextSnapshot | undefined> {
  const match = locationService.getLocation().pathname.match(/\/d(?:-solo)?\/([^/]+)/);
  const panelValue = locationService.getSearch().get('editPanel') ?? locationService.getSearch().get('viewPanel');
  const panelId = panelValue ? Number(panelValue) : NaN;
  if (!match?.[1] || !Number.isInteger(panelId)) {
    return undefined;
  }

  const dashboardUid = decodeURIComponent(match[1]);
  const response = (await loadDashboard(dashboardUid)) as DashboardResponseSnapshot;
  const panel = findDashboardPanel(response.dashboard?.panels ?? [], panelId);
  if (!panel) {
    return undefined;
  }
  const targets: Array<Record<string, unknown>> = (panel.targets ?? []).map((target) => ({
    ...target,
    datasource: target.datasource ?? panel.datasource,
  }));
  const bindings = frames.flatMap((frame, frameIndex) => {
    const refId = stringValue(frame.refId) || (targets.length === 1 ? stringValue(targets[0].refId) : '');
    const target = targets.find((candidate) => stringValue(candidate.refId) === refId);
    const datasource = datasourceFromTarget(target);
    return [
      {
        ...(datasource ? { datasource } : {}),
        ...(refId ? { refId } : {}),
        frameIndex,
        fields: frameFields(frame),
      },
    ];
  });
  return {
    dashboardUid,
    panelId,
    bindings,
    schemaFingerprint: schemaFingerprint(bindings),
    queryFingerprints: { saved: fingerprint(stableValue(targets)) },
  };
}

export function mergePanelContextSnapshots(
  preferred: FlintPanelContextSnapshot | undefined,
  additional: FlintPanelContextSnapshot | undefined
): FlintPanelContextSnapshot | undefined {
  if (!preferred) {
    return additional;
  }
  if (!additional) {
    return preferred;
  }
  return {
    ...preferred,
    queryFingerprints: {
      ...additional.queryFingerprints,
      ...preferred.queryFingerprints,
    },
  };
}

function fingerprints(context: FlintPanelContextSnapshot): { runtime?: string; saved?: string } {
  if (context.queryFingerprints) {
    return context.queryFingerprints;
  }
  return context.queryFingerprint && context.queryFingerprintSource
    ? { [context.queryFingerprintSource]: context.queryFingerprint }
    : {};
}

export function isSamePanelContext(
  left: FlintPanelContextSnapshot | undefined,
  right: FlintPanelContextSnapshot | undefined
): boolean {
  if (!left || !right || left.schemaFingerprint !== right.schemaFingerprint) {
    return false;
  }
  if (left.dashboardUid && right.dashboardUid && left.dashboardUid !== right.dashboardUid) {
    return false;
  }
  if (left.panelId !== undefined && right.panelId !== undefined && left.panelId !== right.panelId) {
    return false;
  }
  const leftFingerprints = fingerprints(left);
  const rightFingerprints = fingerprints(right);
  return (['runtime', 'saved'] as const).every(
    (source) =>
      !leftFingerprints[source] || !rightFingerprints[source] || leftFingerprints[source] === rightFingerprints[source]
  );
}

export function describePanelContext(context: FlintPanelContextSnapshot | undefined, frameCount: number): string {
  if (!context) {
    return 'Panel query context unavailable.';
  }
  const location = [
    context.dashboardUid ? `dashboard=${context.dashboardUid}` : undefined,
    context.panelId !== undefined ? `panel=${context.panelId}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  const sources = context.bindings.map((binding) => {
    const datasource = binding.datasource
      ? `${binding.datasource.uid} (${binding.datasource.type})`
      : 'managed by Grafana Panel';
    return `frame=${binding.frameIndex}, refId=${binding.refId ?? '(none)'}, datasource=${datasource}`;
  });
  if (context.bindings.length !== frameCount) {
    sources.push(`warning: resolved ${context.bindings.length}/${frameCount} frame datasource bindings`);
  }
  return [location, ...sources, `schema=${context.schemaFingerprint}`].filter(Boolean).join('\n');
}
