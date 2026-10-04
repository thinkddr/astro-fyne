#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

bun install --frozen-lockfile --ignore-scripts
# Start with actual Fyne objects, then compile the exported scene into a web page.
(cd native && GOMAXPROCS=2 go run -p=1 ./reverse/cmd/scene-fixture --out ../artifacts/reverse)
(cd native && GOMAXPROCS=2 go run -p=1 ./reverse/cmd/scene-fixture --controls --out ../artifacts/reverse-controls)
bun src/cli.ts reverse --scene artifacts/reverse/scene.json --out example/src/pages/reverse-generated --name ReverseGeometry --public-dir example/public
bun src/cli.ts reverse --scene artifacts/reverse/scene.json --out example/src/pages/reverse-generated --name ReverseGeometry --public-dir example/public --check
cp example/src/pages/reverse-generated/ReverseGeometry.* artifacts/reverse/
bun src/cli.ts reverse --scene artifacts/reverse-controls/scene.json --out example/src/pages/reverse-controls --name ReverseControls --actions-module ../../../reverse-actions.ts --public-dir example/public
bun src/cli.ts reverse --scene artifacts/reverse-controls/scene.json --out example/src/pages/reverse-controls --name ReverseControls --actions-module ../../../reverse-actions.ts --public-dir example/public --check
cp example/src/pages/reverse-controls/ReverseControls.* artifacts/reverse-controls/
bun run typecheck
bun test src
bunx --no-install prettier --check src capture example astro-fyne.json visual.json visual-scale2.json image-visual.json reverse-visual.json conformance.json updater-conformance.json conformance-scenario.json keyed-conformance.json keyed-scenario.json primitive-conformance.json primitive-scenario.json responsive-flex.json responsive-flex-scenario.json package.json tsconfig.json
bun src/cli.ts generate --config astro-fyne.json
bun src/cli.ts check --config astro-fyne.json
bun src/cli.ts generate --config conformance.json
bun src/cli.ts check --config conformance.json
bun src/cli.ts generate --config updater-conformance.json
bun src/cli.ts check --config updater-conformance.json
bun src/cli.ts generate --config keyed-conformance.json
bun src/cli.ts check --config keyed-conformance.json
bun src/cli.ts generate --config primitive-conformance.json
bun src/cli.ts check --config primitive-conformance.json
bun src/cli.ts generate --config responsive-flex.json
bun src/cli.ts check --config responsive-flex.json
bun src/cli.ts analyze --config conformance.json > artifacts-conformance-analysis.json
export ASTRO_FYNE_CONFORMANCE_SOURCE_HASH="$(bun -e 'console.log((await Bun.file("artifacts-conformance-analysis.json").json()).sourceHash)')"
bun src/cli.ts analyze --config visual.json > artifacts-analysis.json
bun src/cli.ts analyze --config image-visual.json --entry ImageGeometry > artifacts-image-analysis.json
bun src/cli.ts analyze --config reverse-visual.json --entry ReverseGeometry > artifacts-reverse-analysis.json
bun src/cli.ts analyze --config keyed-conformance.json > artifacts-keyed-analysis.json
bun src/cli.ts analyze --config primitive-conformance.json > artifacts-primitive-analysis.json
bun src/cli.ts analyze --config visual-scale2.json > artifacts-scale2-analysis.json
bun src/cli.ts analyze --config responsive-flex.json > artifacts-responsive-flex-analysis.json
export ASTRO_FYNE_RESPONSIVE_FLEX_SOURCE_HASH="$(bun -e 'console.log((await Bun.file("artifacts-responsive-flex-analysis.json").json()).sourceHash)')"
task_source_hash="$(bun -e 'console.log((await Bun.file("artifacts-analysis.json").json()).sourceHash)')"
task_image_source_hash="$(bun -e 'console.log((await Bun.file("artifacts-image-analysis.json").json()).sourceHash)')"
task_reverse_source_hash="$(bun -e 'console.log((await Bun.file("artifacts-reverse-analysis.json").json()).sourceHash)')"
task_keyed_source_hash="$(bun -e 'console.log((await Bun.file("artifacts-keyed-analysis.json").json()).sourceHash)')"
export ASTRO_FYNE_PRIMITIVE_SOURCE_HASH="$(bun -e 'console.log((await Bun.file("artifacts-primitive-analysis.json").json()).sourceHash)')"
task_scale2_source_hash="$(bun -e 'console.log((await Bun.file("artifacts-scale2-analysis.json").json()).sourceHash)')"
bunx --no-install astro build --root example
bunx --no-install playwright install --with-deps chromium
bunx --no-install astro preview --root example --host 127.0.0.1 --port 4321 > /tmp/astro-fyne-preview.log 2>&1 &
task_preview_pid=$!
trap 'kill "$task_preview_pid" 2>/dev/null || true' EXIT
task_preview_ready=false
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4321/geometry >/dev/null; then
    task_preview_ready=true
    break
  fi
  sleep 1
