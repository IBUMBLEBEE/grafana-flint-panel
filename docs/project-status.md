# Project status and maturity

**Status: experimental, research-oriented proof of concept (POC). Not production-ready.**

This repository contains a working Grafana panel, automated tests, and a local development environment. The POC label does not mean that the project is only a literature review or a design sketch. It means that the implementation exists to validate product and engineering hypotheses while its contracts, safeguards, user experience, and upstream dependencies are still evolving.

## Appropriate use

- Evaluation, demos, local development, and controlled internal experiments.
- Exploring Flint as a semantic visualization layer for Grafana.
- Testing AI proposal, preview, validation, and multi-backend rendering workflows.
- Collecting evidence for product requirements and production-readiness work.

Do not rely on the plugin for business-critical dashboards or unattended AI changes. No stability, migration, support, or service-level guarantee is currently provided.

## Current AI scope and limitations

AI Chat text does not modify a panel by itself. **Generate proposal** stages a
reviewable source proposal; **Apply** accepts it into panel options, and saving the
dashboard persists it.

**Automatic planning** reads the bounded conversation and runtime chart context before generation. It chooses local adjustments or a redesign, or asks a clarification question. The UI shows the selected scope and instruction summary; users do not select a mode.

A **redesign** can replace chart type, bindings and semantic configuration.
A **local adjustment** permits title, subtitle and field display names, plus
series colors for unfaceted Grouped Bar Chart, Stacked Bar Chart and Line Chart
with multiple numeric measure fields. A complete `seriesColors` map uses source
measure field names and `#RRGGBB` values. It is persisted separately from
`flintInput` and applied after Flint compilation on all four render backends.
Palette-only proposals preserve the original source and Auto bindings. Preview,
Apply, reload and Undo use the same palette state; changing the palette also
invalidates stale refinement proposals.

This does not enable arbitrary backend overrides, fonts, backgrounds, gridlines
or axis styling. Refine preserves chart type, field bindings and data semantics.
AI chooses the redesign path only for explicit structural requests; review the preview before Apply. Failed local adjustments never retry with broader redesign permissions. Planning requires an updated Flint AI datasource exposing the `/plan` resource. The Panel
cannot rewrite Grafana datasource queries or execute transformation code.

Canonical source, bounded wording and series-color refinement are covered by unit tests and
mock Provider browser tests. These checks do not establish compatibility with every
real LLM or prove the separately installed datasource forwards every new request
field. Provider integration, broad refinement semantics and production guarantees
remain evaluation work.

## Relationship to Microsoft Flint

This plugin builds on the public [Microsoft Flint repository](https://github.com/microsoft/flint-chart) but is an independent integration. It is not an official Microsoft or Grafana product, and neither project’s maturity should be inferred from the other.

As of 2026-09-23, the upstream README identifies Flint as a collaboration between Microsoft Research and the IDEAS Lab at Renmin University of China, and still states that its research paper is “coming soon.” This dated note records the upstream repository’s public wording; it is not a claim that Flint lacks a working implementation or public releases.

## What production-ready would require

At minimum, promotion out of POC status requires:

- explicit refinement contracts that preserve locked data semantics for style-only changes;
- compatibility and migration policy for persisted panel options and supported Flint versions;
- repeatable end-to-end coverage across supported Grafana versions and rendering backends;
- documented security, privacy, failure-handling, and operational boundaries;
- release, upgrade, rollback, and support procedures backed by real deployment evidence.

Project status must be changed only when these guarantees are implemented and verified, not merely when additional features are added.
