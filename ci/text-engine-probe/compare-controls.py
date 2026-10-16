#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Hosted generated-widget evidence; no browser data enters native painting."""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
SPEC = importlib.util.spec_from_file_location("controls_fyne_provenance", ROOT / "ci/text-engine-probe/compare-fyne.py")
fyne = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fyne)
require, read, digest, canonical = fyne.require, fyne.read, fyne.digest, fyne.canonical
TEST_NAME = "TestGeneratedResponsiveControlsFontationsPointerTypingResizeAndCommit"
POLICY_INTS = ["hinting", "auto_hint", "embedded_bitmaps", "subpixel", "linear_metrics", "edging", "baseline_snap", "pixel_geometry"]
POLICY_FLOATS = ["contrast", "gamma"]
REQUIRED = {
    "native/go.mod", "native/go.sum", "native/generated/responsive_controls_test.go",
    "native/generated/responsive_controls_fontations_test.go", "native/generated/responsive_flex_test.go",
    "native/generated/responsive_controls.gen.go", "native/generated/responsive_controls.gen.report.json",
    "native/generated/responsive_controls.gen.fonts.css", "responsive-controls.json", "responsive-controls-scenario.json",
    "example/src/components/ResponsiveControlsConformance.tsx", "example/src/pages/responsive-controls.astro",
    "example/public/fonts/NotoSans-Regular.ttf", "example/public/fonts/LICENSE-NotoSans.txt",
    "package.json", "bun.lock", "ci/text-engine-probe/test-controls-remote.sh",
    "ci/text-engine-probe/compare-controls.py", ".github/workflows/native-fontations-text.yml",
}


def sources(repository):
    names = set(REQUIRED)
    for directory in ["native", "src", "capture", "example", "ci/text-engine-probe", ".github/workflows"]:
        for path in (repository / directory).rglob("*"):
            relative = path.relative_to(repository)
            if any(part in {"node_modules", "dist", ".astro", "__pycache__", "artifacts", ".git"} for part in relative.parts):
                continue
            if path.is_dir():
                continue
            if directory == "native" and not (path.suffix in {".go", ".c", ".cc", ".h", ".mod", ".sum"}
                    or path.name.endswith((".gen.report.json", ".gen.fonts.css")) or path.name.startswith("LICENSE")):
                continue
            names.add(relative.as_posix())
    names.update(path.name for path in repository.glob("*.json") if not path.name.startswith("artifacts-"))
    result = {}
    for name in sorted(names):
        path = repository / name
        require(path.is_file() and not path.is_symlink(), "Controls source must be a regular file: " + name)
        result[name] = digest(path)
    return result