done
if [[ "$task_preview_ready" != true ]]; then
  cat /tmp/astro-fyne-preview.log >&2
  exit 1
fi
bun capture/astro-fyne-capture.ts --url http://127.0.0.1:4321/geometry --out artifacts --width 320 --height 240 --scale 1 --source-hash "$task_source_hash"
bun capture/behavior.ts http://127.0.0.1:4321/conformance conformance-scenario.json artifacts/web-behavior.json "$ASTRO_FYNE_CONFORMANCE_SOURCE_HASH"
bun capture/keyed-behavior.ts http://127.0.0.1:4321/keyed keyed-scenario.json artifacts/web-keyed-behavior.json "$task_keyed_source_hash"
bun capture/behavior.ts http://127.0.0.1:4321/primitives primitive-scenario.json artifacts/web-primitive-behavior.json "$ASTRO_FYNE_PRIMITIVE_SOURCE_HASH"
bun capture/responsive-flex.ts --url http://127.0.0.1:4321/responsive-flex --out artifacts/responsive-flex --source-hash "$ASTRO_FYNE_RESPONSIVE_FLEX_SOURCE_HASH"
bun capture/reverse-behavior.ts http://127.0.0.1:4321/reverse-controls/ReverseControls artifacts/reverse-controls/scene.json artifacts/reverse-controls/web-behavior.json
bun capture/compare-reverse-behavior.ts artifacts/reverse-controls/web-behavior.json artifacts/reverse-controls/native-behavior.json artifacts/reverse-controls/scene.json | tee artifacts/reverse-controls/comparison.json
bun src/cli.ts generate --config visual.json --entry Geometry --measurements artifacts/measurements.json
bun src/cli.ts check --config visual.json --entry Geometry --measurements artifacts/measurements.json
bun capture/astro-fyne-capture.ts --url http://127.0.0.1:4321/geometry --out artifacts/scale2 --width 320 --height 240 --scale 2 --source-hash "$task_scale2_source_hash"
bun src/cli.ts generate --config visual-scale2.json --entry GeometryScale2 --measurements artifacts/scale2/measurements.json
bun src/cli.ts check --config visual-scale2.json --entry GeometryScale2 --measurements artifacts/scale2/measurements.json
bun capture/astro-fyne-capture.ts --url http://127.0.0.1:4321/geometry-image --out artifacts/images --width 320 --height 240 --scale 1 --source-hash "$task_image_source_hash" --analysis artifacts-image-analysis.json
bun src/cli.ts generate --config image-visual.json --entry ImageGeometry --measurements artifacts/images/measurements.json
bun src/cli.ts check --config image-visual.json --entry ImageGeometry --measurements artifacts/images/measurements.json
bun capture/astro-fyne-capture.ts --url http://127.0.0.1:4321/reverse-generated/ReverseGeometry --out artifacts/reverse --width 320 --height 240 --scale 1 --source-hash "$task_reverse_source_hash" --analysis artifacts-reverse-analysis.json
bun src/cli.ts generate --config reverse-visual.json --entry ReverseGeometry --measurements artifacts/reverse/measurements.json
bun src/cli.ts check --config reverse-visual.json --entry ReverseGeometry --measurements artifacts/reverse/measurements.json

