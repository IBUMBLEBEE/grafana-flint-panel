import type { ChartConfiguration } from 'chart.js';
import type { Result } from 'vega-embed';

import type { RenderBackend } from './backends';

let chartJsModule: Promise<typeof import('chart.js')> | undefined;

function loadChartJs(): Promise<typeof import('chart.js')> {
  chartJsModule ??= import(/* webpackChunkName: "chartjs" */ 'chart.js').then((module) => {
    module.Chart.register(
      module.CategoryScale,
      module.LinearScale,
      module.TimeScale,
      module.PointElement,
      module.LineElement,
      module.BarElement,
      module.ArcElement,
      module.LineController,
      module.BarController,
      module.PieController,
      module.ScatterController,
      module.Title,
      module.Tooltip,
      module.Legend,
      module.Filler
    );
    return module;
  });
  return chartJsModule;
}

export interface HostSize {
  width: number;
  height: number;
  isDark: boolean;
}

export interface MountedChart {
  dispose: () => void;
  resize: (size: HostSize) => void | Promise<void>;
  update: (payload: Record<string, unknown>, size: HostSize) => void | Promise<void>;
}

function isStepSize(value: unknown): value is { step: number } {
  return Boolean(value && typeof value === 'object' && typeof (value as { step?: unknown }).step === 'number');
}

/**
 * Mount a Flint-compiled payload. Prefer resize/update over remounting to avoid
 * flicker when the panel editor layout nudges width/height during scroll.
 */
