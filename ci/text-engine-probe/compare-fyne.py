#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Strict original-source Fyne text evidence with explicit fork/library bindings."""
import argparse
import copy
import hashlib
import json
import math
import os
import pathlib
import struct
import subprocess
import tempfile

from compare import frame_scales


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    # Go writes float32 negative zero as -0; preserve its IEEE sign.
    return json.loads(path.read_bytes(), parse_int=lambda token: -0.0 if token == "-0" else int(token))


def same_float(first, second):
    return (type(first) in [int, float] and type(second) in [int, float]
            and math.isfinite(first) and math.isfinite(second)
            and struct.pack("<f", first) == struct.pack("<f", second))


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def provider_sources(repository):
    """Bind local Go implementation/tests, C loader/ABI and build selection."""
    names = {"native/go.mod", "native/go.sum", "ci/text-engine-probe/compare-fyne.py",
             "ci/text-engine-probe/test-fyne-remote.sh", "ci/text-engine-probe/fyne-hook-pin.json"}
    names.update(path.relative_to(repository).as_posix() for path in (repository / "native").rglob("*.go")
                 if path.relative_to(repository / "native").parts[0] != "generated")
    for path in (repository / "native/fontations").rglob("*"):
        if path.suffix in {".go", ".c", ".cc", ".h"} or path.name == "LICENSE-Chromium":
            names.add(path.relative_to(repository).as_posix())
    required = {"native/fontations/backend.go", "native/fontations/line.go", "native/fontations/transport.go",
                "native/fontations/loader.go", "native/fontations/loader.c", "native/fontations/loader.h",
                "native/fontations/cabi/text_engine.cc", "native/fontations/cabi/text_engine.h",
                "native/fontations/cabi/LICENSE-Chromium", "native/fontations/probe_external_test.go"}
    require(required <= names, "Provider source manifest is incomplete")
    result = {}
    for name in sorted(names):
        path = repository / name
        require(path.is_file() and not path.is_symlink(), "Provider inputs must be regular source files: " + name)
        result[name] = digest(path)
    return result


def go_environment():
    return {**os.environ, "GOWORK": "off", "GOFLAGS": "-mod=readonly"}


def module_json(path):
    return json.loads(subprocess.check_output(["go", "mod", "edit", "-json", "-modfile", str(path)],
                                             cwd=pathlib.Path(__file__).resolve().parents[2] / "native",
                                             env=go_environment()))


def normalized_build_info(data):
    lines = data.splitlines(keepends=True)
    require(lines and b": go" in lines[0], "Missing actual Go test binary build information")
    # Only the binary's filename changes when an artifact is extracted elsewhere.
    lines[0] = lines[0].rsplit(b": ", 1)[1]
    return b"".join(lines)


def binary_build_info(path):
    return subprocess.check_output(["go", "version", "-m", str(path)], env=go_environment())


def selected_modules(path):
    values, text = [], path.read_text()
    decoder = json.JSONDecoder()
    while text.strip():
        value, used = decoder.raw_decode(text.lstrip())
        require(isinstance(value, dict), "Invalid selected module record")
        values.append(value)
        text = text.lstrip()[used:]
    return values


def module_context(repository, provider, parse_module=module_json):
    original, temporary = parse_module(repository / "native/go.mod"), parse_module(provider / "provider.mod")
    replacement = str(provider.parents[1] / "fyne-text-hook")
    expected = copy.deepcopy(original)
    replacements = expected.get("Replace")
    require(isinstance(replacements, list), "The production module must retain its explicit Fyne dependency")
    selected = [item for item in replacements if item.get("Old", {}).get("Path") == "fyne.io/fyne/v2"]
    require(len(selected) == 1, "The production module must have one Fyne replacement")
    selected[0]["New"] = {"Path": replacement}
    require(canonical(temporary) == canonical(expected), "Temporary module changed more than the Fyne source replacement")
    require((provider / "provider.sum").read_bytes() == (repository / "native/go.sum").read_bytes(),
            "Temporary module sums differ from the unchanged production sums")
    modules = selected_modules(provider / "selected-modules.json")
    selected = [item for item in modules if item.get("Path") == "fyne.io/fyne/v2"]
    require(len(selected) == 1 and selected[0].get("Replace", {}).get("Dir") == replacement
            and selected[0]["Replace"].get("Path") == replacement
            and not selected[0]["Replace"].get("Version"), "The selected graph did not use the exact local Fyne source")
    return {"productionGoModHash": digest(repository / "native/go.mod"),
            "productionGoSumHash": digest(repository / "native/go.sum"),
            "temporaryGoModHash": digest(provider / "provider.mod"),
            "temporaryGoSumHash": digest(provider / "provider.sum"),
            "selectedModulesHash": digest(provider / "selected-modules.json"),
            "fyneReplacementPath": replacement, "temporaryFyneReplacementOnly": True,
            "productionDependencyChanged": False}


