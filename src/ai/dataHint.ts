import { DataFrame, FieldType } from '@grafana/data';

import { preparePanelData } from '../flint/preparePanelData';
import { inferChartType } from '../flint/assemble';
import { allowedChartTypesForBackend } from '../flint/chartTypes';
import type { RenderBackend } from '../flint/backends';

const MAX_SAMPLE_ROWS = 12;
const MAX_FIELD_VALUES = 8;
const MAX_SAMPLE_VALUE_BYTES = 96;
export const MAX_DATA_HINT_BYTES = 4 * 1024;
const SENSITIVE_FIELD = /(api.?key|authorization|cookie|credential|pass(word|wd)?|secret|token)/i;

export interface DataHint {
  /** Compact, user-facing query summary for the AI Assist editor. */
  querySummary: string;
  summary: string;
  fieldNames: string[];
  suggestedChartType: string;
  sampleRows: Array<Record<string, unknown>>;
}

function truncateUtf8(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) {
    return text;
  }
  const suffix = '...';
  let result = '';
  let bytes = 0;
  for (const character of text) {
    const characterBytes = new TextEncoder().encode(character).length;
    if (bytes + characterBytes + suffix.length > maxBytes) {
      break;
    }
    result += character;
    bytes += characterBytes;
  }
  return result + suffix;
}

function safeSampleValue(fieldName: string, value: unknown): string {
  if (SENSITIVE_FIELD.test(fieldName)) {
    return '<redacted>';
  }
  return truncateUtf8(String(value), MAX_SAMPLE_VALUE_BYTES);
}

/**
 * Build a compact, LLM-friendly description of the current panel query result.
 */
export function buildDataHint(frames: DataFrame[]): DataHint {
  const prepared = preparePanelData(frames);
  const table = prepared.table;
  const fieldNames = table.fields.map((field) => field.name);
  const suggestedChartType = table.values.length ? inferChartType(table) : 'auto';

  const fieldLines = table.fields.map((field) => {
    const values = table.values
      .slice(0, MAX_FIELD_VALUES)
      .map((row) => row[field.name])
      .filter((value) => value !== null && value !== undefined);
    const unique = Array.from(new Set(values.map((value) => safeSampleValue(field.name, value)))).slice(0, 5);
    return `- ${field.name} (${field.type}): sample=${JSON.stringify(unique)}`;
  });

  const frameLine = `frames=${frames.length}, rows=${table.values.length}, fields=${fieldNames.join(', ') || '(none)'}`;
  const count = (value: number, singular: string) => `${value} ${singular}${value === 1 ? '' : 's'}`;
  const querySummary = [
    `Current query: ${count(frames.length, 'frame')} · ${count(table.values.length, 'row')} · ${count(table.fields.length, 'field')}`,
    table.fields.length ? table.fields.map((field) => `${field.name} (${field.type})`).join(', ') : 'No query fields.',
  ].join('\n');
  const typeHint = table.fields.some((field) => field.type === FieldType.time)
    ? 'Looks like time series (prefer Line/Area).'
    : table.fields.some((field) => field.type === FieldType.string) &&
        table.fields.some((field) => field.type === FieldType.number)
      ? 'Looks like category + measure (prefer Bar/Pie).'
      : 'Inspect samples before choosing a chart.';

  const summary = truncateUtf8(
    [
      frameLine,
      typeHint,
      `Suggested chartType (rule engine): ${suggestedChartType}`,
      ...prepared.warnings.map((warning) => `Warning: ${warning}`),
      'Fields:',
      ...fieldLines,
    ].join('\n'),
    MAX_DATA_HINT_BYTES
  );

  return {
    querySummary,
    summary,
    fieldNames,
    suggestedChartType,
    sampleRows: table.values.slice(0, MAX_SAMPLE_ROWS),
  };
}

export function allowedChartTypes(backend: RenderBackend = 'echarts'): string[] {
  return allowedChartTypesForBackend(backend);
}
