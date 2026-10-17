# Flint source and Grafana MCP workflow

Read this guide when creating or modifying a Flint Panel through Grafana MCP or
dashboard JSON. For chart authoring, read the project
[Flint skill](../.codex/skills/flint-chart-author/SKILL.md) and the project constraints
in [AGENTS.md](../AGENTS.md).

## Author the source

The Panel owns row conversion, field validation, runtime sizing, compilation and
rendering. Agents own the semantic chart source. Persist `options.flintInput`, not
compiled ECharts, Vega-Lite, Plotly or Chart.js output. The
[options schema](schemas/flint-panel-options.schema.json) describes the saved shape;
`src/flint/chartTypes.ts` and `src/flint/validateOptions.ts` define the installed
Panel's backend coverage and validation. `flintInput.theme_spec` accepts an official
Flint preset ID and applies it only with Vega-Lite. Other backends retain the preset
without applying it. Custom theme objects and `interaction_spec` are not supported.

```json
{
  "stateVersion": 1,
  "renderBackend": "echarts",
  "bindingMode": "explicit",
  "flintInput": {
    "semantic_types": { "region": "Category", "revenue": "Amount" },
    "chart_spec": {
      "chartType": "Bar Chart",
      "title": "Revenue by region",
      "encodings": { "x": { "field": "region" }, "y": { "field": "revenue" } }
    }
  },
  "ai": { "lastPrompt": "" }
}
```

Use `bindingMode: "explicit"` for authored bindings against inspected query fields.
Use `"auto"` for omitted channels that the Panel should infer from current query
frames; `chartType: "auto"` also asks the Panel to infer chart type. Saved source
has no `data` or `chart_spec.canvasSize`: query frames supply rows and the host
supplies dimensions at runtime. An authored `baseSize` may remain in the source.
Prepare joins, filtering, aggregation and reshaping in Grafana queries or
transformations before charting; the Panel does not execute agent-authored code.

Chart Settings and Flint Spec edit this same source. UI Framework Spec is
read-only compiled output. Legacy dashboard scalar options and `specJson` are read for
migration only; new writes use the source shape above. Save a migrated dashboard
to persist its migration. Backend-specific overrides are not part of this
contract.

## Write only the intended dashboard changes

1. Inspect the installed MCP tool schemas and the target dashboard. The current
   [Grafana MCP tool reference](https://grafana.com/docs/grafana/latest/developer-resources/mcp/reference/mcp-tools-table/)
   describes `get_dashboard_summary`, `get_dashboard_property` and
   `update_dashboard`. Prefer focused reads and patches for an existing dashboard.
2. Inspect the exact target Panel, datasource UID/type, queries, transformations
   and resulting fields. Preserve unrelated panels, queries, datasource bindings,
   `fieldConfig` and dashboard metadata. Match the stored native dashboard schema;
   these templates use classic `panels[]`, not native v2 `elements`/`layout`.
3. Author data-free source against real field names and verify chart type,
   channels, properties and semantic types for the selected backend. If the data
   shape is unsuitable, resolve its query/transformation before writing source.
4. For creation, use [dashboard-create-payload.json](templates/dashboard-create-payload.json)
   with a unique new UID and `overwrite: false`. For an authorized existing
   dashboard change, use `update_dashboard` with its exact `uid` and patch
   `operations`; inspect current array indexes or assign a unique panel ID before
   appending [patch-add-panel.operations.json](templates/patch-add-panel.operations.json).
   The current upstream append path is `$.panels/-`; confirm it against the
   installed server's schema. Preserve the folder and stop on conflicts instead
   of forcing an overwrite. See the
   [upstream implementation](https://github.com/grafana/mcp-grafana/blob/main/tools/dashboard.go).
5. Read back the saved target and verify source and unrelated state. Open the
   dashboard to verify rendering against live query frames: the JSON Schema alone
   cannot validate runtime field availability or prove successful compilation.

The sample TestData UID `trlxrdZVk` matches this repository's provisioning. Replace
it when targeting another instance. The PromQL template has a deliberately
unresolved `REPLACE_PROMETHEUS_UID`; discover and set the real datasource before
use. Example query rows live in TestData targets, never in `flintInput`.

## AI proposals inside the Panel

Users describe a change and choose **Generate proposal**. The Panel calls the
Provider's `/plan` resource with the bounded conversation and current chart
capabilities. A validated plan selects internal `refine` or `create` constraints;
`clarify` adds a question to chat and stops before generation. The UI displays
"Adjust current chart" or "Redesign chart" and the plan summary, without a mode
selector. A failed local proposal never retries as a redesign.

Local adjustments permit `chart_spec.title`, `chart_spec.subtitle`,
`field_display_names` and a separate `seriesColors` palette. See
[the current scope](project-status.md#current-ai-scope-and-limitations) for
supported charts and palette validation. Semantic source, bindings and backend
remain locked except for the permitted wording fields.

The Panel keeps generation mode, canonical baseline and allowed paths locally.
Its datasource adapter sends the stable wire contract; the prompt includes the
current source and constraints. Wording proposals return a complete data-free
`chartInput`. Palette-only proposals return `seriesColors` and leave `chartInput`
and `specJson` null, so the host preserves source and Auto bindings itself.

The host compares the complete returned source, including additions and deletions,
validates fields and compiles before staging. One bounded repair must satisfy the
same locks. Refine has no scalar fallback. Create accepts legacy scalar Provider
responses only at the compatibility boundary and converts them to canonical source.
An invalid structured Create response can fall back only when it also carries
actual legacy field selections that independently validate and compile; the rejected
advanced-source reason stays visible. Generation, repair, preview, Apply and saved
chart state otherwise use the same canonical source.

Proposals require explicit Apply and dashboard Save for durable chart changes.
Chart Studio's proposal is held in the current editor session; this guide does not
promise UI draft restoration after reload. If an external caller saves `ai.draft`
or `ai.pending` with a refinement `baseFingerprint`, migration preserves that
guard. Query/schema context and the committed source fingerprint are checked again
before Apply. Guard evidence is removed from the committed chart source.

Provider credentials stay in the AI datasource's `secureJsonData`. The separately
installed datasource and real Provider must still be verified with these requests:
host guards prevent unauthorized results but cannot make an incompatible Provider
produce a valid refinement. Mock Provider browser tests verify the Panel's request,
validation and review workflow; they do not prove a real LLM or a live external
datasource integration.

## Verify the examples

Run `npm run check:flint-contract` after editing this contract, its schema or
templates. It validates canonical saved options, fixture field bindings and public
documentation links without contacting Grafana.

`npm run e2e:flint-mcp` checks the equivalent classic Grafana HTTP API create,
read and patch surface against a running local instance. It creates a unique
test-owned dashboard with `overwrite: false`, verifies all saved source options,
then deletes only that exact temporary UID in cleanup. It never replaces the
user's `flint-agent-demo`. This HTTP smoke test is not proof of an MCP server
connection or browser rendering; the browser suite covers rendering separately.
