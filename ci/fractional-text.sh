#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
task_root="$(pwd)"
task_evidence="$task_root/artifacts/fractional-text"
task_temporary="$(mktemp -d)"
trap 'rm -rf "$task_temporary"' EXIT
mkdir -p "$task_evidence"
cp ci/fractional-text.sh "$task_evidence/fractional-text.sh"

test -z "$(gofmt -l ci/typesetting-fractional_test.go)"
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
task_fixture_status=0
GOMAXPROCS=2 go test -json -count=1 -p=1 -race ./shaping > "$task_evidence/candidate-original-fixtures.jsonl" || task_fixture_status=$?
python3 - "$task_evidence/candidate-original-fixtures.jsonl" "$task_fixture_status" shaping/wrapping_test.go "$task_evidence/wrapping-inputs.json" <<'PY'
import hashlib, json, pathlib, sys
events = [json.loads(line) for line in open(sys.argv[1])]
names = ['TestTrailingSpace', 'TestRequiredBreaks', 'TestTrimmedTrailingWhitespace', 'TestMaxWidthRouding']
failed = {e['Test'] for e in events if e.get('Action') == 'fail' and e.get('Test')}
assert sys.argv[2] == '1' and failed == set(names), 'unexpected candidate failure outside the four integer-metric wrapping fixtures'
path = pathlib.Path(sys.argv[3]); before = path.read_text(); after = before
changes = []
for name in names:
    start = after.index('func ' + name + '(t *testing.T)')
    end = after.find('\nfunc ', start + 1)
    if end < 0: end = len(after)
    body = after[start:end]
    old, new = ('Size:   36,', 'Size:   fixed.I(1),') if name == 'TestMaxWidthRouding' else ('Size:   72,', 'Size:   fixed.I(2),')
    assert body.count(old) == 1, 'wrapping fixture source precondition failed'
    after = after[:start] + body.replace(old, new) + after[end:]
    changes.append({'test': name, 'old': old, 'new': new})
path.write_text(after)
pathlib.Path(sys.argv[4]).write_text(json.dumps({
    'schema': 1, 'beforeHash': hashlib.sha256(before.encode()).hexdigest(),
    'afterHash': hashlib.sha256(after.encode()).hexdigest(), 'changes': changes,
    'assertionsChanged': False,
    'reason': 'Wrapping fixtures explicitly require 1px or 0.5px monospace advances. Integer font sizes retain those intended metrics; fractional scale behavior is tested independently.',
}, indent=2) + '\n')
PY
GOMAXPROCS=2 go test -json -count=1 -p=1 -race ./shaping > "$task_evidence/candidate.jsonl"
go list -m -json all > "$task_evidence/modules.jsonl"
cp go.mod "$task_evidence/go.mod"
cp go.sum "$task_evidence/go.sum"
cp shaping/shaping.go "$task_evidence/shaping.go"
cp shaping/wrapping_test.go "$task_evidence/wrapping_test.go"
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
task_production_variant="$(go list -m -f '{{if .Replace}}fork-{{.Replace.Version}}{{else}}upstream-{{.Version}}{{end}}' fyne.io/fyne/v2)"
go list -m -json all > "$task_evidence/original-native-modules.jsonl"
ASTRO_FYNE_TYPOGRAPHY_ARTIFACTS="$task_evidence/original-native" ASTRO_FYNE_TEXT_VARIANT="$task_production_variant" ASTRO_FYNE_TEXT_ORIGIN=nearest \
  GOMAXPROCS=2 go test -count=1 -p=1 -run '^TestTypographyProbeSoftwareCanvasEvidence$' ./generated
