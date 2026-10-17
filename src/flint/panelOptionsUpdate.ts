import type { FlintOptions, PersistedFlintOptions } from '../types';

/** Grafana Scenes deep-merges updates; explicitly undefined keys remove old values. */
function replaceFields(previous: unknown, next: unknown): unknown {
  if (
    !next ||
    typeof next !== 'object' ||
    Array.isArray(next) ||
    !previous ||
    typeof previous !== 'object' ||
    Array.isArray(previous)
  ) {
    return next;
  }
  const oldFields = previous as Record<string, unknown>;
  const newFields = next as Record<string, unknown>;
  return Object.fromEntries(
    [...new Set([...Object.keys(oldFields), ...Object.keys(newFields)])].map((key) => [
      key,
      Object.hasOwn(newFields, key) ? replaceFields(oldFields[key], newFields[key]) : undefined,
    ])
  );
}

/** Host transport only. Canonical chart snapshots never contain deletion markers. */
export function panelOptionsUpdate(previous: FlintOptions, next: PersistedFlintOptions): PersistedFlintOptions {
  return {
    ...next,
    flintInput: replaceFields(previous.flintInput, next.flintInput) as typeof next.flintInput,
    seriesColors: next.seriesColors,
    recovery: next.recovery,
  };
}
