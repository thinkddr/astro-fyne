#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

task_admission_dir="$(pwd)/artifacts/text-admission"
mkdir -p "$task_admission_dir"
go version > "$task_admission_dir/go-version.txt"
task_admission_pattern='^(TestLegacyTextAdmission|TestLegacyStrictFrameAdmission|TestJavascriptTextAdmission|TestJavascriptAnimationTextAdmission)'
printf '%s\n' "GOMAXPROCS=2 go test -json -count=1 -p=2 -race -run '$task_admission_pattern' . ./javascript" > "$task_admission_dir/command.txt"
set +e
(
  cd native
  GOMAXPROCS=2 go test -json -count=1 -p=2 -race -run "$task_admission_pattern" . ./javascript
) | tee "$task_admission_dir/tests.jsonl"
task_admission_statuses=("${PIPESTATUS[@]}")
set -e

python3 - "$task_admission_dir" "${task_admission_statuses[0]}" "${task_admission_statuses[1]}" <<'PY'
import collections
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

directory = Path(sys.argv[1])
test_status, tee_status = map(int, sys.argv[2:])
module = "github.com/thinkddr/astro-fyne/native"
expected = {
    module: [
        "TestLegacyTextAdmissionUsesInheritedStylesOnceWithoutExposingMetadata",
        "TestLegacyTextAdmissionIncludesHiddenDisabledEmptyAndRawRoles",
        "TestLegacyStrictFrameAdmissionRejectsEmptyEditorsBeforeFactories",
        "TestLegacyTextAdmissionFailureKeepsTheWholeNativeFrameAndFocus",
        "TestLegacyTextAdmissionRejectsProfilesBeforeStoredStateChanges",
        "TestLegacyTextAdmissionRestoresProfilesAfterPendingSourceRejection",
        "TestLegacyTextAdmissionChecksSourceAfterMeasurementBecomesStale",
        "TestLegacyTextAdmissionDoesNotChangeDefaultEditingOrResponsiveValidation",
        "TestLegacyTextAdmissionRecoveryPreservesOtherFaults",
    ],
    module + "/javascript": [
        "TestJavascriptTextAdmissionKeepsNativeFrameWithoutRollingBackSourceActions",
        "TestJavascriptAnimationTextAdmissionPreservesFrameAndInvalidatesExport",
        "TestJavascriptTextAdmissionDoesNotClearWrapperPointerFault",
    ],
}
events = []
invalid = []
for number, line in enumerate((directory / "tests.jsonl").read_text().splitlines(), 1):
    try:
        event = json.loads(line)
        if not isinstance(event, dict) or not isinstance(event.get("Action"), str):
            raise ValueError("not a test event")
        events.append(event)
    except (ValueError, TypeError):
        invalid.append(number)
passes = collections.Counter((event.get("Package"), event.get("Test"))
                             for event in events if event["Action"] == "pass")
missing = [{"package": package, "test": name, "passes": passes[package, name]}
           for package, names in expected.items() for name in names
           if passes[package, name] != 1]
missing_packages = [package for package in expected if passes[package, None] != 1]
failures = [event for event in events if event["Action"] in ("fail", "skip")]
inputs = [
    "ci/text-admission.sh", "ci/run.sh", "native/go.mod", "native/go.sum",
    "native/text_admission.go", "native/text_admission_test.go", "native/view.go",
    "native/backend.go", "native/controls.go", "native/program.go", "native/flex.go",
    "native/javascript/text_admission_test.go", "native/javascript/runtime.go",
    "native/javascript/nodes.go", "native/javascript/animations.go",
    "native/javascript/pointer_test.go", "native/javascript/animations_test.go",
]
bindings = []
for relative in inputs:
    data = Path(relative).read_bytes()
    committed = subprocess.check_output(["git", "show", "HEAD:" + relative])
    if data != committed:
        raise SystemExit("admission input differs from committed source: " + relative)
    target = directory / "inputs" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(relative, target)
    bindings.append({"path": "inputs/" + relative, "source": relative,
                     "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
for name in ("tests.jsonl", "go-version.txt", "command.txt"):
    data = (directory / name).read_bytes()
    bindings.append({"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
accepted = (test_status == tee_status == 0 and not invalid and not missing
            and not missing_packages and not failures)
receipt = {
    "schema": 1, "accepted": accepted,
    "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "tree": subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], text=True).strip(),
    "testExitStatus": test_status, "traceExitStatus": tee_status,
    "expectedTests": expected, "expectedTestCount": sum(map(len, expected.values())),
    "passedNamedEvents": sum(count for (_, name), count in passes.items() if name),
    "invalidEventLines": invalid, "missingTests": missing,
    "missingPackages": missing_packages, "failuresOrSkips": failures,
    "bindings": bindings, "pixelPerfectVerified": False,
    "scope": "Opt-in native frame admission; no prospective editor, browser, shaping or pixel certification",
}
(directory / "summary.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({"accepted": accepted, "expectedTests": receipt["expectedTestCount"],
                  "passedNamedEvents": receipt["passedNamedEvents"]}))
if not accepted:
    raise SystemExit("native text admission trace failed its explicit contract")
PY
