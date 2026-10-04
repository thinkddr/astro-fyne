#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
task_root="$(pwd)"
task_evidence="$task_root/artifacts/fractional-text"
task_temporary="$(mktemp -d)"
trap 'rm -rf "$task_temporary"' EXIT
mkdir -p "$task_evidence"

gofmt -w ci/typesetting-fractional_test.go
cp ci/typesetting-fractional_test.go "$task_evidence/fractional_size_test.go"
go version > "$task_evidence/go-version.txt"
cd native
go mod download -json github.com/go-text/typesetting@v0.3.4 > "$task_evidence/module.json"
task_module_directory="$(python3 - "$task_evidence/module.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
assert m.get('Path') == 'github.com/go-text/typesetting' and m.get('Version') == 'v0.3.4'
assert m.get('Sum') == 'h1:YYurUOtEb9kGSOz4uE3k4OpBGsp1dDL8+fjCeaFamAU='
assert m.get('GoModSum') == 'h1:4qZCQphq4KSgGTAeI0uMEkVbROgfah8BuyF5LRYr7XY='
assert not m.get('Error') and m.get('Dir')
print(m['Dir'])
PY
)"
task_checkout="$task_temporary/typesetting"
mkdir -p "$task_checkout"
cp -R "$task_module_directory/." "$task_checkout/"
chmod -R u+w "$task_checkout"
cp "$task_root/ci/typesetting-fractional_test.go" "$task_checkout/shaping/fractional_size_test.go"
cd "$task_checkout"
cp LICENSE "$task_evidence/typesetting-LICENSE.txt"
task_baseline_status=0
GOMAXPROCS=2 go test -json -count=1 -p=1 -run '^TestFractionalSizeAdvanceFromFontUnits$' ./shaping > "$task_evidence/baseline.jsonl" || task_baseline_status=$?
python3 - "$task_evidence/baseline.jsonl" "$task_baseline_status" <<'PY'
import json, sys
events = [json.loads(line) for line in open(sys.argv[1])]
assert sys.argv[2] == '1', 'the unmodified upstream case must fail'
assert any(e.get('Action') == 'fail' and e.get('Test') == 'TestFractionalSizeAdvanceFromFontUnits' for e in events)
assert any('14.5px advance: got' in e.get('Output', '') for e in events), 'failure must establish the fractional advance error'
PY
python3 - shaping/shaping.go "$task_evidence/patch.json" <<'PY'
import hashlib, json, pathlib, sys
p = pathlib.Path(sys.argv[1]); before = p.read_bytes()
old = b'font.XScale = int32(input.Size.Ceil()) << scaleShift'
new = b'font.XScale = int32(input.Size)'
assert before.count(old) == 1, 'exact upstream source precondition failed'
after = before.replace(old, new); p.write_bytes(after)
pathlib.Path(sys.argv[2]).write_text(json.dumps({
  'schema': 1, 'diagnosticOnly': True, 'pixelPerfectVerified': False,
  'productionBackendChanged': False,
  'source': 'github.com/go-text/typesetting@v0.3.4/shaping/shaping.go',
  'beforeHash': hashlib.sha256(before).hexdigest(), 'afterHash': hashlib.sha256(after).hexdigest(),
  'old': old.decode(), 'new': new.decode(),
  'requestedSize26_6': 928, 'oldHarfBuzzScale': 960, 'newHarfBuzzScale': 928,
}, indent=2) + '\n')
PY
GOMAXPROCS=2 go test -json -count=1 -p=1 -race ./shaping > "$task_evidence/candidate.jsonl"
go list -m -json all > "$task_evidence/modules.jsonl"
cp go.mod "$task_evidence/go.mod"
cp go.sum "$task_evidence/go.sum"
cp shaping/shaping.go "$task_evidence/shaping.go"
python3 - "$task_evidence/candidate.jsonl" "$task_evidence/result.json" <<'PY'
import json, pathlib, sys
events = [json.loads(line) for line in open(sys.argv[1])]
required = ['TestFractionalSizeAdvanceFromFontUnits', 'TestFractionalSizeMatchesHarfBuzz',
  'TestIntegerSizeMatchesPreviousScale', 'TestFractionalSizeFontCacheUpdatesScale',
  'TestFractionalSizeBidiRunsMatchHarfBuzz', 'TestFractionalSizeFeaturesRemainEffective']
