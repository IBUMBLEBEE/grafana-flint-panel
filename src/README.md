# ![Flint AI Panel logo](img/logo-title.png) Flint

Flint is an AI-assisted visualization panel for Grafana, powered by Microsoft Flint. Describe the chart you want in AI Chat, generate a proposal grounded in the panel's current query frames, review the live preview, and explicitly apply it. Flint renders the approved result with Apache ECharts, Vega-Lite, Plotly, or Chart.js.

## AI dependency

AI Chat and chart generation require [Flint AI Datasource](https://github.com/IBUMBLEBEE/grafana-flintai-datasource), installed in the same Grafana instance. The datasource currently requires **Grafana 13.1.0 or later**. Follow its [setup documentation](https://github.com/IBUMBLEBEE/grafana-flintai-datasource#readme) to configure a provider, API token, and model, test the connection, and save the datasource before selecting its model in AI Chart Studio.

Automatic and manual chart creation remain available on Grafana 12.3.0 or later without the AI datasource. Panel queries continue to use your business datasource for chart data.

## Quick start

1. Add the **Flint** visualization to a panel.
2. Add or select a Grafana query.
3. Open **AI Assist → Open AI Chart Studio** and select a configured model.
4. Describe the chart or change you want in **AI Chat**, then select **Generate proposal**.
5. Review the live preview and refine the request when needed.
6. Select **Apply to panel** to accept the draft, or discard it without changing the panel.

AI Assist is the primary workflow. Automatic chart inference and manual Chart Studio controls remain available as fallbacks. After a proposal is applied, the panel does not need an active AI request to render it.

## Render backends

- **Apache ECharts** is the default and most broadly tested backend.
- **Vega-Lite** provides a declarative statistical grammar.
- **Plotly** supports interactive scientific and statistical charts.
- **Chart.js** is a compact canvas renderer for common chart types.

Advanced users can edit **UI Framework Spec** in the Chart Studio. The panel stores only a data-free override and recompiles query values at runtime. Stale overrides are ignored when the Flint source or compiler version changes.

## AI Assist and safety

AI Assist connects to the separately installed [Flint AI Datasource](https://github.com/IBUMBLEBEE/grafana-flintai-datasource) plugin. It combines the user's request with a redacted summary of the current query fields, generates a chart proposal, validates it against the live panel context, and stages it as a draft. The datasource owns provider configuration and credentials through Grafana `secureJsonData`; Flint Panel does not store credentials in panel options or dashboard JSON. Generated proposals remain drafts until explicitly applied.

Provider-facing data hints are redacted and size-limited. Generated Flint specifications and framework overrides cannot embed query data rows.

## Agent / options contract

```json
{
  "type": "ibumblebee-flint-panel",
  "options": {
    "renderBackend": "echarts",
    "chartType": "Line Chart",
    "xField": "",
    "yField": "",
    "colorField": "",
    "specJson": "",
    "ai": { "providerUid": "", "lastPrompt": "" }
  }
}
```

Agents should write Flint options and leave the internal `frameworkOverrides` field unset.

## Compatibility and support

Requires Grafana 12.3.0 or later. When reporting an issue, include the Grafana version, Flint Panel version, selected backend, browser, panel options with secrets removed, and minimal query-frame shape.

Flint Panel uses Microsoft Flint, Apache ECharts, Vega and Vega-Lite, Plotly.js, Chart.js, Grafana, and assistant-ui. Production archives include dependency license texts in `LICENSE.txt`.
