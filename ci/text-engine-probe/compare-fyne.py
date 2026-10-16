#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Strict original-source Fyne text evidence with explicit fork/library bindings."""
import argparse
import base64
import copy
import hashlib
import json
import math
import os
import pathlib
import re
import shutil
import struct
import subprocess
import tempfile
import zipfile

from compare import frame_scales


FYNE_SOURCE_NAMES = {"canvas/text.go", "canvas/text_layout.go", "canvas/text_layout_test.go",
    "internal/painter/gl/draw.go", "internal/painter/gl/text_layout_test.go",
    "internal/painter/software/draw.go", "internal/painter/software/text_layout.go",
    "internal/painter/software/text_layout_integration_test.go", "internal/painter/software/text_layout_test.go",
    "go.mod", "go.sum", "LICENSE"}


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


def verify_binary_module(data, pin):
    lines = [line.strip().split("\t") for line in data.decode("utf-8").splitlines()]
    module = pin["module"]
    selected = [index for index, line in enumerate(lines)
                if len(line) >= 2 and line[:2] == ["dep", module["canonicalPath"]]]
    require(len(selected) == 1 and lines[selected[0]][2:] == [module["canonicalVersion"]]
            and selected[0] + 1 < len(lines)
            and lines[selected[0] + 1] == ["=>", module["path"], module["version"], module["sum"]],
            "The actual provider binary did not compile the pinned public Fyne release")


def selected_modules(path):
    values, text = [], path.read_text()
    decoder = json.JSONDecoder()
    while text.strip():
        value, used = decoder.raw_decode(text.lstrip())
        require(isinstance(value, dict), "Invalid selected module record")
        values.append(value)
        text = text.lstrip()[used:]
    return values


def public_pin(repository):
    pin = read(repository / "ci/text-engine-probe/fyne-hook-pin.json")
    require(type(pin.get("schema")) is int and pin["schema"] == 1
            and pin.get("repository") == "https://github.com/thinkddr/fyne.git"
            and all(isinstance(pin.get(key), str) and re.fullmatch(r"[0-9a-f]{40}", pin[key])
                    for key in ["revision", "tree", "tagObject"])
            and set(pin.get("sourceHashes", {})) == FYNE_SOURCE_NAMES
            and all(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value)
                    for value in pin["sourceHashes"].values()), "Invalid exact public Fyne source pin")
    module = pin.get("module", {})
    require(module.get("path") == "github.com/thinkddr/fyne/v2"
            and module.get("canonicalPath") == "fyne.io/fyne/v2"
            and module.get("canonicalVersion") == "v2.8.1"
            and module.get("version") == "v2.8.1-sytue.19"
            and all(isinstance(module.get(key), str) and re.fullmatch(r"h1:[A-Za-z0-9+/]{43}=", module[key])
                    for key in ["sum", "goModSum"])
            and isinstance(module.get("zipSHA256"), str)
            and re.fullmatch(r"[0-9a-f]{64}", module["zipSHA256"]), "Invalid published Fyne module pin")
    return pin


def hash1(entries):
    result = hashlib.sha256()
    for name, content in sorted(entries):
        require("\n" not in name, "Invalid newline in Go module Hash1 name")
        result.update((hashlib.sha256(content).hexdigest() + "  " + name + "\n").encode())
    return "h1:" + base64.b64encode(result.digest()).decode("ascii")


def git_object(kind, data):
    return hashlib.sha1(kind.encode() + b" " + str(len(data)).encode() + b"\0" + data).hexdigest()


