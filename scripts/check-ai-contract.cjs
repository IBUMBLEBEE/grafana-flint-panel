#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.resolve(process.env.FLINT_AI_DATASOURCE_DIR || path.join(root, '../flint-ai-datasource'));
if (!fs.existsSync(path.join(source, 'pkg/plugin/resources.go'))) {
  throw new Error('Set FLINT_AI_DATASOURCE_DIR to the datasource checkout; real consumer validation is required.');
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-ai-contract-'));
function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}
try {
  const fixtures = path.join(work, 'requests.json');
  run(
    process.execPath,
    [path.join(root, 'node_modules/jest/bin/jest.js'), '--runInBand', 'src/ai/providerWire.test.ts'],
    root,
    { FLINT_AI_CONTRACT_FIXTURES: fixtures }
  );
  // Never write tests or generated data into the user's datasource checkout.
  for (const file of ['go.mod', 'go.sum', 'pkg']) {
    fs.cpSync(path.join(source, file), path.join(work, file), { recursive: true });
  }
  fs.copyFileSync(
    path.join(__dirname, 'ai-contract/datasource_contract_test.go'),
    path.join(work, 'pkg/plugin/panel_wire_contract_test.go')
  );
  run('go', ['test', './pkg/plugin', '-run', '^TestPanelWireContract$', '-count=1', '-v'], work, {
    FLINT_AI_CONTRACT_FIXTURES: fixtures,
  });
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