GOMAXPROCS=2 go test -json -count=1 -p=1 -race ./fontresource > "$task_evidence/original-font-coverage.jsonl"
GOMAXPROCS=2 go test -c -race -p=1 -o "$task_evidence/font-backend-original.test" ./fontbackend
go version -m "$task_evidence/font-backend-original.test" > "$task_evidence/font-backend-build-info.txt"
(
  cd fontbackend
  GOMAXPROCS=2 go tool test2json -p github.com/thinkddr/astro-fyne/native/fontbackend -t "$task_evidence/font-backend-original.test" -test.v=test2json -test.count=1
) > "$task_evidence/original-font-backend.jsonl"
go mod edit -modfile="$task_modfile" -replace="github.com/go-text/typesetting=$task_checkout"
ASTRO_FYNE_TYPOGRAPHY_ARTIFACTS="$task_evidence/candidate-native" ASTRO_FYNE_TEXT_VARIANT=fork-fractional-candidate ASTRO_FYNE_TEXT_ORIGIN=nearest \
  GOMAXPROCS=2 go test -mod=mod -modfile="$task_modfile" -count=1 -p=1 -run '^TestTypographyProbeSoftwareCanvasEvidence$' ./generated
GOMAXPROCS=2 go test -json -mod=mod -modfile="$task_modfile" -count=1 -p=1 -race -run '^TestCoverageBuildContract$' ./fontresource > "$task_evidence/replaced-font-coverage.jsonl"
GOMAXPROCS=2 go test -json -mod=mod -modfile="$task_modfile" -count=1 -p=1 -race -run '^TestFontBackendBuildContract$' ./fontbackend > "$task_evidence/replaced-font-backend.jsonl"
GOMAXPROCS=2 go test -mod=mod -modfile="$task_modfile" -count=1 -p=2 -race -skip '^(TestStaticFace|TestNominalBackend)' ./... > "$task_evidence/native-tests.log"
go list -mod=mod -modfile="$task_modfile" -m -json all > "$task_evidence/patched-native-modules.jsonl"
cp "$task_modfile" "$task_evidence/patched-native.mod"
cp "$task_temporary/native.sum" "$task_evidence/patched-native.sum"
python3 - "$task_evidence" <<'PY'
import hashlib, json, pathlib, re, sys
root = pathlib.Path(sys.argv[1])
original_path = root/'original-font-coverage.jsonl'
replaced_path = root/'replaced-font-coverage.jsonl'
original = [json.loads(line) for line in original_path.read_text().splitlines()]
replaced = [json.loads(line) for line in replaced_path.read_text().splitlines()]
source = pathlib.Path('fontresource/coverage_test.go').read_text()
names = re.findall(r'^func (TestStaticFace\w+)\(t \*testing.T\)', source, re.M)
assert len(names) == 8 and len(set(names)) == 8
backend_source = '\n'.join(path.read_text() for path in sorted(pathlib.Path('fontbackend').glob('*_test.go')))
backend_names = re.findall(r'^func (TestNominalBackend\w+)\(t \*testing.T\)', backend_source, re.M)
assert backend_names and len(backend_names) == len(set(backend_names))
for events in [original, replaced]:
    assert not any(e.get('Action') in ['fail', 'skip'] for e in events)
    assert any(e.get('Action') == 'pass' and e.get('Test') == 'TestCoverageBuildContract' for e in events)
