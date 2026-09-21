export type RenderBackend = 'echarts' | 'vegalite' | 'chartjs' | 'plotly';

/**
 * Browser render backends for Flint.
 *
 * Maturity for a Grafana panel (default = echarts):
 * - echarts: best fit for Grafana (Business Charts path), richest interactive types
 * - vegalite: Flint's earliest / most grammar-complete backend; strong for statistical charts
 * - plotly: strong scientific / statistical interactive charts (Flint 0.4+)
 * - chartjs: lighter, fewer advanced templates
 */
export const RENDER_BACKENDS: Array<{ label: string; value: RenderBackend; description: string }> = [
  {
    label: 'Apache ECharts (default)',
    value: 'echarts',
    description: 'Most mature for Grafana panels — interactive, wide chart coverage',
  },
  {
    label: 'Vega-Lite',
    value: 'vegalite',
    description: 'Flint reference backend — strong statistical / grammar-of-graphics charts',
  },
  {
    label: 'Plotly',
    value: 'plotly',
    description: 'Interactive scientific charts — good for statistical / exploratory views',
  },
  {
    label: 'Chart.js',
    value: 'chartjs',
    description: 'Lightweight canvas charts — fewer advanced templates',
  },
];

export const DEFAULT_RENDER_BACKEND: RenderBackend = 'echarts';
