#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun test src
bunx --no-install prettier --check src capture example astro-fyne.json visual.json package.json tsconfig.json
bun src/cli.ts generate --config astro-fyne.json
bun src/cli.ts check --config astro-fyne.json
bun src/cli.ts analyze --config visual.json > artifacts-analysis.json
task_source_hash="$(bun -e 'console.log((await Bun.file("artifacts-analysis.json").json()).sourceHash)')"
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
bun src/cli.ts generate --config visual.json --entry Geometry --measurements artifacts/measurements.json
bun src/cli.ts check --config visual.json --entry Geometry --measurements artifacts/measurements.json

export ASTRO_FYNE_ARTIFACTS="$(pwd)/artifacts"
cd native
go mod tidy
go vet ./...
GOMAXPROCS=2 go test -p=2 -race ./...
go run ./visual/cmd/astro-fyne-compare --reference ../artifacts/web.png --native ../artifacts/native.png --out ../artifacts/diff.png | tee ../artifacts/comparison.json
test -z "$(gofmt -l .)"
