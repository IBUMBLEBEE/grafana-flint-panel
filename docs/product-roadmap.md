# Product roadmap

**Tagline:** An intelligent visualization panel for Grafana, powered by Microsoft Flint.

## Product form (now)

The **AI Chart Studio**, launched from the Panel editor's **AI Assist** section,
is the AI entry point inside Grafana:

1. Run a query (Prometheus / TestData / …).
2. Edit the Flint Panel → open **AI Assist → AI Chart Studio**.
3. Select a separately installed Flint AI data source and describe the chart in
   **AI Chat**. The provider key remains in that data source's Grafana
   `secureJsonData`.
4. **Generate proposal** combines the bounded conversation with the current
   Panel query context and creates a validated, unapplied draft.
5. Review the draft in the live preview, Chart Settings, Flint Spec, or UI
   Framework Spec, then explicitly **Apply to panel**.

```text
Query data
  → AI Chart Studio + bounded conversation
  → validated proposal
  → live preview
  → explicit Apply
  → Flint compiler
  → ECharts / Vega-Lite / Plotly / Chart.js
```

Manual controls (chart type, fields, JSON) remain under **Flint**. AI and MCP-originated options are checked against the live query schema and cannot embed query rows in `specJson`.

## Why this shape

| Layer                | Role                                                    |
| -------------------- | ------------------------------------------------------- |
| Grafana              | Data, dashboards, permissions                           |
| Flint                | Visualization IR (what to draw)                         |
| AI Chart Studio      | Chat, proposal review, preview, and Apply for one Panel |
| Flint AI data source | Named provider instances and server-side secure adapter |
| Grafana MCP (later)  | Agent orchestration across dashboards                   |

## Phased value

### Phase 1 — Intelligent panel (current)

- AI Chart Studio with temporary multi-turn chat and live preview
- Auto, manual, and AI-assisted Flint proposals with explicit Apply
- Four selectable rendering backends
- Docs + templates for Grafana MCP (external agents)

### Phase 2 — AI-native visualization

- Richer prompts (thresholds, units, facets)
- Optional `validate_chart` via flint-chart-mcp before apply
- Additional governed authoring and validation workflows

### Phase 3 — AI-generated Dashboard

- Multi-panel generation via Grafana MCP (`patch_dashboard` / `update_dashboard`)
- Diagnosis → temporary dashboard → human approval
- Reuses the same Flint options and approval contract as AI Chart Studio

## Security note

The Panel never stores an API key. Each selected Flint AI data source stores it
in Grafana `secureJsonData`, and only its Go backend reads the decrypted key.