def verify_public_identity(provider, pin):
    commit, tag = [(provider / name).read_bytes() for name in ["fyne-commit.txt", "fyne-tag.txt"]]
    neutral = b"Fyne contributors <contributors@fyne.invalid> "
    require(git_object("commit", commit) == pin["revision"]
            and commit.startswith(("tree " + pin["tree"] + "\n").encode())
            and git_object("tag", tag) == pin["tagObject"]
            and tag.startswith(("object " + pin["revision"] + "\ntype commit\ntag " + pin["module"]["version"] + "\n").encode())
            and all(any(line.startswith(key + neutral) for line in commit.splitlines())
                    for key in [b"author ", b"committer "])
            and any(line.startswith(b"tagger " + neutral) for line in tag.splitlines())
            and b"\ngpgsig " not in commit and b"-----BEGIN " not in tag,
            "Public Fyne tag/commit must retain their pinned neutral unsigned identity")


def public_module(repository, provider, retain=False):
    """Verify both downloaded bytes and the cache tree used by the actual build."""
    pin = public_pin(repository)
    expected = pin["module"]
    if retain:
        shutil.copyfile(repository / "ci/text-engine-probe/fyne-hook-pin.json", provider / "fyne-hook-pin.json")
    require((provider / "fyne-hook-pin.json").read_bytes()
            == (repository / "ci/text-engine-probe/fyne-hook-pin.json").read_bytes(), "Retained Fyne pin changed")
    verify_public_identity(provider, pin)
    download = read(provider / "module-download.json")
    require(not download.get("Error") and download.get("Path") == expected["path"]
            and download.get("Version") == expected["version"]
            and download.get("Sum") == expected["sum"] and download.get("GoModSum") == expected["goModSum"],
            "Actual Go download is not the pinned published Fyne module")
    cache = pathlib.Path(download.get("Dir", ""))
    require(cache.is_absolute() and cache.is_dir() and not cache.is_symlink(), "Missing actual public module cache directory")
    for key, name in [("Zip", "module.zip"), ("GoMod", "module.mod"), ("Info", "module.info")]:
        source = pathlib.Path(download.get(key, ""))
        require(source.is_absolute() and source.is_file() and not source.is_symlink(), "Missing actual cache module file: " + key)
        target = provider / name
        if retain:
            shutil.copyfile(source, target)
        require(target.is_file() and not target.is_symlink() and source.read_bytes() == target.read_bytes(),
                "Actual module cache bytes changed: " + key)
    info = read(provider / "module.info")
    require(info.get("Version") == expected["version"]
            and info.get("Origin") == {"VCS": "git", "URL": pin["repository"].removesuffix(".git"),
                                      "Hash": pin["revision"], "Ref": "refs/tags/" + expected["version"]},
            "Public module info lacks the exact pinned tag origin")
    require(digest(provider / "module.zip") == expected["zipSHA256"]
            and hash1([("go.mod", (provider / "module.mod").read_bytes())]) == expected["goModSum"],
            "Published module ZIP or go.mod checksum changed")
    prefix = expected["path"] + "@" + expected["version"] + "/"
    entries = {}
    with zipfile.ZipFile(provider / "module.zip") as archive:
        files = archive.infolist()
        require(files and len(files) <= 10000 and sum(item.file_size for item in files) <= 64 * 1024 * 1024,
                "Unexpected public module ZIP limits")
        for item in files:
            relative = item.filename.removeprefix(prefix)
            require(item.filename.startswith(prefix) and not item.is_dir()
                    and relative and pathlib.PurePosixPath(relative).as_posix() == relative
                    and not relative.startswith("/") and ".." not in pathlib.PurePosixPath(relative).parts
                    and "\\" not in relative and relative not in entries,
                    "Unsafe or duplicate public module ZIP entry")
            entries[relative] = archive.read(item)
    require(hash1([(prefix + name, value) for name, value in entries.items()]) == expected["sum"],
            "Actual public module ZIP Hash1 differs from the published pin")
    cache_entries = {}
    for path in cache.rglob("*"):
        require(not path.is_symlink(), "Unexpected symlink in the public module cache")
        if path.is_dir():
            continue
        require(path.is_file(), "Unexpected non-file in the public module cache")
        cache_entries[path.relative_to(cache).as_posix()] = path.read_bytes()
    require(cache_entries == entries, "The actual compiled public module cache differs from its verified ZIP")
    require(entries["go.mod"] == (provider / "module.mod").read_bytes(), "ZIP and cache module declarations differ")
    for name, expected_hash in pin["sourceHashes"].items():
        require(hashlib.sha256(entries[name]).hexdigest() == expected_hash, "Pinned Fyne source changed: " + name)
        target = provider / "fyne-source" / name
        if retain:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(entries[name])
        require(target.is_file() and not target.is_symlink() and target.read_bytes() == entries[name],
                "Retained public Fyne source changed: " + name)
    retained_sources = {path.relative_to(provider / "fyne-source").as_posix()
                        for path in (provider / "fyne-source").rglob("*") if path.is_file()}
    require(retained_sources == FYNE_SOURCE_NAMES, "Missing or extra retained Fyne source")
    if retain:
        (provider / "LICENSE-Fyne").write_bytes(entries["LICENSE"])
    require((provider / "LICENSE-Fyne").read_bytes() == entries["LICENSE"], "Retained Fyne license changed")
    return {"revision": pin["revision"], "tree": pin["tree"], "tagObject": pin["tagObject"],
            "path": expected["path"], "version": expected["version"], "sum": expected["sum"],
            "goModSum": expected["goModSum"], "zipSHA256": digest(provider / "module.zip"),
            "modSHA256": digest(provider / "module.mod"), "infoSHA256": digest(provider / "module.info"),
            "downloadMetadataHash": digest(provider / "module-download.json"),
            "tagHash": digest(provider / "fyne-tag.txt"), "commitHash": digest(provider / "fyne-commit.txt"),
            "sourceHashes": pin["sourceHashes"], "moduleFiles": len(entries),
            "selection": "Published versioned production replacement; no temporary Fyne replacement"}


