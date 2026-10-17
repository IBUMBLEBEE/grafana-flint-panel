## Project knowledge

This repository contains a **Grafana plugin**. You must Read @./.config/AGENTS/instructions.md before doing changes.

## Flint chart authoring

When authoring or revising Flint chart input, changing the Flint integration, or working on AI chart-generation prompts, read and use @./.codex/skills/flint-chart-author/SKILL.md.

Apply these project constraints alongside the upstream skill:

- Persist semantic source in `flintInput`; bind `data` from Grafana query frames and `canvasSize` from the host at runtime. Source editing and persistence follow `src/flint/chartState.ts`.
- Prepare data through Grafana queries or transformations before Flint; the Panel does not execute agent-authored transformation code.
- Use `src/flint/chartTypes.ts` and `src/flint/validateOptions.ts` to check the installed library's backend catalog and the Panel's accepted input. Upstream examples, including `theme_spec` and `interaction_spec`, are not proof of Panel support.
- Keep compiled backend output read-only. Backend-specific customization requires a separate user request; installing this skill does not restore `frameworkOverrides`.

Upstream provenance and update instructions: @./.codex/skills/README.md.

## AI datasource contracts

When changing AI request types, provider adapters, chart catalog metadata, diagnostics, or provider mocks, read and follow [the request contract workflow](docs/contracts/README.md). Verify serialized Generate and Repair payloads with the real datasource decoders before completing interface changes.
