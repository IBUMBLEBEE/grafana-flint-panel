# Flint Panel for Grafana

[English](README.md) | [简体中文](README.zh-CN.md)

Flint is an AI-assisted visualization panel for Grafana, powered by [Microsoft Flint](https://github.com/microsoft/flint-chart). Describe the chart you want in AI Chat, generate a proposal grounded in the current Grafana query frames, review it in a live preview, and explicitly apply it to the panel. Flint then renders the result with Apache ECharts, Vega-Lite, Plotly, or Chart.js.

> [!WARNING]
> **Project status: experimental, research-oriented proof of concept (POC).** This repository demonstrates and evaluates a Grafana integration with Flint and AI-generated visualization proposals; it is not production-ready and does not provide a stable compatibility or migration guarantee. Treat every AI proposal as untrusted: even a style-only request such as “change the colors” may currently regenerate chart type, field bindings, or Flint Spec. Review the preview and Chart Settings before Apply. See [Project status and maturity](docs/project-status.md).

**AI Assist is the primary workflow.** Automatic chart selection and manual Chart Studio controls remain available as reliable fallbacks. Conversational generation uses a separately installed compatible Flint AI datasource, keeping provider configuration and credentials outside the panel.

![AI Chart Studio with live Panel preview and AI Chat](src/img/screenshots/ai-chart-studio.gif)

## Highlights

- Create and refine charts through AI Chat using the current Grafana query context.
- Review generated drafts in a live preview before explicitly applying or discarding them.
- Render approved charts with Apache ECharts, Vega-Lite, Plotly, or Chart.js.
- Use Auto, manual settings, or specification editors when more control is needed.

## Compatibility

| Component               | Supported version |
| ----------------------- | ----------------- |
| Grafana                 | 12.3.0 or later   |
| Node.js for development | 22 or later       |
| Package manager         | npm 10            |

The browser test suite covers the minimum supported Grafana 12.3 line and the current Grafana 13 line.

## Getting started

### Run the development environment

```bash
npm ci
npm run build
docker compose up --build
```

Open <http://localhost:3000>, then select **Provisioned Flint dashboard**. The default Compose setup builds and mounts this panel and uses Grafana's built-in TestData datasource; it does not require a sibling datasource repository.

For incremental frontend development, run:

```bash
npm run dev
```

### Create a visualization with AI Assist

1. Add a panel to a Grafana dashboard and configure its query.
2. Select the **Flint** visualization.
3. Expand **AI Assist** and open **AI Chart Studio**.
4. Select a configured model, describe the chart or change you want in **AI Chat**, and send the request.
5. Select **Generate proposal** to turn the conversation and current query context into a chart draft.
6. Review the live preview and, if needed, refine the request or adjust Chart Settings, Flint Spec, or UI Framework Spec.
7. Select **Apply to panel** to commit the draft, or **Discard edits** to leave the panel unchanged.

If no AI provider is configured, keep **Chart type** set to **Auto** or use the manual Chart Studio controls.

## Rendering backends

| Backend        | Best suited for                                         |
| -------------- | ------------------------------------------------------- |
| Apache ECharts | Default and most broadly tested Grafana dashboards      |
| Vega-Lite      | Declarative statistical and grammar-based visualization |
| Plotly         | Interactive scientific and statistical charts           |
| Chart.js       | Lightweight canvas charts for common use cases          |

Renderer code is loaded on demand, so opening a normal Flint panel does not eagerly load every backend.

![Flint visualization gallery](src/img/screenshots/flint-panel.png)

## Chart Studio

Chart Studio is the AI-assisted chart creation and review workspace inside the Grafana panel editor:

- **AI Chat** accepts natural-language chart requests and follow-up refinements based on the current data context.
- **Generate proposal** converts the conversation into a validated, unapplied chart draft.
- **UI Preview** renders the current panel or the proposed draft with the actual query frames.
- **Chart Settings** provides reviewable chart type and field mapping controls.
- **Flint Spec** exposes the semantic visualization specification.
- **UI Framework Spec** exposes the compiled backend-native configuration.
- **Apply to panel** is the explicit boundary between an AI proposal and the saved panel configuration.

Drafts are tied to the current dashboard, panel, query, and field schema. If that context changes, stale drafts are prevented from being applied.

## How it works

```text
Grafana query frames
  -> build a redacted data hint and field schema
  -> combine them with the AI Chat request and conversation
  -> generate and validate a Flint chart proposal
  -> stage the proposal in the live preview
  -> compile a Flint chart specification
  -> compile for the selected rendering backend
  -> replay an optional data-free framework override
  -> apply explicitly and render inside the Grafana panel
```

The AI workflow uses the query frames already attached to the Grafana panel. It does not introduce a second business-data selector. After a proposal is applied, the panel can continue rendering it without an active AI request.

## AI Assist setup and safety

Install and configure a compatible Flint AI datasource separately, then select its model from AI Chart Studio. Automatic and manual chart creation remain available when that service is unavailable.

The integration follows these boundaries:

- Provider credentials belong to the datasource and are stored by Grafana in `secureJsonData`.
- Flint Panel and dashboard JSON do not store provider API keys.
- Chat history is bounded and temporary to the browser session.
- Provider-facing data hints are redacted, size-limited, and omit business datasource identities.
- Ordinary requests use chart and field selections; advanced requests use a structured, data-free Flint `chartInput`.
- AI-generated options are validated against the current query fields and compiled by the installed `flint-chart` runtime.
- One bounded repair may receive the exact compiler error; a failed repair is shown explicitly before scalar fallback.
- Flint Spec and UI Framework overrides cannot embed query data rows.
- A proposal never changes the panel until the user selects Apply.

## Panel options contract

Agents and provisioning tools can use the following shape:

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
    "ai": {
      "providerUid": "",
      "lastPrompt": ""
    }
  }
}
```

External agents should write Flint options and leave the internal `frameworkOverrides` field unset. See the complete [options schema](docs/schemas/flint-panel-options.schema.json) and [Grafana MCP contract](docs/agent-flint-grafana.md).

## Development and verification

Run the same checks used by CI:

```bash
npm run format:check
npm run typecheck
npm run lint
npm run test:ci
npm run audit:prod
npm run build
npm run e2e
```

Useful commands:

| Command           | Purpose                                   |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Watch and rebuild the frontend            |
| `npm run test:ci` | Run the Jest unit suite                   |
| `npm run e2e`     | Run Grafana browser tests with Playwright |
| `npm run build`   | Create the production plugin in `dist/`   |
| `npm run sign`    | Sign an approved plugin build             |

## Project structure

```text
src/components/     Panel, Chart Studio, preview, and chat UI
src/flint/          Data conversion, validation, compilation, and renderers
src/ai/             Panel context, proposals, provider client, and temporary chat
tests/              Grafana Playwright end-to-end tests
provisioning/       Local dashboards and datasource fixtures
docs/               Requirements, schemas, design notes, and MCP examples
```

## Documentation

- [Project status and maturity](docs/project-status.md)
- [Documentation index](docs/README.md)
- [Product roadmap](docs/product-roadmap.md)
- [Agent and Grafana MCP contract](docs/agent-flint-grafana.md)
- [Panel options schema](docs/schemas/flint-panel-options.schema.json)
- [Security policy](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## Packaging and release

A release archive must contain a top-level directory named after the plugin ID:

```text
ibumblebee-flint-panel/
  plugin.json
  module.js
  README.md
  LICENSE
  ...
```

Public Grafana submissions also require a public source repository, a release archive, its SHA1 checksum, testing guidance, and a Grafana Cloud organization matching the `ibumblebee` plugin ID prefix. New public plugins are expected to be unsigned during their initial review and are signed after approval.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request. Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Acknowledgements

Flint Panel builds on Microsoft Flint, Grafana, Apache ECharts, Vega and Vega-Lite, Plotly.js, Chart.js, and assistant-ui. Production archives include dependency license information in `LICENSE.txt`.

## License

Licensed under Apache-2.0. See [LICENSE](LICENSE).
