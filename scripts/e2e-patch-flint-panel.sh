#!/usr/bin/env bash
# End-to-end: create a dashboard with Flint panels via Grafana HTTP API
# (same capability surface as Grafana MCP update_dashboard).
set -euo pipefail

GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAYLOAD="${ROOT}/docs/templates/dashboard-create-payload.json"
DASH_UID="flint-agent-demo"

echo "==> Health check ${GRAFANA_URL}"
curl -sf "${GRAFANA_URL}/api/health" >/dev/null

echo "==> Confirm Flint panel is registered in frontend settings"
curl -sf "${GRAFANA_URL}/api/frontend/settings" | python3 -c '
import json, sys
d = json.load(sys.stdin)
p = (d.get("panels") or {}).get("ibumblebee-flint-panel")
if not p:
    raise SystemExit("FAIL: ibumblebee-flint-panel missing from frontend settings")
print("OK: panel name=%s module=%s signature=%s" % (p.get("name"), p.get("module"), p.get("signature")))
'

echo "==> Create/overwrite dashboard ${DASH_UID}"
RESP="$(curl -sf -X POST "${GRAFANA_URL}/api/dashboards/db" \
  -H 'Content-Type: application/json' \
  --data-binary @"${PAYLOAD}")"
echo "${RESP}" | python3 -m json.tool

DASH_URL="$(echo "${RESP}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"])')"
FULL_URL="${GRAFANA_URL}${DASH_URL}"

echo "==> Fetch dashboard and assert panel types"
curl -sf "${GRAFANA_URL}/api/dashboards/uid/${DASH_UID}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
panels = d["dashboard"]["panels"]
types = [p.get("type") for p in panels]
print("panel types:", types)
if not types or any(t != "ibumblebee-flint-panel" for t in types):
    raise SystemExit("FAIL: expected only ibumblebee-flint-panel panels")
for p in panels:
    opts = p.get("options") or {}
    for key in ("chartType", "xField", "yField", "colorField", "specJson"):
        if key not in opts:
            raise SystemExit("FAIL: panel %s missing options.%s" % (p.get("title"), key))
print("OK: %d Flint panels with complete options" % len(panels))
'

echo "==> Static plugin assets"
curl -sf -o /dev/null -w "module.js %{http_code}\n" "${GRAFANA_URL}/public/plugins/ibumblebee-flint-panel/module.js"
curl -sf -o /dev/null -w "plugin.json %{http_code}\n" "${GRAFANA_URL}/public/plugins/ibumblebee-flint-panel/plugin.json"

echo "==> Patch: add a third Flint panel (specJson pie) via dashboard update"
python3 - "${GRAFANA_URL}" "${DASH_UID}" "${ROOT}/docs/templates/panel-with-specjson.json" <<'PY'
import json, sys, urllib.request

base, uid, pie_path = sys.argv[1], sys.argv[2], sys.argv[3]
with urllib.request.urlopen(f"{base}/api/dashboards/uid/{uid}") as response:
    body = json.load(response)

dash = body["dashboard"]
panels = dash["panels"]
next_id = max((panel.get("id") or 0) for panel in panels) + 1
with open(pie_path, encoding="utf-8") as handle:
    pie = json.load(handle)
pie["id"] = next_id
pie["gridPos"] = {"h": 8, "w": 12, "x": 0, "y": 10}
# Avoid duplicate title if script is re-run
panels = [panel for panel in panels if panel.get("title") != pie.get("title")]
panels.append(pie)
dash["panels"] = panels

payload = json.dumps(
    {"dashboard": dash, "overwrite": True, "message": "e2e patch add flint pie panel"}
).encode()
request = urllib.request.Request(
    f"{base}/api/dashboards/db",
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request) as response:
    print(json.load(response))

with urllib.request.urlopen(f"{base}/api/dashboards/uid/{uid}") as response:
    titles = [panel["title"] for panel in json.load(response)["dashboard"]["panels"]]
if pie["title"] not in titles:
    raise SystemExit("FAIL: patched pie panel missing")
print("OK: patched panels ->", titles)
PY

echo
echo "E2E OK"
echo "Open: ${FULL_URL}"