assert all(any(e.get('Action') == 'pass' and e.get('Test') == name for e in events) for name in required)
assert not any(e.get('Action') == 'fail' for e in events)
pathlib.Path(sys.argv[2]).write_text(json.dumps({
  'schema': 1, 'diagnosticOnly': True, 'pixelPerfectVerified': False,
  'productionBackendChanged': False, 'baselineFailureVerified': True,
  'candidateShapingTestsPassed': True, 'regressionTests': required,
  'interpretation': 'Fractional raw26.6 shaping scale is preserved; Chromium hinted advances and native rasterization remain separate requirements.',
}, indent=2) + '\n')
PY
cd "$task_root/native"
task_modfile="$task_temporary/native.mod"
cp go.mod "$task_modfile"
cp go.sum "$task_temporary/native.sum"
GOMAXPROCS=2 go build -p=1 -o "$task_temporary/compare" ./visual/cmd/astro-fyne-compare
ASTRO_FYNE_TYPOGRAPHY_ARTIFACTS="$task_evidence/original-native" ASTRO_FYNE_TEXT_VARIANT=fork-v2.8.1-sytue.16 ASTRO_FYNE_TEXT_ORIGIN=nearest \
  GOMAXPROCS=2 go test -count=1 -p=1 -run '^TestTypographyProbeSoftwareCanvasEvidence$' ./generated
go mod edit -modfile="$task_modfile" -replace="github.com/go-text/typesetting=$task_checkout"
ASTRO_FYNE_TYPOGRAPHY_ARTIFACTS="$task_evidence/candidate-native" ASTRO_FYNE_TEXT_VARIANT=fork-fractional-candidate ASTRO_FYNE_TEXT_ORIGIN=nearest \
  GOMAXPROCS=2 go test -mod=mod -modfile="$task_modfile" -count=1 -p=1 -run '^TestTypographyProbeSoftwareCanvasEvidence$' ./generated
GOMAXPROCS=2 go test -mod=mod -modfile="$task_modfile" -count=1 -p=2 -race ./... > "$task_evidence/native-tests.log"
for task_scale in 1 2; do
  task_status=0
  "$task_temporary/compare" --reference "$task_evidence/original-native/scale-$task_scale/native.png" \
    --native "$task_evidence/candidate-native/scale-$task_scale/native.png" \
    --out "$task_evidence/candidate-native/scale-$task_scale/diff.png" > "$task_evidence/candidate-native/scale-$task_scale/pixels.json" || task_status=$?
  python3 - "$task_evidence" "$task_scale" "$task_status" <<'PY'
import json, pathlib, sys
root, scale, status = pathlib.Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
before = json.loads((root/'original-native'/f'scale-{scale}'/'native-text.json').read_text())
after = json.loads((root/'candidate-native'/f'scale-{scale}'/'native-text.json').read_text())
assert before['sourceHash'] == after['sourceHash'] and before['fontHash'] == after['fontHash']
assert before['diagnosticOnly'] is True and after['diagnosticOnly'] is True
assert before['pixelPerfectVerified'] is False and after['pixelPerfectVerified'] is False
assert len(before['texts']) == len(after['texts']) == 7
for a, b in zip(before['texts'][:6], after['texts'][:6]):
    assert a == b, 'integer-size native evidence changed'
fractional = after['texts'][6]
assert fractional['nodeID'] == 'probe-fractional' and fractional['fontSize'] == 14.5
assert before['texts'][6]['driverText'] != fractional['driverText'], 'fractional driver metrics did not change'
pixels = json.loads((root/'candidate-native'/f'scale-{scale}'/'pixels.json').read_text())
assert status == 1 and pixels['exact'] is False and pixels['accepted'] is False and pixels['changedPixels'] > 0
assert pixels['tolerance'] == {'channel': 0, 'pixels': 0}
assert pixels['bounds']['minY'] >= fractional['lineBox']['y']*scale, 'an integer-size row acquired a pixel change'
PY
done
cd "$task_root"
git diff --exit-code HEAD -- ci/typesetting-fractional_test.go
