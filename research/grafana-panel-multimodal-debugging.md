# Multimodal AI debugging for Grafana panels

Research date: 2026-09-23

## Conclusion

Sending a rendered panel image to a multimodal model is both technically
feasible and useful, but only as an additional **visual observation channel**.
It can reveal symptoms that a schema validator, Flint compiler, or JavaScript
exception cannot see: clipped labels, overlapping legends, unreadable text,
low contrast, blank or partially painted canvases, responsive-layout failures,
and differences between the intended spec and the pixels users actually see.

It should not become the source of truth for exact values, aggregation,
field semantics, timestamps, missing rows, or root cause. The reliable design
is therefore:

```text
structured validation + runtime diagnostics + panel image
                         ↓
              multimodal visual critic
                         ↓
              constrained Flint-level repair
                         ↓
        recompile + rerender + deterministic gates
                         ↓
                    user approval
```

Grafana can already render panels as PNGs, while current multimodal APIs accept
image inputs. Grafana's official sharing flow supports panel PNGs with explicit
`width`, `height`, `tz`, `timeout`, and `scale` parameters, so there is no
fundamental capture or model-interface barrier.
[Share dashboards and panels](https://grafana.com/docs/grafana/latest/visualizations/dashboards/share-dashboards-panels/)
[OpenAI images and vision](https://developers.openai.com/api/docs/guides/images-vision)
[Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)

## Why an image adds useful information

The existing project already checks the textual and executable parts of a
proposal. `validateAndCompileGenerated` validates fields and the pending
visualization, then assembles the candidate using real panel data. The live
preview uses the same Flint assembly and browser backend as the panel and
reports both compile and mount failures.
[Generation validation](../src/ai/generateOptions.ts)
[Live preview](../src/components/AiChartLivePreview.tsx)

Those checks answer questions such as “is this field valid?”, “does Flint
compile?”, and “did the backend mount?”. They cannot answer all of the questions
visible to a person looking at the result:

| Signal                               | Good at detecting                                                            | Cannot reliably establish                                                |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Spec, field schema, and data summary | field/type mismatch, unsupported channels, units, nulls, exact values        | final layout and legibility                                              |
| Compile/runtime diagnostics          | invalid Flint input, backend exceptions, failed mount                        | a technically successful but ugly or misleading render                   |
| Panel image                          | clipping, overlap, blank regions, contrast, density, theme and size problems | exact data correctness, query freshness, hidden state, causal root cause |

Primary research supports both sides of this boundary. ChartQA explicitly
combined visual features with the underlying chart table to handle visual and
logical questions rather than treating either representation as sufficient by
itself. Google Research also found that plots can outperform long numeric text
for several time-series pattern tasks. Conversely, ChartQAPro found a large
performance drop when vision-language models were evaluated on more diverse,
realistic charts. These results support adding pixels, but not replacing the
structured inputs with pixels.
[ChartQA](https://aclanthology.org/2022.findings-acl.177/)
[Plots unlock time-series understanding](https://research.google/blog/unlocking-the-power-of-time-series-data-with-multimodal-models/)
[ChartQAPro](https://aclanthology.org/2025.findings-acl.978/)

## Recommended diagnostic bundle

The model should receive a deliberately small, typed bundle rather than a full
dashboard screenshot and an open-ended request:

```json
{
  "task": "diagnose_visual_render",
  "image": "panel-only PNG",
  "visualContext": {
    "width": 900,
    "height": 420,
    "devicePixelRatio": 2,
    "theme": "dark",
    "timeRange": "absolute and redacted if needed",
    "backend": "echarts"
  },
  "chart": {
    "flintInput": "the proposed semantic contract",
    "fields": "names, primitive types, semantic types",
    "dataSummary": "bounded counts, ranges, null counts, sampled labels",
    "compileDiagnostics": [],
    "runtimeDiagnostics": []
  },
  "allowedRepairs": "schema for Flint-level edits only"
}
```

For a visual regression, send a clearly labelled pair: expected/reference and
actual. For an interaction problem, send a baseline and a deliberately frozen
interaction state, together with the event that produced it. Do not rely on the
model to infer image ordering or the meaning of each image.

The response should also be structured. A useful contract contains a stable
defect category, confidence, short evidence, optional evidence region, whether
the issue is answerable from the provided inputs, and a constrained proposed
Flint patch. It should be valid for the model to return `insufficient_evidence`.
Free-form backend JavaScript should not be an accepted repair format.

The current provider contract is text/JSON-only: `GenerateChartRequest` and
`RepairChartRequest` have fields, samples, conversation, candidate, and compile
error, but no image part. Multimodal debugging therefore requires an explicit
provider capability and transport extension; it is not enabled merely by
capturing a screenshot.
[Current provider contract](../src/ai/providerClient.ts)

## Capture strategy

### 1. Capture the current live-preview region for draft debugging

For “Debug this preview”, capture only the preview host after the runtime says
it is ready. This is the closest representation of the user's actual draft,
viewport, theme, browser, backend, and transient visual state. It also matters
because the project stages an unsaved draft before Apply; a server renderer
that reopens a saved dashboard should not be assumed to see that draft.

Recommended controls:

- Crop to the panel/preview root, not the Grafana page or dashboard.
- Record width, height, device-pixel ratio, theme, backend, locale, timezone,
  and capture timestamp alongside the image.
- Wait for fonts and layout to settle, and disable or finish animation before
  capture. A mount success alone does not prove that the final frame is stable.
- Prefer one standard-resolution image first. Add a high-resolution crop only
  when small text or a dense region needs inspection.
- Keep the image in memory unless the user explicitly saves a diagnostic.

This path needs testing across the four backends because the preview may contain
Canvas, SVG, and ordinary DOM. The capture result, not only the capture API
return value, should be checked for blank or missing layers.

### 2. Use Grafana Image Renderer for saved-state and CI reproduction

Grafana Image Renderer is appropriate for a saved panel, background regression
tests, alert-style rendering, and reproduction in a controlled environment.
It runs a separate Chromium-based rendering service and can generate panel and
dashboard PNGs. The service waits for queries, network activity, and layout
stability, with configurable readiness and timeout behavior.
[Set up image rendering](https://grafana.com/docs/grafana/latest/setup-grafana/image-rendering/)
[Renderer readiness](https://grafana.com/docs/grafana/latest/setup-grafana/image-rendering/troubleshooting/#understand-incomplete-outputs-and-request-timeouts)

It is not an exact substitute for the browser capture. It reopens a URL in a
different browser process, can rerun queries, and can differ in fonts, timezone,
GPU behavior, viewport, cookies, or transient interaction state. Treat a
browser-only failure and a renderer-only failure as distinct environments in
diagnostics rather than allowing one image to overwrite the other.

Renderer capacity is also non-trivial: Grafana recommends at least 16 GiB of
memory and four CPU cores for the service, noting that rendering has spiky CPU
and memory needs. It should be rate-limited and monitored, not invoked on every
keystroke.
[Renderer resource guidance](https://grafana.com/docs/grafana/latest/setup-grafana/image-rendering/)

## Repair loop for this project

A conservative loop would be:

1. Generate the semantic Flint candidate.
2. Run the existing schema, field, capability, and compile checks.
3. Mount through the existing live-preview runtime.
4. If compilation or mount fails, use the structured error path first; an image
   usually adds little when no valid frame exists.
5. If mount succeeds, capture on explicit user request or when a deterministic
   visual heuristic flags a likely issue.
6. Ask the multimodal critic to diagnose only the allowed visual categories.
7. Send its constrained Flint patch through the same validation, compilation,
   and runtime path as any other repair.
8. Capture the repaired result and compare before/after. Deterministic checks
   and the user, not the model's self-assessment, decide whether it improved.
9. Keep the existing Apply/Discard boundary. Never auto-apply a visual repair
   merely because the model reports success.

Useful stable categories include `blank-render`, `clipped-content`,
`label-overlap`, `legend-overlap`, `illegible-text`, `low-contrast`,
`excessive-density`, `theme-mismatch`, `responsive-layout`,
`interaction-state`, and `not-visually-diagnosable`. Keep semantic errors such
as wrong aggregation, unit, timezone, or rank direction in the structured
validation domain even when they happen to be visible.

## Failure modes and guardrails

### Vision is fallible on exactly the details charts rely on

OpenAI's official vision guide warns about small text, graphs distinguished by
color or line style, precise spatial localization, counting, resizing, and
incorrect descriptions. Higher detail can help with dense inputs but does not
remove these limitations. Gemini likewise states that more media resolution
helps with fine text while increasing token use and latency.
[OpenAI vision limitations](https://developers.openai.com/api/docs/guides/images-vision#limitations)
[OpenAI detail levels and cost](https://developers.openai.com/api/docs/guides/images-vision#choose-an-image-detail-level)
[Gemini resolution and tokens](https://ai.google.dev/gemini-api/docs/image-understanding#token-calculation)

Consequences for panel debugging:

- Never ask the model to recover authoritative numeric values from pixels when
  the underlying table or summary is available.
- Do not accept “a line is missing” without checking the series and renderer
  state; overlapping lines and similar colors can look missing.
- Do not let a screenshot prove that an aggregation, scale, unit, timezone, or
  query is correct.
- Require evidence and confidence, but remember that confidence is not a proof.
- Bound retries. A visual critic can oscillate between cosmetic alternatives or
  “repair” one viewport while breaking another.

### A screenshot loses behavior and hidden state

A still image does not contain hover hit-testing, keyboard navigation,
accessibility semantics, DOM ownership, event handlers, console output, or the
frames before and after an animation. Interaction bugs need event traces plus
one or more deliberately captured states. Accessibility requires dedicated DOM
and accessibility checks; it cannot be certified by visual inspection.

### Screen content is untrusted input

Series labels, annotations, data values, markdown, or HTML panels can contain
text that looks like instructions to a model. Treat all pixels and OCR text as
untrusted data. The model should have no credential access or direct Apply
authority; structured outputs, an allowlisted patch schema, deterministic
validation, and user confirmation should sit between diagnosis and action.
OpenAI's computer-use guidance similarly says to treat screen content as
untrusted, restrict actions, and verify outcomes.
[Computer-use safety](https://developers.openai.com/api/docs/guides/tools-computer-use#run-safely)
[Agent safety and structured outputs](https://developers.openai.com/api/docs/guides/agent-builder-safety)

## Privacy, security, and cost

A panel crop may contain customer or host names, series labels, incident text,
annotations, IDs, usernames, exact business metrics, or health/financial data.
Removing query text is not sufficient: Grafana's own snapshot documentation
notes that snapshots remove queries and panel links but retain visible metrics
and series names.
[Grafana panel snapshots](https://grafana.com/docs/grafana/latest/visualizations/dashboards/share-dashboards-panels/#share-a-snapshot)

Minimum controls should include:

- Explicit opt-in for image analysis, with a preview of exactly what will be
  sent.
- Panel-only crop and local masking before upload. Use an allowlist of regions
  where practical rather than trying to discover every secret afterward.
- A data classification check that can disable image upload entirely for
  protected dashboards.
- No image bytes in ordinary application logs; log a content hash, dimensions,
  model, latency, diagnostic category, and retention decision instead.
- Short-lived in-memory or encrypted temporary storage, bounded TTLs, and
  deletion on cancellation.
- Provider-specific review of region, retention, training, subprocessors, and
  contractual controls. Do not infer that every provider has the same policy.

For example, OpenAI states that API data is not used for model training unless
the customer opts in, while default abuse-monitoring logs can retain customer
content for up to 30 days; eligible customers can apply for additional
retention controls. Image/file inputs also have documented safety-scanning
exceptions. These details must be checked for the exact endpoint and account
configuration rather than summarized as “the screenshot is not stored.”
[OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)

The Grafana renderer itself needs hardening. Configure a non-default secret
token, restrict network exposure, use TLS where required, keep it isolated, and
rate-limit requests. Grafana documents renderer authentication, TLS, Chromium
sandboxing, and the limitations of optional namespace isolation.
[Renderer authentication](https://grafana.com/docs/grafana/latest/setup-grafana/image-rendering/#security)
[Renderer security options](https://grafana.com/docs/grafana/latest/setup-grafana/image-rendering/troubleshooting/)

Image cost depends on model, dimensions, and detail mode. Current OpenAI and
Gemini documentation both describe image tokenization and higher-resolution
tradeoffs. A practical policy is progressive disclosure: structured diagnostics
first, then a standard panel crop, then a high-detail crop only if required.
Cache only by a privacy-safe key over visualization revision, data generation,
size, theme, and backend; a spec-only key can incorrectly reuse an image after
the data changes.

## Evaluation plan

Do not evaluate the feature by asking whether explanations sound plausible.
Build a gold set of real panels plus controlled fault injection:

- blank/partial paint, clipped axis labels, legend overlap, label collisions,
  low contrast, tiny text, excessive density, NaN/empty-series behavior;
- incorrect unit, scale, aggregation, timezone, and missing rows, specifically
  to test whether the model wrongly claims visual certainty;
- loading, error, hover/tooltip, and responsive states;
- all four supported backends, common chart types, dark/light themes, multiple
  viewport sizes and device-pixel ratios, and Chinese/English labels.

Compare at least three conditions with identical tasks:

1. structured diagnostics only;
2. image only;
3. image plus structured diagnostics.

Measure:

- defect detection precision and recall by stable category;
- root-cause accuracy and `insufficient_evidence` calibration;
- percentage of proposed repairs that compile and mount;
- percentage that actually remove the gold defect without introducing another;
- exact-data hallucination and false-edit rate;
- expert acceptance rate and time saved;
- repeated-run consistency and robustness to small changes in size, resolution,
  theme, label language, and series color;
- end-to-end latency, image tokens, monetary cost, renderer load, and retry count;
- redaction misses, unintended image persistence, and prompt-injection success.

Use deterministic assertions where possible, pixel or layout checks for known
faults, and blinded human review for genuinely perceptual issues. A/B the three
conditions rather than assuming the hybrid is better. Research benchmarks show
that realistic chart diversity and small visual perturbations expose much more
difficulty than clean synthetic charts, so the project's own Grafana/backend
matrix is the relevant acceptance test.
[ChartQAPro](https://aclanthology.org/2025.findings-acl.978/)

## Recommended rollout

1. **Offline evaluation:** collect redacted fixtures and establish whether the
   hybrid condition beats structured-only diagnosis at acceptable cost.
2. **Read-only opt-in:** add “Analyze preview image” as a user-triggered
   diagnosis that proposes no automatic edit.
3. **Constrained repair suggestion:** allow one Flint-level proposal, run it
   through the existing compile/runtime loop, and show before/after results.
4. **Bounded automatic retry:** only after measured precision is adequate; keep
   a strict retry limit and retain user Apply/Discard.

The highest-value first version is not continuous screenshot streaming. It is a
single, panel-only capture taken after a successful live-preview mount, paired
with the exact semantic spec and diagnostics that produced it, and used by a
read-only visual critic. That fills the current observability gap while keeping
Flint and deterministic checks responsible for correctness.
