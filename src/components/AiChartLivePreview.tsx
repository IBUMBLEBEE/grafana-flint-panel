import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { DataFrame } from '@grafana/data';
import { Alert, useStyles2, useTheme2 } from '@grafana/ui';

import { assemblePanelChart } from '../flint/assemble';
import { createChartRuntime, type ChartRenderRequest, type ChartRuntime } from '../flint/chartRuntime';
import { preparePanelData } from '../flint/preparePanelData';
import { mountBackendChart } from '../flint/renderBackend';
import { resolveVisualizationRevision } from '../flint/visualizationRevision';
import { defaultFlintOptions, type FlintOptions, type FlintPendingViz } from '../types';

type PreviewStatus = 'checking' | 'ready' | 'error';

interface Props {
  frames: DataFrame[];
  options?: FlintOptions;
  draft?: FlintPendingViz;
  onStatusChange?: (status: PreviewStatus, error?: string) => void;
}

const PREVIEW_COMPILE_SIZE = { width: 800, height: 450 };

const getStyles = () => ({
  root: css`
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 360px;
    overflow: hidden;
  `,
  chart: css`
    position: absolute;
    inset: 0;
  `,
  alert: css`
    position: absolute;
    inset: 8px 8px auto;
    z-index: 1;
  `,
});

/** Renders the proposal with the same Flint assembly and backend used by the Panel. */
export const AiChartLivePreview: React.FC<Props> = ({ frames, options, draft, onStatusChange }) => {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ChartRuntime | undefined>(undefined);
  const requestRef = useRef<ChartRenderRequest | undefined>(undefined);
  const [mountError, setMountError] = useState<string>();
  const prepared = useMemo(() => preparePanelData(frames), [frames]);
  const visualization = useMemo(
    () => resolveVisualizationRevision(options ?? defaultFlintOptions, draft),
    [draft, options]
  );
  const effectiveOptions = visualization.options;
  const assembled = useMemo(() => {
    if (!frames.length || !prepared.table.values.length) {
      return { payload: undefined, payloadKey: '', backend: effectiveOptions.renderBackend, error: undefined };
    }
    try {
      const result = assemblePanelChart(prepared.table, effectiveOptions, PREVIEW_COMPILE_SIZE);
      return {
        payload: result.payload,
        payloadKey: JSON.stringify(result.payload),
        backend: result.backend,
        error: undefined,
      };
    } catch (cause) {
      return {
        payload: undefined,
        payloadKey: '',
        backend: effectiveOptions.renderBackend,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
    // The stable revision key intentionally excludes Provider and other non-visual options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualization.key, frames.length, prepared.table]);
  const assembledPayloadRef = useRef(assembled.payload);

  useEffect(() => {
    assembledPayloadRef.current = assembled.payload;
  }, [assembled.payload]);

  useEffect(() => {
    if (!assembled.error) {
      return;
    }
    onStatusChange?.('error', assembled.error);
  }, [assembled.error, onStatusChange]);

  useEffect(() => {
    const el = hostRef.current;
    const payload = assembledPayloadRef.current;
    if (!el || !payload) {
      runtimeRef.current?.dispose();
      runtimeRef.current = undefined;
      requestRef.current = undefined;
      el?.replaceChildren();
      if (!frames.length || !prepared.table.values.length) {
        onStatusChange?.('error', 'No query data is available for preview.');
      }
      return;
    }

    let cancelled = false;
    onStatusChange?.('checking');
    const measuredWidth = el.clientWidth;
    const measuredHeight = el.clientHeight;
    const size = {
      width: measuredWidth > 1 ? measuredWidth : PREVIEW_COMPILE_SIZE.width,
      height: measuredHeight > 1 ? measuredHeight : PREVIEW_COMPILE_SIZE.height,
      isDark: theme.isDark,
    };

    const reconcile = async () => {
      const request: ChartRenderRequest = {
        backend: assembled.backend,
        payload,
        payloadKey: assembled.payloadKey,
        dataGeneration: assembled.payloadKey,
        size,
      };
      requestRef.current = request;
      const runtime = runtimeRef.current ?? createChartRuntime(el, mountBackendChart);
      runtimeRef.current = runtime;
      try {
        await runtime.reconcile(request);
        if (!cancelled) {
          setMountError(undefined);
          onStatusChange?.('ready');
        }
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : String(cause);
          setMountError(message);
          onStatusChange?.('error', message);
        }
      }
    };
    void reconcile();

    return () => {
      cancelled = true;
    };
  }, [
    assembled.backend,
    assembled.payloadKey,
    frames.length,
    onStatusChange,
    prepared.table.values.length,
    theme.isDark,
  ]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    let animationFrame: number | undefined;
    const observer = new ResizeObserver(() => {
      if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
      }
      animationFrame = requestAnimationFrame(() => {
        animationFrame = undefined;
        const runtime = runtimeRef.current;
        const request = requestRef.current;
        const width = el.clientWidth;
        const height = el.clientHeight;
        if (!runtime || !request || width <= 1 || height <= 1) {
          return;
        }
        const resizedRequest = {
          ...request,
          size: { width, height, isDark: theme.isDark },
        };
        requestRef.current = resizedRequest;
        void runtime.reconcile(resizedRequest).catch((cause) => {
          const message = cause instanceof Error ? cause.message : String(cause);
          setMountError(message);
          onStatusChange?.('error', message);
        });
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [onStatusChange, theme.isDark]);

  useEffect(
    () => () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = undefined;
      requestRef.current = undefined;
    },
    []
  );

  return (
    <div className={styles.root} data-testid="flint-ai-live-preview">
      {(assembled.error || mountError) && (
        <div className={styles.alert}>
          <Alert title="Preview failed" severity="error">
            {assembled.error ?? mountError}
          </Alert>
        </div>
      )}
      {!frames.length && (
        <div className={styles.alert}>
          <Alert title="No query data" severity="info">
            Run the Panel query before generating a chart.
          </Alert>
        </div>
      )}
      <div
        ref={hostRef}
        className={styles.chart}
        data-testid="flint-ai-dialog-chart"
        data-render-backend={assembled.backend}
        data-chart-type={effectiveOptions.chartType}
      />
    </div>
  );
};
