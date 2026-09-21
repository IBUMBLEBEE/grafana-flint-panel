import { DataFrame, Field, FieldType } from '@grafana/data';

export interface FlintFieldMeta {
  name: string;
  type: FieldType;
  /** Host bookkeeping column, not a default visualization recommendation. */
  internal?: boolean;
}

export interface FlintTable {
  values: Array<Record<string, unknown>>;
  fields: FlintFieldMeta[];
  warnings?: string[];
}

export function fieldDisplayName(field: Field, frameName?: string): string {
  if (field.config?.displayNameFromDS) {
    return field.config.displayNameFromDS;
  }
  if (field.config?.displayName) {
    return field.config.displayName;
  }

  const labels = field.labels;
  if (labels && Object.keys(labels).length > 0) {
    const labelStr = Object.entries(labels)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    return field.name === 'Value' ? labelStr : `${field.name} {${labelStr}}`;
  }

  if (frameName && frameName !== 'primary') {
    return `${frameName}:${field.name}`;
  }

  return field.name;
}

function isTimeSeriesLike(frames: DataFrame[]): boolean {
  if (frames.length === 0) {
    return false;
  }

  return frames.every((frame) => {
    const hasTime = frame.fields.some((field) => field.type === FieldType.time);
    const hasNumber = frame.fields.some((field) => field.type === FieldType.number);
    const extra = frame.fields.filter((field) => field.type !== FieldType.time && field.type !== FieldType.number);
    return hasTime && hasNumber && extra.length <= 1;
  });
}

function numberFieldCount(frames: DataFrame[]): number {
  return frames.reduce(
    (count, frame) => count + frame.fields.filter((field) => field.type === FieldType.number).length,
    0
  );
}

function frameLength(frame: DataFrame): number {
  return frame.length ?? frame.fields[0]?.values?.length ?? 0;
}

function uniqueFields(fields: FlintFieldMeta[]): FlintFieldMeta[] {
  const seen = new Set<string>();
  const result: FlintFieldMeta[] = [];
  for (const field of fields) {
    if (seen.has(field.name)) {
      continue;
    }
    seen.add(field.name);
    result.push(field);
  }
  return result;
}

export function dataFramesToFlintTable(frames: DataFrame[]): FlintTable {
  if (frames.length === 0) {
    return { values: [], fields: [] };
  }

  const shouldMelt = isTimeSeriesLike(frames) && (frames.length > 1 || numberFieldCount(frames) > 1);
  if (shouldMelt) {
    return meltTimeSeries(frames);
  }

  if (frames.length === 1) {
    return frameToTable(frames[0]);
  }

  return mergeTableFrames(frames);
}

function frameToTable(frame: DataFrame, qualifyWithFrameName = true): FlintTable {
  const fields: FlintFieldMeta[] = frame.fields.map((field) => ({
    name: fieldDisplayName(field, qualifyWithFrameName ? frame.name : undefined),
    type: field.type,
  }));
  const values: Array<Record<string, unknown>> = [];
  const length = frameLength(frame);

  for (let i = 0; i < length; i++) {
    const row: Record<string, unknown> = {};
    frame.fields.forEach((field, index) => {
      row[fields[index].name] = field.values[i];
    });
    values.push(row);
  }

  return { values, fields };
}

function frameSource(frame: DataFrame, frameIndex: number): string {
  return frame.refId || frame.name || `frame-${frameIndex + 1}`;
}

function sameSchema(tables: FlintTable[]): boolean {
  const first = tables[0]?.fields ?? [];
  return tables.every(
    (table) =>
      table.fields.length === first.length &&
      table.fields.every((field, index) => field.name === first[index].name && field.type === first[index].type)
  );
}

function sourceFieldName(fields: FlintFieldMeta[]): string {
  const names = new Set(fields.map((field) => field.name));
  let candidate = '__grafana_frame';
  while (names.has(candidate)) {
    candidate = `_${candidate}`;
  }
  return candidate;
}

/**
 * Preserve every tabular frame. Compatible schemas are concatenated; heterogeneous
 * schemas are unioned with sparse values and an explicit, internal frame marker.
 */
function mergeTableFrames(frames: DataFrame[]): FlintTable {
  // Frame identity is represented by the synthetic source column. Keeping a
  // frame-name prefix here would make otherwise identical schemas incompatible.
  const tables = frames.map((frame) => frameToTable(frame, false));
  const compatible = sameSchema(tables);
  const fields: FlintFieldMeta[] = [];
  const seen = new Map<string, FieldType>();
  const mappings: Array<Map<string, string>> = [];

  tables.forEach((table, frameIndex) => {
    const mapping = new Map<string, string>();
    table.fields.forEach((field) => {
      let outputName = field.name;
      const existingType = seen.get(outputName);
      if (existingType !== undefined && existingType !== field.type) {
        outputName = `${frameSource(frames[frameIndex], frameIndex)}:${field.name}`;
      }
      let suffix = 2;
      while (seen.has(outputName) && seen.get(outputName) !== field.type) {
        outputName = `${frameSource(frames[frameIndex], frameIndex)}:${field.name}-${suffix++}`;
      }
      mapping.set(field.name, outputName);
      if (!seen.has(outputName)) {
        seen.set(outputName, field.type);
        fields.push({ name: outputName, type: field.type });
      }
    });
    mappings.push(mapping);
  });

  const sourceName = sourceFieldName(fields);
  fields.push({ name: sourceName, type: FieldType.string, internal: true });
  const values = tables.flatMap((table, frameIndex) =>
    table.values.map((row) => {
      const merged: Record<string, unknown> = { [sourceName]: frameSource(frames[frameIndex], frameIndex) };
      for (const [name, value] of Object.entries(row)) {
        merged[mappings[frameIndex].get(name) ?? name] = value;
      }
      return merged;
    })
  );

  return {
    fields,
    values,
    warnings: compatible
      ? []
      : ['Combined heterogeneous Grafana frames into a sparse table; use Grafana transformations for explicit joins.'],
  };
}

function meltTimeSeries(frames: DataFrame[]): FlintTable {
  const values: Array<Record<string, unknown>> = [];
  const fields: FlintFieldMeta[] = [];

  for (const frame of frames) {
    const timeField = frame.fields.find((field) => field.type === FieldType.time);
    const numberFields = frame.fields.filter((field) => field.type === FieldType.number);
    const stringField = frame.fields.find((field) => field.type === FieldType.string);
    const length = frameLength(frame);

    if (timeField && !fields.some((field) => field.name === 'Time')) {
      fields.push({ name: 'Time', type: FieldType.time });
    }
    if (stringField && !fields.some((field) => field.name === stringField.name)) {
      fields.push({ name: stringField.name, type: FieldType.string });
    }

    for (const numberField of numberFields) {
      const seriesName = stringField ? undefined : fieldDisplayName(numberField, frame.name);

      if (seriesName && !fields.some((field) => field.name === 'series')) {
        fields.push({ name: 'series', type: FieldType.string });
      }
      if (!fields.some((field) => field.name === 'Value')) {
        fields.push({ name: 'Value', type: FieldType.number });
      }

      for (let i = 0; i < length; i++) {
        const row: Record<string, unknown> = {};
        if (timeField) {
          row.Time = timeField.values[i];
        }
        if (stringField) {
          row[stringField.name] = stringField.values[i];
        }
        if (seriesName) {
          row.series = seriesName;
        }
        row.Value = numberField.values[i];
        values.push(row);
      }
    }
  }

  return { values, fields: uniqueFields(fields) };
}