def scenario_contract(repository):
    scenario = read(repository / "responsive-controls-scenario.json")
    require(set(scenario) == {"ids", "actions"} and isinstance(scenario["ids"], list)
            and len(scenario["ids"]) == len(set(scenario["ids"])) == 10
            and all(isinstance(value, str) and value for value in scenario["ids"])
            and isinstance(scenario["actions"], list) and len(scenario["actions"]) == 21,
            "Controls must retain the ten IDs and twenty-one original gestures")
    allowed = {"click-input", "click-commit", "click-toggle-disabled", "click-disabled-input", "click-disabled-button",
               "click-canvas", "type-BC", "type-D", "type-E", "type-F", "press-enter", "resize-224", "resize-368", "resize-512"}
    width, cases = 224, []
    for index, action in enumerate(["initial", *scenario["actions"]]):
        require(action == "initial" if index == 0 else action in allowed, "Unknown controls gesture")
        if action.startswith("resize-"):
            width = int(action.removeprefix("resize-"))
        cases.append({"case": f"{index:02d}-{action}", "action": action,
                      "viewport": {"width": width, "height": 320, "scale": 1}})
    require(len({case["case"] for case in cases}) == 22, "Duplicate controls capture case")
    wire = {"ids": scenario["ids"], "actions": scenario["actions"]}
    scenario_hash = hashlib.sha256(json.dumps(wire, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return scenario, scenario_hash, cases


def policy_contract(repository):
    policy = read(repository / "ci/text-engine-probe/policy.json")
    require(all(type(policy.get(name)) is int for name in POLICY_INTS)
            and all(type(policy.get(name)) in [int, float] and math.isfinite(policy[name]) for name in POLICY_FLOATS),
            "Invalid original native policy")
    return {name: policy[name] for name in POLICY_INTS + POLICY_FLOATS}


def same_policy(actual, expected):
    require(isinstance(actual, dict) and set(actual) == set(expected), "Incomplete controls native policy")
    for name, value in expected.items():
        require(fyne.same_float(actual[name], value) if name in POLICY_FLOATS else type(actual[name]) is int and actual[name] == value,
                "Controls changed native policy: " + name)


def make_build(repository, evidence, provider):
    provider_record, provider_hash = fyne.validate_provider_build(repository, provider)
    binary, info = evidence / "controls.test", evidence / "test-build-info.txt"
    require(binary.is_file() and not binary.is_symlink() and info.is_file() and not info.is_symlink(),
            "Missing actual controls test binary/build information")
    observed = fyne.binary_build_info(binary)
    require(fyne.normalized_build_info(observed) == fyne.normalized_build_info(info.read_bytes()),
            "Controls build information differs from the retained binary")
    fyne.verify_binary_module(observed, fyne.public_pin(repository))
    lines = observed.decode().splitlines()
    for value in ["\tbuild\t-race=true", "\tbuild\t-tags=ci,atf_fontations", "\tbuild\tCGO_ENABLED=1",
                  "\tbuild\tGOOS=linux", "\tbuild\tGOARCH=arm64"]:
        require(lines.count(value) == 1, "Controls binary lacks the required build selection: " + value)
    _, scenario_hash, _ = scenario_contract(repository)
    generated = read(repository / "native/generated/responsive_controls.gen.report.json")
    require(generated.get("name") == "ResponsiveControls" and generated.get("visual", {}).get("measured") is False
            and generated.get("visual", {}).get("pixelPerfectVerified") is False
            and isinstance(generated.get("sourceHash"), str) and re.fullmatch(r"[0-9a-f]{64}", generated["sourceHash"]),
            "Controls must be generated from the original source without measurements")
    library = provider.parent / "libastro_fyne_text_experiment.so"
    require(library.is_file() and not library.is_symlink(), "Missing actual controls native library")
    return {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
            "sources": sources(repository), "providerBuildHash": provider_hash,
            "publicModule": provider_record["moduleContext"]["publicModule"],
            "binary": {"name": binary.name, "sha256": digest(binary)},
            "buildInfo": {"name": info.name, "sha256": digest(info),
                          "normalizedSHA256": hashlib.sha256(fyne.normalized_build_info(observed)).hexdigest()},
            "productionGoModHash": digest(repository / "native/go.mod"),
            "productionGoSumHash": digest(repository / "native/go.sum"),
            "sourceHash": generated["sourceHash"], "scenarioHash": scenario_hash,
            "fontHash": digest(repository / "example/public/fonts/NotoSans-Regular.ttf"),
            "fontLicenseHash": digest(repository / "example/public/fonts/LICENSE-NotoSans.txt"),
            "policyHash": digest(repository / "ci/text-engine-probe/policy.json"), "libraryHash": digest(library)}


def sealed_build(record, current, before):
    require(canonical(record) == canonical(current), "Controls build evidence is stale, incomplete or replayed")
    require(canonical(before) == canonical(current["sources"]), "Controls sources changed during compilation/execution")


def verify_build(repository, evidence, provider):
    record_path = evidence / "controls-build.json"
    record, current = read(record_path), make_build(repository, evidence, provider)
    sealed_build(record, current, read(evidence / "controls-sources-before.json"))
    return record, digest(record_path)


def report_binding(report, record, record_hash):
    require(type(report.get("schema")) is int and report["schema"] == 1
            and report.get("diagnosticOnly") is True and report.get("pixelPerfectVerified") is False,
            "Controls native report must remain an uncertified diagnostic")
    require(report.get("controlsBuildHash") == record_hash and canonical(report.get("controlsBuild")) == canonical(record)
            and report.get("testBinaryHash") == record["binary"]["sha256"]
            and report.get("testBuildInfoHash") == record["buildInfo"]["sha256"],
            "Controls capture lacks actual executed binary/source bindings")
    for name in ["sourceHash", "scenarioHash", "fontHash", "fontLicenseHash", "policyHash", "libraryHash"]:
        require(report.get(name) == record[name], "Controls capture has a stale binding: " + name)


def finite(value):
    return type(value) in [int, float] and math.isfinite(value)


def line_contract(line, expected_text, font_hash, policy):
    require(line.get("text") == expected_text and isinstance(expected_text, str) and expected_text,
            "Controls line differs from the actual state text")
    snapshot = line.get("snapshot", {})
    require(snapshot.get("text") == expected_text and snapshot.get("sourceFontHash") == font_hash
            and isinstance(snapshot.get("effectiveFontHash"), str) and re.fullmatch(r"[0-9a-f]{64}", snapshot["effectiveFontHash"])
            and fyne.same_float(snapshot.get("fontSizeCSS"), 14) and fyne.same_float(snapshot.get("lineHeightCSS"), 20),
            "Controls line changed font bytes or shaping size")
    same_policy(snapshot.get("policy"), policy)
    position, size, metrics = line.get("position", {}), line.get("size", {}), snapshot.get("metrics", {})
    require(set(position) == {"X", "Y"} and all(finite(value) for value in position.values())
            and set(size) == {"Width", "Height"} and all(finite(value) and value >= 0 for value in size.values())
            and set(metrics) == {"advanceCSS", "ascentCSS", "descentCSS", "leadingCSS", "baselineCSS"}
            and all(finite(value) for value in metrics.values()) and finite(line.get("baseline"))
            and fyne.same_float(size["Height"], 20) and fyne.same_float(size["Width"], metrics["advanceCSS"])
            and fyne.same_float(line["baseline"], metrics["baselineCSS"]), "Invalid native controls line geometry")
    expected_color = {"R": 255, "G": 255, "B": 255, "A": 255} if line.get("id") in {
        "controls-commit", "controls-toggle-disabled"} else {"R": 17, "G": 35, "B": 43, "A": 255}
    ink = line.get("color", {})
    require(set(ink) == set(expected_color) and all(type(value) is int for value in ink.values()) and ink == expected_color,
            "Controls line changed its authored opaque color")
    glyphs = snapshot.get("glyphs")
    require(isinstance(glyphs, list) and 0 < len(glyphs) <= 4096, "Missing native controls glyph snapshot")
    expected_fields = {"glyph", "clusterUTF8", "xAdvance16_16", "yAdvance16_16", "xOffset16_16", "yOffset16_16",
                       "nominalAdvanceCSS", "xCSS", "yCSS"}
    for glyph in glyphs:
        require(isinstance(glyph, dict) and set(glyph) == expected_fields
                and all(type(glyph[name]) is int for name in ["glyph", "clusterUTF8", "xAdvance16_16", "yAdvance16_16", "xOffset16_16", "yOffset16_16"])
                and 0 < glyph["glyph"] <= 65535 and 0 <= glyph["clusterUTF8"] < len(expected_text.encode())
                and all(-(1 << 31) <= glyph[name] < (1 << 31) for name in ["xAdvance16_16", "yAdvance16_16", "xOffset16_16", "yOffset16_16"])
                and all(finite(glyph[name]) for name in ["nominalAdvanceCSS", "xCSS", "yCSS"]),
                "Invalid native controls glyph record")


def frame_contract(report, cases, ids):
    frames = report.get("frames")
    require(isinstance(frames, list) and len(frames) == 22, "Controls must retain all twenty-two frames")
    for frame, expected in zip(frames, cases, strict=True):
        require(frame.get("case") == expected["case"] and frame.get("action") == expected["action"]
                and canonical(frame.get("viewport")) == canonical(expected["viewport"]), "Controls case/viewport sequence changed")
        require(isinstance(frame.get("lines"), list) and len(frame["lines"]) == 10
                and [line.get("id") for line in frame["lines"]] == ids,
                "Controls frame omitted, duplicated or reordered a source line")
    return frames


def profile_contract(repository, profile, report, record, record_hash, cases, scenario):
    report_binding(report, record, record_hash)
    policy = policy_contract(repository)
    same_policy(report.get("policy"), policy)
    frames = frame_contract(report, cases, scenario["ids"])
    native, browser = [read(profile / name) for name in ["native-behavior.json", "web-behavior.json"]]
    ids = {"responsive-controls", "controls-editor-row", "controls-toggle-row", *scenario["ids"]}
    for trace in [native, browser]:
        require(type(trace.get("schema")) is int and trace["schema"] == 1 and trace.get("sourceHash") == record["sourceHash"]
                and trace.get("scenarioHash") == record["scenarioHash"] and trace.get("unexpectedCalls") == []
                and isinstance(trace.get("frames"), list) and len(trace["frames"]) == 22,
                "Controls event trace is incomplete or stale")
    for index, (frame, case) in enumerate(zip(frames, cases, strict=True)):
        for trace in [native, browser]:
            require(trace["frames"][index].get("action") == case["action"]
                    and set(trace["frames"][index].get("nodes", {})) == set(scenario["ids"]),
                    "Controls event trace changed source cases/IDs")
        directory = profile / case["case"]
        for name, filename in [("web", "geometry.json"), ("native", "native-geometry.json")]:
            geometry = read(directory / filename)
            require(type(geometry.get("schema")) is int and geometry["schema"] == 1
                    and geometry.get("sourceHash") == record["sourceHash"] and geometry.get("scenarioHash") == record["scenarioHash"]
                    and geometry.get("case") == case["case"] and canonical(geometry.get("viewport")) == canonical(case["viewport"])
                    and geometry.get("screenshotHash") == digest(directory / (name + ".png"))
                    and set(geometry.get("nodes", {})) == ids, "Controls geometry/PNG binding changed")
            for rectangle in geometry["nodes"].values():
                require(set(rectangle) == {"parent", "x", "y", "width", "height"}
                        and all(finite(rectangle[key]) for key in ["x", "y", "width", "height"])
                        and rectangle["width"] >= 0 and rectangle["height"] >= 0
                        and (rectangle["parent"] is None or rectangle["parent"] in ids), "Invalid controls box")
        require(frame.get("screenshotHash") == digest(directory / "native.png"), "Native glyph sidecar belongs to another PNG")
        for line in frame["lines"]:
            line_contract(line, native["frames"][index]["nodes"][line["id"]], record["fontHash"], policy)


def strict_result(result, viewport, status):
    width, height = viewport["width"], viewport["height"]
    require(type(result.get("width")) is int and type(result.get("height")) is int
            and (result["width"], result["height"]) == (width, height)
            and type(result.get("totalPixels")) is int and result["totalPixels"] == width * height
            and type(result.get("changedPixels")) is int and 0 <= result["changedPixels"] <= width * height
            and type(result.get("pixelsOverTolerance")) is int and result["pixelsOverTolerance"] == result["changedPixels"]
            and type(result.get("maxChannelDelta")) is int and 0 <= result["maxChannelDelta"] <= 255
            and (result["maxChannelDelta"] == 0) == (result["changedPixels"] == 0), "Invalid controls pixel counters")
    tolerance = result.get("tolerance", {})
    require(set(tolerance) == {"channel", "pixels"} and all(type(value) is int and value == 0 for value in tolerance.values())
            and type(result.get("exact")) is bool and type(result.get("accepted")) is bool
            and result["exact"] == result["accepted"] == (result["changedPixels"] == 0)
            and status == (0 if result["exact"] else 1), "Controls comparison changed zero tolerance or exit semantics")


def self_test():
    def rejected(call, label):
        try:
            call()
        except (RuntimeError, ValueError, KeyError, TypeError):
            return
        raise RuntimeError("Negative controls evidence accepted: " + label)
    with tempfile.TemporaryDirectory(prefix="controls-contract-") as directory:
        repository = pathlib.Path(directory)
        for name in REQUIRED:
            path = repository / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(name)
        before = sources(repository)
        record = {"sources": before, "binary": {"sha256": "binary-one"}}
        sealed_build(record, copy.deepcopy(record), before)
        for name in ["native/generated/responsive_controls.gen.go", "native/generated/responsive_controls_test.go",
                     "native/generated/responsive_flex_test.go", "example/src/components/ResponsiveControlsConformance.tsx"]:
            path = repository / name
            original = path.read_bytes()
            path.write_bytes(original + b"changed")
            rejected(lambda: sealed_build(record, {**record, "sources": sources(repository)}, before), name)
            path.write_bytes(original)
        extra = repository / "native/generated/extra_implementation.go"
        extra.write_text("package generated\n")
        rejected(lambda: sealed_build(record, {**record, "sources": sources(repository)}, before), "new generated source")
        extra.unlink()
        rejected(lambda: sealed_build(record, {**record, "binary": {"sha256": "old-replayed-binary"}}, before), "replayed binary")
    cases = [{"case": f"{index:02d}-initial", "action": "initial", "viewport": {"width": 224, "height": 320, "scale": 1}}
             for index in range(22)]
    ids = [str(index) for index in range(10)]
    report = {"frames": [{**case, "lines": [{"id": name} for name in ids]} for case in cases]}
    frame_contract(report, cases, ids)
    changed = copy.deepcopy(report)
    changed["frames"].pop()
    rejected(lambda: frame_contract(changed, cases, ids), "omitted frame")
    changed = copy.deepcopy(report)
    changed["frames"][0]["lines"][1]["id"] = "0"
    rejected(lambda: frame_contract(changed, cases, ids), "duplicated source line")
    changed = copy.deepcopy(report)
    changed["frames"][0]["lines"][0], changed["frames"][0]["lines"][1] = changed["frames"][0]["lines"][1], changed["frames"][0]["lines"][0]
    rejected(lambda: frame_contract(changed, cases, ids), "reordered source lines")
    policy = {key: 0 for key in POLICY_INTS + POLICY_FLOATS}
    line = {"id": "controls-title", "text": "A", "position": {"X": 16, "Y": 16}, "size": {"Width": 10, "Height": 20},
            "baseline": 15, "color": {"R": 17, "G": 35, "B": 43, "A": 255}, "snapshot": {
                "text": "A", "sourceFontHash": "a" * 64, "effectiveFontHash": "b" * 64, "fontSizeCSS": 14, "lineHeightCSS": 20,
                "policy": policy, "metrics": {"advanceCSS": 10, "ascentCSS": 15, "descentCSS": 5, "leadingCSS": 0, "baselineCSS": 15},
                "glyphs": [{"glyph": 1, "clusterUTF8": 0, "xAdvance16_16": 655360, "yAdvance16_16": 0,
                            "xOffset16_16": 0, "yOffset16_16": 0, "nominalAdvanceCSS": 10, "xCSS": 0, "yCSS": 0}]}}
    line_contract(line, "A", "a" * 64, policy)
    changed = copy.deepcopy(line)
    changed["snapshot"]["sourceFontHash"] = "c" * 64
    rejected(lambda: line_contract(changed, "A", "a" * 64, policy), "changed glyph source")
    changed = copy.deepcopy(line)
    changed["snapshot"]["glyphs"][0]["glyph"] = True
    rejected(lambda: line_contract(changed, "A", "a" * 64, policy), "boolean glyph alias")
    pixels = {"width": 224, "height": 320, "totalPixels": 71680, "changedPixels": 0,
              "pixelsOverTolerance": 0, "maxChannelDelta": 0, "tolerance": {"channel": 0, "pixels": 0},
              "exact": True, "accepted": True}
    strict_result(pixels, {"width": 224, "height": 320}, 0)
    for key, value in [("tolerance", {"channel": 1, "pixels": 0}), ("width", 224.0),
                       ("changedPixels", False), ("maxChannelDelta", 1)]:
        rejected(lambda: strict_result({**pixels, key: value}, {"width": 224, "height": 320}, 0), key)
    print("Generated controls evidence negative controls passed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider-evidence", type=pathlib.Path)
    parser.add_argument("--controls-evidence", type=pathlib.Path)
    parser.add_argument("--evidence", type=pathlib.Path)
    parser.add_argument("--comparator", type=pathlib.Path)
    for name in ["self-test", "record-sources", "record-build", "verify-build"]:
        parser.add_argument("--" + name, action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    require(args.controls_evidence is not None and args.provider_evidence is not None,
            "Controls and original provider evidence paths are required")
    evidence, provider = args.controls_evidence.resolve(), args.provider_evidence.resolve()
    if args.record_sources:
        (evidence / "controls-sources-before.json").write_text(json.dumps(sources(ROOT), indent=2) + "\n")
        return
    if args.record_build:
        record = make_build(ROOT, evidence, provider)
        require(canonical(read(evidence / "controls-sources-before.json")) == canonical(record["sources"]),
                "Controls sources changed before binary execution")
        (evidence / "controls-build.json").write_text(json.dumps(record, indent=2) + "\n")
        return
    if args.verify_build:
        verify_build(ROOT, evidence, provider)
        return
    require(args.evidence is not None and args.comparator is not None, "Controls profile/comparator are required")
    profile = args.evidence.resolve()
    scenario, _, cases = scenario_contract(ROOT)
    errors, comparisons = [], []
    try:
        record, record_hash = verify_build(ROOT, evidence, provider)
        report = read(profile / "fontations-frames.json")
        profile_contract(ROOT, profile, report, record, record_hash, cases, scenario)
        require((evidence / "test-exit-code.txt").read_text() == "0\n", "Actual generated controls test failed")
        log = (evidence / "tests.log").read_text()
        require(re.search(r"(?m)^=== RUN   " + TEST_NAME + r"$", log)
                and re.search(r"(?m)^--- PASS: " + TEST_NAME + r" \(", log), "Actual named generated controls test did not pass")
    except Exception as error:
        errors.append(type(error).__name__ + ": " + str(error))
    for case in cases:
        directory = profile / case["case"]
        output = directory / "fontations-comparison"
        output.mkdir(parents=True, exist_ok=True)
        result = {"case": case["case"], "viewport": case["viewport"], "valid": False, "accepted": False}
        try:
            reference, native = directory / "web.png", directory / "native.png"
            completed = subprocess.run([str(args.comparator.resolve()), "--reference", str(reference), "--native", str(native),
                                        "--out", str(output / "diff.png")], capture_output=True, text=True)
            (output / "pixels.raw.json").write_text(completed.stdout)
            (output / "comparator.stderr.txt").write_text(completed.stderr)
            pixels = json.loads(completed.stdout)
            strict_result(pixels, case["viewport"], completed.returncode)
            result.update(valid=True, accepted=pixels["accepted"], referenceHash=digest(reference), nativeHash=digest(native), pixels=pixels)
        except Exception as error:
            result["error"] = type(error).__name__ + ": " + str(error)
        (output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        comparisons.append(result)
    accepted = not errors and len(comparisons) == 22 and all(item["valid"] and item["accepted"] for item in comparisons)
    summary = {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False, "accepted": accepted,
               "errors": errors, "caseCount": 22, "lineSnapshotCount": 220 if not errors else None,
               "tolerance": {"channel": 0, "pixels": 0}, "comparisons": comparisons,
               "scope": "Unmodified source-only generated controls, DPR1, same twenty-one gestures; no GPU/inverse/bidi claim"}
    (profile / "fontations-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    raise SystemExit(0 if accepted else 1)


if __name__ == "__main__":
    main()
