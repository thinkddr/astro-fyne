#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Validate and retain the Fyne module actually selected by the native build."""

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def module_tree_checksum(directory, prefix):
    # Go Hash1/HashDir: sorted canonical names, SHA-256 per file, then SHA-256
    # of their hexadecimal digests and names. This is not the raw ZIP hash.
    # Source: Go1.27.2 cmd/vendor/golang.org/x/mod/sumdb/dirhash/hash.go.
    files = []
    for path in directory.rglob("*"):
        require(not path.is_symlink(), "Unexpected symlink in the public module cache")
        if path.is_dir():
            continue
        require(path.is_file(), "Unexpected non-file in the public module cache")
        name = prefix + "/" + path.relative_to(directory).as_posix()
        require("\n" not in name, "Module Hash1 does not support newlines in names")
        files.append((name, path))
    require(files, "The selected public module tree is empty")
    digest = hashlib.sha256()
    total = 0
    for name, path in sorted(files):
        content = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                content.update(chunk)
                total += len(chunk)
        digest.update((content.hexdigest() + "  " + name + "\n").encode("utf-8"))
    return {
        "algorithm": "Go dirhash.Hash1/HashDir",
        "prefix": prefix,
        "h1": "h1:" + base64.b64encode(digest.digest()).decode("ascii"),
        "files": len(files),
        "bytes": total,
    }


def read_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(path.read_text(), object_pairs_hook=pairs)


def read_stream(path, key):
    decoder = json.JSONDecoder()
    remaining = path.read_text()
    result = {}
    while remaining.strip():
        remaining = remaining.lstrip()
        value, end = decoder.raw_decode(remaining)
        remaining = remaining[end:]
        require(isinstance(value, dict) and isinstance(value.get(key), str),
                f"Invalid {path.name} record")
        require(value[key] not in result, f"Duplicate {key}: {value[key]}")
        result[value[key]] = value
    require(result, f"Empty {path.name}")
    return result


def public_identity(module):
    replacement = module.get("Replace")
    return {
        "path": module["Path"],
        "version": module.get("Version"),
        "sum": module.get("Sum"),
        "goModSum": module.get("GoModSum"),
        "replacement": public_identity(replacement) if replacement else None,
    }