def make_provider_build(repository, provider, parse_module=module_json, observe_binary=binary_build_info):
    binary, info = provider / "fontations.test", provider / "test-build-info.txt"
    require(binary.is_file() and not binary.is_symlink() and info.is_file() and not info.is_symlink(),
            "Missing retained test binary or its actual build information")
    observed, recorded = observe_binary(binary), info.read_bytes()
    require(normalized_build_info(observed) == normalized_build_info(recorded),
            "Retained build information differs from the actual retained test binary")
    return {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
            "sources": provider_sources(repository),
            "binary": {"name": binary.name, "sha256": digest(binary)},
            "buildInfo": {"name": info.name, "sha256": digest(info),
                          "normalizedSHA256": hashlib.sha256(normalized_build_info(observed)).hexdigest()},
            "moduleContext": module_context(repository, provider, parse_module)}


def validate_provider_build(repository, provider, parse_module=module_json, observe_binary=binary_build_info):
    path = provider / "provider-build.json"
    record = read(path)
    current = make_provider_build(repository, provider, parse_module, observe_binary)
    require(canonical(record) == canonical(current), "Provider build evidence is stale, incomplete or replayed")
    require(read(provider / "provider-sources-before.json") == current["sources"],
            "Production/provider sources changed during the hosted build")
    return record, digest(path)


def validate_provider_report(report, record, record_hash):
    require(report.get("providerBuildHash") == record_hash
            and canonical(report.get("providerBuild")) == canonical(record)
            and report.get("testBinaryHash") == record["binary"]["sha256"]
            and report.get("testBuildInfoHash") == record["buildInfo"]["sha256"],
            "Fyne captures lack the current provider source and actual executed binary bindings")


