import type { AssembleOptions } from 'flint-chart';

function invalid(path: string, message: string): never {
  throw new Error(`Invalid Flint spec JSON: ${path} ${message}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalid(`${path}.${key}`, 'is not supported');
    }
  }
}

function number(value: unknown, path: string, min = -Infinity, max = Infinity): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    invalid(path, `must be a finite number between ${min} and ${max}`);
  }
}

function size(value: unknown, path: string, min: number): void {
  const dimensions = object(value, path);
  keys(dimensions, ['width', 'height'], path);
  for (const dimension of ['width', 'height']) {
    number(dimensions[dimension], `${path}.${dimension}`, min);
  }
}

function encoding(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (!value.trim()) {
      invalid(path, 'must be a non-empty query field name');
    }
    return;
  }
  const record = object(value, path);
  keys(record, ['field', 'type', 'aggregate', 'sortOrder', 'sortBy', 'scheme'], path);
  if (typeof record.field !== 'string' || !record.field.trim()) {
    invalid(`${path}.field`, 'must be a query field name');
  }
  for (const [key, allowed] of Object.entries({
    type: ['quantitative', 'nominal', 'ordinal', 'temporal'],
    aggregate: ['count', 'sum', 'average', 'mean'],
    sortOrder: ['ascending', 'descending'],
  })) {
    if (record[key] !== undefined && !allowed.includes(record[key] as string)) {
      invalid(`${path}.${key}`, `must be one of ${allowed.join(', ')}`);
    }
  }
  for (const key of ['sortBy', 'scheme']) {
    if (record[key] !== undefined && (typeof record[key] !== 'string' || !record[key].trim())) {
      invalid(`${path}.${key}`, 'must be a non-empty string');
    }
  }
}

// A Flint upgrade that adds an option must update this runtime contract explicitly.
const optionTypes = {
  stepPadding: 'number',
  elasticity: 'number',
  maxStretch: 'number',
  maxStretchX: 'number',
  maxStretchY: 'number',
  facetElasticity: 'number',
  minStep: 'number',
  maxColorValues: 'number',
  minSubplotSize: 'number',
  facetGap: 'number',
  facetColumns: 'number',
  defaultBandSize: 'number',
  bandStepFit: 'number',
  bandStepFitCapacityX: 'number',
  bandStepFitCapacityY: 'number',
  minBandStep: 'number',
  maxBandSize: 'number',
  baseLabelFontSize: 'number',
  baseTitleFontSize: 'number',
  facetAspectRatioResistance: 'number',
  targetBandAR: 'number',
  addTooltips: 'boolean',
  groupBandFillsLanes: 'boolean',
  maintainContinuousAxisRatio: 'boolean',
  autoFacetWrap: 'boolean',
  facetFixedPadding: 'size',
  continuousMarkCrossSection: 'crossSection',
} as const satisfies Record<keyof AssembleOptions, 'number' | 'boolean' | 'size' | 'crossSection'>;
const numericOptions = Object.keys(optionTypes).filter((key) => optionTypes[key as keyof AssembleOptions] === 'number');
const booleanOptions = Object.keys(optionTypes).filter(
  (key) => optionTypes[key as keyof AssembleOptions] === 'boolean'
);

/** Structural checks run before normalization can hide malformed values. Runtime catalog checks follow. */
export function validateSourceShape(value: unknown): void {
  const root = object(value, 'flintInput');
  keys(root, ['chart_spec', 'semantic_types', 'field_display_names', 'options', 'theme_spec'], 'flintInput');
  const spec = object(root.chart_spec, 'chart_spec');
  keys(
    spec,
    ['chartType', 'title', 'subtitle', 'encodings', 'baseSize', 'canvasSize', 'chartProperties'],
    'chart_spec'
  );
  if (typeof spec.chartType !== 'string' || !spec.chartType.trim()) {
    invalid('chart_spec.chartType', 'must be a non-empty string');
  }
  for (const key of ['title', 'subtitle']) {
    if (spec[key] !== undefined && typeof spec[key] !== 'string') {
      invalid(`chart_spec.${key}`, 'must be a string');
    }
  }
  for (const key of ['baseSize', 'canvasSize']) {
    if (spec[key] !== undefined) {
      size(spec[key], `chart_spec.${key}`, Number.MIN_VALUE);
    }
  }
  if (spec.chartProperties !== undefined) {
    object(spec.chartProperties, 'chart_spec.chartProperties');
  }
  if (spec.encodings !== undefined) {
    for (const [channel, value] of Object.entries(object(spec.encodings, 'chart_spec.encodings'))) {
      const path = `chart_spec.encodings.${channel}`;
      if (Array.isArray(value)) {
        if (!value.length) {
          invalid(path, 'must not be an empty array');
        }
        if (!['x', 'y'].includes(channel)) {
          invalid(path, 'arrays are supported only on x or y measure channels');
        }
        const fields = new Set();
        value.forEach((item, index) => {
          encoding(item, `${path}[${index}]`);
          const field = typeof item === 'string' ? item : item.field;
          if (fields.has(field)) {
            invalid(`${path}[${index}]`, `duplicates field "${field}"`);
          }
          fields.add(field);
        });
      } else {
        encoding(value, path);
      }
    }
  }
  if (root.semantic_types !== undefined) {
    for (const [field, annotation] of Object.entries(object(root.semantic_types, 'semantic_types'))) {
      if (typeof annotation === 'string') {
        continue;
      }
      const path = `semantic_types.${field}`;
      const record = object(annotation, path);
      keys(record, ['semanticType', 'intrinsicDomain', 'unit', 'divergingMidpoint', 'sortOrder'], path);
      if (record.unit !== undefined && typeof record.unit !== 'string') {
        invalid(`${path}.unit`, 'must be a string');
      }
      if (record.divergingMidpoint !== undefined) {
        number(record.divergingMidpoint, `${path}.divergingMidpoint`);
      }
      if (record.intrinsicDomain !== undefined) {
        const domain = record.intrinsicDomain;
        if (!Array.isArray(domain) || domain.length !== 2) {
          invalid(`${path}.intrinsicDomain`, 'must contain two numbers');
        }
        domain.forEach((bound, index) => number(bound, `${path}.intrinsicDomain[${index}]`));
        if (domain[0] >= domain[1]) {
          invalid(`${path}.intrinsicDomain`, 'must be in ascending order');
        }
      }
      if (
        record.sortOrder !== undefined &&
        (!Array.isArray(record.sortOrder) || record.sortOrder.some((item) => typeof item !== 'string'))
      ) {
        invalid(`${path}.sortOrder`, 'must be an array of strings');
      }
    }
  }
  if (root.options !== undefined) {
    const options = object(root.options, 'options');
    keys(options, [...numericOptions, ...booleanOptions, 'facetFixedPadding', 'continuousMarkCrossSection'], 'options');
    for (const key of numericOptions) {
      if (options[key] !== undefined) {
        number(
          options[key],
          `options.${key}`,
          0,
          ['stepPadding', 'bandStepFit', 'facetAspectRatioResistance'].includes(key) ? 1 : Infinity
        );
      }
    }
    for (const key of ['facetColumns', 'maxColorValues']) {
      if (options[key] !== undefined && (!Number.isInteger(options[key]) || (options[key] as number) < 1)) {
        invalid(`options.${key}`, 'must be a positive integer');
      }
    }
    for (const key of booleanOptions) {
      if (options[key] !== undefined && typeof options[key] !== 'boolean') {
        invalid(`options.${key}`, 'must be boolean');
      }
    }
    if (options.facetFixedPadding !== undefined) {
      size(options.facetFixedPadding, 'options.facetFixedPadding', 0);
    }
    const crossSection = options.continuousMarkCrossSection;
    if (crossSection !== undefined) {
      const path = 'options.continuousMarkCrossSection';
      if (typeof crossSection === 'number') {
        number(crossSection, path, 0);
      } else {
        const record = object(crossSection, path);
        keys(record, ['x', 'y', 'elasticity', 'maxStretch', 'seriesCountAxis'], path);
        for (const key of ['x', 'y', 'elasticity', 'maxStretch']) {
          if (['x', 'y'].includes(key) || record[key] !== undefined) {
            number(record[key], `${path}.${key}`, 0);
          }
        }
        if (record.seriesCountAxis !== undefined && !['x', 'y', 'auto'].includes(record.seriesCountAxis as string)) {
          invalid(`${path}.seriesCountAxis`, 'must be x, y or auto');
        }
      }
    }
  }
}