export ASTRO_FYNE_ARTIFACTS="$(pwd)/artifacts"
export ASTRO_FYNE_IMAGE_ARTIFACTS="$(pwd)/artifacts/images"
export ASTRO_FYNE_REVERSE_ARTIFACTS="$(pwd)/artifacts/reverse"
export ASTRO_FYNE_SCALE2_ARTIFACTS="$(pwd)/artifacts/scale2"
export ASTRO_FYNE_RESPONSIVE_FLEX_ARTIFACTS="$(pwd)/artifacts/responsive-flex"
cd native
go mod tidy
git diff --exit-code HEAD -- go.mod go.sum
go vet ./...
# Keep independent comparisons as failure evidence even when another native test
# fails. Every failure remains fatal; a missing capture also fails its own gate.
task_native_test_status=0
GOMAXPROCS=2 go test -p=2 -race ./... || task_native_test_status=$?
# Exported scenes come from the already resized native widget. Generate their web
# pages only after the native tests have retained the actual frames and scenes.
if [[ "$task_native_test_status" -eq 0 ]]; then
  cd ..
  while IFS= read -r task_flex_case; do
    bun src/cli.ts reverse --scene "artifacts/responsive-flex/$task_flex_case/scene.json" --out "example/src/pages/flex-reverse/$task_flex_case" --name FlexReverse --public-dir example/public
    bun src/cli.ts reverse --scene "artifacts/responsive-flex/$task_flex_case/scene.json" --out "example/src/pages/flex-reverse/$task_flex_case" --name FlexReverse --public-dir example/public --check
    cp "example/src/pages/flex-reverse/$task_flex_case/"FlexReverse.* "artifacts/responsive-flex/$task_flex_case/"
  done < <(bun -e 'for (const item of (await Bun.file("responsive-flex-scenario.json").json()).cases) console.log(item.name)')
  kill "$task_preview_pid"
  wait "$task_preview_pid" 2>/dev/null || true
  bunx --no-install astro build --root example
  bunx --no-install astro preview --root example --host 127.0.0.1 --port 4321 > /tmp/astro-fyne-preview.log 2>&1 &
  task_preview_pid=$!
  task_preview_ready=false
  for attempt in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:4321/responsive-flex >/dev/null; then
      task_preview_ready=true
      break
    fi
    sleep 1
  done
  if [[ "$task_preview_ready" != true ]]; then
    cat /tmp/astro-fyne-preview.log >&2
    exit 1
  fi
  bun capture/responsive-flex-reverse.ts --base-url http://127.0.0.1:4321 --out artifacts/responsive-flex
  cd native
fi
task_comparison_status=0
run_comparison() {
  local task_result_path="$1"
  shift
  if "$@" | tee "$task_result_path"; then
    return 0
  else
    task_comparison_status=1
  fi
}
run_comparison ../artifacts/comparison.json go run ./visual/cmd/astro-fyne-compare --reference ../artifacts/web.png --native ../artifacts/native.png --out ../artifacts/diff.png
run_comparison ../artifacts/scale2/comparison.json go run ./visual/cmd/astro-fyne-compare --reference ../artifacts/scale2/web.png --native ../artifacts/scale2/native.png --out ../artifacts/scale2/diff.png
run_comparison ../artifacts/images/comparison.json go run ./visual/cmd/astro-fyne-compare --reference ../artifacts/images/web.png --native ../artifacts/images/native.png --out ../artifacts/images/diff.png
run_comparison ../artifacts/reverse/web-comparison.json go run ./visual/cmd/astro-fyne-compare --reference ../artifacts/reverse/native.png --native ../artifacts/reverse/web.png --out ../artifacts/reverse/web-diff.png
run_comparison ../artifacts/reverse/roundtrip-comparison.json go run ./visual/cmd/astro-fyne-compare --reference ../artifacts/reverse/native.png --native ../artifacts/reverse/roundtrip.png --out ../artifacts/reverse/roundtrip-diff.png
run_comparison ../artifacts/behavior-comparison.json bun ../capture/compare-behavior.ts ../artifacts/web-behavior.json ../artifacts/native-behavior.json ../conformance-scenario.json "$ASTRO_FYNE_CONFORMANCE_SOURCE_HASH"
run_comparison ../artifacts/keyed-behavior-comparison.json bun ../capture/compare-behavior.ts ../artifacts/web-keyed-behavior.json ../artifacts/native-keyed-behavior.json ../keyed-scenario.json "$task_keyed_source_hash"
run_comparison ../artifacts/primitive-behavior-comparison.json bun ../capture/compare-behavior.ts ../artifacts/web-primitive-behavior.json ../artifacts/native-primitive-behavior.json ../primitive-scenario.json "$ASTRO_FYNE_PRIMITIVE_SOURCE_HASH"
while IFS= read -r task_flex_case; do
  task_flex_directory="../artifacts/responsive-flex/$task_flex_case"
  run_comparison "$task_flex_directory/comparison.json" go run ./visual/cmd/astro-fyne-compare --reference "$task_flex_directory/web.png" --native "$task_flex_directory/native.png" --out "$task_flex_directory/diff.png"
  run_comparison "$task_flex_directory/reverse-comparison.json" go run ./visual/cmd/astro-fyne-compare --reference "$task_flex_directory/native.png" --native "$task_flex_directory/reverse-web.png" --out "$task_flex_directory/reverse-diff.png"
done < <(bun -e 'for (const item of (await Bun.file("../responsive-flex-scenario.json").json()).cases) console.log(item.name)')
test "$task_native_test_status" -eq 0
test "$task_comparison_status" -eq 0
test -z "$(gofmt -l .)"
go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...
cd ..
git diff --exit-code HEAD -- native/generated
test -z "$(git ls-files --others --exclude-standard -- native/generated)"
