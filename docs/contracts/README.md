# AI datasource request contract

Contract v1 is defined in `ai-request-v1.schema.json`. It describes serialized Generate and Repair requests, independently of Chart Settings UI types. `src/ai/providerWire.ts` owns conversion; datasource helpers receive the resulting wire types.

## Changing the interface

1. Classify a new field as Panel-local or datasource-facing. Keep UI labels, defaults, host state and allowed-path locks local.
2. Add datasource-facing fields explicitly to the wire type and allowlist converter. Map each typed nested object; arbitrary authoring objects (`chartInput`, sample rows and palettes) retain their content.
3. Update the versioned schema and consumer decoder together for interface changes. Keep an existing schema version immutable once published; add a new version when changing its accepted shape.
4. Test the final JSON, using every installed backend's full chart catalog. Preserve accepted values, including null options created by JSON serialization; test that unexpected fields are rejected and original inputs remain unchanged.
5. Run `npm run check:ai-contract`. It generates requests in the Panel's Jest test and runs the actual datasource Generate/Repair decoders in a temporary copy. Set `FLINT_AI_DATASOURCE_DIR` when the checkout is not the sibling `flint-ai-datasource` repository. Missing consumer sources are a failure, not a skipped validation.
6. Verify rejection behavior: no committed chart mutation, no automatic Apply, manual edits remain recoverable, and diagnostics retain a redacted request/error. Strict mock providers must validate the contract instead of accepting any object.

CI verifies the same serialized fixtures against baseline commit `9ffc1a1f214b5c171072059fdb9003ced92466b1` and current datasource `main`. These checks establish compatibility of the tested Generate/Repair payloads, not support for every optional response capability (such as per-series palettes). Advance the baseline deliberately and review both decoder results. CI requires read access to the consumer repository.

## Compatibility and diagnostics

The datasource currently has no interface-version/capability endpoint. The Panel uses method availability to detect missing operations and gives an upgrade message. Generic request-contract rejection asks users to check compatibility and export diagnostics; it does not guess a minimum plugin version or silently substitute chart generation.

Diagnostic format v2 keeps `request` as the original Panel input and adds `transmittedRequest`, captured from the actual adapter call after allowlist conversion and JSON serialization. It records `requestStage`, `contractVersion` and `httpStatus` when supplied by the datasource error. A missing transmitted request means the adapter boundary was not observed; it is never reconstructed from internal input. This boundary is the datasource helper, not upstream HTTP retries or a packet capture. Both representations are redacted immediately, including query samples and copied credentials.

The JSON Schema test reports exact paths for incompatible fields during development. The datasource's public generic decode error remains unchanged; improving its internal error details requires a coordinated datasource change. A future capability endpoint should declare interface versions and optional operations explicitly before the Panel sends newly introduced request fields.
