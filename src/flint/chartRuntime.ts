import type { RenderBackend } from './backends';
import type { HostSize, MountedChart } from './renderBackend';

export interface ChartRenderRequest {
  backend: RenderBackend;
  payload: Record<string, unknown>;
  payloadKey: string;
  dataGeneration: string;
  size: HostSize;
}

export type ChartRuntimeAction = 'noop' | 'resize' | 'update' | 'mount';

export interface ChartRuntime {
  reconcile(request: ChartRenderRequest): Promise<ChartRuntimeAction>;
  dispose(): void;
}

export type ChartMountAdapter = (args: {
  el: HTMLDivElement;
  backend: RenderBackend;
  payload: Record<string, unknown>;
  size: HostSize;
}) => Promise<MountedChart>;

interface AppliedRequest {
  backend: RenderBackend;
  payloadKey: string;
  dataGeneration: string;
  hostKey: string;
}

function hostKey(size: HostSize): string {
  return `${size.width}x${size.height}:${size.isDark ? 'dark' : 'light'}`;
}

function requestKey(request: ChartRenderRequest): string {
  return JSON.stringify([
    request.backend,
    request.payloadKey,
    request.dataGeneration,
    request.size.width,
    request.size.height,
    request.size.isDark,
  ]);
}

/**
 * Owns one chart host and hides lifecycle/race handling from React callers.
 * Requests are serialized; superseded asynchronous mounts are disposed before
 * the newest request is evaluated.
 */
export function createChartRuntime(el: HTMLDivElement, mount: ChartMountAdapter): ChartRuntime {
  let mounted: MountedChart | undefined;
  let applied: AppliedRequest | undefined;
  let generation = 0;
  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();
  let pending:
    | {
        key: string;
        result: Promise<ChartRuntimeAction>;
      }
    | undefined;

  const reconcile = (request: ChartRenderRequest): Promise<ChartRuntimeAction> => {
    if (disposed) {
      return Promise.reject(new Error('Chart runtime is disposed'));
    }

    const key = requestKey(request);
    if (pending?.key === key) {
      return pending.result;
    }

    const requestGeneration = ++generation;
    const run = async (): Promise<ChartRuntimeAction> => {
      if (disposed || requestGeneration !== generation) {
        return 'noop';
      }

      const nextHostKey = hostKey(request.size);
      if (
        mounted &&
        applied?.backend === request.backend &&
        applied.payloadKey === request.payloadKey &&
        applied.dataGeneration === request.dataGeneration
      ) {
        if (applied.hostKey === nextHostKey) {
          return 'noop';
        }
        await mounted.resize(request.size);
        if (!disposed && requestGeneration === generation) {
          applied = { ...applied, hostKey: nextHostKey };
        }
        return 'resize';
      }

      if (mounted && applied?.backend === request.backend) {
        await mounted.update(request.payload, request.size);
        if (!disposed && requestGeneration === generation) {
          applied = {
            backend: request.backend,
            payloadKey: request.payloadKey,
            dataGeneration: request.dataGeneration,
            hostKey: nextHostKey,
          };
        }
        return 'update';
      }

      mounted?.dispose();
      mounted = undefined;
      applied = undefined;
      const nextMounted = await mount({ el, backend: request.backend, payload: request.payload, size: request.size });
      if (disposed || requestGeneration !== generation) {
        nextMounted.dispose();
        return 'mount';
      }

      mounted = nextMounted;
      applied = {
        backend: request.backend,
        payloadKey: request.payloadKey,
        dataGeneration: request.dataGeneration,
        hostKey: nextHostKey,
      };
      return 'mount';
    };

    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    pending = { key, result };
    const clearPending = () => {
      if (pending?.result === result) {
        pending = undefined;
      }
    };
    void result.then(clearPending, clearPending);
    return result;
  };

  return {
    reconcile,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      generation += 1;
      pending = undefined;
      mounted?.dispose();
      mounted = undefined;
      applied = undefined;
    },
  };
}
