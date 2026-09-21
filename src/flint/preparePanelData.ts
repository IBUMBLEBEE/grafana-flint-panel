import type { DataFrame } from '@grafana/data';

import { dataFramesToFlintTable, type FlintTable } from './dataFrames';

export interface PreparedFrameSummary {
  frameIndex: number;
  refId?: string;
  name?: string;
  fields: Array<{ name: string; type: string }>;
}

export interface PreparedPanelData {
  table: FlintTable;
  frames: PreparedFrameSummary[];
  warnings: string[];
}

/** Single seam used by rendering and AI so both observe the same Panel data. */
export function preparePanelData(frames: DataFrame[]): PreparedPanelData {
  const table = dataFramesToFlintTable(frames);
  return {
    table,
    frames: frames.map((frame, frameIndex) => ({
      frameIndex,
      ...(frame.refId ? { refId: frame.refId } : {}),
      ...(frame.name ? { name: frame.name } : {}),
      fields: frame.fields.map((field) => ({ name: field.name, type: String(field.type) })),
    })),
    warnings: table.warnings ?? [],
  };
}
