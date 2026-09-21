import { type FlintOptions, sanitizeAiConfig } from './types';

type LegacyFlintOptions = FlintOptions & { dataScope?: unknown };

/** Remove the retired frame selector without changing Grafana datasource or targets. */
export function migrateFlintOptions(panel: { options: FlintOptions }): Partial<FlintOptions> {
  const { dataScope: _legacyDataScope, ...options } = panel.options as LegacyFlintOptions;
  return {
    ...options,
    ai: sanitizeAiConfig(options.ai),
  };
}

export function hasLegacyDataScope(panel: { options?: unknown }): boolean {
  const options = panel.options;
  if (!options || typeof options !== 'object') {
    return false;
  }
  const record = options as Record<string, unknown>;
  const ai = record.ai && typeof record.ai === 'object' ? (record.ai as Record<string, unknown>) : undefined;
  const draft = ai?.draft && typeof ai.draft === 'object' ? (ai.draft as Record<string, unknown>) : undefined;
  const pending = ai?.pending && typeof ai.pending === 'object' ? (ai.pending as Record<string, unknown>) : undefined;
  return (
    Object.hasOwn(record, 'dataScope') ||
    Boolean(draft && Object.hasOwn(draft, 'dataScope')) ||
    Boolean(pending && Object.hasOwn(pending, 'dataScope'))
  );
}
