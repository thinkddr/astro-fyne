#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Bind each N32 report to its actual compile receipts and copied sources."""
import hashlib
import importlib.util
import json
import math
import pathlib
import shlex

HERE = pathlib.Path(__file__).resolve().parent
PROBE = HERE.parent / "text-engine-probe"


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


surface_build = module("trace_surface_build", PROBE / "surface-build.py")
driver = module("trace_control_driver", PROBE / "driver.py")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    def reject(value):
        raise ValueError("Nonfinite contract number: " + value)
    return json.loads(path.read_text(), parse_constant=reject)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def requested_policy(report, path):
    policy = read(path)
    if report.get("policyHash") != digest(path) or canonical(report.get("requestedPolicy")) != canonical(policy):
        raise RuntimeError("Native typed requested policy differs from current bytes")
    values = {name: policy[name] for name in driver.POLICY_FIELDS}
    if any(type(value) is not int for value in values.values()):
        raise RuntimeError("Current policy enum/boolean values must be integers")
    for name in ["contrast", "gamma"]:
        value = policy[name]
        if type(value) not in [int, float] or not math.isfinite(value):
            raise RuntimeError("This N32 policy requires explicit finite gamma/contrast")
        values[name] = value
    expected = driver.fields(driver.Policy(**values))
    if canonical(report.get("nativePolicy")) != canonical(expected):
        raise RuntimeError("Native float32 requests differ from the current typed policy")
    return policy


def fontconfig_binding(root, work, policy):
    expected = policy.get("fontconfigExpected")
    keys = {"antialias", "autohint", "embeddedbitmap", "hinting", "hintstyle", "rgba"}
    if not isinstance(expected, dict) or set(expected) != keys or any(type(value) is not int for value in expected.values()):
        raise RuntimeError("Invalid current typed Fontconfig expectations")
    path = root / "fontconfig/fontconfig.json"
    config = read(path)
    if not isinstance(config, dict):
        raise RuntimeError("Fontconfig observation must be an object")
    bound = config.get("requestPolicyBinding")
    if (type(config.get("schema")) is not int or config["schema"] != 1
            or config.get("diagnosticOnly") is not True or config.get("browserEffectivePolicyVerified") is not False
            or config.get("pixelPerfectVerified") is not False or config.get("policyAppliedToNative") is not False
            or config.get("configEntriesStable") is not True or not isinstance(bound, dict)
            or bound.get("sha256") != digest(PROBE / "policy.json")
            or bound.get("expectedPropertiesMatched") is not True
            or canonical(bound.get("expectedProperties")) != canonical(expected)):
        raise RuntimeError("Fontconfig sidecar is not bound to the current native request policy")
    if (config.get("observerHash") != digest(PROBE / "observe-fontconfig.py")
            or canonical(config.get("sourcePins")) != canonical(read(PROBE / "font-policy-source-pin.json"))
            or config.get("sourceManifestHash") != digest(work / "sources.json")):
        raise RuntimeError("Fontconfig observer/source identities differ from current inputs")
    observed = config.get("emptyQueryResult")
    if not isinstance(observed, dict) or not isinstance(observed.get("properties"), dict):
        raise RuntimeError("Fontconfig properties are missing")
    for name, value in expected.items():
        actual = observed["properties"].get(name)
        if (not isinstance(actual, dict) or type(actual.get("result")) is not int or actual["result"] != 0
                or actual.get("present") is not True or type(actual.get("value")) is not int or actual["value"] != value):
            raise RuntimeError("Fontconfig observation differs from current typed request: " + name)
    return {"accepted": True, "reportHash": digest(path), "requestPolicyHash": bound["sha256"],
            "sourceManifestHash": config["sourceManifestHash"], "expectedPropertiesMatched": True}