def module_context(repository, provider, parse_module=module_json):
    original = parse_module(repository / "native/go.mod")
    require((provider / "provider.mod").read_bytes() == (repository / "native/go.mod").read_bytes()
            and (provider / "provider.sum").read_bytes() == (repository / "native/go.sum").read_bytes(),
            "Production module files changed during the hosted provider build")
    pin = public_pin(repository)
    expected = pin["module"]
    replacements = original.get("Replace", [])
    selected = [item for item in replacements if item.get("Old", {}).get("Path") == expected["canonicalPath"]]
    require(len(selected) == 1 and selected[0].get("New") == {"Path": expected["path"], "Version": expected["version"]},
            "Production Fyne replacement is not the pinned public release")
    modules = selected_modules(provider / "selected-modules.json")
    require(len({item.get("Path") for item in modules}) == len(modules), "Duplicate selected module")
    require(all(item.get("Replace", {}).get("Version") for item in modules if item.get("Replace")),
            "Local module replacement is forbidden in the hosted provider build")
    selected = [item for item in modules if item.get("Path") == expected["canonicalPath"]]
    download = read(provider / "module-download.json")
    replacement = selected[0].get("Replace", {}) if len(selected) == 1 else {}
    require(len(selected) == 1 and selected[0].get("Version") == expected["canonicalVersion"]
            and not replacement.get("Replace") and replacement.get("Path") == expected["path"]
            and replacement.get("Version") == expected["version"] and replacement.get("Sum") == expected["sum"]
            and replacement.get("GoModSum") == expected["goModSum"]
            and replacement.get("Dir") == download.get("Dir") and selected[0].get("Dir") == download.get("Dir"),
            "Selected provider graph differs from the actual published Fyne download")
    sums = (repository / "native/go.sum").read_text().splitlines()
    require(all(expected["path"] + " " + expected["version"] + suffix + " " + expected[key] in sums
                for key, suffix in [("sum", ""), ("goModSum", "/go.mod")]), "Missing pinned production Fyne checksums")
    return {"productionGoModHash": digest(repository / "native/go.mod"),
            "productionGoSumHash": digest(repository / "native/go.sum"),
            "retainedGoModHash": digest(provider / "provider.mod"), "retainedGoSumHash": digest(provider / "provider.sum"),
            "selectedModulesHash": digest(provider / "selected-modules.json"),
            "publicModule": public_module(repository, provider), "usesPublishedProductionModule": True,
            "temporaryFyneReplacement": False, "productionDependencyChangedDuringBuild": False}


