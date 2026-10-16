#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
task_root="$(pwd)"
task_variant="${1:-baseline}"
case "$task_variant" in baseline|bilinear|skia-lowp) ;; *) echo 'Variant must be baseline, bilinear or skia-lowp' >&2; exit 2 ;; esac
task_evidence="$task_root/artifacts/image-enlargement/$task_variant"
task_temporary="$(mktemp -d)"
task_fork="$task_temporary/fyne"
task_modfile="$task_temporary/native.mod"
task_preview_pid=''
task_status=0
mkdir -p "$task_evidence"
stop_preview() {
  if [[ -n "$task_preview_pid" ]]; then
    kill "$task_preview_pid" 2>/dev/null || true
    wait "$task_preview_pid" 2>/dev/null || true
    task_preview_pid=''
  fi
}
cleanup() { stop_preview; rm -rf "$task_temporary"; }
trap cleanup EXIT
task_phases="$task_evidence/phases.jsonl"
: > "$task_phases"
run_phase() {
  local task_name="$1" task_code=0
  shift
  if "$@" 2>&1 | tee "$task_evidence/$task_name.log"; then
    task_code=0
  else
    local task_codes=("${PIPESTATUS[@]}")
    task_code="${task_codes[0]}"
    if [[ "$task_code" -eq 0 ]]; then task_code=2; fi
    task_status=1
  fi
  printf '{"name":"%s","exitCode":%s}\n' "$task_name" "$task_code" >> "$task_phases"
  return "$task_code"
}
start_preview() {
  local task_route="$1" task_name="$2"
  stop_preview
  bunx --no-install astro preview --ignore-lock --root example --host 127.0.0.1 --port 4321 > "$task_evidence/$task_name-preview.log" 2>&1 &
  task_preview_pid=$!
  for task_attempt in $(seq 1 60); do
    if ! kill -0 "$task_preview_pid" 2>/dev/null; then return 1; fi
    if curl -fsS "http://127.0.0.1:4321/$task_route" >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

go version > "$task_evidence/go-version.txt"
go env -json GOOS GOARCH GOVERSION GOPROXY GOSUMDB > "$task_evidence/go-environment.json"
uname -a > "$task_evidence/host.txt"
bun --version > "$task_evidence/bun-version.txt"
git rev-parse HEAD > "$task_evidence/converter-revision.txt"
sha256sum native/go.mod native/go.sum > "$task_evidence/production-modules.sha256"
cp native/go.mod "$task_modfile"
cp native/go.sum "$task_temporary/native.sum"
export GOFLAGS="-modfile=$task_modfile -mod=mod"
export GOMAXPROCS=2
export ASTRO_FYNE_IMAGE_ENLARGEMENT_ARTIFACTS="$task_evidence"
test -n "$ASTRO_FYNE_IMAGE_ENLARGEMENT_ARTIFACTS"

# Fail before using a changed proposal. Formatting occurs only after these checks.
(
  cd ci/image-sampling
  sha256sum -c <<'PINS'
7a27af6b6eb39a035ee59b7bbe268cfa4f620c8949e79fbf6d6edd1c76012d0c  source-pin.json
f5068c6f94b94fdffc9624d16068c9090f71a4808b10e7729c213807b5fedd39  fyne-smooth-image-enlargement.patch
36a152205bb9970a424b161ad1ee7cbe75ecebb3297f019fee245019745ff563  image_enlargement_test.go.proposed
2945cc01783ce61c61e16c44da981c48911dbdcd36a12bdb4a08b1cf05adcf1b  skia_lowp_enlargement.go.proposed
cb76463dcb4f8eb6790def84f1c1227bfc07bfba143ba721e5691f725aa40bde  skia_lowp_enlargement_test.go.proposed
713bbdcca92aac24ef0c5e7c7cf1b310bbc1da52f3269d18c2df3234e55a0ba7  fyne-skia-lowp-enlargement.patch
af74a08a7a846262b696f5995ad84688b8e6ee24d73fd783b9a88877cf88f7ca  LICENSE-Fyne.txt
5f787c1dee3c56547f09ccc2906ab5f5293c4d8dd6c8654e573216c38e908dbd  LICENSE-Skia.txt
PINS
) | tee "$task_evidence/proposal-pins.log"
cp -R ci/image-sampling "$task_evidence/proposal"
(cd native && go mod download -json github.com/thinkddr/fyne/v2@v2.8.1-sytue.16) > "$task_evidence/fyne-module.json"
task_module_directory="$(bun -e 'const m=await Bun.file(process.argv[1]).json(); if(m.Error||m.Path!=="github.com/thinkddr/fyne/v2"||m.Version!=="v2.8.1-sytue.16"||m.Sum!=="h1:JTIsUHcA/X/LShfpiPY2dXwOK0BKXkD53x7VLB5uCbY="||m.GoModSum!=="h1:kpeuFrClm0fiAgJYr2soTfwKMT5rzNcSKzmgGjxvHOY="||!m.Dir)throw new Error("Unexpected public Fyne module identity");console.log(m.Dir);' "$task_evidence/fyne-module.json")"
mkdir -p "$task_fork"
cp -R "$task_module_directory/." "$task_fork/"
chmod -R u+w "$task_fork"
cp ci/image-sampling/LICENSE-Fyne.txt ci/image-sampling/LICENSE-Skia.txt "$task_fork/"
task_draw="$task_fork/internal/painter/software/draw.go"
echo "cf3280e8a4fca973792bb60626756de426f3df648665e99400546cf38573215a  $task_draw" | sha256sum -c -
cp "$task_draw" "$task_evidence/original-draw.go.txt"
if [[ "$task_variant" != baseline ]]; then
  (cd "$task_fork" && patch --batch --fuzz=0 -p1 < "$task_root/ci/image-sampling/fyne-smooth-image-enlargement.patch")
  echo "a14e3bb6b41ecdd5291a60c45131126eca6aa84d7f5c761268976390b03e6e2c  $task_draw" | sha256sum -c -
  cp ci/image-sampling/image_enlargement_test.go.proposed "$task_fork/internal/painter/software/image_enlargement_test.go"
fi
if [[ "$task_variant" == skia-lowp ]]; then
  cp ci/image-sampling/skia_lowp_enlargement.go.proposed "$task_fork/internal/painter/software/skia_lowp_enlargement.go"
  cp ci/image-sampling/skia_lowp_enlargement_test.go.proposed "$task_fork/internal/painter/software/skia_lowp_enlargement_test.go"
  (cd "$task_fork" && patch --batch --fuzz=0 -p1 < "$task_root/ci/image-sampling/fyne-skia-lowp-enlargement.patch")
  echo "4049e8e48c174a80c63cb42b99bd3855a0b7fa81efd776e0af361b760d319fb3  $task_draw" | sha256sum -c -
fi
mkdir -p "$task_evidence/painter-before-format" "$task_evidence/painter"
cp "$task_fork/internal/painter/software/"*.go "$task_evidence/painter-before-format/"
if [[ "$task_variant" != baseline ]]; then gofmt -w "$task_fork/internal/painter/software/"*.go; fi
cp "$task_fork/internal/painter/software/"*.go "$task_evidence/painter/"
sha256sum "$task_evidence/painter-before-format/"*.go > "$task_evidence/painter-before-format.sha256"
sha256sum "$task_evidence/painter/"*.go > "$task_evidence/painter-formatted.sha256"
cp ci/image-sampling/LICENSE-Fyne.txt ci/image-sampling/LICENSE-Skia.txt "$task_evidence/painter/"
(cd native && go mod edit -replace="fyne.io/fyne/v2=$task_fork")
(cd native && go list -m -json all) > "$task_evidence/native-modules.jsonl"
(cd native && go list -m golang.org/x/image) | tee "$task_evidence/x-image-version.txt"
grep -Fx 'golang.org/x/image v0.46.0' "$task_evidence/x-image-version.txt"
(cd native && go list -deps -json fyne.io/fyne/v2/internal/painter/software) > "$task_evidence/native-painter-packages.jsonl"
task_resolved_painter="$(cd native && go list -f '{{.Dir}}' fyne.io/fyne/v2/internal/painter/software)"
test "$task_resolved_painter" = "$task_fork/internal/painter/software"
cp "$task_fork/go.mod" "$task_temporary/probe.mod"
cp "$task_temporary/native.sum" "$task_temporary/probe.sum"
python3 - "$task_temporary/probe.mod" "$task_evidence/native-modules.jsonl" "$task_fork" <<'PY'
import json, pathlib, subprocess, sys
remaining = pathlib.Path(sys.argv[2]).read_text()
decoder, flags = json.JSONDecoder(), []
while remaining.strip():
    module, end = decoder.raw_decode(remaining.lstrip())
    remaining = remaining.lstrip()[end:]
    if module.get('Main') or module['Path'] == 'fyne.io/fyne/v2':
        continue
    assert module.get('Version') and not module.get('Replace')
    flags.append('-require=' + module['Path'] + '@' + module['Version'])
assert flags
subprocess.run(['go', 'mod', 'edit', '-modfile=' + sys.argv[1], '-go=1.27.2', *flags], check=True, cwd=sys.argv[3])
PY
(cd "$task_fork" && env "GOFLAGS=-modfile=$task_temporary/probe.mod -mod=mod" go list -m golang.org/x/image) > "$task_evidence/probe-x-image-version.txt"
grep -Fx 'golang.org/x/image v0.46.0' "$task_evidence/probe-x-image-version.txt"
if [[ "$task_variant" != baseline ]]; then
  (cd "$task_fork" && run_phase candidate-unit env "GOFLAGS=-modfile=$task_temporary/probe.mod -mod=mod" go test -race -count=1 -p=1 -run '^(TestPainterImageEnlargement|TestSkiaLowpCandidate)' ./internal/painter/software) || task_status=1
fi

bun install --frozen-lockfile --ignore-scripts
bunx --no-install playwright install --with-deps chromium
bun src/cli.ts generate --config image-enlargement.json
bun src/cli.ts check --config image-enlargement.json
run_phase typecheck bun run typecheck || task_status=1
bun src/cli.ts analyze --config image-enlargement.json > "$task_evidence/analysis.json"
export ASTRO_FYNE_IMAGE_ENLARGEMENT_SOURCE_HASH="$(bun -e 'const a=await Bun.file(process.argv[1]).json();if(!/^[a-f0-9]{64}$/.test(a.sourceHash)||a.program?.hasStyles!==false)throw new Error("Expected source-only analysis");console.log(a.sourceHash);' "$task_evidence/analysis.json")"
cp ci/image-enlargement-source_test.go native/.image-enlargement-source/image_enlargement_test.go
for task_scale in 1 2; do
  (cd native && run_phase "raw-native-$task_scale" go run -p=1 ./reverse/cmd/image-enlargement-fixture --root .. --scale "$task_scale" --out "$task_evidence/scale-$task_scale") || task_status=1
done
if run_phase source-build bun run build:web; then
  if start_preview image-enlargement source; then
    printf '{"name":"source-preview","exitCode":0}\n' >> "$task_phases"
    run_phase source-browser bun capture/image-enlargement.ts --base-url http://127.0.0.1:4321 --out "$task_evidence" --direction source --analysis "$task_evidence/analysis.json" || task_status=1
  else
    printf '{"name":"source-preview","exitCode":1}\n' >> "$task_phases"
    task_status=1
  fi
fi
stop_preview
(cd native && run_phase source-vet go vet ./.image-enlargement-source) || task_status=1
(cd native && run_phase source-race go test -race -count=1 -p=1 ./.image-enlargement-source) || task_status=1
mkdir -p native/.image-enlargement-roundtrip
task_inverse_ready=true
for task_scale in 1 2; do
  task_directory="$task_evidence/scale-$task_scale"
  if run_phase "inverse-generate-$task_scale" bun src/cli.ts to-web --scene "$task_directory/scene.json" --out "example/src/pages/image-enlargement-reverse/scale-$task_scale" --name "EnlargementReverse$task_scale" --public-dir example/public; then
    run_phase "inverse-check-$task_scale" bun src/cli.ts to-web --scene "$task_directory/scene.json" --out "example/src/pages/image-enlargement-reverse/scale-$task_scale" --name "EnlargementReverse$task_scale" --public-dir example/public --check || task_status=1
    cp "example/src/pages/image-enlargement-reverse/scale-$task_scale/EnlargementReverse$task_scale.reverse.report.json" "$task_directory/"
  else task_inverse_ready=false; fi
  run_phase "scene-generate-$task_scale" bun src/cli.ts to-fyne --scene "$task_directory/scene.json" --out native/.image-enlargement-roundtrip --name "SceneEnlargement$task_scale" --package enlargements || task_status=1
  run_phase "scene-check-$task_scale" bun src/cli.ts check --scene "$task_directory/scene.json" --out native/.image-enlargement-roundtrip --name "SceneEnlargement$task_scale" --package enlargements || task_status=1
done
cp ci/image-enlargement-roundtrip_test.go native/.image-enlargement-roundtrip/image_enlargement_roundtrip_test.go
(cd native && run_phase scene-vet go vet ./.image-enlargement-roundtrip) || task_status=1
(cd native && run_phase scene-race go test -race -count=1 -p=1 ./.image-enlargement-roundtrip) || task_status=1
if [[ "$task_inverse_ready" == true ]] && run_phase inverse-build bun run build:web; then
  if start_preview image-enlargement-reverse/scale-1/EnlargementReverse1 inverse; then
    printf '{"name":"inverse-preview","exitCode":0}\n' >> "$task_phases"
    run_phase inverse-browser bun capture/image-enlargement.ts --base-url http://127.0.0.1:4321 --out "$task_evidence" --direction inverse || task_status=1
  else
    printf '{"name":"inverse-preview","exitCode":1}\n' >> "$task_phases"
    task_status=1
  fi
fi
stop_preview
cp -R native/.image-enlargement-source "$task_evidence/generated-source"
cp -R native/.image-enlargement-roundtrip "$task_evidence/generated-scene"
cp "$task_modfile" "$task_evidence/native.mod"
cp "$task_temporary/native.sum" "$task_evidence/native.sum"
cp "$task_temporary/probe.mod" "$task_evidence/probe.mod"
cp "$task_temporary/probe.sum" "$task_evidence/probe.sum"
(cd native && go list -m -json all) > "$task_evidence/native-modules-final.jsonl"
(cd "$task_fork" && env "GOFLAGS=-modfile=$task_temporary/probe.mod -mod=mod" go list -m -json all) > "$task_evidence/probe-modules.jsonl"
(cd native && go build -p=1 -o "$task_temporary/compare" ./visual/cmd/astro-fyne-compare)
task_comparisons="$task_evidence/comparisons.jsonl"
: > "$task_comparisons"
compare_frame() {
  local task_name="$1" task_scale="$2" task_reference="$3" task_native="$4" task_code=0
  local task_directory="$task_evidence/scale-$task_scale/comparisons/$task_name"
  mkdir -p "$task_directory"
  "$task_temporary/compare" --reference "$task_reference" --native "$task_native" --out "$task_directory/diff.png" > "$task_directory/raw.json" 2> "$task_directory/stderr.log" || task_code=$?
  if ! bun -e '
    import {createHash} from "node:crypto";
    import {relative,sep} from "node:path";
    const [directory,status,reference,native,root,variant,name,scale]=process.argv.slice(1);
    let record={variant,name,scale:Number(scale),exitCode:Number(status),valid:false,accepted:false};
    try {
      const result=await Bun.file(directory+"/raw.json").json();
      if(result.tolerance?.channel!==0||result.tolerance?.pixels!==0||!Number.isSafeInteger(result.changedPixels)||result.changedPixels<0||result.exact!==(result.changedPixels===0)||result.accepted!==result.exact||Number(status)!==(result.exact?0:1)||result.width!==160*Number(scale)||result.height!==80*Number(scale))throw new Error("Invalid strict comparison result");
      const inputs={};
      for(const [role,path] of [["reference",reference],["native",native]]){
        const name=relative(root,path).split(sep).join("/");
        if(name.startsWith("../")||name==="..")throw new Error("Comparison escaped evidence root");
        inputs[role]={path:name,hash:createHash("sha256").update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest("hex")};
      }
      record={...record,...result,valid:true,inputs};
    }catch(error){record={...record,error:error instanceof Error?error.message:String(error)};}
    await Bun.write(directory+"/result.json",JSON.stringify(record,null,2)+"\n");
    console.log(JSON.stringify(record));
    if(!record.valid)process.exitCode=2;
  ' "$task_directory" "$task_code" "$task_reference" "$task_native" "$task_evidence" "$task_variant" "$task_name" "$task_scale" >> "$task_comparisons"; then task_status=1; fi
  if [[ "$task_code" -ne 0 ]]; then task_status=1; fi
}
for task_scale in 1 2; do
  task_directory="$task_evidence/scale-$task_scale"
  compare_frame source-native "$task_scale" "$task_directory/web.png" "$task_directory/generated-native.png"
  compare_frame native-inverse "$task_scale" "$task_directory/original-native.png" "$task_directory/inverse-web.png"
  compare_frame native-reconstruction "$task_scale" "$task_directory/original-native.png" "$task_directory/scene-native.png"
done
task_modules_unchanged=true
if ! sha256sum -c "$task_evidence/production-modules.sha256"; then task_status=1; task_modules_unchanged=false; fi
bun -e 'const [root,variant,status,unchanged]=process.argv.slice(1);const comparisons=(await Bun.file(root+"/comparisons.jsonl").text()).trim().split("\n").filter(Boolean).map(JSON.parse);const phases=(await Bun.file(root+"/phases.jsonl").text()).trim().split("\n").filter(Boolean).map(JSON.parse);const complete=comparisons.length===6&&comparisons.every(item=>item.valid===true);const accepted=complete&&Number(status)===0&&unchanged==="true"&&comparisons.every(item=>item.accepted===true)&&phases.every(item=>item.exitCode===0);await Bun.write(root+"/summary.json",JSON.stringify({schema:1,experimental:true,variant,baseline:variant==="baseline",complete,accepted,productionDependencyChanged:unchanged!=="true",tolerance:{channel:0,pixels:0},comparisons,phases},null,2)+"\n");if(!accepted)process.exitCode=1;' "$task_evidence" "$task_variant" "$task_status" "$task_modules_unchanged" || task_status=1
exit "$task_status"