def binding(work, root, report, traced, pin):
    own = work / "trace" if traced else work
    evidence = own / "evidence"
    library = evidence / "libastro_fyne_text_experiment.so"
    contract_path = evidence / "surface-build-contract.json"
    contract = read(contract_path)
    if not isinstance(contract, dict):
        raise RuntimeError("Surface build contract must be an object")
    if (root / "surface-build-contract.json").read_bytes() != contract_path.read_bytes():
        raise RuntimeError("Driver copied a different surface build contract")
    if report.get("surfaceBuildContractHash") != digest(contract_path):
        raise RuntimeError("Report surface contract hash differs from the actual file")
    if report.get("libraryHash") != digest(library):
        raise RuntimeError("Contract/report library differs from the actual binary")
    current_sources = {name: digest(own / "assembly" / name)
                       for name in ["build.rs", "text_engine.cc", "text_engine.h"]}
    driver.validate_surface_contract(contract, digest(library), current_sources)
    for name in ["text_engine.cc", "text_engine.h"]:
        if current_sources[name] != pin["controlInputs"]["ci/text-engine-probe/" + name]["sha256"]:
            raise RuntimeError("Trace changed the current N32 engine/header source")
    variant = "instrumented" if traced else "original"
    if current_sources["build.rs"] != pin["files"]["build.rs." + variant]["sha256"]:
        raise RuntimeError("Contract has the wrong current/copied build script")
    source_names = ["assembly/build.rs", "assembly/text_engine.cc", "assembly/text_engine.h",
                    "skia/BUILD.gn", "skia/include/core/SkTypes.h", "skia/include/core/SkColorType.h",
                    "skia/src/core/SkGlyphRunPainter.cpp", "skia/src/core/SkBitmapDevice.cpp"]
    if contract.get("sourceHashes") != {name: digest(own / name) for name in source_names}:
        raise RuntimeError("Surface contract compiled-source hashes differ")
    receipt_names = ["skia-commands.txt", "cargo-build.log", "cabi-command.json"]
    if contract.get("receiptHashes") != {name: digest(evidence / name) for name in receipt_names}:
        raise RuntimeError("Surface contract receipt hashes differ from actual compiler logs")
    if (evidence / "skia-commands.txt").read_bytes() != (work / "evidence/skia-commands.txt").read_bytes():
        raise RuntimeError("Trace changed original GN compile receipts")
    skia = surface_build.compile_sources(
        [shlex.split(line) for line in (evidence / "skia-commands.txt").read_text().splitlines()],
        surface_build.SKIA_SOURCES)
    cargo = surface_build.compile_sources(
        surface_build.cargo_commands((evidence / "cargo-build.log").read_text()),
        surface_build.CARGO_SOURCES)
    cabi = read(evidence / "cabi-command.json")
    if not isinstance(cabi, dict):
        raise RuntimeError("C ABI receipt must be an object")
    surface_build.validate_cabi(cabi)
    if digest(pathlib.Path(cabi["compiler"])) != cabi["compilerHashBefore"]:
        raise RuntimeError("C ABI receipt does not bind the current compiler")
    if contract.get("commands") != {"skia": skia, "cargo": cargo, "cabi": cabi}:
        raise RuntimeError("Surface contract selected commands differ from actual receipts")
    argv = cabi["argv"]
    if pathlib.Path(next(part for part in argv if part.endswith("/text_engine.cc"))).resolve() != (own / "assembly/text_engine.cc").resolve():
        raise RuntimeError("C ABI compiled a different engine source")
    if argv.count("-o") != 1 or argv.index("-o") + 1 >= len(argv):
        raise RuntimeError("C ABI receipt has no single output operand")
    if pathlib.Path(argv[argv.index("-o") + 1]).resolve() != library.resolve():
        raise RuntimeError("C ABI receipt produced a different library")
    archives = [work / "skia/out/text-probe/libskia.a", work / "harfbuzz/out/libharfbuzz.a",
                work / "ots/out/libots.a", own / ("target/release/libastro_fyne_fontations_experiment.a"
                if traced else "assembly/target/release/libastro_fyne_fontations_experiment.a")]
    if any(argv.count(str(path)) != 1 for path in archives):
        raise RuntimeError("Trace did not link the declared shared native archives")
    scaler = (own / "copied-skia" if traced else work / "skia") / pin["fontationsSource"]["path"]
    if digest(scaler) != pin["files"]["SkTypeface_fontations.cpp." + variant]["sha256"]:
        raise RuntimeError("Actual scaler source differs from its declared copy")
    selected_sources = {}
    for name, command in cargo.items():
        diagnostic = [part for part in command if part.startswith("-DATF_DIAGNOSTIC_SCALER_TRACE")]
        if diagnostic != (["-DATF_DIAGNOSTIC_SCALER_TRACE"] if traced else []):
            raise RuntimeError("Actual Cargo trace define differs from its variant")
        actual_source = pathlib.Path(command[command.index("-c") + 1])
        if not actual_source.is_absolute():
            actual_source = own / "assembly" / actual_source
        actual_source = actual_source.resolve(strict=True)
        if name == pin["fontationsSource"]["path"] and actual_source != scaler.resolve():
            raise RuntimeError("Cargo compiled a different scaler source")
        selected_sources[name] = digest(actual_source)
    return {"accepted": True, "contractHash": digest(contract_path), "libraryHash": digest(library),
            "sourceHashes": contract["sourceHashes"], "receiptHashes": contract["receiptHashes"],
            "selectedCargoSourceHashes": selected_sources, "threeCompileContextsVerified": True}


def surfaces(report, probe):
    values = report.get("frames")
    if not isinstance(values, list) or len(values) != 2:
        raise RuntimeError("Native report requires both original DPR frames")
    sample_ids = [sample["id"] for sample in probe["samples"]]
    if len(sample_ids) != 7 or len(set(sample_ids)) != 7:
        raise RuntimeError("Expected seven unique original probe rows")
    if (not isinstance(report.get("samples"), list)
            or any(not isinstance(sample, dict) for sample in report["samples"])
            or [sample.get("id") for sample in report["samples"]] != sample_ids):
        raise RuntimeError("Native report omitted/reordered original shaped rows")
    for frame, scale in zip(values, [1, 2], strict=True):
        if not isinstance(frame, dict):
            raise RuntimeError("Native surface frame must be an object")
        records = frame.get("surfaces")
        width, height = 512 * scale, 256 * scale
        if (type(frame.get("scale")) is not int or frame["scale"] != scale
                or type(frame.get("width")) is not int or frame["width"] != width
                or type(frame.get("height")) is not int or frame["height"] != height
                or not isinstance(records, list) or len(records) != 7
                or any(not isinstance(record, dict) for record in records)
                or [record.get("sampleId") for record in records] != sample_ids):
            raise RuntimeError("Native report omitted/reordered an actual N32 surface")
        for record in records:
            driver.validate_surface_record({name: value for name, value in record.items()
                                            if name != "sampleId"}, width, height, report["nativePolicy"])
    return 14
