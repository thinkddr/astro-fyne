#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Strict full-frame evidence for this standalone native experiment only."""
import argparse, hashlib, json, pathlib, subprocess

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def frame_scales(frames, label, browser=False):
    if not isinstance(frames, list) or len(frames) != 2:
        raise RuntimeError(label + " must contain exactly two frames")
    indexed = {}
    for frame in frames:
        if not isinstance(frame, dict):
            raise RuntimeError(label + " frame must be an object")
        viewport = frame.get("viewport") if browser else frame
        scale = viewport.get("scale") if isinstance(viewport, dict) else None
        if type(scale) is not int or scale not in [1, 2] or scale in indexed:
            raise RuntimeError(label + " must contain distinct integer scales 1 and 2")
        indexed[scale] = frame
    return indexed

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=pathlib.Path, required=True)
    parser.add_argument("--comparator", type=pathlib.Path, required=True)
    args = parser.parse_args()
    root = args.evidence.resolve()
    browser = json.loads((root / "browser/browser-text.json").read_text())
    native = json.loads((root / "native/native-text.json").read_text())
    browser_frames = frame_scales(browser["cases"], "Browser", browser=True)
    native_frames = frame_scales(native["frames"], "Native")
    for name in ["sourceHash", "probeHash", "fixtureHash", "fontHash"]:
        if browser[name] != native[name]:
            raise RuntimeError("Native/browser original-source identity differs: " + name)
    failed = False
    results = []
    for scale in [1, 2]:
        web, painted = browser_frames[scale], native_frames[scale]
        viewport = web["viewport"]
        if any(type(viewport.get(name)) is not int or viewport[name] <= 0 for name in ["width", "height"]):
            raise RuntimeError("Invalid declared CSS viewport")
        width, height = viewport["width"] * scale, viewport["height"] * scale
        reference = root / "browser" / web["screenshot"]["path"]
        target = root / "native" / painted["path"]
        if digest(reference) != web["screenshot"]["hash"] or digest(target) != painted["hash"]:
            raise RuntimeError("Current PNG differs from native/browser screenshot identity")
        for screenshot in [painted, web["screenshot"]]:
            if type(screenshot.get("width")) is not int or type(screenshot.get("height")) is not int or (screenshot["width"], screenshot["height"]) != (width, height):
                raise RuntimeError("Native/browser screenshot dimensions differ from declared viewport")
        out = root / f"comparisons/scale-{scale}"
        out.mkdir(parents=True, exist_ok=True)
        command = [str(args.comparator.resolve()), "--reference", str(reference), "--native", str(target), "--out", str(out / "diff.png")]
        completed = subprocess.run(command, capture_output=True, text=True)
        (out / "comparator.stderr.txt").write_text(completed.stderr)
        # Preserve the raw answer even on execution/schema failure.
        (out / "pixels.raw.json").write_text(completed.stdout)
        result = json.loads(completed.stdout)
        if type(result.get("width")) is not int or type(result.get("height")) is not int or (result["width"], result["height"]) != (width, height):
            raise RuntimeError("Actual PNG comparator dimensions differ from declared viewport")
        changed = result["changedPixels"]
        if (type(changed) is not int or changed < 0 or type(result["exact"]) is not bool or type(result["accepted"]) is not bool
            or result["tolerance"] != {"channel": 0, "pixels": 0}
            or result["exact"] != (changed == 0) or result["accepted"] != (changed == 0)
            or completed.returncode != (0 if changed == 0 else 1)):
            raise RuntimeError("Invalid strict native-text comparison result")
        result["inputs"] = {"reference": {"path": reference.relative_to(root).as_posix(), "hash": digest(reference)}, "native": {"path": target.relative_to(root).as_posix(), "hash": digest(target)}}
        (out / "pixels.json").write_text(json.dumps(result, indent=2) + "\n")
        results.append({"scale": scale, **result})
        failed = failed or changed != 0
    (root / "summary.json").write_text(json.dumps({"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False, "browserEffectivePolicyVerified": False, "scope": "Standalone native Fontations/Skia/HarfBuzz/OTS probe; no Fyne widget, editor, inverse or GPU claim", "frames": results}, indent=2) + "\n")
    raise SystemExit(1 if failed else 0)

if __name__ == "__main__":
    main()