def version_identity(module):
    replacement = module.get("Replace")
    return {
        "path": module["Path"],
        "version": module.get("Version"),
        "replacement": version_identity(replacement) if replacement else None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--pin", required=True, type=Path)
    parser.add_argument("--phase", required=True, choices=("initial", "final"))
    args = parser.parse_args()
    root, evidence = args.root.resolve(), args.evidence.resolve()
    pin = read_json(args.pin)
    require(pin.get("schema") == 1, "Expected production pin schema 1")
    require(os.environ.get("GOWORK") == "off", "Production mode requires GOWORK=off")
    require(os.environ.get("GOFLAGS") == "-mod=readonly",
            "Production mode requires GOFLAGS=-mod=readonly without a modfile")
    expected = pin.get("replacement", {})
    require(expected.get("path") == "github.com/thinkddr/fyne/v2",
            "Expected the public Fyne release module")
    require(isinstance(expected.get("version"), str) and
            re.fullmatch(r"v\d+\.\d+\.\d+-sytue\.\d+", expected["version"]),
            "Resolve the production release version after publication")
    for field in ("sum", "goModSum"):
        require(isinstance(expected.get(field), str) and
                re.fullmatch(r"h1:[A-Za-z0-9+/]{43}=", expected[field]),
                f"Resolve the published module {field} before enabling the gate")
    suffix = "" if args.phase == "initial" else "-final"
    modules_path = evidence / f"native-modules{suffix}.jsonl"
    packages_path = evidence / f"native-painter-packages{suffix}.jsonl"
    modules = read_stream(modules_path, "Path")
    packages = read_stream(packages_path, "ImportPath")
    selected = modules.get("fyne.io/fyne/v2")
    require(selected is not None, "The native graph does not select Fyne")
    require(selected["Path"] == pin["logicalModule"]["path"] and
            selected.get("Version") == pin["logicalModule"]["version"],
            "Logical Fyne module differs from the production pin")
    replacement = selected.get("Replace")
    require(isinstance(replacement, dict), "Expected the adopted public release replacement")
    require(not replacement.get("Replace"), "Nested Fyne replacement is unsupported")
    for key, expected_key in (("Path", "path"), ("Version", "version")):
        require(replacement.get(key) == expected[expected_key],
                f"Selected public Fyne {key} differs from the production pin")
    checksum_lines = {}
    for line in (root / "native/go.sum").read_text().splitlines():
        path, version, checksum = line.split()
        if (path, version) in checksum_lines:
            require(checksum_lines[path, version] == checksum,
                    "Conflicting production module checksums")
        checksum_lines[path, version] = checksum
    for key, expected_key, suffix in (("Sum", "sum", ""),
                                      ("GoModSum", "goModSum", "/go.mod")):
        require(checksum_lines.get((expected["path"], expected["version"] + suffix)) == expected[expected_key],
                f"Committed production checksum differs: {expected_key}")
        if replacement.get(key):
            require(replacement[key] == expected[expected_key],
                    f"Resolved public Fyne {key} differs from the production pin")
    for module in modules.values():
        if module.get("Replace"):
            require(module["Replace"].get("Version"),
                    f"Unversioned replacement in the production graph: {module['Path']}")
    require(isinstance(replacement.get("Dir"), str), "Selected Fyne source is not downloaded")
    module_dir = Path(replacement["Dir"]).resolve()
    tree = module_tree_checksum(module_dir, expected["path"] + "@" + expected["version"])
    require(tree["h1"] == expected["sum"],
            "The actual extracted public Fyne tree differs from its release checksum")
    painter_dir = module_dir / "internal/painter/software"
    package = packages.get("fyne.io/fyne/v2/internal/painter/software")
    require(package is not None and Path(package["Dir"]).resolve() == painter_dir,
            "The native painter did not resolve to the selected public module")
    require(version_identity(package["Module"]) == version_identity(selected),
            "Painter package/module metadata differs from the selected graph")
    source_files = package.get("GoFiles", []) + package.get("CgoFiles", [])
    require(source_files and len(set(source_files)) == len(source_files),
            "Missing or duplicate compiled painter source files")
    hashes = {}
    for name in source_files:
        require(isinstance(name, str) and Path(name).name == name,
                "Unsafe compiled source filename")
        path = painter_dir / name
        require(path.resolve().parent == painter_dir, "Compiled source escaped the painter")
        hashes[name] = sha256(path)
    require({"draw.go", "skia_legacy_enlargement.go"}.issubset(pin.get("softwareSourceFiles", {})),
            "Production pin must bind the draw routing and sampler helper")
    for name, digest in pin["softwareSourceFiles"].items():
        require(isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest),
                f"Resolve the release source digest: {name}")
        require(hashes.get(name) == digest, f"Production painter source differs: {name}")
    licenses = {}
    require({"LICENSE", "LICENSE-Skia.txt"}.issubset(pin.get("licenses", {})),
            "Production pin must retain the Fyne and Skia notices")
    for name, digest in pin["licenses"].items():
        require(Path(name).name == name, "Unsafe license filename")
        require(isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest),
                f"Resolve the release license digest: {name}")
        licenses[name] = sha256(module_dir / name)
        require(licenses[name] == digest, f"Production license differs: {name}")
    identities = {name: version_identity(module) for name, module in sorted(modules.items())}
    production = {name: sha256(root / "native" / name) for name in ("go.mod", "go.sum")}
    result = {
        "schema": 1, "mode": "production", "phase": args.phase,
        "usesAdoptedDependency": True, "temporaryFyneReplacement": False,
        "pinSHA256": sha256(args.pin), "selectedFyne": public_identity(selected),
        "moduleChecksums": {"sum": expected["sum"], "goModSum": expected["goModSum"]},
        "resolvedReplacementTree": tree,
        "softwareSourceFiles": hashes, "licenses": licenses,
        "moduleVersionIdentities": identities,
        "productionModuleFiles": production,
        "moduleListSHA256": sha256(modules_path),
        "painterPackageListSHA256": sha256(packages_path),
        "converterResolvedImageModule": public_identity(modules["golang.org/x/image"]),
    }
    if args.phase == "final":
        initial = read_json(evidence / "production-provenance-initial.json")
        for key in ("pinSHA256", "moduleChecksums", "resolvedReplacementTree", "softwareSourceFiles", "licenses",
                    "moduleVersionIdentities", "productionModuleFiles"):
            require(result[key] == initial[key], f"Production provenance changed during the gate: {key}")
    else:
        destination = evidence / "production-painter"
        destination.mkdir(parents=True, exist_ok=True)
        for name in hashes:
            shutil.copy2(painter_dir / name, destination / name)
        for name in licenses:
            shutil.copy2(module_dir / name, destination / name)
        shutil.copy2(args.pin, evidence / "production-pin.json")
    (evidence / f"production-provenance-{args.phase}.json").write_text(
        json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
