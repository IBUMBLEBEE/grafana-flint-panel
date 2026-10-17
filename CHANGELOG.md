# Changelog

## 0.4.0 - 2026-10-17

### Features

- Add a provider-free Chart settings entry and Chart workbench with backend-aware field bindings, multiple numeric values, chart-specific options, Tooltip and reset controls.
- Add official Flint theme presets for Vega-Lite, including preview, Apply, persistence and Default reset. Other backends retain the selection and report unsupported themes.
- Add per-series colors for supported multi-measure grouped bars, stacked bars and lines across the four rendering backends.
- Plan AI changes from the conversation and current chart, with clarification, constrained refinement and explicit redesign intent.
- Add chart application history and exportable, redacted AI diagnostics.

### Improvements

- Persist versioned, data-free Flint source as the canonical chart state; recompile with current Grafana query rows and host dimensions.
- Preserve compatible bindings and settings across chart switches, Auto inference, manual edits and AI proposals. Generate against the current preview draft.
- Normalize Generate and Repair responses to canonical source, enforce refinement locks and reject stale source baselines before Apply.
- Show manual Apply confirmations in Chart workbench while keeping AI proposal confirmations in chat.
- Add public Grafana MCP templates, a persisted-options schema and source validation with field-level errors.

### Bug fixes

- Restore Auto chart history correctly when Grafana transports deleted bindings as undefined fields; retain the exact source, palette and confirmed Apply notification.

### Migration and compatibility

- Remove framework overrides and make UI Framework Spec read-only. Existing overrides are removed by migration and custom backend styling is no longer replayed.
- Migrate legacy scalar options and Flint Spec JSON, including drafts and Undo state. Unconvertible content is retained for recovery and blocked from rendering.
- The plugin remains an experimental POC. Review saved charts after upgrading; back up dashboards before migration.

### Validation and security

- Check serialized Generate and Repair payloads against the real AI datasource decoders and a versioned request schema.
- Cover manual settings, themes, colors, history, source preservation and AI proposal safeguards with deterministic tests.
- Make the HTTP dashboard smoke test use a unique test-owned dashboard and clean it up afterward.
- Refresh the Cursor authoring guide, protect local credential files from accidental commits and fix the bundled README logo URL.

**Full changelog**: https://github.com/IBUMBLEBEE/grafana-flint-panel/compare/v0.3.1...v0.4.0

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
