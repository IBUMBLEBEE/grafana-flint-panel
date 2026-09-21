# Documentation

This directory contains durable product contracts, requirements, integration
guides, and active issue records. The implementation and automated tests are
the source of truth for code-level behavior.

## Start here

| Document                                                        | Purpose                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Project README](../README.md)                                  | User-facing setup, workflow, and feature overview                  |
| [Domain context](../CONTEXT.md)                                 | Shared terminology for conversations, proposals, and Panel context |
| [Product roadmap](product-roadmap.md)                           | Current product shape and future direction                         |
| [Agent guide](agent-flint-grafana.md)                           | Flint options contract and Grafana MCP write workflow              |
| [Panel options schema](schemas/flint-panel-options.schema.json) | Machine-readable persisted-options contract                        |

## Requirements

| Requirement                                                                                      | Status                                                                       |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [001 — AI provider compatibility](requirements/001-ai-provider-compatibility.md)                 | Active integration contract; provider implementation is installed separately |
| [002 — Chart proposal validation](requirements/002-flint-chart-proposal-validation.md)           | Implemented                                                                  |
| [003 — Panel query-context binding](requirements/003-panel-datasource-context-binding.md)        | Implemented                                                                  |
| [004 — Grafana MCP orchestration](requirements/004-grafana-flint-mcp-orchestration.md)           | Planned; the agent contract and examples are available                       |
| [005 — Temporary multi-turn conversation](requirements/005-ai-workspace-conversation-history.md) | Implemented                                                                  |
| [006 — UI framework overrides](requirements/006-ui-framework-overrides.md)                       | Implemented                                                                  |

## MCP integration

- [Grafana MCP agent contract](agent-flint-grafana.md)
- [Grafana MCP panel-context research](grafana-mcp-panel-context-research.md)
- [Flint MCP integration research](flint-mcp-integration-research.md)
- [Example MCP configuration](mcp-grafana.example.json)
- [Dashboard and Panel payload templates](templates/)

The research notes support future MCP orchestration. They are not runtime
dependencies of the Panel.

## Decisions and active issues

- [ADR 0001](adr/0001-ai-workspace-is-a-separate-grafana-app-domain.md)
  records the rejected durable AI Workspace direction. It is intentionally
  retained as a deprecated decision record.
- [Vega-Lite grouped-bar compatibility issue](issues/vega-lite-grouped-bar-static-series.md)
  and its [upstream handoff](issues/vega-lite-grouped-bar-upstream-pr.md) remain
  until the upstream fix is published and the local adapter can be removed.

## Maintenance policy

- Requirements describe durable behavior and acceptance boundaries.
- ADRs record consequential decisions, including rejected directions.
- Research notes remain only while they support an active or planned decision.
- Implementation plans are working documents. Once completed, merge lasting
  constraints into requirements or ADRs and remove the plan.
- Do not duplicate source-level design details that are already enforced by
  focused tests.
