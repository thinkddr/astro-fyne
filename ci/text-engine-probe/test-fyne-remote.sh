#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Hosted optional native text provider checks.
set -euo pipefail
[[ $# == 2 ]]
task_repository="$(realpath -e "$1")"
task_work="$(realpath -e "$2")"
task_evidence="$task_work/evidence/fyne"
task_fyne="$task_work/fyne-text-hook"
task_capture="$task_repository/artifacts/native-fontations-text/fyne"
mkdir -p "$task_evidence" "$task_capture"
exec > >(tee "$task_evidence/build-and-tests.log") 2>&1
task_pin="$task_repository/ci/text-engine-probe/fyne-hook-pin.json"
python3 "$task_repository/ci/text-engine-probe/compare-fyne.py" --self-test
python3 "$task_repository/ci/text-engine-probe/compare-fyne.py" \
  --record-sources --provider-evidence "$task_evidence"
task_revision="$(python3 - "$task_pin" <<'PY'
import json, pathlib, re, sys
pin = json.loads(pathlib.Path(sys.argv[1]).read_bytes())
if (type(pin.get("schema")) is not int or pin["schema"] != 1
    or pin.get("repository") != "https://github.com/thinkddr/fyne.git"
    or not isinstance(pin.get("revision"), str) or not re.fullmatch(r"[0-9a-f]{40}", pin["revision"])
    or not isinstance(pin.get("tree"), str) or not re.fullmatch(r"[0-9a-f]{40}", pin["tree"])
    or not isinstance(pin.get("sourceHashes"), dict) or len(pin["sourceHashes"]) != 12
    or any(not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)
           for value in pin["sourceHashes"].values())):
    raise RuntimeError("Invalid exact Fyne source pin")
print(pin["revision"])
PY
)"
[[ ! -e "$task_fyne" ]]
git init "$task_fyne"
git -C "$task_fyne" remote add origin https://github.com/thinkddr/fyne.git
git -C "$task_fyne" fetch --depth=1 origin "$task_revision"
git -C "$task_fyne" checkout --detach FETCH_HEAD
cp "$task_pin" "$task_evidence/fyne-hook-pin.json"
python3 - "$task_fyne" "$task_pin" "$task_evidence" <<'PY'
import hashlib, json, pathlib, subprocess, sys
source, pin_path, out = map(pathlib.Path, sys.argv[1:])
pin = json.loads(pin_path.read_bytes())
def git(*args):
    return subprocess.check_output(["git", "-C", str(source), *args], text=True).strip()
if git("rev-parse", "HEAD") != pin["revision"] or git("rev-parse", "HEAD^{tree}") != pin["tree"] or git("status", "--porcelain"):
    raise RuntimeError("Fyne source differs from the exact reviewed clean tree")
raw = git("cat-file", "-p", "HEAD")
if ("gpgsig" in raw or "author Fyne contributors <contributors@fyne.invalid> " not in raw
    or "committer Fyne contributors <contributors@fyne.invalid> " not in raw):
    raise RuntimeError("The pinned fork commit does not preserve the neutral contributor identity")
hashes = {}
for name, expected in pin["sourceHashes"].items():
    relative = pathlib.PurePosixPath(name)
    if relative.is_absolute() or ".." in relative.parts or "\\" in name:
        raise RuntimeError("Invalid pinned Fyne source path")
    actual = hashlib.sha256((source / relative).read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError("Pinned Fyne source bytes changed: " + name)
    hashes[name] = actual
record = {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
          "revision": pin["revision"], "tree": pin["tree"], "sourceHashes": hashes,
          "selection": "Exact public fork source; temporary local replacement, not a published .19 module claim"}
(out / "fyne-source.json").write_text(json.dumps(record, indent=2) + "\n")
(out / "fyne-commit.txt").write_text(raw + "\n")
(out / "LICENSE-Fyne").write_bytes((source / "LICENSE").read_bytes())
PY
cp "$task_repository/native/go.mod" "$task_evidence/provider.mod"
cp "$task_repository/native/go.sum" "$task_evidence/provider.sum"
cd "$task_repository/native"
go version
GOWORK=off go mod edit -modfile "$task_evidence/provider.mod" \
  -replace "fyne.io/fyne/v2=$task_fyne"
GOWORK=off GOFLAGS=-mod=readonly go list -modfile "$task_evidence/provider.mod" -m -json all \
  > "$task_evidence/selected-modules.json"
GOWORK=off GOFLAGS=-mod=readonly GOMAXPROCS=2 go vet -modfile "$task_evidence/provider.mod" \
  -tags ci,atf_fontations ./fontations
GOWORK=off GOFLAGS=-mod=readonly GOMAXPROCS=2 go test -c -modfile "$task_evidence/provider.mod" \
  -tags ci,atf_fontations -race -p=1 -o "$task_evidence/fontations.test" ./fontations
go version -m "$task_evidence/fontations.test" > "$task_evidence/test-build-info.txt"
sha256sum "$task_evidence/fontations.test" > "$task_evidence/test-binary.sha256"
python3 "$task_repository/ci/text-engine-probe/compare-fyne.py" \
  --record-provider-build --provider-evidence "$task_evidence"
ASTRO_FYNE_FONTATIONS_SOURCE_ROOT="$task_repository" \
ASTRO_FYNE_FONTATIONS_ARTIFACTS="$task_capture" \
ASTRO_FYNE_FONTATIONS_FYNE_REVISION="$task_revision" \
ASTRO_FYNE_FONTATIONS_BUILD_RECORD="$task_evidence/provider-build.json" \
ASTRO_FYNE_TEXT_LIBRARY="$task_work/evidence/libastro_fyne_text_experiment.so" \
  "$task_evidence/fontations.test" -test.v -test.count=1
python3 "$task_repository/ci/text-engine-probe/compare-fyne.py" \
  --verify-provider-build --provider-evidence "$task_evidence"
[[ -z "$(git -C "$task_fyne" status --porcelain)" ]]
git -C "$task_fyne" rev-parse HEAD > "$task_evidence/fyne-after-tests.txt"
sha256sum "$task_evidence/provider.mod" "$task_evidence/provider.sum" \
  "$task_work/evidence/libastro_fyne_text_experiment.so" > "$task_evidence/provider-inputs.sha256"
