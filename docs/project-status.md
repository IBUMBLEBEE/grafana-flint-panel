# Project status and maturity

**Status: experimental, research-oriented proof of concept (POC). Not production-ready.**

This repository contains a working Grafana panel, automated tests, and a local development environment. The POC label does not mean that the project is only a literature review or a design sketch. It means that the implementation exists to validate product and engineering hypotheses while its contracts, safeguards, user experience, and upstream dependencies are still evolving.

## Appropriate use

- Evaluation, demos, local development, and controlled internal experiments.
- Exploring Flint as a semantic visualization layer for Grafana.
- Testing AI proposal, preview, validation, and multi-backend rendering workflows.
- Collecting evidence for product requirements and production-readiness work.

Do not rely on the plugin for business-critical dashboards or unattended AI changes. No stability, migration, support, or service-level guarantee is currently provided.

## Current AI limitation

AI Chat text does not modify a panel by itself. **Generate proposal** asks the selected model for a complete visualization proposal, and **Apply** writes the reviewed proposal into panel options.

Natural-language refinements are not yet constrained semantic patches. A style-only request such as “change only the colors” may still produce a different chart type, field mapping, color encoding, or Flint Spec. The proposal can therefore change which values are visualized even though it cannot rewrite the Grafana datasource query. Always review the live preview and the Chart Settings field mappings before Apply.

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
