#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Geometry/control fixtures are exported at the start of ci/run.sh. Export each
# responsive source once; future sizes must use this same schema 2 document.
(cd native && GOMAXPROCS=2 go run -p=1 ./reverse/cmd/scene-fixture --responsive flex --out ../artifacts/bidirectional/flex)
(cd native && GOMAXPROCS=2 go run -p=1 ./reverse/cmd/scene-fixture --responsive bitmap --out ../artifacts/bidirectional/bitmap)
mkdir -p native/.scene-roundtrip
bun src/cli.ts to-fyne --scene artifacts/reverse/scene.json --out native/.scene-roundtrip --name SceneGeometry --package scenes
bun src/cli.ts to-fyne --scene artifacts/reverse-controls/scene.json --out native/.scene-roundtrip --name SceneControls --package scenes
bun src/cli.ts to-fyne --scene artifacts/bidirectional/flex/scene.json --out native/.scene-roundtrip --name SceneFlex --package scenes
bun src/cli.ts to-fyne --scene artifacts/bidirectional/bitmap/scene.json --out native/.scene-roundtrip --name SceneBitmap --package scenes
for task_scene_preset in flex bitmap; do
  if [[ "$task_scene_preset" == flex ]]; then task_scene_name=SceneFlex; else task_scene_name=SceneBitmap; fi
  bun src/cli.ts to-web --scene "artifacts/bidirectional/$task_scene_preset/scene.json" --out "example/src/pages/scene-responsive/$task_scene_preset" --name "$task_scene_name" --public-dir example/public
  bun src/cli.ts to-web --scene "artifacts/bidirectional/$task_scene_preset/scene.json" --out "example/src/pages/scene-responsive/$task_scene_preset" --name "$task_scene_name" --public-dir example/public --check
  bun src/cli.ts check --scene "artifacts/bidirectional/$task_scene_preset/scene.json" --out native/.scene-roundtrip --name "$task_scene_name" --package scenes
  cp "example/src/pages/scene-responsive/$task_scene_preset/"* "artifacts/bidirectional/$task_scene_preset/"
done
bun src/cli.ts check --scene artifacts/reverse/scene.json --out native/.scene-roundtrip --name SceneGeometry --package scenes
bun src/cli.ts check --scene artifacts/reverse-controls/scene.json --out native/.scene-roundtrip --name SceneControls --package scenes
cp ci/scene-roundtrip_test.go native/.scene-roundtrip/scene_roundtrip_test.go
export ASTRO_FYNE_SCENE_ARTIFACTS="$(pwd)/artifacts/bidirectional"
(cd native && GOMAXPROCS=2 go vet ./.scene-roundtrip && GOMAXPROCS=2 go test -race -count=1 -p=1 ./.scene-roundtrip)
cp -R native/.scene-roundtrip artifacts/bidirectional/generated
