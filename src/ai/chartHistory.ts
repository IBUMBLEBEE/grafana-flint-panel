import { toChartState, type FlintChartState } from '../flint/chartState';
import { snapshotFingerprint, snapshotToPending } from '../flint/visualizationRevision';
import { isSamePanelContext, type FlintPanelContextSnapshot } from './panelContext';

export interface ChartRevision {
  id: string;
  createdAt: number;
  label: string;
  action: 'initial' | 'applied' | 'restored';
  restoredFrom?: string;
  confirmed?: boolean;
  notificationTarget?: 'chat' | 'workbench';
  snapshot: FlintChartState;
  context: FlintPanelContextSnapshot;
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const MAX_REVISIONS = 10;
const MAX_HISTORY_BYTES = 1024 * 1024;

export function chartHistoryKey(context?: FlintPanelContextSnapshot): string | undefined {
  return context?.dashboardUid && Number.isInteger(context.panelId)
    ? `flint-chart-history:v1:${context.dashboardUid}:${context.panelId}`
    : undefined;
}

export function loadChartHistory(storage: Storage | undefined, key?: string): ChartRevision[] {
  try {
    const text = key && storage?.getItem(key);
    if (!text || new TextEncoder().encode(text).length > MAX_HISTORY_BYTES) {
      return [];
    }
    const parsed = JSON.parse(text);
    if (parsed.version !== 1 || !Array.isArray(parsed.revisions) || parsed.revisions.length > MAX_REVISIONS) {
      return [];
    }
    const seen = new Set<string>();
    return parsed.revisions.map((value: ChartRevision) => {
      if (
        !value ||
        typeof value.id !== 'string' ||
        !value.id ||
        value.id.length > 128 ||
        seen.has(value.id) ||
        !Number.isFinite(value.createdAt) ||
        typeof value.label !== 'string' ||
        value.label.length > 256 ||
        !['initial', 'applied', 'restored'].includes(value.action) ||
        !value.context?.schemaFingerprint ||
        !Array.isArray(value.context.bindings) ||
        !value.snapshot ||
        (value.restoredFrom !== undefined && typeof value.restoredFrom !== 'string') ||
        (value.confirmed !== undefined && typeof value.confirmed !== 'boolean') ||
        (value.notificationTarget !== undefined && !['chat', 'workbench'].includes(value.notificationTarget))
      ) {
        throw new Error('Invalid chart history');
      }
      seen.add(value.id);
      const snapshot = toChartState(value.snapshot);
      if (snapshot.recovery) {
        throw new Error('Invalid chart snapshot');
      }
      return {
        id: value.id,
        createdAt: value.createdAt,
        label: value.label,
        action: value.action,
        restoredFrom: value.restoredFrom,
        confirmed: value.confirmed,
        ...(value.notificationTarget ? { notificationTarget: value.notificationTarget } : {}),
        context: value.context,
        snapshot,
      };
    });
  } catch {
    return [];
  }
}

export function saveChartHistory(
  storage: Storage | undefined,
  key: string | undefined,
  revisions: ChartRevision[]
): void {
  try {
    if (key) {
      storage?.setItem(key, JSON.stringify({ version: 1, revisions }));
    }
  } catch {
    /* In-memory history remains available when browser storage is full. */
  }
}

export function historyUnavailableReason(
  revisions: ChartRevision[],
  current: FlintChartState,
  context?: FlintPanelContextSnapshot
): string | undefined {
  const head = revisions.at(-1);
  if (!head || revisions.length < 2) {
    return 'No earlier chart version is available in this browser tab.';
  }
  if (head.confirmed === false) {
    return 'Waiting for the recorded Panel application to be confirmed.';
  }
  if (!isSamePanelContext(head.context, context)) {
    return 'The Panel query or field schema changed after the last recorded application.';
  }
  if (snapshotFingerprint(head.snapshot) !== snapshotFingerprint(current)) {
    return 'The current chart differs from the last recorded application.';
  }
  return undefined;
}

export function recordChartApplication(
  revisions: ChartRevision[],
  before: FlintChartState,
  after: FlintChartState,
  context: FlintPanelContextSnapshot,
  labels: { before: string; after: string },
  restoredFrom?: string,
  confirmed = true,
  notificationTarget?: ChartRevision['notificationTarget']
): ChartRevision[] {
  const head = revisions.at(-1);
  const matches =
    head &&
    isSamePanelContext(head.context, context) &&
    snapshotFingerprint(head.snapshot) === snapshotFingerprint(before);
  const make = (snapshot: FlintChartState, label: string, action: ChartRevision['action']): ChartRevision => ({
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    label: label.slice(0, 256),
    action,
    snapshot: toChartState(snapshot),
    context: JSON.parse(JSON.stringify(context)),
  });
  const revision = {
    ...make(after, labels.after, restoredFrom ? 'restored' : 'applied'),
    ...(restoredFrom ? { restoredFrom } : {}),
    confirmed,
    ...(notificationTarget ? { notificationTarget } : {}),
  };
  let next = [...(matches ? revisions : [make(before, labels.before, 'initial')]), revision].slice(-MAX_REVISIONS);
  while (next.length > 2 && new TextEncoder().encode(JSON.stringify(next)).length > MAX_HISTORY_BYTES - 1024) {
    next = next.slice(1);
  }
  return next;
}

export function prepareChartRestore(
  revisions: ChartRevision[],
  revisionId: string,
  current: FlintChartState,
  context?: FlintPanelContextSnapshot
) {
  const reason = historyUnavailableReason(revisions, current, context);
  if (reason) {
    throw new Error(reason);
  }
  const revision = revisions.slice(0, -1).find((item) => item.id === revisionId);
  if (!revision || !isSamePanelContext(revision.context, context)) {
    throw new Error('The requested chart version is unavailable for this Panel query.');
  }
  return {
    ...snapshotToPending(revision.snapshot, context),
    restoreRevisionId: revision.id,
    baseFingerprint: snapshotFingerprint(current),
    rationale: `Restore ${revision.label} from ${new Date(revision.createdAt).toISOString()}.`,
  };
}

export function chartHistoryContext(
  revisions: ChartRevision[],
  current: FlintChartState,
  context?: FlintPanelContextSnapshot
) {
  const unavailableReason = historyUnavailableReason(revisions, current, context);
  return {
    unavailableReason,
    revisions: unavailableReason
      ? []
      : revisions
          .slice(0, -1)
          .filter((item) => isSamePanelContext(item.context, context))
          .map(({ id, label, createdAt }) => ({ id, label, createdAt })),
  };
}

export function isRestoreRequest(message: string): boolean {
  return /撤销|回滚|回退|还原|恢复|复原|改回|退回|回到|上一(?:个|次)?版本|\b(?:undo|revert|restore|roll\s*back|go\s+back)\b/i.test(
    message
  );
}
