#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export GOMAXPROCS=2 GOWORK=off
task_out="$(pwd)/artifacts/reverse-flex"
mkdir -p "$task_out"
task_failed=0
task_preview_pid=""
task_phase_status=0
finish() {
  task_exit=$?
  if [[ -n "$task_preview_pid" ]]; then kill "$task_preview_pid" 2>/dev/null || true; wait "$task_preview_pid" 2>/dev/null || true; fi
  set +e
  python3 - "$task_out" "$task_failed" "$task_exit" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]);phases=[json.loads(l) for l in (p/'phases.jsonl').read_text().splitlines()] if (p/'phases.jsonl').exists() else []
scenario=json.loads(pathlib.Path('reverse-flex-scenario.json').read_text());results=[]
expected=[{'name':name,'width':width,'height':2400,'scale':scale} for name,width,scale in [('01-224',224,1),('02-368',368,1),('03-512',512,1),('04-368',368,1),('05-224',224,1),('06-224-scale2',224,2)]]
scenario_valid=scenario.get('schema')==1 and scenario.get('height')==2400 and scenario.get('cases')==expected
scenario_valid=scenario_valid and len(set(v['name'] for v in scenario['cases']))==6
for case in scenario['cases']:
 for name in ['source-native','native-inverse','native-reconstruction']:
  f=p/case['name']/(name+'-comparison.json')
  try:
   result=json.loads(f.read_text());valid=result['tolerance']=={'channel':0,'pixels':0} and result['width']==case['width']*case['scale'] and result['height']==case['height']*case['scale'] and result['totalPixels']==case['width']*case['height']*case['scale']**2
   exact=valid and result['accepted'] is True and result['exact'] is True and result['changedPixels']==0 and result['pixelsOverTolerance']==0 and result['maxChannelDelta']==0
  except (OSError,ValueError,KeyError):result=None;valid=exact=False
  results.append({'case':case['name'],'name':name,'valid':valid,'accepted':exact,'result':result})
