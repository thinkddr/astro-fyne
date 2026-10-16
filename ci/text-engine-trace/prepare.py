#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Prepare copied trace inputs and verify unchanged primary source inventories."""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess

HERE = pathlib.Path(__file__).resolve().parent


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(data)
    return value.hexdigest()


def inventory(root):
    entries = {}
    for directory, dirs, files in os.walk(root):
        dirs[:] = sorted(name for name in dirs if name not in [".git", "out", "target", "__pycache__"])
        for name in dirs + sorted(files):
            path = pathlib.Path(directory) / name
            key = path.relative_to(root).as_posix()
            if path.is_symlink():
                entries[key] = {"kind": "symlink", "target": os.readlink(path)}
            elif path.is_dir():
                entries[key] = {"kind": "directory"}
            elif path.is_file():
                entries[key] = {"kind": "file", "bytes": path.stat().st_size, "hash": digest(path)}
            else:
                raise RuntimeError("Unsupported source inventory entry: " + str(path))
    return entries


def primary_inventory(work):
    return {name: inventory(work / name) for name in ["skia", "harfbuzz", "ots"]}


def checked(path, identity):
    if digest(path) != identity["sha256"] or path.stat().st_size != identity["length"]:
        raise RuntimeError("Source pin mismatch: " + str(path))


def apply(directory, patch):
    subprocess.run(["patch", "--batch", "--fuzz=0", "-p1", "-i", str(patch)], cwd=directory, check=True)


def write(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=pathlib.Path, required=True)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--check-inputs", action="store_true")
    args = parser.parse_args()
    work = args.work.resolve(strict=True)
    evidence = work / "evidence"
    trace = work / "trace"
    pin = json.loads((HERE / "source-pin.json").read_text())
    for name, identity in pin["controlInputs"].items():
        checked(HERE.parents[1] / name, identity)
    inputs = ["fontations-passive-trace.patch", "cargo-trace-source.patch", "driver-stage-labels.patch", "LICENSE-Skia.txt"]
    for name in inputs:
        checked(HERE / name, pin["files"][name])
    checked(work / "skia" / pin["fontationsSource"]["path"], pin["files"]["SkTypeface_fontations.cpp.original"])
    for name in ["build.rs", "driver.py"]:
        checked(work / "assembly" / name, pin["files"][name + ".original"])
    if args.check_inputs:
        return
    if args.verify:
        before = json.loads((evidence / "primary-sources-before-trace.json").read_text())
        after = primary_inventory(work)
        write(evidence / "primary-sources-after-trace.json", after)
        if before != after:
            raise RuntimeError("Primary source checkout changed during instrumentation")
        proof = json.loads((evidence / "trace-preparation.json").read_text())
        for name, expected in [("assembly", proof["controlAssemblyInventoryHash"]), ("trace/assembly", proof["traceAssemblyInventoryHash"])]:
            actual = hashlib.sha256(json.dumps(inventory(work / name), sort_keys=True).encode()).hexdigest()
            if actual != expected:
                raise RuntimeError("Assembly source inputs changed: " + name)
        checked(trace / "copied-skia" / pin["fontationsSource"]["path"], pin["files"]["SkTypeface_fontations.cpp.instrumented"])
        for name, identity in proof["preserved"].items():
            if digest(pathlib.Path(name)) != identity:
                raise RuntimeError("Control binary, archive, lock or policy changed: " + name)
        if subprocess.check_output(["rustc", "-vV"], text=True) != proof["rustcVerbose"]:
            raise RuntimeError("Rust toolchain identity changed")
        write(evidence / "source-neutrality.json", {"schema": 1, "primarySourcesUnchanged": True, "controlInputsUnchanged": True, "sourceInventoryHash": digest(evidence / "primary-sources-before-trace.json")})
        return
    if trace.exists():
        raise RuntimeError("Trace preparation requires a fresh destination")
    sources = json.loads((work / "sources.json").read_text())
    if sources["sources"]["skia"]["revision"] != pin["skiaRevision"] or sources["chromiumCommit"] != pin["chromiumRevision"]:
        raise RuntimeError("Resolved primary revisions differ from trace pins")
    source = work / "skia" / pin["fontationsSource"]["path"]
    checked(source, pin["files"]["SkTypeface_fontations.cpp.original"])
    if digest(work / "skia/LICENSE") != digest(HERE / "LICENSE-Skia.txt"):
        raise RuntimeError("Copied Skia notice differs from the pinned source checkout")
    for name in ["build.rs", "driver.py"]:
        checked(work / "assembly" / name, pin["files"][name + ".original"])
    write(evidence / "primary-sources-before-trace.json", primary_inventory(work))
    assembly = trace / "assembly"
    shutil.copytree(work / "assembly", assembly, ignore=shutil.ignore_patterns("target", "__pycache__"))
    copied = trace / "copied-skia" / pin["fontationsSource"]["path"]
    copied.parent.mkdir(parents=True)
    shutil.copyfile(source, copied)
    apply(trace / "copied-skia", HERE / inputs[0])
    apply(assembly, HERE / inputs[1])
    apply(assembly, HERE / inputs[2])
    checked(copied, pin["files"]["SkTypeface_fontations.cpp.instrumented"])
    for name in ["build.rs", "driver.py"]:
        checked(assembly / name, pin["files"][name + ".instrumented"])
    before = inventory(work / "assembly")
    after = inventory(assembly)
    expected = {name: value for name, value in before.items() if name not in ["build.rs", "driver.py"]}
    if expected != {name: value for name, value in after.items() if name not in ["build.rs", "driver.py"]}:
        raise RuntimeError("Trace assembly changed inputs beyond the two declared patches")
    # The current surface-build verifier reads this shared source tree without
    # modifying it; only the scaler translation unit is selected from its copy.
    (trace / "skia").symlink_to(work / "skia", target_is_directory=True)
    preserved = [work / "evidence/libastro_fyne_text_experiment.so", work / "skia/out/text-probe/libskia.a", work / "harfbuzz/out/libharfbuzz.a", work / "ots/out/libots.a", work / "assembly/Cargo.lock", work / "sources.json", HERE.parent / "text-engine-probe/policy.json"]
    preserved.extend(work / "evidence" / name for name in ["skia-commands.txt", "cargo-build.log", "cabi-command.json", "surface-build-contract.json"])
    tools = {name: str(pathlib.Path(shutil.which(name)).resolve(strict=True)) for name in ["clang", "clang++", "llvm-ar", "llvm-nm", "ninja", "cmake", "meson", "rustc", "cargo"]}
    if shutil.which("rustup"):
        for name in ["rustc", "cargo"]:
            tools["rustup-" + name] = subprocess.check_output(["rustup", "which", name], text=True).strip()
    preserved.extend(pathlib.Path(path) for path in tools.values())
    proof = {"schema": 1, "diagnosticOnly": True, "sourcePinHash": digest(HERE / "source-pin.json"), "copiedScalerSource": {"path": str(copied), "hash": digest(copied)}, "controlAssemblyInventoryHash": hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(), "traceAssemblyInventoryHash": hashlib.sha256(json.dumps(after, sort_keys=True).encode()).hexdigest(), "tools": tools, "rustcVerbose": subprocess.check_output(["rustc", "-vV"], text=True), "preserved": {str(path): digest(path) for path in preserved}}
    write(evidence / "trace-preparation.json", proof)
    (trace / "evidence").mkdir()
    shutil.copyfile(HERE / "source-pin.json", trace / "evidence/source-pin.json")
    for name in inputs:
        shutil.copyfile(HERE / name, trace / "evidence" / name)


if __name__ == "__main__":
    main()
