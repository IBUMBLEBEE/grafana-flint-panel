# Documentation

Public contracts in this directory travel with a clean checkout. Runtime source
and automated tests remain authoritative for accepted chart input and behavior.

| Document                                                             | Purpose                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Project README](../README.md)                                       | Setup, workflow and feature overview                                   |
| [Project status](project-status.md)                                  | Maturity, limitations and promotion criteria                           |
| [Product roadmap](product-roadmap.md)                                | Product direction                                                      |
| [Agent guide](agent-flint-grafana.md)                                | Source authoring and safe Grafana MCP writes                           |
| [Panel options schema](schemas/flint-panel-options.schema.json)      | Machine-readable persisted-source shape                                |
| [Dashboard creation](templates/dashboard-create-payload.json)        | Fresh classic dashboard payload; replace UID and datasource before use |
| [Panel append operations](templates/patch-add-panel.operations.json) | Existing classic dashboard append payload                              |
| [PromQL Line Panel](templates/panel-line-promql.json)                | Auto field inference with a real Prometheus UID to be supplied         |
| [TestData Bar Panel](templates/panel-bar-table.json)                 | Explicit region/revenue source bindings                                |
| [TestData Pie Panel](templates/panel-pie-flint-input.json)           | Explicit color/size source bindings                                    |

Run `npm run check:flint-contract` after changing the public schema, examples or
links. CI runs the same read-only check.

Local requirement drafts, research notes, MCP configuration and implementation
plans are intentionally ignored by Git. They are optional working material, not
required by this contract or by a fresh checkout. Publish a selected durable
contract explicitly when it is ready; keep private notes and credentials local.

## Chart Settings JSON validation

Panel-local validation runs before source normalization and before Flint compilation. Manual controls and Flint Spec edits share this path; invalid drafts keep the last valid preview and block Apply. Errors identify paths such as `options.addTooltips` or `chart_spec.encodings.y[1]`.

The source contract checks allowed properties, encoding modifiers, unique measure fields, option types/ranges, positive dimensions and semantic annotations. Query-aware validation checks field names, numeric measure arrays, backend chart/channel/property support and required bindings. Theme IDs come from the installed Flint catalog; supported presets remain inactive on backends other than Vega-Lite. Data stays in Grafana queries and canvas dimensions come from the host. Legacy migrations can remove old canvas dimensions; newly edited JSON receives an error instead of silently losing them.

`src/flint/sourceValidation.ts` defines structural checks; the persisted-options JSON Schema is tested against representative valid and invalid sources. When changing Chart Settings or upgrading Flint, keep these aligned with the installed library's types and runtime chart catalog. This path uses no AI datasource request or capability endpoint.
