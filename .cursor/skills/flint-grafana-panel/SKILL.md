---
name: flint-grafana-panel
description: >-
  Builds intelligent Flint visualizations in Grafana: panel-editor AI Assist
  options, or Grafana MCP patches that set ibumblebee-flint-panel options. Use
  when the user mentions Flint panel, AI Assist in Grafana, AI-generated
  charts/dashboards, or Grafana MCP + Flint.
---

# Flint Grafana Panel

**An intelligent visualization panel for Grafana, powered by Microsoft Flint.**

## Product entry (preferred)

Inside Grafana, open the panel editor → **AI Assist**:

1. Data hint from the current query (fields + samples + rule suggestion)
2. **Auto** — local rule engine (no API key)
3. **Generate** — OpenAI-compatible LLM using `ai.baseUrl` / `ai.apiKey` / `ai.model`

Do not emit ECharts `option` JSON. Write Flint options only.

## Dashboard-scale (Grafana MCP)

When creating/updating dashboards via MCP:

1. Default panel `type` is `ibumblebee-flint-panel`
2. Prefer `patch_dashboard`
3. Options contract below; data stays in `targets`

## Hard rules

1. Default visualization panel `type` is **`ibumblebee-flint-panel`** (unless the user asks for Stat/Table/etc.).
2. **Do not** generate ECharts `option`, Vega-Lite specs, or Monaco JS for Business Charts.
3. Prefer `patch_dashboard` / targeted updates over full `update_dashboard` JSON.
4. Data always comes from panel `targets` (PromQL etc.). Never put query rows into `options.specJson`.
5. When field names are unknown, use `chartType: "auto"` and empty `xField` / `yField` / `colorField`.

## Panel options contract

```ts
options: {
  renderBackend: 'echarts' | 'vegalite' | 'plotly' | 'chartjs'; // default: echarts
  chartType: string; // "auto" | "Line Chart" | "Bar Chart" | ...
  xField: string; // "" = infer
  yField: string; // "" = infer
  colorField: string; // "" = infer
  specJson: string; // optional JSON string; overrides chart_spec; NO data
  ai: {
    baseUrl: string;
    apiKey: string;
    model: string;
    lastPrompt: string;
  }
}
```

Default render backend is **Apache ECharts** (most mature for Grafana panels).
Also supports Vega-Lite, Plotly, and Chart.js.

Supported `chartType` values (plugin UI): `auto`, `Line Chart`, `Area Chart`,
`Bar Chart`, `Grouped Bar Chart`, `Stacked Bar Chart`, `Scatter Plot`,
`Pie Chart`, `Heatmap`, `Histogram`, `Gauge Chart`, `Radar Chart`.

### Decision order

1. Inspect data shape (time series vs category vs two measures).
2. Pick `chartType` (or `auto`).
3. Optionally set `xField` / `yField` / `colorField` to Grafana field names.
4. Only if needed, set `specJson` to a stringified Flint `chart_spec` (or ChartAssemblyInput without `data`).

### Field-name rules after melt

Multi-series time frames are melted to columns **`Time`**, **`Value`**, **`series`**.
If you write `specJson` encodings for melted data, use those names. Prefer Auto when unsure.

### Pie Chart encodings

Use `color` + `size` (not Vega-style `theta`).

## Minimal panel fragment

```json
{
  "type": "ibumblebee-flint-panel",
  "title": "Node CPU",
  "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 },
  "datasource": { "type": "prometheus", "uid": "<uid>" },
  "targets": [
    {
      "refId": "A",
      "expr": "avg by(instance) (rate(node_cpu_seconds_total{mode!=\"idle\"}[5m]))"
    }
  ],
  "options": {
    "chartType": "Line Chart",
    "xField": "",
    "yField": "",
    "colorField": "",
    "specJson": ""
  }
}
```

## specJson example (string in options)

Object form (stringify before writing to Dashboard JSON):

```json
{
  "chartType": "Bar Chart",
  "encodings": {
    "x": { "field": "region", "type": "nominal" },
    "y": { "field": "revenue", "type": "quantitative" }
  }
}
```

## Grafana MCP workflow

1. `query_prometheus` (or list datasources) — understand metrics/labels.
2. `get_dashboard_summary` / `get_dashboard_property` — avoid full JSON.
3. `patch_dashboard` or `update_dashboard` — add/update Flint panels.
4. Optional later: `get_panel_image` for visual self-check.

## Anti-patterns

- Putting `data.values` inside `specJson`
- Writing ECharts `series`/`xAxis` into options
- Using Prometheus label names as encoding fields after melt without checking
- Replacing an entire production dashboard when a panel patch would do

## References in this repo

- [docs/agent-flint-grafana.md](../../../docs/agent-flint-grafana.md)
- [docs/templates/](../../../docs/templates/)
- [docs/schemas/flint-panel-options.schema.json](../../../docs/schemas/flint-panel-options.schema.json)