def contract_self_test():
    """Hosted negative controls; these exercise validation without running Go."""
    with tempfile.TemporaryDirectory(prefix="fontations-contract-") as directory:
        root = pathlib.Path(directory)
        numbers = root / "numbers.json"
        numbers.write_text('{"negative":-0,"decimalNegative":-0.0,"positive":0,"one":1,"boolean":true}')
        values = read(numbers)
        require(same_float(values["negative"], values["decimalNegative"])
                and not same_float(values["negative"], values["positive"])
                and type(values["positive"]) is int and type(values["one"]) is int
                and not same_float(values["boolean"], values["one"]),
                "JSON must preserve floating negative zero without weakening integer or boolean checks")
        repository, provider = root / "repository", root / "work/evidence/fyne"
        source_names = ["native/go.mod", "native/go.sum", "native/backend.go",
                        "ci/text-engine-probe/compare-fyne.py", "ci/text-engine-probe/test-fyne-remote.sh",
                        "ci/text-engine-probe/fyne-hook-pin.json", "native/fontations/backend.go",
                        "native/fontations/line.go", "native/fontations/transport.go", "native/fontations/loader.go",
                        "native/fontations/loader.c", "native/fontations/loader.h",
                        "native/fontations/cabi/text_engine.cc", "native/fontations/cabi/text_engine.h",
                        "native/fontations/cabi/LICENSE-Chromium", "native/fontations/probe_external_test.go"]
        for name in source_names:
            path = repository / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(name + "\n")
        provider.mkdir(parents=True)
        for name, content in {"provider.mod": b"temporary module\n", "provider.sum": b"native/go.sum\n",
                              "fontations.test": b"retained ELF fixture", "test-build-info.txt": b"/build/fontations.test: go1.27.2\n\tpath\texample.test\n"}.items():
            (provider / name).write_bytes(content)
        replacement = str(provider.parents[1] / "fyne-text-hook")
        original = {"Module": {"Path": "example/native"}, "Replace": [{"Old": {"Path": "fyne.io/fyne/v2"},
                     "New": {"Path": "example/fyne", "Version": "v1.0.0"}}]}
        temporary = copy.deepcopy(original)
        temporary["Replace"][0]["New"] = {"Path": replacement}
        (provider / "selected-modules.json").write_text(json.dumps({"Path": "fyne.io/fyne/v2", "Replace": {"Path": replacement, "Dir": replacement}}))
        parse = lambda path: original if path == repository / "native/go.mod" else temporary
        observe = lambda _: b"/extract/fontations.test: go1.27.2\n\tpath\texample.test\n"
        record = make_provider_build(repository, provider, parse, observe)
        build_path = provider / "provider-build.json"
        build_path.write_text(json.dumps(record))
        (provider / "provider-sources-before.json").write_text(json.dumps(record["sources"]))
        validate_provider_build(repository, provider, parse, observe)
        report = {"providerBuildHash": digest(build_path), "providerBuild": record,
                  "testBinaryHash": record["binary"]["sha256"], "testBuildInfoHash": record["buildInfo"]["sha256"]}
        validate_provider_report(report, record, digest(build_path))
        def rejected(action, message):
            try:
                action()
            except (RuntimeError, ValueError, KeyError):
                return
            raise RuntimeError("Negative provider control accepted: " + message)
        for relative in ["native/fontations/loader.c", "native/fontations/cabi/text_engine.h", "native/backend.go", "native/go.mod"]:
            path = repository / relative
            before = path.read_bytes()
            path.write_bytes(before + b"changed\n")
            rejected(lambda: validate_provider_build(repository, provider, parse, observe), relative)
            path.write_bytes(before)
        for name in ["fontations.test", "test-build-info.txt", "provider.mod", "provider.sum", "selected-modules.json"]:
            path = provider / name
            before = path.read_bytes()
            path.write_bytes(before + b"changed\n")
            rejected(lambda: validate_provider_build(repository, provider, parse, observe), name)
            path.write_bytes(before)
        added = repository / "native/fontations/new_implementation.go"
        added.write_text("package fontations\n")
        rejected(lambda: validate_provider_build(repository, provider, parse, observe), "omitted new source")
        added.unlink()
        for key, value in [("providerBuild", None), ("providerBuildHash", "0" * 64), ("testBinaryHash", "0" * 64), ("testBuildInfoHash", "0" * 64)]:
            altered = {**report, key: value}
            rejected(lambda: validate_provider_report(altered, record, digest(build_path)), key)
        altered = copy.deepcopy(record)
        altered["schema"] = True
        build_path.write_text(json.dumps(altered))
        rejected(lambda: validate_provider_build(repository, provider, parse, observe), "boolean schema alias")
        build_path.write_text(json.dumps(record))
        temporary["Require"] = [{"Path": "unexpected/dependency", "Version": "v1.0.0"}]
        rejected(lambda: make_provider_build(repository, provider, parse, observe), "extra temporary dependency")
        print("Provider provenance negative controls passed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=pathlib.Path)
    parser.add_argument("--provider-evidence", type=pathlib.Path)
    parser.add_argument("--comparator", type=pathlib.Path)
    parser.add_argument("--record-sources", action="store_true")
    parser.add_argument("--record-provider-build", action="store_true")
    parser.add_argument("--verify-provider-build", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    repository = pathlib.Path(__file__).resolve().parents[2]
    if args.self_test:
        contract_self_test()
        return
    require(args.provider_evidence is not None, "--provider-evidence is required")
    provider = args.provider_evidence.resolve()
    if args.record_sources:
        (provider / "provider-sources-before.json").write_text(json.dumps(provider_sources(repository), indent=2) + "\n")
        return
    if args.record_provider_build:
        record = make_provider_build(repository, provider)
        require(read(provider / "provider-sources-before.json") == record["sources"], "Provider inputs changed before test execution")
        (provider / "provider-build.json").write_text(json.dumps(record, indent=2) + "\n")
        return
    record, record_hash = validate_provider_build(repository, provider)
    if args.verify_provider_build:
        return
    require(args.evidence is not None and args.comparator is not None, "--evidence and --comparator are required")
    root = args.evidence.resolve()
    pin_path = repository / "ci/text-engine-probe/fyne-hook-pin.json"
    pin = read(pin_path)
    source = read(provider / "fyne-source.json")
    require((provider / "fyne-hook-pin.json").read_bytes() == pin_path.read_bytes()
            and source.get("revision") == pin["revision"] and source.get("tree") == pin["tree"]
            and source.get("sourceHashes") == pin["sourceHashes"], "Fyne source is not bound to the current exact fork pin")
    raw = (provider / "fyne-commit.txt").read_bytes()
    require(hashlib.sha1(b"commit " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == pin["revision"]
            and raw.startswith(("tree " + pin["tree"] + "\n").encode())
            and (provider / "fyne-after-tests.txt").read_text().strip() == pin["revision"],
            "The actual fork commit/tree changed across the hosted provider build")
    require(digest(provider / "LICENSE-Fyne") == pin["sourceHashes"]["LICENSE"], "Fyne notice changed")
    modules, text = [], (provider / "selected-modules.json").read_text()
    decoder = json.JSONDecoder()
    while text.strip():
        module, used = decoder.raw_decode(text.lstrip())
        modules.append(module)
        text = text.lstrip()[used:]
    selected = [module for module in modules if module.get("Path") == "fyne.io/fyne/v2"]
    require(len(selected) == 1 and selected[0].get("Replace", {}).get("Dir")
            == str(provider.parents[1] / "fyne-text-hook"), "Provider did not select the verified local fork source")
    native, browser, fyne = [read(root / name) for name in
                             ["native/native-text.json", "browser/browser-text.json", "fyne/fyne-text.json"]]
    validate_provider_report(fyne, record, record_hash)
    require(type(fyne.get("schema")) is int and fyne["schema"] == 1
            and fyne.get("diagnosticOnly") is True and fyne.get("pixelPerfectVerified") is False
            and fyne.get("browserEffectivePolicyVerified") is False and fyne.get("nativeScalerInternalsObserved") is False,
            "Fyne text must remain a bounded diagnostic")
    for name in ["sourceHash", "probeHash", "fixtureHash", "fontHash"]:
        require(fyne.get(name) == native[name] == browser[name], "Original Fyne/browser/native identity differs: " + name)
    require(fyne.get("libraryHash") == native["libraryHash"]
            and fyne.get("policyHash") == native["policyHash"]
            and fyne.get("testHash") == digest(repository / "native/fontations/probe_external_test.go")
            and fyne.get("fyneRevision") == pin["revision"], "Fyne renderer lacks current library/policy/test/fork bindings")
    require(set(fyne.get("nativePolicy", {})) == set(native["nativePolicy"]), "Fyne policy fields differ")
    for name, expected in native["nativePolicy"].items():
        actual = fyne["nativePolicy"][name]
        require((same_float(actual, expected) if name in ["contrast", "gamma"] else type(actual) is int and actual == expected),
                "Fyne native request differs: " + name)
    input_ = read(repository / "typography-probe.json")
    native_frames, fyne_frames = frame_scales(native["frames"], "Native"), frame_scales(fyne["frames"], "Fyne")
    browser_frames = frame_scales(browser["cases"], "Browser", browser=True)
    metric_fields = {"advanceCSS": "advance_css", "ascentCSS": "ascent_css", "descentCSS": "descent_css",
                     "leadingCSS": "leading_css", "baselineCSS": "baseline_css"}
    glyph_fields = {"glyph": "glyph", "clusterUTF8": "cluster_utf8", "xAdvance16_16": "x_advance_16_16",
                    "yAdvance16_16": "y_advance_16_16", "xOffset16_16": "x_offset_16_16", "yOffset16_16": "y_offset_16_16",
                    "nominalAdvanceCSS": "nominal_advance_css", "xCSS": "x_css", "yCSS": "y_css"}
    results, failed = [], False
    for scale in [1, 2]:
        frame = fyne_frames[scale]
        samples = frame.get("samples")
        require(isinstance(samples, list) and len(samples) == 7
                and [sample.get("id") for sample in samples] == [sample["id"] for sample in native["samples"]],
                "Fyne must retain every original text row in source order")
        for sample, shaped, original in zip(samples, native["samples"], input_["samples"], strict=True):
            require(sample.get("text") == shaped["text"] and sample.get("fontHash") == native["fontHash"], "Fyne text/font changed")
            require(sample.get("position") == {"X": original["x"], "Y": original["y"]}
                    and sample.get("size") == sample.get("backendMeasure")
                    and same_float(sample["size"].get("Width"), shaped["metrics"]["advance_css"])
                    and same_float(sample["size"].get("Height"), input_["font"]["lineHeight"])
                    and same_float(sample.get("baseline"), shaped["metrics"]["baseline_css"]),
                    "Fyne did not use the original line origin and native shape metrics")
            snapshot = sample.get("snapshot", {})
            require(snapshot.get("text") == shaped["text"] and snapshot.get("sourceFontHash") == native["fontHash"]
                    and snapshot.get("effectiveFontHash") == native["effectiveFontHash"]
                    and same_float(snapshot.get("fontSizeCSS"), original.get("fontSize", input_["font"]["size"]))
                    and same_float(snapshot.get("lineHeightCSS"), input_["font"]["lineHeight"]), "Fyne glyph snapshot source differs")
            require(set(snapshot.get("metrics", {})) == set(metric_fields), "Fyne metrics are incomplete")
            for actual, expected in metric_fields.items():
                require(same_float(snapshot["metrics"][actual], shaped["metrics"][expected]), "Fyne native metric changed: " + actual)
            require(set(snapshot.get("policy", {})) == set(fyne["nativePolicy"]), "Fyne snapshot policy is incomplete")
            for name, expected in fyne["nativePolicy"].items():
                actual = snapshot["policy"][name]
                require(same_float(actual, expected) if name in ["contrast", "gamma"] else type(actual) is int and actual == expected,
                        "Fyne snapshot used a different policy")
            glyphs = snapshot.get("glyphs")
            require(isinstance(glyphs, list) and len(glyphs) == len(shaped["glyphs"]), "Fyne glyph count changed")
            for glyph, reference in zip(glyphs, shaped["glyphs"], strict=True):
                require(set(glyph) == set(glyph_fields), "Fyne native glyph fields are incomplete")
                for actual, expected in glyph_fields.items():
                    value = glyph[actual]
                    require(same_float(value, reference[expected]) if actual in ["nominalAdvanceCSS", "xCSS", "yCSS"]
                            else type(value) is int and value == reference[expected], "Fyne native glyph changed: " + actual)
        width, height = input_["viewport"]["width"] * scale, input_["viewport"]["height"] * scale
        require(type(frame.get("width")) is int and type(frame.get("height")) is int
                and (frame["width"], frame["height"]) == (width, height)
                and frame.get("path") == f"scale-{scale}/fyne.png", "Fyne viewport or capture path changed")
        target = root / "fyne" / frame["path"]
        require(digest(target) == frame.get("hash"), "Fyne image differs from the actual capture record")
        references = [("browser", root / "browser" / browser_frames[scale]["screenshot"]["path"]),
                      ("native", root / "native" / native_frames[scale]["path"])]
        for label, reference in references:
            output = root / f"fyne-comparisons/scale-{scale}/{label}"
            output.mkdir(parents=True, exist_ok=True)
            completed = subprocess.run([str(args.comparator.resolve()), "--reference", str(reference),
                                        "--native", str(target), "--out", str(output / "diff.png")], capture_output=True, text=True)
            (output / "pixels.raw.json").write_text(completed.stdout)
            (output / "comparator.stderr.txt").write_text(completed.stderr)
            result = json.loads(completed.stdout)
            changed = result.get("changedPixels")
            tolerance = result.get("tolerance")
            require(type(changed) is int and changed >= 0 and isinstance(tolerance, dict)
                    and set(tolerance) == {"channel", "pixels"}
                    and all(type(value) is int and value == 0 for value in tolerance.values())
                    and type(result.get("exact")) is bool and type(result.get("accepted")) is bool
                    and result["exact"] == result["accepted"] == (changed == 0)
                    and completed.returncode == (0 if changed == 0 else 1)
                    and (result.get("width"), result.get("height")) == (width, height), "Invalid strict Fyne comparison")
            result["inputs"] = {"referenceHash": digest(reference), "fyneHash": digest(target)}
            (output / "pixels.json").write_text(json.dumps(result, indent=2) + "\n")
            results.append({"reference": label, "scale": scale, **result})
            failed = failed or changed != 0
    (root / "fyne-summary.json").write_text(json.dumps({"schema": 1, "diagnosticOnly": True,
        "pixelPerfectVerified": False, "fyneRevision": pin["revision"], "libraryHash": native["libraryHash"],
        "providerBuildHash": record_hash, "testBinaryHash": record["binary"]["sha256"],
        "allSevenGlyphSnapshotsEqualNative": True, "frames": results,
        "scope": "Real Fyne canvas.Text/software painter; generated widgets/editors/inverse/GPU remain separate"}, indent=2) + "\n")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
