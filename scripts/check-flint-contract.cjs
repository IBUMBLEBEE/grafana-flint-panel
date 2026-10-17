#!/usr/bin/env node
// Read-only checks shared by CI and the local dashboard smoke test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020').default;

const root = path.resolve(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const schema = readJson('docs/schemas/flint-panel-options.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validOptions = ajv.compile(schema);
const provisionedDatasourceUids = [
  ...fs
    .readFileSync(path.join(root, 'provisioning/datasources/datasources.yml'), 'utf8')
    .matchAll(/^\s+uid:\s+(\S+)/gm),
].map((match) => match[1]);

function assertOptions(options, label) {
  assert(validOptions(options), label + ': ' + ajv.errorsText(validOptions.errors));
  assert(options.flintInput.chart_spec.chartType !== 'auto' || options.bindingMode === 'auto', label + ': Auto mode');
  assert(!options.ai.providerUid || options.ai.providerUid !== 'REPLACE_AI_UID', label + ': unresolved AI provider');
  assert(!('data' in options.flintInput), label + ': query data must be runtime-bound');
  assert(!('canvasSize' in options.flintInput.chart_spec), label + ': host size must be runtime-bound');
}

function assertPanel(panel, label) {
  assert.equal(panel.type, 'ibumblebee-flint-panel', label + ': type');
  assertOptions(panel.options, label);
  assert(Array.isArray(panel.targets) && panel.targets.length > 0, label + ': targets');
  if (panel.datasource.type === 'grafana-testdata-datasource') {
    assert(provisionedDatasourceUids.includes(panel.datasource.uid), label + ': provisioning UID');
    for (const target of panel.targets) {
      assert.equal(target.datasource.uid, panel.datasource.uid, label + ': target datasource');
      if (target.scenarioId !== 'raw_frame') {
        continue;
      }
      const frames = JSON.parse(target.rawFrameContent);
      const fields = new Set(frames.flatMap((frame) => frame.columns.map((column) => column.text)));
      for (const value of Object.values(panel.options.flintInput.chart_spec.encodings || {})) {
        for (const encoding of Array.isArray(value) ? value : [value]) {
          const field = typeof encoding === 'string' ? encoding : encoding.field;
          assert(fields.has(field), label + ': absent query field ' + field);
        }
      }
      for (const field of Object.keys(panel.options.flintInput.semantic_types || {})) {
        assert(fields.has(field), label + ': absent semantic field ' + field);
      }
    }
  }
}

function runChecks() {
  const chartTypesSource = fs.readFileSync(path.join(root, 'src/flint/chartTypes.ts'), 'utf8');
  const supportedNamesBlock = chartTypesSource.match(/const PANEL_CHART_TYPE_NAMES = \[([\s\S]*?)\] as const/);
  assert(supportedNamesBlock, 'Panel chart types definition');
  const supportedNames = [...supportedNamesBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(
    schema.$defs.flintInput.properties.chart_spec.properties.chartType.enum,
    ['auto', ...supportedNames],
    'schema/Panel chart catalog drift'
  );
  const folder = path.join(root, 'docs/templates');
  const templateFiles = fs.readdirSync(folder).filter((file) => file.endsWith('.json'));
  let panelCount = 0;
  for (const file of templateFiles) {
    const object = readJson('docs/templates/' + file);
    const panels = object.dashboard?.panels ||
      object.operations?.filter((op) => op.op === 'add').map((op) => op.value) || [object];
    for (const panel of panels) {
      assertPanel(panel, file);
      panelCount++;
    }
    if (object.dashboard) {
      assert.equal(object.overwrite, false, file + ': creation must not overwrite');
      assert.equal(object.dashboard.version, 0, file + ': fresh dashboard version');
    }
    for (const operation of object.operations || []) {
      assert.equal(operation.path, '$.panels/-', file + ': append path');
    }
  }
  for (const panel of readJson('provisioning/dashboards/dashboard.json').panels) {
    if (panel.type === 'ibumblebee-flint-panel') {
      assertOptions(panel.options, 'provisioned ' + panel.title);
    }
  }

  // Guard evidence travels with proposals, never with committed chart source.
  const sourceOptions = readJson('docs/templates/panel-bar-table.json').options;
  const guardedDraft = {
    stateVersion: sourceOptions.stateVersion,
    renderBackend: sourceOptions.renderBackend,
    bindingMode: sourceOptions.bindingMode,
    flintInput: sourceOptions.flintInput,
    source: 'provider',
    baseFingerprint: 'source-revision',
  };
  assert(
    validOptions({ ...sourceOptions, ai: { ...sourceOptions.ai, draft: guardedDraft } }),
    'schema rejected refinement draft guard'
  );
  assert(
    !validOptions({ ...sourceOptions, baseFingerprint: 'source-revision' }),
    'schema accepted baseline in committed source'
  );
  for (const invalidFingerprint of ['', null, 123]) {
    assert(
      !validOptions({
        ...sourceOptions,
        ai: { ...sourceOptions.ai, draft: { ...guardedDraft, baseFingerprint: invalidFingerprint } },
      }),
      'schema accepted malformed refinement guard'
    );
  }

  // Regression guards: the schema must reject the retired persisted shapes.
  const sample = readJson('docs/templates/panel-bar-table.json').options;
  for (const obsolete of ['chartType', 'xField', 'yField', 'colorField', 'specJson', 'frameworkOverrides']) {
    assert(!validOptions({ ...sample, [obsolete]: '' }), 'schema accepted obsolete ' + obsolete);
  }
  assert(
    !validOptions({ ...sample, flintInput: { ...sample.flintInput, data: { values: [] } } }),
    'schema accepted data'
  );
  assert(
    !validOptions({ ...sample, flintInput: { chart_spec: { ...sample.flintInput.chart_spec, canvasSize: {} } } }),
    'schema accepted canvasSize'
  );

  assert(
    !validOptions({ ...sample, flintInput: { ...sample.flintInput, options: { nested: { data: [] } } } }),
    'schema accepted nested data'
  );
  for (const fakeMap of ['field_display_names', 'semantic_types']) {
    assert(
      !validOptions({
        ...sample,
        flintInput: {
          ...sample.flintInput,
          options: { [fakeMap]: { data: [{ region: 'North', revenue: 120 }] } },
        },
      }),
      'schema accepted query rows in nested fake map ' + fakeMap
    );
    assert(
      !validOptions({
        ...sample,
        flintInput: {
          ...sample.flintInput,
          chart_spec: { ...sample.flintInput.chart_spec, [fakeMap]: { data: [] } },
        },
      }),
      'schema accepted chart-level fake map ' + fakeMap
    );
  }
  assert(
    !validOptions({
      ...sample,
      flintInput: {
        ...sample.flintInput,
        semantic_types: { revenue: { semanticType: 'Amount', field_display_names: { data: [] } } },
      },
    }),
    'schema accepted nested data under root semantic annotation'
  );
  assert(
    validOptions({
      ...sample,
      flintInput: {
        ...sample.flintInput,
        semantic_types: { data: 'Quantity' },
        field_display_names: { data: 'Data measure' },
      },
    }),
    'schema rejected real field named data'
  );

  for (const file of [
    'README.md',
    'README.zh-CN.md',
    'src/README.md',
    'docs/README.md',
    'docs/agent-flint-grafana.md',
  ]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/\`\`\`json\n([\s\S]*?)\n\`\`\`/g)) {
      const object = JSON.parse(match[1]);
      if (object.options) {
        assertOptions(object.options, file + ': JSON example');
      } else if (object.flintInput) {
        assertOptions(object, file + ': JSON example');
      }
    }
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target) || target.startsWith('//')) {
        continue;
      }
      assert(fs.existsSync(path.resolve(root, path.dirname(file), target)), file + ': dangling link ' + target);
    }
  }
  console.log(
    'Flint contract OK: ' + templateFiles.length + ' templates, ' + panelCount + ' panels, source/schema/link checks'
  );
}

module.exports = { assertPanel };
if (require.main === module) {
  runChecks();
}
