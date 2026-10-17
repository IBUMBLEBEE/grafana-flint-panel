#!/usr/bin/env bash
# HTTP create/read/patch contract smoke test; not an MCP connection test.
set -euo pipefail

CONTRACT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "${CONTRACT_ROOT}/scripts/check-flint-contract.cjs"
node - "${CONTRACT_ROOT}" <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = process.argv[2];
const { assertPanel } = require(path.join(root, 'scripts/check-flint-contract.cjs'));
const base = (process.env.GRAFANA_URL || 'http://localhost:3000').replace(/\/$/, '');
const uid = 'flint-e2e-' + randomUUID().replaceAll('-', '').slice(0, 24);
const title = 'Flint contract smoke ' + uid;
let created = false;

async function request(route, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.GRAFANA_TOKEN) {
    headers.Authorization = 'Bearer ' + process.env.GRAFANA_TOKEN;
  }
  const response = await fetch(base + route, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(method + ' ' + route + ': HTTP ' + response.status);
  }
  return response.json();
}

async function readOwnedDashboard() {
  const result = await request('/api/dashboards/uid/' + uid);
  assert.equal(result.dashboard.uid, uid, 'temporary UID');
  assert.equal(result.dashboard.title, title, 'temporary ownership title');
  return result;
}

async function main() {
  await request('/api/health');
  const settings = await request('/api/frontend/settings');
  assert(settings.panels?.['ibumblebee-flint-panel'], 'Flint plugin registered');
  const payload = JSON.parse(fs.readFileSync(path.join(root, 'docs/templates/dashboard-create-payload.json'), 'utf8'));
  payload.dashboard.uid = uid;
  payload.dashboard.title = title;
  payload.overwrite = false;
  console.log('Creating test-owned dashboard ' + uid);
  const response = await request('/api/dashboards/db', 'POST', payload);
  created = true;
  assert.equal(response.uid, uid, 'created dashboard UID');
  const initial = await readOwnedDashboard();
  assert.equal(initial.dashboard.panels.length, 2);
  for (const panel of initial.dashboard.panels) {
    assertPanel(panel, 'saved ' + panel.title);
  }

  for (const asset of ['module.js', 'plugin.json']) {
    const response = await fetch(base + '/public/plugins/ibumblebee-flint-panel/' + asset, { signal: AbortSignal.timeout(15000) });
    assert(response.ok, 'static asset ' + asset);
  }

  const pie = JSON.parse(fs.readFileSync(path.join(root, 'docs/templates/panel-pie-flint-input.json'), 'utf8'));
  pie.id = Math.max(...initial.dashboard.panels.map((panel) => panel.id || 0)) + 1;
  pie.gridPos = { h: 8, w: 12, x: 0, y: 10 };
  initial.dashboard.panels.push(pie);
  await request('/api/dashboards/db', 'POST', {
    dashboard: initial.dashboard,
    folderUid: initial.meta?.folderUid || '',
    overwrite: false,
    message: 'Flint contract smoke: append source pie',
  });
  const patched = await readOwnedDashboard();
  assert.equal(patched.dashboard.panels.length, 3);
  assert.deepEqual(patched.dashboard.panels.slice(0, 2), initial.dashboard.panels.slice(0, 2), 'unrelated panels preserved');
  for (const panel of patched.dashboard.panels) {
    assertPanel(panel, 'patched ' + panel.title);
  }
  assert.deepEqual(patched.dashboard.panels.at(-1).options.flintInput, pie.options.flintInput, 'saved precompile pie');
  console.log('Flint HTTP contract OK: canonical source created, read back and patched');
}

(async () => {
  try {
    await main();
  } finally {
    if (created) {
      // Re-read ownership before deleting exactly the dashboard this run created.
      await readOwnedDashboard();
      await request('/api/dashboards/uid/' + uid, 'DELETE');
      console.log('Removed temporary test-owned dashboard ' + uid);
    }
  }
})().catch((error) => {
  console.error(error.message);
  console.error('If cleanup failed, inspect only temporary dashboard ' + uid);
  process.exitCode = 1;
});
JS
