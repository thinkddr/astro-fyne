#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Hosted-only passive instrumentation experiment; keep all comparison failures.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
task_work="$(realpath "${1:?Usage: run.sh RESOLVED_WORK}")"
[[ $# == 1 && -f "$task_work/sources.json" ]]
task_out="$GITHUB_WORKSPACE/artifacts/native-scaler-trace"
mkdir -p "$task_out"
task_failed=0
task_preview=""
task_status=0
: > "$task_out/phases.jsonl"
finish() {
  task_exit=$?
  if [[ -n "$task_preview" ]]; then kill "$task_preview" 2>/dev/null || true; wait "$task_preview" 2>/dev/null || true; fi
  set +e
  if [[ ! -f "$task_out/summary.json" ]]; then
    python3 ci/text-engine-trace/compare.py --mode all --evidence "$task_out" \
      --work "$task_work" --comparator "$task_work/compare" > "$task_out/incomplete-comparisons.log" 2>&1
  fi
  python3 - "$task_out" "$task_failed" "$task_exit" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]);phases=[json.loads(line) for line in (root/'phases.jsonl').read_text().splitlines()]
try: comparison=json.loads((root/'summary.json').read_text())
except (OSError,ValueError): comparison={}
expected=[(name,scale) for name in ['control-trace','browser-control','browser-trace'] for scale in [1,2]]
records=comparison.get('comparisons',[])
complete=[(r.get('name'),r.get('scale')) for r in records]==expected
accepted=sys.argv[2]=='0' and sys.argv[3]=='0' and complete and comparison.get('accepted') is True and all(p['exitCode']==0 for p in phases)
(root/'pipeline-summary.json').write_text(json.dumps({'schema':1,'diagnosticOnly':True,'pixelPerfectVerified':False,'browserEffectivePolicyVerified':False,'accepted':accepted,'sixComparisonSlotsComplete':complete,'validComparisonCount':sum(r.get('valid') is True for r in records),'acceptedComparisonCount':sum(r.get('accepted') is True for r in records),'instrumentationNeutral':comparison.get('instrumentationNeutral',False),'phases':phases},indent=2)+'\n')
sys.exit(0 if accepted else 1)
PY
  task_summary_status=$?
  trap - EXIT
  if [[ "$task_exit" -ne 0 ]]; then exit "$task_exit"; fi
  exit "$task_summary_status"
}
trap finish EXIT
phase() {
  local task_name="$1"; shift
  set +e
  "$@" > >(tee "$task_out/$task_name.log") 2>&1
  task_status=$?
  set -e
  printf '{"name":"%s","exitCode":%d}\n' "$task_name" "$task_status" >> "$task_out/phases.jsonl"
  if [[ "$task_status" -ne 0 ]]; then task_failed=1; fi
}
require_phase() { phase "$@"; [[ "$task_status" -eq 0 ]] || exit "$task_status"; }
export GOWORK=off GOMAXPROCS=2
git rev-parse HEAD > "$task_out/converter-revision.txt"
sha256sum native/go.mod native/go.sum typography-probe.json example/src/pages/typography-probe.astro \
  example/public/fonts/NotoSans-Regular.ttf ci/text-engine-probe/policy.json \
  ci/text-engine-probe/Cargo.lock ci/text-engine-probe/gn.args > "$task_out/inputs-before.sha256"
require_phase dependencies bun install --frozen-lockfile --ignore-scripts
require_phase browser-install bunx --no-install playwright install --with-deps chromium
require_phase control-input-pins python3 ci/text-engine-trace/prepare.py --work "$task_work" --check-inputs
require_phase control-build bash ci/text-engine-probe/build-remote.sh --build --work "$task_work"
require_phase trace-prepare python3 ci/text-engine-trace/prepare.py --work "$task_work"
require_phase trace-build bash ci/text-engine-trace/build-trace.sh "$task_work"
require_phase comparator-build bash -c 'cd native; GOFLAGS=-mod=readonly go build -p=1 -o "$1/compare" ./visual/cmd/astro-fyne-compare' bash "$task_work"
control_driver() {
  python3 ci/text-engine-probe/driver.py --source-root "$GITHUB_WORKSPACE" \
    --library "$task_work/evidence/libastro_fyne_text_experiment.so" \
    --policy ci/text-engine-probe/policy.json --out "$task_out/control" \
    > "$task_out/control-driver.stdout.log" 2> "$task_out/control-driver.stderr.log"
}
trace_driver() {
  python3 "$task_work/trace/assembly/driver.py" --source-root "$GITHUB_WORKSPACE" \
    --library "$task_work/trace/evidence/libastro_fyne_text_trace.so" \
    --policy ci/text-engine-probe/policy.json --out "$task_out/trace" \
    > "$task_out/trace-driver.stdout.log" 2> "$task_out/trace-driver.stderr.log"
}
phase control-driver control_driver
phase trace-driver trace_driver
# These two full-frame checks and all native report fields run before any
# browser capture/comparison can fail. Their outcomes are retained separately.
phase neutrality python3 ci/text-engine-trace/compare.py --mode neutrality \
  --evidence "$task_out" --work "$task_work" --comparator "$task_work/compare"
phase fontconfig python3 ci/text-engine-probe/observe-fontconfig.py --out "$task_out/fontconfig" --sources "$task_work/sources.json"
phase browser-build bun run build:web
start_preview() {
  bunx --no-install astro preview --ignore-lock --root example --host 127.0.0.1 --port 4321 > "$task_out/preview.log" 2>&1 &
  task_preview=$!
  for task_attempt in $(seq 1 90); do
    if ! kill -0 "$task_preview" 2>/dev/null; then return 1; fi
    if curl --fail --silent http://127.0.0.1:4321/typography-probe >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
phase browser-preview start_preview
phase browser-capture bun capture/typography-probe.ts --url http://127.0.0.1:4321/typography-probe --out "$task_out/browser"
phase browser-provenance bun ci/text-engine-probe/validate-browser.ts "$task_out/browser"
# Each of the six slots is recorded even when an input is invalid or missing.
# Known browser mismatches remain failures; they do not erase neutrality proof.
phase all-comparisons python3 ci/text-engine-trace/compare.py --mode all \
  --evidence "$task_out" --work "$task_work" --comparator "$task_work/compare"
phase primary-source-invariance python3 ci/text-engine-trace/prepare.py --work "$task_work" --verify
phase input-invariance sha256sum --check "$task_out/inputs-before.sha256"
exit "$task_failed"
