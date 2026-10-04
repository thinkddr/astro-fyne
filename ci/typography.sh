#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
task_root="$(pwd)"
task_evidence="$task_root/artifacts/typography"
task_temporary="$(mktemp -d)"
trap 'rm -rf "$task_temporary"' EXIT
mkdir -p "$task_evidence"

bun capture/typography-probe.ts --url http://127.0.0.1:4321/typography-probe --out "$task_evidence"
go version > "$task_evidence/go-version.txt"
go env -json GOOS GOARCH GOVERSION GOPROXY GOSUMDB > "$task_evidence/go-environment.json"
git rev-parse HEAD > "$task_evidence/converter-revision.txt"
sha256sum ci/fyne-texttrace_test.go > "$task_evidence/sidecar.sha256"

cd native
GOMAXPROCS=2 go build -p=1 -o "$task_temporary/compare" ./visual/cmd/astro-fyne-compare
for task_variant in upstream-v2.8.1 fork-v2.8.1-sytue.16; do
  task_directory="$task_evidence/$task_variant"
  mkdir -p "$task_directory"
  task_modfile="$task_temporary/$task_variant.mod"
  cp go.mod "$task_modfile"
  cp go.sum "${task_modfile%.mod}.sum"
  if [[ "$task_variant" == upstream-v2.8.1 ]]; then
    task_module='fyne.io/fyne/v2@v2.8.1'
    task_origin=ceil
    go mod edit -modfile="$task_modfile" -dropreplace=fyne.io/fyne/v2
  else
    task_module='github.com/thinkddr/fyne/v2@v2.8.1-sytue.16'
    task_origin=nearest
  fi
  go mod download -json "$task_module" > "$task_directory/fyne-module.json"
  task_module_directory="$(bun -e 'const m=await Bun.file(process.argv[1]).json(); if(m.Error || !m.Dir || !m.Sum || !m.GoModSum) throw new Error("Incomplete public Fyne module download"); console.log(m.Dir);' "$task_directory/fyne-module.json")"
  ASTRO_FYNE_TYPOGRAPHY_ARTIFACTS="$task_directory" ASTRO_FYNE_TEXT_VARIANT="$task_variant" ASTRO_FYNE_TEXT_ORIGIN="$task_origin" \
    GOMAXPROCS=2 go test -mod=mod -modfile="$task_modfile" -count=1 -p=1 -run '^TestTypographyProbeSoftwareCanvasEvidence$' ./generated
  GOMAXPROCS=2 go list -mod=mod -modfile="$task_modfile" -m -json all > "$task_directory/native-modules.jsonl"
  cp "$task_modfile" "$task_directory/native.mod"
  cp "${task_modfile%.mod}.sum" "$task_directory/native.sum"

  task_checkout="$task_temporary/$task_variant"
  mkdir -p "$task_checkout"
  cp -R "$task_module_directory/." "$task_checkout/"
  chmod -R u+w "$task_checkout"
  cp "$task_checkout/internal/painter/software/draw.go" "$task_directory/software-painter.go.txt"
  cp "$task_checkout/internal/scale/scale.go" "$task_directory/scale-helper.go.txt"
  cp "$task_checkout/internal/painter/font.go" "$task_directory/shaping-kernel.go.txt"
  cp "$task_root/ci/fyne-texttrace_test.go" "$task_checkout/internal/painter/astro_fyne_texttrace_test.go"
  cp "$task_modfile" "$task_checkout/probe.mod"
  cp "${task_modfile%.mod}.sum" "$task_checkout/probe.sum"
  (
    cd "$task_checkout"
    go mod edit -modfile=probe.mod -module=fyne.io/fyne/v2 -droprequire=fyne.io/fyne/v2 -dropreplace=fyne.io/fyne/v2
    python3 - "$task_directory/native-modules.jsonl" <<'PY'
import json, pathlib, subprocess, sys
remaining = pathlib.Path(sys.argv[1]).read_text()
decoder, requirements = json.JSONDecoder(), []
while remaining.strip():
    module, end = decoder.raw_decode(remaining.lstrip())
    remaining = remaining.lstrip()[end:]
    if module.get('Main') or module['Path'] == 'fyne.io/fyne/v2':
        continue
    assert module.get('Version') and not module.get('Replace')
    requirements.append('-require=' + module['Path'] + '@' + module['Version'])
assert requirements
subprocess.run(['go', 'mod', 'edit', '-modfile=probe.mod', *requirements], check=True)
PY
    ASTRO_FYNE_TEXTTRACE_INPUT="$task_directory/texttrace-input.json" ASTRO_FYNE_TEXTTRACE_OUTPUT="$task_directory/native-shaping.json" \
      GOMAXPROCS=2 go test -mod=mod -modfile=probe.mod -count=1 -p=1 -run '^TestAstroFyneTextTrace$' ./internal/painter
    GOMAXPROCS=2 go list -mod=mod -modfile=probe.mod -m -json all > "$task_directory/sidecar-modules.jsonl"
    cp probe.mod "$task_directory/sidecar.mod"
    cp probe.sum "$task_directory/sidecar.sum"
  )
done

task_comparisons="$task_evidence/comparisons.jsonl"
: > "$task_comparisons"
compare_text() {
  local task_reference="$1" task_native="$2" task_output="$3" task_status=0
  "$task_temporary/compare" --reference "$task_reference" --native "$task_native" --out "$task_output/diff.png" > "$task_output/pixels.json" || task_status=$?
  bun -e 'const [path,status]=process.argv.slice(1); const result=await Bun.file(path).json(); const code=Number(status); if(result.tolerance?.channel!==0 || result.tolerance?.pixels!==0 || !Number.isSafeInteger(result.changedPixels) || result.changedPixels<0 || result.exact!==(result.changedPixels===0) || result.accepted!==result.exact || code!==(result.exact?0:1)) throw new Error("Invalid zero-tolerance typography comparison"); console.log(JSON.stringify({path,exitCode:code,...result}));' "$task_output/pixels.json" "$task_status" >> "$task_comparisons"
}
for task_scale in 1 2; do
  for task_variant in upstream-v2.8.1 fork-v2.8.1-sytue.16; do
    task_frame="$task_evidence/$task_variant/scale-$task_scale"
    compare_text "$task_evidence/scale-$task_scale/web.png" "$task_frame/native.png" "$task_frame"
  done
  task_pair="$task_evidence/upstream-versus-fork/scale-$task_scale"
  mkdir -p "$task_pair"
  compare_text "$task_evidence/upstream-v2.8.1/scale-$task_scale/native.png" "$task_evidence/fork-v2.8.1-sytue.16/scale-$task_scale/native.png" "$task_pair"
done
cd "$task_root"
bun capture/compare-typography.ts "$task_evidence"