def make_provider_build(repository, provider, parse_module=module_json, observe_binary=binary_build_info):
    binary, info = provider / "fontations.test", provider / "test-build-info.txt"
    require(binary.is_file() and not binary.is_symlink() and info.is_file() and not info.is_symlink(),
            "Missing retained test binary or its actual build information")
    observed, recorded = observe_binary(binary), info.read_bytes()
    require(normalized_build_info(observed) == normalized_build_info(recorded),
            "Retained build information differs from the actual retained test binary")
    verify_binary_module(observed, public_pin(repository))
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
        entries = {name: (name + "\n").encode() for name in FYNE_SOURCE_NAMES}
        module = {"path": "github.com/thinkddr/fyne/v2", "canonicalPath": "fyne.io/fyne/v2",
                  "canonicalVersion": "v2.8.1", "version": "v2.8.1-sytue.19"}
        prefix = module["path"] + "@" + module["version"] + "/"
        cache = root / "cache/module"
        for name, content in entries.items():
            path = cache / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        archive = root / "cache/module.zip"
        with zipfile.ZipFile(archive, "w") as target:
            for name, content in entries.items():
                target.writestr(prefix + name, content)
        mod, info = root / "cache/module.mod", root / "cache/module.info"
        mod.write_bytes(entries["go.mod"])
        module.update(sum=hash1([(prefix + name, content) for name, content in entries.items()]),
                      goModSum=hash1([("go.mod", entries["go.mod"])]), zipSHA256=digest(archive))
        commit = b"tree " + b"1" * 40 + b"\nauthor Fyne contributors <contributors@fyne.invalid> 1 +0000\ncommitter Fyne contributors <contributors@fyne.invalid> 1 +0000\n\nFixture\n"
        revision = git_object("commit", commit)
        tag = ("object " + revision + "\ntype commit\ntag " + module["version"]
               + "\ntagger Fyne contributors <contributors@fyne.invalid> 1 +0000\n\nFixture\n").encode()
        pin = {"schema": 1, "repository": "https://github.com/thinkddr/fyne.git", "revision": revision,
               "tree": "1" * 40, "tagObject": git_object("tag", tag), "module": module,
               "sourceHashes": {name: hashlib.sha256(content).hexdigest() for name, content in entries.items()}}
        (repository / "ci/text-engine-probe/fyne-hook-pin.json").write_text(json.dumps(pin))
        (provider / "fyne-commit.txt").write_bytes(commit)
        (provider / "fyne-tag.txt").write_bytes(tag)
        info.write_text(json.dumps({"Version": module["version"], "Origin": {"VCS": "git",
            "URL": "https://github.com/thinkddr/fyne", "Hash": revision, "Ref": "refs/tags/" + module["version"]}}))
        download = {"Path": module["path"], "Version": module["version"], "Dir": str(cache), "Zip": str(archive),
                    "GoMod": str(mod), "Info": str(info), "Sum": module["sum"], "GoModSum": module["goModSum"]}
        (provider / "module-download.json").write_text(json.dumps(download))
        public_module(repository, provider, retain=True)
        original = {"Module": {"Path": "example/native"}, "Replace": [{"Old": {"Path": module["canonicalPath"]},
                     "New": {"Path": module["path"], "Version": module["version"]}}]}
        selected = {"Path": module["canonicalPath"], "Version": module["canonicalVersion"], "Dir": str(cache),
                    "Replace": {"Path": module["path"], "Version": module["version"], "Dir": str(cache),
                                "Sum": module["sum"], "GoModSum": module["goModSum"]}}
        (provider / "selected-modules.json").write_text(json.dumps(selected))
        (repository / "native/go.sum").write_text("\n".join(module["path"] + " " + module["version"] + suffix
             + " " + module[key] for key, suffix in [("sum", ""), ("goModSum", "/go.mod")]) + "\n")
        for suffix in ["mod", "sum"]:
            shutil.copyfile(repository / ("native/go." + suffix), provider / ("provider." + suffix))
        parse = lambda _: original
        binary_info = ("/build/fontations.test: go1.27.2\n\tpath\texample.test\n\tdep\t"
                       + module["canonicalPath"] + "\t" + module["canonicalVersion"] + "\n\t=>\t"
                       + module["path"] + "\t" + module["version"] + "\t" + module["sum"] + "\n").encode()
        (provider / "test-build-info.txt").write_bytes(binary_info)
        observe = lambda _: binary_info.replace(b"/build/", b"/extract/")
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
        for key, value in [("Version", "v2.8.1-sytue.18"), ("Version", None), ("Path", "/local/fyne"),
                           ("Sum", "h1:" + "0" * 43 + "=")]:
            altered = copy.deepcopy(selected)
            altered["Replace"][key] = value
            (provider / "selected-modules.json").write_text(json.dumps(altered))
            rejected(lambda: make_provider_build(repository, provider, parse, observe), "selected " + key)
        (provider / "selected-modules.json").write_text(json.dumps(selected))
        original["Replace"][0]["New"]["Version"] = "v2.8.1-sytue.18"
        rejected(lambda: make_provider_build(repository, provider, parse, observe), "stale production release")
        original["Replace"][0]["New"]["Version"] = module["version"]
        for path in [provider / "fyne-tag.txt", provider / "fyne-commit.txt", provider / "module.zip",
                     provider / "fyne-source/canvas/text.go", cache / "canvas/text.go"]:
            before = path.read_bytes()
            path.write_bytes(before + b"changed\n")
            rejected(lambda: make_provider_build(repository, provider, parse, observe), str(path))
            path.write_bytes(before)
        for path in [cache / "extra.go", provider / "fyne-source/extra.go"]:
            path.write_text("package injected\n")
            rejected(lambda: make_provider_build(repository, provider, parse, observe), "extra Fyne source")
            path.unlink()
        altered = {**download, "Sum": "h1:" + "0" * 43 + "="}
        (provider / "module-download.json").write_text(json.dumps(altered))
        rejected(lambda: make_provider_build(repository, provider, parse, observe), "incorrect download sum")
        (provider / "module-download.json").write_text(json.dumps(download))
        for before, after in [(module["version"], "v2.8.1-sytue.18"),
                              (module["path"], "/local/fyne"), (module["sum"], "h1:" + "0" * 43 + "=")]:
            replayed = binary_info.replace(before.encode(), after.encode())
            (provider / "test-build-info.txt").write_bytes(replayed)
            rejected(lambda: make_provider_build(repository, provider, parse, lambda _: replayed),
                     "resealed binary compiled with stale/local/wrong-sum Fyne")
        (provider / "test-build-info.txt").write_bytes(binary_info)
        print("Provider provenance negative controls passed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=pathlib.Path)
    parser.add_argument("--provider-evidence", type=pathlib.Path)
    parser.add_argument("--comparator", type=pathlib.Path)
    parser.add_argument("--record-sources", action="store_true")
    parser.add_argument("--record-provider-build", action="store_true")
    parser.add_argument("--retain-public-module", action="store_true")
    parser.add_argument("--verify-provider-build", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    repository = pathlib.Path(__file__).resolve().parents[2]
    if args.self_test:
        contract_self_test()
        return
    require(args.provider_evidence is not None, "--provider-evidence is required")
    provider = args.provider_evidence.resolve()
    if args.retain_public_module:
        public_module(repository, provider, retain=True)
        return
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
    pin = public_pin(repository)
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
