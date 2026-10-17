# Changelog

## Unreleased

- Show manual Apply confirmations in Chart workbench without adding AI Chat messages; preserve history recording and keep AI proposal confirmations in chat. Unify notification titles as Chart workbench.

- Add official Flint theme presets for Vega-Lite with preview, Apply, persistence and Default reset. Other backends explicitly report unsupported themes and retain the selected preset without applying it.

- Add a provider-free Chart settings entry with backend-aware field mappings, multiple measure selection, chart-specific options, Tooltip and per-option reset.
- Preserve compatible bindings and properties across chart switches, including returning to Auto; expose inferred fields and missing-field guidance.
- Preserve settings omitted by AI proposals and generate against the current preview draft.

- Normalize AI proposals to canonical Flint source through generation, repair, preview and Apply; keep legacy scalar Provider response compatibility at the adapter boundary.
- Add explicit Create and Refine modes. Refine permits only titles, subtitles and field display names, enforces the same locks during repair, and rejects stale source baselines before Apply.
- Cover source preservation and constrained refinement with deterministic mock Provider tests without requiring live LLM credentials.

- Align public Grafana MCP templates and documentation with the canonical Flint source contract; verify schema, fixture fields and links in CI.
- Make the HTTP dashboard smoke test use a unique test-owned dashboard and clean it up without overwriting existing dashboards.
- Persist versioned, data-free Flint source as the single chart state; recompile with current Grafana query rows and host dimensions.
- Preserve unrelated semantic configuration when editing chart settings, and retain dynamic Auto inference.
- Remove framework overrides and make UI Framework Spec read-only. Existing overrides are removed by migration; custom backend styling is no longer replayed.
- Migrate legacy scalar options and Flint Spec JSON, including drafts and Undo state. Unconvertible legacy content is retained for recovery and blocked from rendering.

## 0.3.1 - 2026-09-24

### Improvements

- Replace the plugin logo with a faceted F, an AI inspiration sparkle, and an orange-to-yellow panel outline.

### Documentation

- Display the new logo in the English, Chinese, and bundled plugin READMEs.
- Refresh the demo GIF and its panel editor screenshot to show the new logo.
- Link the Flint AI Datasource dependency and document its setup and Grafana version requirement for AI features.

**Full changelog**: https://github.com/IBUMBLEBEE/grafana-flint-panel/compare/v0.3.0...v0.3.1

## 0.3.0 - 2026-09-23

### Bug fixes

- Fix: load renamed Flint AI datasource locally

### Documentation

- Docs: clarify experimental POC maturity

### Features

- Feat: validate and repair structured Flint proposals

### Maintenance

- Chore: format generated release changelog

**Full changelog**: https://github.com/IBUMBLEBEE/grafana-flint-panel/compare/v0.2.2...v0.3.0

## 0.2.2 - 2026-09-22

### Tests and CI

- Ci: publish plugin through GitHub Releases

**Full changelog**: https://github.com/IBUMBLEBEE/grafana-flint-panel/compare/v0.2.1...v0.2.2

## 0.2.0 - 2026-09-21

### Changes

- Init
