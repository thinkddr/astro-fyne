#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Hosted optional native text provider checks against the public production module.
set -euo pipefail
[[ $# == 2 ]]
task_repository="$(realpath -e "$1")"
task_work="$(realpath -e "$2")"
task_evidence="$task_work/evidence/fyne"
task_identity="$task_work/fyne-public-identity"
task_capture="$task_repository/artifacts/native-fontations-text/fyne"
mkdir -p "$task_evidence" "$task_capture"
exec > >(tee "$task_evidence/build-and-tests.log") 2>&1
export GOWORK=off GOFLAGS=-mod=readonly
task_compare="$task_repository/ci/text-engine-probe/compare-fyne.py"
python3 "$task_compare" --self-test
python3 "$task_compare" --record-sources --provider-evidence "$task_evidence"
task_version="$(python3 - "$task_repository/ci/text-engine-probe/fyne-hook-pin.json" <<'PY'
import json, pathlib, sys
pin = json.loads(pathlib.Path(sys.argv[1]).read_bytes())
if pin.get("module", {}).get("version") != "v2.8.1-sytue.19":
    raise RuntimeError("Expected the verified published Fyne .19 module")
print(pin["module"]["version"])
PY
)"

# Fetch tag objects for identity evidence only; the build never uses this repository.
[[ ! -e "$task_identity" ]]
git init "$task_identity"
git -C "$task_identity" remote add origin https://github.com/thinkddr/fyne.git
git -C "$task_identity" fetch --depth=1 origin "refs/tags/$task_version:refs/tags/$task_version"
git -C "$task_identity" cat-file tag "refs/tags/$task_version" > "$task_evidence/fyne-tag.txt"
task_revision="$(git -C "$task_identity" rev-parse "refs/tags/$task_version^{commit}")"
git -C "$task_identity" cat-file commit "$task_revision" > "$task_evidence/fyne-commit.txt"

cp "$task_repository/native/go.mod" "$task_evidence/provider.mod"
cp "$task_repository/native/go.sum" "$task_evidence/provider.sum"
cd "$task_repository/native"
go version
go mod download -json "github.com/thinkddr/fyne/v2@$task_version" > "$task_evidence/module-download.json"
python3 "$task_compare" --retain-public-module --provider-evidence "$task_evidence"
go list -m -json all > "$task_evidence/selected-modules.json"
GOMAXPROCS=2 go vet -tags ci,atf_fontations ./fontations
GOMAXPROCS=2 go test -c -tags ci,atf_fontations -race -p=1 \
  -o "$task_evidence/fontations.test" ./fontations
go version -m "$task_evidence/fontations.test" > "$task_evidence/test-build-info.txt"
sha256sum "$task_evidence/fontations.test" > "$task_evidence/test-binary.sha256"
python3 "$task_compare" --record-provider-build --provider-evidence "$task_evidence"
ASTRO_FYNE_FONTATIONS_SOURCE_ROOT="$task_repository" \
ASTRO_FYNE_FONTATIONS_ARTIFACTS="$task_capture" \
ASTRO_FYNE_FONTATIONS_FYNE_REVISION="$task_revision" \
ASTRO_FYNE_FONTATIONS_BUILD_RECORD="$task_evidence/provider-build.json" \
ASTRO_FYNE_TEXT_LIBRARY="$task_work/evidence/libastro_fyne_text_experiment.so" \
  "$task_evidence/fontations.test" -test.v -test.count=1
python3 "$task_compare" --verify-provider-build --provider-evidence "$task_evidence"
sha256sum "$task_repository/native/go.mod" "$task_repository/native/go.sum" \
  "$task_evidence/provider.mod" "$task_evidence/provider.sum" \
  "$task_work/evidence/libastro_fyne_text_experiment.so" > "$task_evidence/provider-inputs.sha256"
