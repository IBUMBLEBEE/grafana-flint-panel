import {
  cjsAllTemplateDefs,
  ecAllTemplateDefs,
  plAllTemplateDefs,
  type ChartTemplateDef,
  vlAllTemplateDefs,
} from 'flint-chart';

import type { RenderBackend } from './backends';

const PANEL_CHART_TYPE_NAMES = [
  'Line Chart',
  'Area Chart',
  'Bar Chart',
  'Grouped Bar Chart',
  'Stacked Bar Chart',
  'Waterfall Chart',
  'Scatter Plot',
  'Pie Chart',
  'Heatmap',
  'Histogram',
  'Gauge Chart',
  'Radar Chart',
] as const;

export interface FlintChartCatalogEntry {
  chartType: string;
  channels: string[];
}

function templateDefsForBackend(backend: RenderBackend): ChartTemplateDef[] {
  switch (backend) {
    case 'vegalite':
      return vlAllTemplateDefs;
    case 'plotly':
      return plAllTemplateDefs;
    case 'chartjs':
      return cjsAllTemplateDefs;
    case 'echarts':
    default:
      return ecAllTemplateDefs;
  }
}

/** Panel-supported chart types enriched from Flint's runtime backend catalog. */
export function chartCatalogForBackend(backend: RenderBackend): FlintChartCatalogEntry[] {
  const definitions = new Map(templateDefsForBackend(backend).map((definition) => [definition.chart, definition]));
  return PANEL_CHART_TYPE_NAMES.flatMap((chartType) => {
    const definition = definitions.get(chartType);
    return definition ? [{ chartType, channels: [...definition.channels] }] : [];
  });
}

export function allowedChartTypesForBackend(backend: RenderBackend): string[] {
  return ['auto', ...chartCatalogForBackend(backend).map((entry) => entry.chartType)];
}

export function chartChannelsForBackend(backend: RenderBackend, chartType: string): string[] {
  return chartCatalogForBackend(backend).find((entry) => entry.chartType === chartType)?.channels ?? [];
}

export const FLINT_CHART_TYPES = [
  { label: 'Auto', value: 'auto' },
  ...PANEL_CHART_TYPE_NAMES.map((chartType) => ({ label: chartType, value: chartType })),
] as const;
