import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { LoadingState, PanelProps } from '@grafana/data';
import { PanelDataErrorView } from '@grafana/runtime';
import { Alert, useStyles2, useTheme2 } from '@grafana/ui';

import { defaultFlintOptions, FlintOptions, hasLegacyAiConfig, sanitizeAiConfig } from '../types';
import { FlintPreviewRequestEvent, FlintPreviewResultEvent } from '../ai/preview';
import { assemblePanelChart } from '../flint/assemble';
import { applyPendingViz } from '../flint/applyPendingViz';
import { createChartRuntime, type ChartRuntime } from '../flint/chartRuntime';
import { preparePanelData } from '../flint/preparePanelData';
import { mountBackendChart } from '../flint/renderBackend';
import { resolveVisualizationRevision } from '../flint/visualizationRevision';
import {
  buildPanelContextSnapshot,
  isSamePanelContext,
  loadDashboardFromGrafana,
  registerPanelQueryContext,
} from '../ai/panelContext';
import { validatePendingViz } from '../flint/validateOptions';

interface Props extends PanelProps<FlintOptions> {}

const getStyles = () => ({
  wrapper: css`
    position: relative;
    overflow: hidden;
  `,
  chart: css`
    position: absolute;
    top: 0;
    left: 0;
  `,
  warning: css`
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 8px;
    z-index: 1;
  `,
  previewBadge: css`
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    padding: 3px 8px;
    border-radius: 10px;
    background: #1f60c4;
    color: #fff;
    font-size: 11px;
    font-weight: 500;
    pointer-events: none;
  `,
});

/**
 * Host size for backend resize only. Coarse grid ignores options-pane drag jitter.
 * Compile size is fixed separately so sidebar resize never recompiles the chart.
 */
function stableHostSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(width / 16) * 16),
    height: Math.max(1, Math.round(height / 16) * 16),
  };
}

/** Fixed canvas for Flint compile — actual pixels come from backend.resize(). */
const COMPILE_SIZE = { width: 800, height: 450 };

function hostSizeKey(size: { width: number; height: number }, isDark: boolean): string {
  return `${size.width}x${size.height}:${isDark ? 'd' : 'l'}`;
}

/** Grafana bumps renderCounter on each query result — reliable refresh signal. */
function dataGeneration(renderCounter: number, structureRev?: number): string {
  return `${renderCounter}:${structureRev ?? 0}`;
}

