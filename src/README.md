# ![Flint AI Panel logo](https://raw.githubusercontent.com/IBUMBLEBEE/grafana-flint-panel/v0.4.0/src/img/logo-title.png) Flint

Flint is an AI-assisted visualization panel for Grafana, powered by Microsoft Flint. Describe the chart you want in AI Chat, generate a proposal grounded in the panel's current query frames, review the live preview, and explicitly apply it. Flint renders the approved result with Apache ECharts, Vega-Lite, Plotly, or Chart.js.

## AI dependency

AI Chat and chart generation require [Flint AI Datasource](https://github.com/IBUMBLEBEE/grafana-flintai-datasource), installed in the same Grafana instance. The datasource currently requires **Grafana 13.1.0 or later**. Follow its [setup documentation](https://github.com/IBUMBLEBEE/grafana-flintai-datasource#readme) to configure a provider, API token, and model, test the connection, and save the datasource before selecting its model in the Chart workbench.

Automatic and manual chart creation remain available on Grafana 12.3.0 or later without the AI datasource. Panel queries continue to use your business datasource for chart data.

## Quick start

1. Add the **Flint** visualization to a panel.
2. Add or select a Grafana query.
3. Open **Chart settings → Open Chart workbench** and select a configured model.
4. Describe the chart or change you want in **AI Chat**, then select **Generate proposal**. AI determines the change scope from the conversation and current chart, asking for clarification when needed. Review the plan and preview before Apply.
5. Review the live preview and refine the request when needed.
6. Select **Apply to panel** to accept the draft, or discard it without changing the panel. Save the dashboard to persist the applied source.

Chart Settings supports chart creation without AI: dynamic field mappings, multiple numeric values, chart-specific options and Tooltip all use the same preview and Apply workflow. Vega-Lite supports official Flint theme presets; other backends display an unsupported notice and retain the selected preset without applying it. AI Chat is optional. Compatible settings survive chart switches and omitted settings survive AI proposals. After a proposal is applied, the panel does not need an active AI request to render it.

## Render backends

- **Apache ECharts** is the default and most broadly tested backend.
- **Vega-Lite** provides a declarative statistical grammar.
- **Plotly** supports interactive scientific and statistical charts.
- **Chart.js** is a compact canvas renderer for common chart types.

**UI Framework Spec** is read-only compiled output. Edit **Flint Spec** or **Chart Settings** to change the saved semantic source. The panel recompiles it with current query values at runtime.

## AI Assist and safety

AI Assist connects to the separately installed [Flint AI Datasource](https://github.com/IBUMBLEBEE/grafana-flintai-datasource) plugin. It combines the user's request with a redacted summary of the current query fields, generates a chart proposal, validates it against the live panel context, and stages it as a draft. The datasource owns provider configuration and credentials through Grafana `secureJsonData`; Flint Panel does not store credentials in panel options or dashboard JSON. Generated proposals remain drafts until explicitly applied.

Provider-facing data hints are redacted and size-limited. Saved Flint source cannot embed query data rows. Refine locks chart type, bindings, semantic types and properties during generation and repair, and rejects a stale committed-source baseline before Apply. Refine also supports per-series colors for supported multi-measure charts; it does not change themes or data semantics. Mock Provider tests cover Panel safeguards, not real LLM or external datasource compatibility.

## Agent / options contract

```json
{
  "type": "ibumblebee-flint-panel",
  "options": {
    "stateVersion": 1,
    "renderBackend": "echarts",
    "bindingMode": "auto",
    "flintInput": { "chart_spec": { "chartType": "Line Chart", "encodings": {} } },
    "ai": { "lastPrompt": "" }
  }
}
```

Agents should write structured, data-free `flintInput`. Backend output is read-only and compiled at runtime; framework overrides have been removed.

## Compatibility and support

Requires Grafana 12.3.0 or later. When reporting an issue, include the Grafana version, Flint Panel version, selected backend, browser, panel options with secrets removed, and minimal query-frame shape.

Flint Panel uses Microsoft Flint, Apache ECharts, Vega and Vega-Lite, Plotly.js, Chart.js, Grafana, and assistant-ui. Production archives include dependency license texts in `LICENSE.txt`.
