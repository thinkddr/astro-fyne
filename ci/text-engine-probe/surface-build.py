#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Retain actual C ABI argv and check the three public-header compile contexts."""
import argparse
import hashlib
import json
import pathlib
import platform
import re
import shlex
import shutil
import subprocess
import sys

SKIA_SOURCES = ["src/core/SkBitmapDevice.cpp", "src/core/SkGlyphRunPainter.cpp"]
CARGO_SOURCES = [
    "src/ports/fontations/src/ffi.rs.cc", "src/ports/SkTypeface_fontations.cpp",
    "src/ports/SkFontScanner_fontations.cpp", "src/ports/SkTypeface_proxy.cpp",
]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def public_defines(argv):
    defines = []
    index = 0
    while index < len(argv):
        token = argv[index]
        if token.startswith(("@", "-include", "-imacros")):
            raise RuntimeError("Indirect compiler input is outside the declared public-header profile")
        if token in ["-D", "-U"]:
            index += 1
            if index == len(argv):
                raise RuntimeError("Incomplete public compiler definition")
            token += argv[index]
        if token.startswith(("-D", "-U")):
            name = token[2:].split("=", 1)[0]
            if name in ["SK_R32_SHIFT", "SK_G32_SHIFT", "SK_B32_SHIFT", "SK_A32_SHIFT",
                        "SK_CPU_BENDIAN", "SK_USER_CONFIG_HEADER"]:
                defines.append(token)
        index += 1
    if defines != ["-DSK_R32_SHIFT=16"]:
        raise RuntimeError("Actual compiler argv must define only SK_R32_SHIFT=16 for public color order")


def compile_sources(commands, expected):
    selected = {}
    for argv in commands:
        if "-c" not in argv:
            continue
        position = argv.index("-c") + 1
        if position >= len(argv):
            raise RuntimeError("Compile command has no source")
        source = argv[position]
        for suffix in expected:
            if source == suffix or source.endswith("/" + suffix):
                if suffix in selected:
                    raise RuntimeError("Duplicate actual compile command: " + suffix)
                public_defines(argv)
                selected[suffix] = argv
    if set(selected) != set(expected):
        raise RuntimeError("Missing actual public-header compile command")
    return selected


def cargo_commands(text):
    prefix = "[astro-fyne-fontations-experiment 0.0.0] running: "
    return [shlex.split(line[len(prefix):]) for line in text.splitlines()
            if line.startswith(prefix)]


def validate_cabi(receipt):
    if (type(receipt.get("schema")) is not int or receipt["schema"] != 1
            or type(receipt.get("returncode")) is not int or receipt["returncode"] != 0
            or receipt.get("diagnosticOnly") is not True or receipt.get("pixelPerfectVerified") is not False
            or receipt.get("compilerHashBefore") != receipt.get("compilerHashAfter")
            or not re.fullmatch(r"[0-9a-f]{64}", receipt.get("compilerHashBefore", ""))):
        raise RuntimeError("C ABI compilation did not finish with a stable identified compiler")
    argv = receipt.get("argv")
    if not isinstance(argv, list) or not all(isinstance(part, str) for part in argv):
        raise RuntimeError("Missing actual C ABI argv")
    public_defines(argv)
    if sum(part.endswith("/text_engine.cc") for part in argv) != 1:
        raise RuntimeError("C ABI argv must compile the actual text engine once")


def compile_cabi(receipt_path, argv):
    if not argv:
        raise RuntimeError("Missing C ABI compiler argv")
    compiler = pathlib.Path(shutil.which(argv[0]) or argv[0]).resolve(strict=True)
    receipt = {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
               "cwd": str(pathlib.Path.cwd()), "argv": argv, "compiler": str(compiler),
               "compilerHashBefore": digest(compiler), "compilerHashAfter": None,
               "returncode": None}
    write(receipt_path, receipt)
    print("Actual C ABI command: " + shlex.join(argv), flush=True)
    try:
        completed = subprocess.run(argv, check=False)
        receipt["returncode"] = completed.returncode
    finally:
        receipt["compilerHashAfter"] = digest(compiler)
        write(receipt_path, receipt)
    if receipt["returncode"] != 0:
        raise SystemExit(receipt["returncode"] if receipt["returncode"] > 0 else 1)


def verify(work):
    if platform.system() != "Linux" or platform.machine() not in ["aarch64", "arm64"]:
        raise RuntimeError("This surface build contract is restricted to Linux ARM64")
    evidence = work / "evidence"
    skia = evidence / "skia-commands.txt"
    cargo = evidence / "cargo-build.log"
    cabi = evidence / "cabi-command.json"
    selected_skia = compile_sources([shlex.split(line) for line in skia.read_text().splitlines()], SKIA_SOURCES)
    selected_cargo = compile_sources(cargo_commands(cargo.read_text()), CARGO_SOURCES)
    cabi_receipt = json.loads(cabi.read_text())
    validate_cabi(cabi_receipt)
    selected = {"skia": selected_skia, "cargo": selected_cargo, "cabi": cabi_receipt}
    inputs = ["assembly/build.rs", "assembly/text_engine.cc", "assembly/text_engine.h",
              "skia/BUILD.gn", "skia/include/core/SkTypes.h", "skia/include/core/SkColorType.h",
              "skia/src/core/SkGlyphRunPainter.cpp", "skia/src/core/SkBitmapDevice.cpp"]
    report = {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
              "nativeScalerInternalsObserved": False, "system": platform.system(),
              "machine": platform.machine(), "requiredR32Shift": 16,
              "libraryHash": digest(evidence / "libastro_fyne_text_experiment.so"),
              "scope": "Observed SkBitmapDevice/SkGlyphRunPainter GN argv, four named Cargo CXX consumers and final C ABI argv; not all Skia translation units or actual glyph masks",
              "receiptHashes": {path.name: digest(path) for path in [skia, cargo, cabi]},
              "sourceHashes": {path: digest(work / path) for path in inputs},
              "commands": selected}
    write(evidence / "surface-build-contract.json", report)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    compile_parser = sub.add_parser("compile")
    compile_parser.add_argument("--receipt", type=pathlib.Path, required=True)
    compile_parser.add_argument("argv", nargs=argparse.REMAINDER)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--work", type=pathlib.Path, required=True)
    args = parser.parse_args()
    if args.command == "compile":
        argv = args.argv[1:] if args.argv and args.argv[0] == "--" else args.argv
        compile_cabi(args.receipt, argv)
    else:
        verify(args.work.resolve(strict=True))


if __name__ == "__main__":
    main()
