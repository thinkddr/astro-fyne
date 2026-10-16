#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Hosted generated controls checks against the public production module.
set -euo pipefail
[[ $# == 2 ]]
task_repository="$(realpath -e "$1")"
task_work="$(realpath -e "$2")"
task_evidence="$task_work/evidence/controls"
task_provider="$task_work/evidence/fyne"
task_capture="$task_repository/artifacts/native-fontations-text/controls"
task_compare="$task_repository/ci/text-engine-probe/compare-controls.py"
mkdir -p "$task_evidence"
exec > >(tee "$task_evidence/build-and-tests.log") 2>&1
export GOWORK=off GOFLAGS=-mod=readonly
[[ -n "${ASTRO_FYNE_RESPONSIVE_CONTROLS_SOURCE_HASH:-}" ]]
python3 "$task_compare" --self-test
python3 "$task_compare" --record-sources --controls-evidence "$task_evidence" --provider-evidence "$task_provider"
cd "$task_repository/native"
GOMAXPROCS=2 go vet -tags ci,atf_fontations ./generated
GOMAXPROCS=2 go test -c -tags ci,atf_fontations -race -p=1 \
  -o "$task_evidence/controls.test" ./generated
go version -m "$task_evidence/controls.test" > "$task_evidence/test-build-info.txt"
sha256sum "$task_evidence/controls.test" > "$task_evidence/test-binary.sha256"
python3 "$task_compare" --record-build --controls-evidence "$task_evidence" --provider-evidence "$task_provider"
cd "$task_repository/native/generated"
task_test_status=0
ASTRO_FYNE_FONTATIONS_SOURCE_ROOT="$task_repository" \
ASTRO_FYNE_FONTATIONS_CONTROLS_ARTIFACTS="$task_capture" \
ASTRO_FYNE_FONTATIONS_CONTROLS_BUILD_RECORD="$task_evidence/controls-build.json" \
ASTRO_FYNE_TEXT_LIBRARY="$task_work/evidence/libastro_fyne_text_experiment.so" \
  "$task_evidence/controls.test" -test.v -test.count=1 \
    -test.run '^TestGeneratedResponsiveControlsFontationsPointerTypingResizeAndCommit$' \
    2>&1 | tee "$task_evidence/tests.log" || task_test_status=$?
printf '%s\n' "$task_test_status" > "$task_evidence/test-exit-code.txt"
task_verify_status=0
python3 "$task_compare" --verify-build --controls-evidence "$task_evidence" \
  --provider-evidence "$task_provider" || task_verify_status=$?
task_compare_status=0
python3 "$task_compare" --evidence "$task_capture" --controls-evidence "$task_evidence" \
  --provider-evidence "$task_provider" --comparator "$task_work/compare" || task_compare_status=$?
task_behavior_status=0
bun "$task_repository/capture/compare-behavior.ts" "$task_capture/web-behavior.json" \
  "$task_capture/native-behavior.json" "$task_repository/responsive-controls-scenario.json" \
  "$ASTRO_FYNE_RESPONSIVE_CONTROLS_SOURCE_HASH" > "$task_capture/behavior-comparison.json" || task_behavior_status=$?
test "$task_test_status" -eq 0
test "$task_verify_status" -eq 0
test "$task_compare_status" -eq 0
test "$task_behavior_status" -eq 0
