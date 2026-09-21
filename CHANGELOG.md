# Changelog

## 1.0.0 - 2026-09-21

Product: **An intelligent visualization panel for Grafana, powered by Microsoft Flint.**

### Features

- Automatic and manually reviewable chart configuration from Grafana DataFrames
- Apache ECharts, Vega-Lite, Plotly, and Chart.js rendering backends
- Data-free framework overrides for advanced renderer customization
- Optional panel-editor AI Assist through an external Flint AI datasource
- Agent and Grafana MCP documentation for dashboard-scale automation

### Security

- AI credentials remain in datasource `secureJsonData` and are never stored in panel options
- Generated specifications and framework overrides reject embedded query rows and unsafe object keys

### Quality

- Unit and browser tests covering rendering, interactions, drafts, and override persistence
- Lazy-loaded renderers and AI editor to reduce the initial plugin bundle
