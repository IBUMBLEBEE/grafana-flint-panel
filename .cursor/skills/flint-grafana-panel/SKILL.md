---
name: flint-grafana-panel
description: >-
  Author Flint panel source and Grafana MCP dashboard patches for
  ibumblebee-flint-panel. Use for Flint panels, AI chart proposals, or Grafana
  MCP integration with this panel.
---

# Flint Grafana Panel

Read the repository [AGENTS.md](../../../AGENTS.md) before changing the panel.

For chart authoring, read the [Flint authoring skill](../../../.codex/skills/flint-chart-author/SKILL.md)
and apply the Panel-specific constraints in AGENTS.md.

For Grafana MCP dashboard writes, use the [agent guide](../../../docs/agent-flint-grafana.md),
[templates](../../../docs/templates/) and [persisted options schema](../../../docs/schemas/flint-panel-options.schema.json).
Persist semantic source in `flintInput`; Grafana supplies query rows and host dimensions at runtime.
Keep compiled backend output read-only.

AI provider credentials belong to the separately installed Flint AI Datasource
in Grafana `secureJsonData`. Panel options retain the provider UID, never API keys.

Before changing Generate or Repair payloads, follow the
[AI datasource contract workflow](../../../docs/contracts/README.md).
