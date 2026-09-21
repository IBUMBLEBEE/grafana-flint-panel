import { BusEventWithPayload } from '@grafana/data';

import type { FlintPendingViz } from '../types';

export {
  captureVizSnapshot,
  snapshotFingerprint,
  snapshotToPending,
  snapshotWithDraft,
} from '../flint/visualizationRevision';
export type { FlintVizSnapshot } from '../flint/visualizationRevision';

export interface FlintPreviewRequestPayload {
  action: 'start' | 'stop';
  requestId: string;
  panelId?: number;
  draft?: FlintPendingViz;
}

export interface FlintPreviewResultPayload {
  requestId: string;
  panelId: number;
  ok: boolean;
  error?: string;
}

export class FlintPreviewRequestEvent extends BusEventWithPayload<FlintPreviewRequestPayload> {
  static type = 'flint-ai-preview-request';
}

export class FlintPreviewResultEvent extends BusEventWithPayload<FlintPreviewResultPayload> {
  static type = 'flint-ai-preview-result';
}