accepted=scenario_valid and sys.argv[2]=='0' and sys.argv[3]=='0' and all(v['exitCode']==0 for v in phases) and len(results)==18 and all(v['accepted'] for v in results)
(p/'summary.json').write_text(json.dumps({'schema':1,'accepted':accepted,'sourceOnly':True,'sceneSchema':2,'scenarioSequenceValid':scenario_valid,'tolerance':{'channel':0,'pixels':0},'comparisons':results,'phases':phases},indent=2)+'\n')
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
  task_phase_status=$?
  set -e
  printf '{"name":"%s","exitCode":%d}\n' "$task_name" "$task_phase_status" >> "$task_out/phases.jsonl"
  if [[ "$task_phase_status" -ne 0 ]]; then task_failed=1; fi
}
require_phase() { phase "$@"; [[ "$task_phase_status" -eq 0 ]] || exit "$task_phase_status"; }
: > "$task_out/phases.jsonl"
git rev-parse HEAD > "$task_out/converter-revision.txt"
sha256sum native/go.mod native/go.sum > "$task_out/modules-before.sha256"
# Formatting is hosted only. Preserve the exact formatter output for committing
# before this branch is merged; the ordinary conformance formatting gate remains.
mkdir -p "$task_out/formatted/native/reverse" "$task_out/formatted/ci"
gofmt -w native/flex.go native/flex_reverse_test.go native/reverse/responsive_reverse_test.go ci/reverse-flex_test.go
git diff -- native/flex.go native/flex_reverse_test.go native/reverse/responsive_reverse_test.go ci/reverse-flex_test.go > "$task_out/gofmt.patch"
cp native/flex.go native/flex_reverse_test.go "$task_out/formatted/native/"
cp native/reverse/responsive_reverse_test.go "$task_out/formatted/native/reverse/"
cp ci/reverse-flex_test.go "$task_out/formatted/ci/"
require_phase dependencies bun install --frozen-lockfile --ignore-scripts
require_phase browser-install bunx --no-install playwright install --with-deps chromium
require_phase source-generate bun src/cli.ts generate --config reverse-flex.json
require_phase source-check bun src/cli.ts check --config reverse-flex.json
export ASTRO_FYNE_REVERSE_FLEX_SOURCE_HASH="$(bun -e 'console.log((await Bun.file("native/.reverse-flex-source/reverse_flex.gen.report.json").json()).sourceHash)')"
[[ "$ASTRO_FYNE_REVERSE_FLEX_SOURCE_HASH" =~ ^[a-f0-9]{64}$ ]]
export ASTRO_FYNE_REVERSE_FLEX_ARTIFACTS="$task_out"
cp reverse-flex.json reverse-flex-scenario.json "$task_out/"
cp ci/reverse-flex_test.go native/.reverse-flex-source/reverse_flex_test.go
cat > native/.reverse-flex-source/probe.go <<'GO'
package generated
import (
 "fyne.io/fyne/v2"
 webui "github.com/thinkddr/astro-fyne/native"
)
const reverseProbeMode="source"
const reverseProbeSourceHash=ReverseFlexSourceHash
func newReverseProbe(actions webui.Actions)(fyne.CanvasObject,*webui.View,error){
 widget,err:=NewReverseFlex(webui.Scope{},actions)
 if err!=nil{return nil,nil,err};return widget,widget.View,nil
}
GO
gofmt -w native/.reverse-flex-source/probe.go
require_phase core-regressions bash -c 'cd native; go test -race -count=1 -p=1 . ./reverse'
require_phase typecheck bun run typecheck
require_phase source-build bun run build:web
start_preview() {
  bunx --no-install astro preview --ignore-lock --root example --host 127.0.0.1 --port 4321 > "$task_out/preview.log" 2>&1 &
  task_preview_pid=$!
  for task_attempt in $(seq 1 60); do
    if ! kill -0 "$task_preview_pid" 2>/dev/null; then cat "$task_out/preview.log"; return 1; fi
    if curl --fail --silent http://127.0.0.1:4321/responsive-reverse-flex >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
require_phase source-preview start_preview
require_phase source-browser bun capture/reverse-flex.ts --mode source --url http://127.0.0.1:4321/responsive-reverse-flex --out "$task_out" --source-hash "$ASTRO_FYNE_REVERSE_FLEX_SOURCE_HASH"
phase source-vet bash -c 'cd native; go vet ./.reverse-flex-source'
phase source-race bash -c 'cd native; go test -v -race -count=1 -p=1 ./.reverse-flex-source'
mkdir -p "$task_out/generated-source"
cp native/.reverse-flex-source/* "$task_out/generated-source/"
phase scene-web bun src/cli.ts to-web --scene "$task_out/scene.json" --out example/src/pages/reverse-flex-scene --name ReverseScene --actions-module ../../../reverse-flex-actions.ts --public-dir example/public
phase scene-web-check bun src/cli.ts to-web --scene "$task_out/scene.json" --out example/src/pages/reverse-flex-scene --name ReverseScene --actions-module ../../../reverse-flex-actions.ts --public-dir example/public --check
phase scene-native bun src/cli.ts to-fyne --scene "$task_out/scene.json" --out native/.reverse-flex-scene --name ReverseScene --package generated --fonts reverse-flex-fonts.json
phase scene-native-check bun src/cli.ts to-fyne --scene "$task_out/scene.json" --out native/.reverse-flex-scene --name ReverseScene --package generated --fonts reverse-flex-fonts.json --check
mkdir -p native/.reverse-flex-scene
cp ci/reverse-flex_test.go native/.reverse-flex-scene/reverse_flex_test.go
cat > native/.reverse-flex-scene/probe.go <<GO
package generated
import (
 "fyne.io/fyne/v2"
 webui "github.com/thinkddr/astro-fyne/native"
)
const reverseProbeMode="scene"
const reverseProbeSourceHash="$ASTRO_FYNE_REVERSE_FLEX_SOURCE_HASH"
func newReverseProbe(actions webui.Actions)(fyne.CanvasObject,*webui.View,error){
 widget,err:=NewReverseScene(webui.Scope{},actions)
 if err!=nil{return nil,nil,err};return widget,widget.View,nil
}
GO
gofmt -w native/.reverse-flex-scene/probe.go
phase scene-vet bash -c 'cd native; go vet ./.reverse-flex-scene'
phase scene-race bash -c 'cd native; go test -v -race -count=1 -p=1 ./.reverse-flex-scene'
mkdir -p "$task_out/generated-scene"
cp native/.reverse-flex-scene/* "$task_out/generated-scene/"
kill "$task_preview_pid"; wait "$task_preview_pid" 2>/dev/null || true; task_preview_pid=""
phase inverse-build bun run build:web
phase inverse-preview start_preview
phase inverse-browser bun capture/reverse-flex.ts --mode scene --url http://127.0.0.1:4321/reverse-flex-scene/ReverseScene --out "$task_out" --source-hash "$ASTRO_FYNE_REVERSE_FLEX_SOURCE_HASH"
task_cases="$(python3 -c 'import json;print("\n".join(v["name"] for v in json.load(open("reverse-flex-scenario.json"))["cases"]))')"
[[ -n "$task_cases" ]]
while IFS= read -r task_case; do
  task_directory="$task_out/$task_case"
  for task_kind in source-native native-inverse native-reconstruction; do
    task_reference="$task_directory/source-native.png"
    case "$task_kind" in
      source-native) task_reference="$task_directory/web.png"; task_actual="$task_directory/source-native.png";;
      native-inverse) task_actual="$task_directory/inverse-web.png";;
      native-reconstruction) task_actual="$task_directory/scene-native.png";;
    esac
    set +e
    (cd native && go run ./visual/cmd/astro-fyne-compare --reference "$task_reference" --native "$task_actual" --out "$task_directory/$task_kind-diff.png") > "$task_directory/$task_kind-comparison.json" 2> "$task_directory/$task_kind-comparison.log"
    task_compare_status=$?
    set -e
    printf '{"name":"%s/%s","exitCode":%d}\n' "$task_case" "$task_kind" "$task_compare_status" >> "$task_out/phases.jsonl"
    if [[ "$task_compare_status" -ne 0 ]]; then task_failed=1; fi
  done
done <<< "$task_cases"
phase module-locks sha256sum --check "$task_out/modules-before.sha256"
exit "$task_failed"
