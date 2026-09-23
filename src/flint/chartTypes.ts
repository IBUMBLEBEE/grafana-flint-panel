import {
  cjsAllTemplateDefs,
  ecAllTemplateDefs,
  plAllTemplateDefs,
  SemanticTypes,
  type ChartPropertyDef,
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
  requiredChannels: string[];
  properties: FlintChartPropertyCatalogEntry[];
}

export interface FlintChartPropertyCatalogEntry {
  key: string;
  type: ChartPropertyDef['type'];
  min?: number;
  max?: number;
  options?: unknown[];
}

const REQUIRED_CHANNELS: Record<(typeof PANEL_CHART_TYPE_NAMES)[number], string[]> = {
  'Line Chart': ['x', 'y'],
  'Area Chart': ['x', 'y'],
  'Bar Chart': ['x', 'y'],
  'Grouped Bar Chart': ['x', 'y', 'group'],
  'Stacked Bar Chart': ['x', 'y', 'color'],
  'Waterfall Chart': ['x', 'y'],
  'Scatter Plot': ['x', 'y'],
  'Pie Chart': ['size', 'color'],
  Heatmap: ['x', 'y', 'color'],
  Histogram: ['x'],
  'Gauge Chart': ['size'],
  'Radar Chart': ['x', 'y'],
};

function propertyCatalog(definition: ChartPropertyDef): FlintChartPropertyCatalogEntry {
  switch (definition.type) {
    case 'continuous':
      return { key: definition.key, type: definition.type, min: definition.min, max: definition.max };
    case 'discrete':
      return { key: definition.key, type: definition.type, options: definition.options.map((option) => option.value) };
    case 'binary':
      return { key: definition.key, type: definition.type };
  }
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
    return definition
      ? [
          {
            chartType,
            channels: [...definition.channels],
            requiredChannels: REQUIRED_CHANNELS[chartType].filter((channel) => definition.channels.includes(channel)),
            properties: (definition.properties ?? []).map(propertyCatalog),
          },
        ]
      : [];
  });
}

export const FLINT_SEMANTIC_TYPES = Object.values(SemanticTypes);

export function allowedChartTypesForBackend(backend: RenderBackend): string[] {
  return ['auto', ...chartCatalogForBackend(backend).map((entry) => entry.chartType)];
}

export function chartChannelsForBackend(backend: RenderBackend, chartType: string): string[] {
  return chartCatalogForBackend(backend).find((entry) => entry.chartType === chartType)?.channels ?? [];
}

export function requiredChartChannelsForBackend(backend: RenderBackend, chartType: string): string[] {
  return chartCatalogForBackend(backend).find((entry) => entry.chartType === chartType)?.requiredChannels ?? [];
}

export function chartPropertiesForBackend(backend: RenderBackend, chartType: string): FlintChartPropertyCatalogEntry[] {
  return chartCatalogForBackend(backend).find((entry) => entry.chartType === chartType)?.properties ?? [];
}

export const FLINT_CHART_TYPES = [
  { label: 'Auto', value: 'auto' },
  ...PANEL_CHART_TYPE_NAMES.map((chartType) => ({ label: chartType, value: chartType })),
] as const;