export const FlintPanel: React.FC<Props> = ({
  options,
  data,
  width,
  height,
  fieldConfig,
  id,
  onOptionsChange,
  renderCounter,
  eventBus,
}) => {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ChartRuntime | undefined>(undefined);
  const [preview, setPreview] = useState<{ requestId: string; draft: NonNullable<FlintOptions['ai']['draft']> }>();
  const [renderError, setRenderError] = useState<string>();

  const ai = sanitizeAiConfig(options.ai);
  const needsAiMigration = hasLegacyAiConfig(options.ai);
  const renderBackend = options.renderBackend ?? defaultFlintOptions.renderBackend;
  const pending = ai.pending;
  const hostSize = useMemo(() => stableHostSize(width, height), [width, height]);
  const appliedHostKey = hostSizeKey(hostSize, theme.isDark);
  const generation = dataGeneration(renderCounter, data.structureRev);
  const prepared = useMemo(() => preparePanelData(data.series), [data.series]);
  const table = prepared.table;
  const previewIsStale = Boolean(
    preview && !isSamePanelContext(preview.draft.context, buildPanelContextSnapshot(data.series, eventBus))
  );
  const activePreview = previewIsStale ? undefined : preview;

  useEffect(
    () => registerPanelQueryContext(eventBus, id, data.request, loadDashboardFromGrafana, data.series),
    [data.request, data.series, eventBus, id]
  );

  useEffect(() => {
    const subscription = eventBus.subscribe(FlintPreviewRequestEvent, (event) => {
      const request = event.payload;
      if (request.panelId !== undefined && request.panelId !== id) {
        return;
      }
      if (request.action === 'stop') {
        setPreview((current) => (current?.requestId === request.requestId ? undefined : current));
        return;
      }
      if (!request.draft) {
        return;
      }

      const currentContext = buildPanelContextSnapshot(data.series, eventBus);
      if (!isSamePanelContext(request.draft.context, currentContext)) {
        eventBus.publish(
          new FlintPreviewResultEvent({
            requestId: request.requestId,
            panelId: id,
            ok: false,
            error: 'Preview rejected because the datasource, query, frame, or field schema changed.',
          })
        );
        return;
      }
      try {
        validatePendingViz(
          request.draft,
          table.fields.map((field) => field.name),
          request.draft.renderBackend ?? renderBackend
        );
        setPreview({ requestId: request.requestId, draft: request.draft });
      } catch (err) {
        eventBus.publish(
          new FlintPreviewResultEvent({
            requestId: request.requestId,
            panelId: id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    });
    return () => subscription.unsubscribe();
  }, [data.series, eventBus, id, renderBackend, table.fields]);

  useEffect(() => {
    if (!preview || !previewIsStale) {
      return;
    }
    eventBus.publish(
      new FlintPreviewResultEvent({
        requestId: preview.requestId,
        panelId: id,
        ok: false,
        error: 'Preview stopped because the datasource, query, frame, or field schema changed.',
      })
    );
  }, [eventBus, id, preview, previewIsStale]);

  // Apply staged visualization updates from the options-editor AI Assist.
  useEffect(() => {
    if (needsAiMigration) {
      onOptionsChange({ ...options, ai });
    }
  }, [ai, needsAiMigration, onOptionsChange, options]);

  useEffect(() => {
    if (!pending) {
      return;
    }

    const currentContext = buildPanelContextSnapshot(data.series, eventBus);
    if (!isSamePanelContext(pending.context, currentContext)) {
      onOptionsChange({
        ...options,
        ai: {
          ...ai,
          draft: {
            ...pending,
            rationale: [pending.rationale, 'Draft became stale before Apply and was not applied.']
              .filter(Boolean)
              .join(' '),
          },
          pending: undefined,
        },
      });
      return;
    }
    try {
      validatePendingViz(
        pending,
        table.fields.map((field) => field.name),
        pending.renderBackend ?? renderBackend
      );
    } catch {
      onOptionsChange({ ...options, ai: { ...ai, draft: pending, pending: undefined } });
      return;
    }

    onOptionsChange(applyPendingViz(options, pending));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const hasData = data.series.length > 0 && table.values.length > 0;
  const visualization = useMemo(
    () => resolveVisualizationRevision(options, activePreview?.draft),
    [activePreview?.draft, options]
  );
  const effectiveOptions = visualization.options;
  const effectiveRenderBackend = effectiveOptions.renderBackend;

  // Only an explicit preview changes the effective visualization. Local editor
  // draft text alone and panel host-size changes do not trigger compilation.
  const assembled = useMemo(() => {
    if (!hasData) {
      return {
        backend: effectiveRenderBackend,
        payload: undefined,
        payloadKey: '',
        warnings: [] as string[],
        error: undefined,
      };
    }

    try {
      const result = assemblePanelChart(
        table,
        {
          ...effectiveOptions,
          renderBackend: effectiveRenderBackend,
        },
        COMPILE_SIZE
      );
      return {
        backend: result.backend,
        payload: result.payload,
        payloadKey: JSON.stringify(result.payload),
        warnings: [...prepared.warnings, ...result.warnings],
        error: undefined,
      };
    } catch (err) {
      return {
        backend: effectiveRenderBackend,
        payload: undefined,
        payloadKey: '',
        warnings: [] as string[],
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
    // The stable revision key intentionally excludes Provider and other non-visual options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualization.key, effectiveRenderBackend, generation, hasData, table]);
  const assembledPayloadRef = useRef(assembled.payload);

  useEffect(() => {
    assembledPayloadRef.current = assembled.payload;
  }, [assembled.payload]);

  useEffect(() => {
    if (activePreview && assembled.error) {
      eventBus.publish(
        new FlintPreviewResultEvent({
          requestId: activePreview.requestId,
          panelId: id,
          ok: false,
          error: assembled.error.message,
        })
      );
    }
  }, [activePreview, assembled.error, eventBus, id]);

  // Reconcile visual/data/host identities through the shared chart lifecycle Module.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) {
      return;
    }

    if (data.state && ![LoadingState.Done, LoadingState.Streaming].includes(data.state)) {
      return;
    }

    const payload = assembledPayloadRef.current;
    if (!payload || !assembled.payloadKey) {
      runtimeRef.current?.dispose();
      runtimeRef.current = undefined;
      el.replaceChildren();
      setRenderError(undefined);
      return;
    }

    const nextHost = { width: hostSize.width, height: hostSize.height, isDark: theme.isDark };
    let cancelled = false;
    const reportPreviewReady = () => {
      if (activePreview) {
        eventBus.publish(new FlintPreviewResultEvent({ requestId: activePreview.requestId, panelId: id, ok: true }));
      }
    };

    const run = async () => {
      const runtime = runtimeRef.current ?? createChartRuntime(el, mountBackendChart);
      runtimeRef.current = runtime;
      try {
        await runtime.reconcile({
          backend: assembled.backend,
          payload,
          payloadKey: assembled.payloadKey,
          dataGeneration: generation,
          size: nextHost,
        });
        if (!cancelled) {
          el.removeAttribute('data-render-error');
          setRenderError(undefined);
          reportPreviewReady();
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          el.setAttribute('data-render-error', message);
          setRenderError(message);
          if (activePreview) {
            eventBus.publish(
              new FlintPreviewResultEvent({
                requestId: activePreview.requestId,
                panelId: id,
                ok: false,
                error: message,
              })
            );
          }
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
    // Payload and size objects are addressed by their stable keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePreview, assembled.backend, assembled.payloadKey, data.state, eventBus, generation, appliedHostKey, id]);

  // Dispose on unmount only.
  useEffect(() => {
    return () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = undefined;
    };
  }, []);

  if (!hasData) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsTimeField={false} />;
  }

  return (
    <div
      className={cx(
        styles.wrapper,
        css`
          width: ${width}px;
          height: ${height}px;
        `
      )}
    >
      {assembled.error && (
        <div className={styles.warning}>
          <Alert title="Flint compile error" severity="error">
            {assembled.error.message}
          </Alert>
        </div>
      )}
      {renderError && !assembled.error && (
        <div className={styles.warning}>
          <Alert title="Chart render error" severity="error">
            {renderError}
          </Alert>
        </div>
      )}
      {assembled.warnings.length > 0 && !assembled.error && !renderError && (
        <div className={styles.warning}>
          <Alert title="Flint layout warning" severity="warning">
            {assembled.warnings.join(' ')}
          </Alert>
        </div>
      )}
      {activePreview && (
        <div className={styles.previewBadge} data-testid="flint-ai-preview-badge">
          AI Preview
        </div>
      )}
      <div
        ref={hostRef}
        className={styles.chart}
        data-testid="flint-panel-chart"
        data-chart-type={effectiveOptions.chartType ?? defaultFlintOptions.chartType}
        data-render-backend={effectiveRenderBackend}
        data-waterfall-totals={effectiveOptions.waterfallTotals ?? defaultFlintOptions.waterfallTotals}
        data-preview-active={activePreview ? 'true' : 'false'}
        data-frame-count={data.series.length}
        data-row-count={table.values.length}
        style={{ width, height }}
      />
    </div>
  );
};
