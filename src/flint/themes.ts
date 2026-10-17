import { listThemePresets } from 'flint-chart';
import type { RenderBackend } from './backends';

/** The installed library owns preset IDs, labels and descriptions. */
export const FLINT_THEME_PRESETS = listThemePresets();

export function supportsThemePresets(backend: RenderBackend): boolean {
  return backend === 'vegalite';
}

export function validateThemePreset(value: unknown): void {
  if (
    value !== undefined &&
    (typeof value !== 'string' || !FLINT_THEME_PRESETS.some((preset) => preset.id === value))
  ) {
    throw new Error('theme_spec must be an official Flint theme preset ID; custom themes are not supported');
  }
}
