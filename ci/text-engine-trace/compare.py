#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Record every strict comparison, including invalid or missing evidence."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reject_constant(value):
    raise ValueError("Nonfinite JSON number: " + value)


def read(path):
    return json.loads(path.read_text(), parse_constant=reject_constant)


def frames(report, browser=False):
    values = report["cases" if browser else "frames"]
    if not isinstance(values, list) or len(values) != 2:
        raise RuntimeError("Expected exactly two DPR frames")
    result = {}
    for frame in values:
        scale = frame["viewport"]["scale"] if browser else frame["scale"]
        if type(scale) is not int or scale not in [1, 2] or scale in result:
            raise RuntimeError("Expected distinct integer scales 1 and 2")
        result[scale] = frame
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=pathlib.Path, required=True)
    parser.add_argument("--work", type=pathlib.Path, required=True)
    parser.add_argument("--comparator", type=pathlib.Path, required=True)
    parser.add_argument("--mode", choices=["neutrality", "all"], required=True)
    args = parser.parse_args()
    root, work = args.evidence.resolve(), args.work.resolve()
    source = pathlib.Path(__file__).resolve().parents[2]
    pin = read(source / "ci/text-engine-probe/probe-pin.json")
    metrics = {"accepted": False}
    trace_observation = {"accepted": False}
    reports = {}
    try:
        for name, library, driver in [
            ("control", work / "evidence/libastro_fyne_text_experiment.so", source / "ci/text-engine-probe/driver.py"),
            ("trace", work / "trace/evidence/libastro_fyne_text_trace.so", work / "trace/assembly/driver.py"),
        ]:
            report = read(root / name / "native-text.json")
            if report["libraryHash"] != digest(library) or report["driverHash"] != digest(driver):
                raise RuntimeError("Library/driver provenance differs: " + name)
            if report["policyHash"] != digest(source / "ci/text-engine-probe/policy.json"):
                raise RuntimeError("Native request policy changed: " + name)
            for field in ["sourceHash", "probeHash", "fixtureHash", "fontHash"]:
                if report[field] != pin[field]:
                    raise RuntimeError("Native original-source identity differs: " + field)
            if report["effectiveFontHash"] != digest(root / name / "effective-font.ttf"):
                raise RuntimeError("Effective font bytes differ from report")
            if any(type(report[field]) is not bool or report[field] is not expected for field, expected in [("diagnosticOnly", True), ("pixelPerfectVerified", False), ("browserEffectivePolicyVerified", False)]):
                raise RuntimeError("Native diagnostic labels were broadened")
            frames(report)
            reports[name] = report
        if (root / "control/effective-font.ttf").read_bytes() != (root / "trace/effective-font.ttf").read_bytes():
            raise RuntimeError("Instrumentation changed effective font bytes")
        # Only the two explicitly different binaries/drivers are provenance.
        # Every other report field, including all metrics, glyphs, requests,
        # table hashes, origins and frame identities, must remain exact.
        normalized = [{key: value for key, value in reports[name].items() if key not in ["libraryHash", "driverHash"]} for name in ["control", "trace"]]
        if normalized[0] != normalized[1]:
            raise RuntimeError("Instrumentation changed native metrics, glyphs, fonts, policy or frame metadata")
        metrics = {"accepted": True, "ignoredProvenanceFields": ["libraryHash", "driverHash"], "controlReportHash": digest(root / "control/native-text.json"), "traceReportHash": digest(root / "trace/native-text.json")}
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        metrics["error"] = str(error)
    try:
        raw = (root / "trace-driver.stderr.log").read_text()
        control = (root / "control-driver.stderr.log").read_text()
        build = (work / "trace/evidence/build.log").read_text()
        if "ATF_SCALER" in control or "ATF_DRIVER" in control:
            raise RuntimeError("Uninstrumented control emitted trace records")
        if "-DATF_DIAGNOSTIC_SCALER_TRACE" not in build:
            raise RuntimeError("Actual trace compile command omitted the diagnostic define")
        stages = ["filter-before", "filter-after", "hint-branch", "context-ready", "context-details", "generate-image"]
        counts = {stage: len(re.findall(r"ATF_SCALER stage=" + stage + r"\b", raw)) for stage in stages}
        if not all(counts.values()):
            raise RuntimeError("Actual scaler trace omitted a required observation stage")
        labels = [json.loads(line[len("ATF_DRIVER "):], parse_constant=reject_constant) for line in raw.splitlines() if line.startswith("ATF_DRIVER ")]
        probe = read(source / "typography-probe.json")
        expected = []
        for sample in probe["samples"]:
            expected.extend([{"stage": "shape-before", "sample": sample["id"], "fontSize": sample.get("fontSize", probe["font"]["size"])}, {"stage": "shape-after", "sample": sample["id"]}])
        for scale in [1, 2]:
            for sample in probe["samples"]:
                expected.extend([{"stage": "paint-before", "sample": sample["id"], "scale": scale}, {"stage": "paint-after", "sample": sample["id"], "scale": scale}])
        if labels != expected:
            raise RuntimeError("Trace driver labels omit or reorder original samples/DPRs")
        trace_observation = {"accepted": True, "rawStderrHash": digest(root / "trace-driver.stderr.log"), "stageCounts": counts, "driverLabels": len(labels), "browserEffectivePolicyVerified": False}
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        trace_observation["error"] = str(error)

    def compare(name, reference_kind, target_kind, scale):
        out = root / "comparisons" / name / ("scale-" + str(scale))
        out.mkdir(parents=True, exist_ok=True)
        record = {"name": name, "scale": scale, "valid": False, "accepted": False}
        try:
            paths = []
            identities = []
            for kind in [reference_kind, target_kind]:
                browser = kind == "browser"
                report = read(root / kind / ("browser-text.json" if browser else "native-text.json"))
                for field in ["sourceHash", "probeHash", "fixtureHash", "fontHash"]:
                    if report[field] != pin[field]:
                        raise RuntimeError("Comparison input belongs to another source")
                frame = frames(report, browser)[scale]
                screenshot = frame["screenshot"] if browser else frame
                if browser:
                    viewport = frame["viewport"]
                    if any(type(viewport.get(field)) is not int for field in ["width", "height", "scale"]) or viewport != {"width": 512, "height": 256, "scale": scale}:
                        raise RuntimeError("Browser viewport differs from the unchanged source")
                relative = pathlib.PurePosixPath(screenshot["path"])
                if relative.is_absolute() or ".." in relative.parts:
                    raise RuntimeError("Unsafe screenshot path")
                path = root / kind / relative
                if digest(path) != screenshot["hash"] or type(screenshot["width"]) is not int or type(screenshot["height"]) is not int or screenshot["width"] != 512 * scale or screenshot["height"] != 256 * scale:
                    raise RuntimeError("Current PNG identity or dimensions differ")
                paths.append(path)
                identities.append({"path": path.relative_to(root).as_posix(), "hash": digest(path)})
            command = [str(args.comparator.resolve()), "--reference", str(paths[0]), "--native", str(paths[1]), "--out", str(out / "diff.png")]
            completed = subprocess.run(command, capture_output=True, text=True)
            (out / "pixels.raw.json").write_text(completed.stdout)
            (out / "comparator.stderr.txt").write_text(completed.stderr)
            result = json.loads(completed.stdout, parse_constant=reject_constant)
            changed = result["changedPixels"]
            total = 512 * 256 * scale * scale
            integers = ["width", "height", "totalPixels", "changedPixels", "pixelsOverTolerance", "maxChannelDelta"]
            tolerance = result["tolerance"]
            if any(type(result[field]) is not int for field in integers) or not 0 <= changed <= total or not isinstance(tolerance, dict) or set(tolerance) != {"channel", "pixels"} or any(type(tolerance[field]) is not int or tolerance[field] != 0 for field in ["channel", "pixels"]) or result["width"] != 512 * scale or result["height"] != 256 * scale or result["totalPixels"] != total or type(result["exact"]) is not bool or type(result["accepted"]) is not bool or result["exact"] is not (changed == 0) or result["accepted"] is not (changed == 0) or completed.returncode != (0 if changed == 0 else 1):
                raise RuntimeError("Invalid zero-tolerance comparator result")
            if result["pixelsOverTolerance"] != changed or not 0 <= result["maxChannelDelta"] <= 255 or (result["maxChannelDelta"] == 0) != (changed == 0):
                raise RuntimeError("Comparator counters contradict zero-tolerance channel evidence")
            bounds = result["bounds"]
            if changed == 0:
                if bounds is not None:
                    raise RuntimeError("Exact comparison has nonempty difference bounds")
            elif not isinstance(bounds, dict) or set(bounds) != {"minX", "minY", "maxX", "maxY"} or any(type(bounds[field]) is not int for field in bounds) or not (0 <= bounds["minX"] <= bounds["maxX"] < 512 * scale and 0 <= bounds["minY"] <= bounds["maxY"] < 256 * scale):
                raise RuntimeError("Invalid actual difference bounds")
            record.update(valid=True, accepted=changed == 0, result=result, inputs=identities)
        except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
            record["error"] = str(error)
        (out / "result.json").write_text(json.dumps(record, indent=2) + "\n")
        return record

    # Neutrality is evaluated first, even when earlier browser evidence failed.
    results = [compare("control-trace", "control", "trace", scale) for scale in [1, 2]]
    neutral = metrics["accepted"] and trace_observation["accepted"] and all(result["accepted"] for result in results)
    if args.mode == "all":
        for name in ["control", "trace"]:
            results.extend(compare("browser-" + name, "browser", name, scale) for scale in [1, 2])
    accepted = neutral and all(result["accepted"] for result in results)
    summary = {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False, "browserEffectivePolicyVerified": False, "mode": args.mode, "accepted": accepted, "instrumentationNeutral": neutral, "nativeReportEquality": metrics, "traceObservation": trace_observation, "comparisons": results, "scope": "Passive standalone native scaler instrumentation; no Fyne widget/editor or browser-effective-policy claim"}
    (root / ("neutrality.json" if args.mode == "neutrality" else "summary.json")).write_text(json.dumps(summary, indent=2) + "\n")
    raise SystemExit(0 if accepted else 1)


if __name__ == "__main__":
    main()