export async function mountBackendChart(args: {
  el: HTMLDivElement;
  backend: RenderBackend;
  payload: Record<string, unknown>;
  size: HostSize;
}): Promise<MountedChart> {
  const { el, backend, payload, size } = args;
  const renderHost = document.createElement('div');
  renderHost.style.width = '100%';
  renderHost.style.height = '100%';
  renderHost.style.overflow = 'hidden';
  el.replaceChildren(renderHost);

  if (backend === 'echarts') {
    const echarts = await import(/* webpackChunkName: "echarts" */ 'echarts');
    const instance = echarts.init(renderHost, size.isDark ? 'dark' : undefined);
    const apply = (nextPayload: Record<string, unknown>, nextSize: HostSize) => {
      instance.resize({ width: nextSize.width, height: nextSize.height });
      instance.setOption(
        {
          backgroundColor: 'transparent',
          ...nextPayload,
        },
        true
      );
    };
    apply(payload, size);
    return {
      dispose: () => {
        instance.dispose();
        renderHost.remove();
      },
      resize: (nextSize) => {
        instance.resize({ width: nextSize.width, height: nextSize.height });
      },
      update: (nextPayload, nextSize) => apply(nextPayload, nextSize),
    };
  }

  if (backend === 'chartjs') {
    const { Chart } = await loadChartJs();
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    renderHost.appendChild(canvas);

    const buildConfig = (nextPayload: Record<string, unknown>): ChartConfiguration =>
      ({
        ...nextPayload,
        options: {
          ...((nextPayload.options as Record<string, unknown>) || {}),
          responsive: false,
          maintainAspectRatio: false,
          animation: false,
        },
      }) as ChartConfiguration;

    canvas.width = size.width;
    canvas.height = size.height;
    let chart = new Chart(canvas.getContext('2d')!, buildConfig(payload));
    type LegendHitTarget = { left: number; top: number; width: number; height: number };
    const reflectInteractionState = () => {
      canvas.dataset.tooltipActive = chart.tooltip?.getActiveElements().length ? 'true' : 'false';
      canvas.dataset.visibleSeriesCount = String(
        chart.data.datasets.reduce((count, _dataset, index) => count + (chart.isDatasetVisible(index) ? 1 : 0), 0)
      );
      canvas.dataset.legendHitTargets = JSON.stringify(
        ((chart.legend as unknown as { legendHitBoxes?: LegendHitTarget[] } | undefined)?.legendHitBoxes ?? []).map(
          ({ left, top, width, height }) => ({ left, top, width, height })
        )
      );
      canvas.dataset.chartLayoutSize = JSON.stringify({ width: chart.width, height: chart.height });
    };
    const reflectAfterEvent = () => queueMicrotask(reflectInteractionState);
    canvas.addEventListener('mousemove', reflectAfterEvent);
    canvas.addEventListener('click', reflectAfterEvent);
    reflectInteractionState();

    return {
      dispose: () => {
        canvas.removeEventListener('mousemove', reflectAfterEvent);
        canvas.removeEventListener('click', reflectAfterEvent);
        chart.destroy();
        renderHost.remove();
      },
      resize: (nextSize) => {
        canvas.width = nextSize.width;
        canvas.height = nextSize.height;
        chart.resize();
      },
      update: (nextPayload, nextSize) => {
        chart.destroy();
        canvas.width = nextSize.width;
        canvas.height = nextSize.height;
        chart = new Chart(canvas.getContext('2d')!, buildConfig(nextPayload));
        reflectInteractionState();
      },
    };
  }

  if (backend === 'plotly') {
    const { default: Plotly } = await import(/* webpackChunkName: "plotly" */ 'plotly.js-dist-min');
    const buildLayout = (nextPayload: Record<string, unknown>, nextSize: HostSize) => {
      const baseLayout = (nextPayload.layout as Record<string, unknown>) || {};
      return {
        ...baseLayout,
        width: nextSize.width,
        height: nextSize.height,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: {
          ...((baseLayout.font as Record<string, unknown>) || {}),
          color: nextSize.isDark ? '#d8d9da' : '#111217',
        },
        margin: {
          ...((baseLayout.margin as Record<string, unknown>) || {}),
          t: 40,
          r: 20,
          b: 40,
          l: 50,
        },
      };
    };

    const data = (payload.data as Array<Record<string, unknown>>) || [];
    await Plotly.newPlot(renderHost, data, buildLayout(payload, size), {
      displayModeBar: false,
      responsive: false,
      staticPlot: false,
    });

    return {
      dispose: () => {
        Plotly.purge(renderHost);
        renderHost.remove();
      },
      resize: async (nextSize) => {
        await Plotly.relayout(renderHost, { width: nextSize.width, height: nextSize.height });
      },
      update: async (nextPayload, nextSize) => {
        const nextData = (nextPayload.data as Array<Record<string, unknown>>) || [];
        await Plotly.react(renderHost, nextData, buildLayout(nextPayload, nextSize), {
          displayModeBar: false,
          responsive: false,
          staticPlot: false,
        });
      },
    };
  }

  // vegalite — embed doesn't support cheap resize; remount with current payload.
  const { default: embed } = await import(/* webpackChunkName: "vega" */ 'vega-embed');
  let currentPayload = payload;
  const render = (nextPayload: Record<string, unknown>, nextSize: HostSize) =>
    embed(
      renderHost,
      {
        ...nextPayload,
        ...(isStepSize(nextPayload.width) ? { width: nextSize.width } : {}),
        ...(isStepSize(nextPayload.height) ? { height: nextSize.height } : {}),
        autosize: { type: 'fit', contains: 'padding', resize: true },
      } as never,
      {
        actions: false,
        renderer: 'canvas',
        theme: nextSize.isDark ? 'dark' : undefined,
        width: nextSize.width,
        height: nextSize.height,
        padding: 8,
      }
    );
  const reflectLegendSelection = (nextResult: Result, nextPayload: Record<string, unknown>) => {
    renderHost.dataset.legendSelectionActive = 'false';
    const params = Array.isArray(nextPayload.params) ? nextPayload.params : [];
    for (const param of params) {
      if (
        param &&
        typeof param === 'object' &&
        (param as { bind?: unknown }).bind === 'legend' &&
        typeof (param as { name?: unknown }).name === 'string'
      ) {
        nextResult.view.addSignalListener((param as { name: string }).name, (_name, value) => {
          renderHost.dataset.legendSelectionActive =
            value && typeof value === 'object' && Object.keys(value as object).length > 0 ? 'true' : 'false';
        });
      }
    }
  };
  let result: Result = await render(currentPayload, size);
  reflectLegendSelection(result, currentPayload);

  return {
    dispose: () => {
      result.finalize();
      renderHost.remove();
    },
    resize: async (nextSize) => {
      result.finalize();
      result = await render(currentPayload, nextSize);
      reflectLegendSelection(result, currentPayload);
    },
    update: async (nextPayload, nextSize) => {
      currentPayload = nextPayload;
      result.finalize();
      result = await render(currentPayload, nextSize);
      reflectLegendSelection(result, currentPayload);
    },
  };
}