assert all(any(e.get('Action') == 'pass' and e.get('Test') == name for e in original) for name in names)
assert any('qualified parser build admitted' in e.get('Output', '') for e in original)
assert any('unqualified parser build rejected' in e.get('Output', '') for e in replaced)
(root/'font-coverage-variants.json').write_text(json.dumps({
    'schema': 1, 'diagnosticOnly': True,
    'originalCoveragePackage': 'github.com/thinkddr/astro-fyne/native/fontresource',
    'originalParser': 'github.com/go-text/typesetting@v0.3.4',
    'originalCoverageTestsPassed': names,
    'originalCoveragePassedCases': sorted({e['Test'] for e in original if e.get('Action') == 'pass' and e.get('Test', '').split('/')[0] in names}),
    'patchedNativeSuiteSkipPattern': '^(TestStaticFace|TestNominalBackend)',
    'patchedNativeSuiteExcludedTests': names + backend_names,
    'patchedNativeSuiteExclusionsByPackage': {
        'github.com/thinkddr/astro-fyne/native/fontresource': names,
        'github.com/thinkddr/astro-fyne/native/fontbackend': backend_names,
    },
    'patchedConstructorRejectionTest': 'TestCoverageBuildContract',
    'patchedConstructorRejected': True,
    'originalTraceHash': hashlib.sha256(original_path.read_bytes()).hexdigest(),
    'patchedTraceHash': hashlib.sha256(replaced_path.read_bytes()).hexdigest(),
    'nativeTestsLogHash': hashlib.sha256((root/'native-tests.log').read_bytes()).hexdigest(),
    'producerScriptHash': hashlib.sha256((root/'fractional-text.sh').read_bytes()).hexdigest(),
    'originalModulesHash': hashlib.sha256((root/'original-native-modules.jsonl').read_bytes()).hexdigest(),
    'patchedModulesHash': hashlib.sha256((root/'patched-native-modules.jsonl').read_bytes()).hexdigest(),
    'patchedModfileHash': hashlib.sha256((root/'patched-native.mod').read_bytes()).hexdigest(),
    'patchedSumHash': hashlib.sha256((root/'patched-native.sum').read_bytes()).hexdigest(),
    'pixelPerfectVerified': False,
}, indent=2) + '\n')
PY
python3 - "$task_evidence" <<'PY'
import hashlib, json, pathlib, re, shutil, subprocess, sys
root = pathlib.Path(sys.argv[1])
sources = sorted(pathlib.Path('fontbackend').glob('*.go'))
source = '\n'.join(path.read_text() for path in sources if path.name.endswith('_test.go'))
names = re.findall(r'^func (TestNominalBackend\w+)\(t \*testing.T\)', source, re.M)
assert names and len(names) == len(set(names))
traces = {}
for kind in ['original', 'replaced']:
    events = [json.loads(line) for line in (root/f'{kind}-font-backend.jsonl').read_text().splitlines()]
    assert not any(event.get('Action') in ['fail', 'skip'] for event in events)
    assert any(event.get('Action') == 'pass' and event.get('Test') == 'TestFontBackendBuildContract' for event in events)
    assert sum(event.get('Action') == 'pass' and event.get('Test') is None and event.get('Package') == 'github.com/thinkddr/astro-fyne/native/fontbackend' for event in events) == 1
    traces[kind] = events
assert all(sum(event.get('Action') == 'pass' and event.get('Test') == name for event in traces['original']) == 1 for name in names)
assert any('qualified nominal backend build admitted' in event.get('Output', '') for event in traces['original'])
assert any('unqualified nominal backend build rejected' in event.get('Output', '') for event in traces['replaced'])
assert not any(event.get('Test', '').split('/')[0] in names for event in traces['replaced'])
bindings = []
for path in [*sources, pathlib.Path('fontbackend/README.md'), pathlib.Path('view.go'), pathlib.Path('backend.go'), pathlib.Path('controls.go'), pathlib.Path('text_admission.go'), pathlib.Path('go.mod'), pathlib.Path('go.sum')]:
    data = path.read_bytes()
    relative = 'native/' + path.as_posix()
    assert data == subprocess.check_output(['git', 'show', 'HEAD:' + relative]), relative
    target = root/'font-backend-inputs'/relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)
    bindings.append({'source': relative, 'file': str(target.relative_to(root)), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
for name in ['font-backend-original.test', 'font-backend-build-info.txt', 'go-version.txt', 'original-font-backend.jsonl', 'replaced-font-backend.jsonl', 'font-coverage-variants.json', 'fractional-text.sh', 'original-native-modules.jsonl', 'patched-native-modules.jsonl', 'patched-native.mod', 'patched-native.sum', 'native-tests.log']:
    data = (root/name).read_bytes()
    bindings.append({'file': name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
(root/'font-backend-variants.json').write_text(json.dumps({
    'schema': 1, 'accepted': True, 'diagnosticOnly': True,
    'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'tree': subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], text=True).strip(),
    'originalOnlyTests': names,
    'originalPassedCases': sorted({event['Test'] for event in traces['original'] if event.get('Action') == 'pass' and event.get('Test')}),
    'patchedNativeSuiteSkipPattern': '^(TestStaticFace|TestNominalBackend)',
    'actualOriginalConstructorAdmitted': True, 'actualReplacedConstructorRejected': True,
    'bindings': bindings, 'pixelPerfectVerified': False,
    'scope': 'Nominal native font admission under an identified parser; no browser, shaping, fallback or raster certification',
}, indent=2) + '\n')
PY
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
