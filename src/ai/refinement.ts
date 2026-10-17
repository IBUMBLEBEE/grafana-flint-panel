import type { FlintInput } from '../flint/chartState';

export const REFINEMENT_ALLOWED_PATHS = [
  '/chart_spec/title',
  '/chart_spec/subtitle',
  '/field_display_names',
  '/seriesColors',
];

function lockedInput(input: FlintInput): Record<string, unknown> {
  const { field_display_names: _labels, chart_spec, ...rest } = input;
  const { title: _title, subtitle: _subtitle, ...lockedSpec } = chart_spec;
  return { ...rest, chart_spec: lockedSpec };
}

function difference(left: unknown, right: unknown, path = ''): string | undefined {
  if (Object.is(left, right)) {
    return undefined;
  }
  if (
    !left ||
    !right ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return path;
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const next = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (Object.hasOwn(a, key) !== Object.hasOwn(b, key)) {
      return next;
    }
    const changed = difference(a[key], b[key], next);
    if (changed !== undefined) {
      return changed;
    }
  }
  return undefined;
}

/** Complete-source comparison: additions, deletions and replacements all obey the same locks. */
export function assertRefinementAllowed(baseline: FlintInput, candidate: FlintInput): void {
  const changed = difference(lockedInput(baseline), lockedInput(candidate));
  if (changed !== undefined) {
    throw new Error(
      `Refinement cannot change locked Flint source path "${changed}". Only chart title, subtitle and field display names may change.`
    );
  }
}
