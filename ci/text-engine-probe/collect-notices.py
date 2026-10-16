#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Retain original notices, with explicit broad-superset collection scope."""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, urllib.request

def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def rust_notices(notices, copy):
    verbose = subprocess.check_output(["rustc", "-vV"], text=True)
    fields = dict(line.split(": ", 1) for line in verbose.splitlines() if ": " in line)
    commit = fields.get("commit-hash", "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise RuntimeError("Rust compiler has no exact public source commit; cannot bind fallback notices")
    sysroot = pathlib.Path(subprocess.check_output(["rustc", "--print", "sysroot"], text=True).strip()).resolve(strict=True)
    target_libdir = pathlib.Path(subprocess.check_output(["rustc", "--print", "target-libdir"], text=True).strip()).resolve(strict=True)
    compiler = (sysroot / "bin/rustc").resolve(strict=True)
    directory = notices / "rust-toolchain"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "rustc-vV.txt").write_text(verbose)
    originals = {}
    def installed(source):
        if source.is_file():
            relative = source.relative_to(sysroot)
            destination = directory / "installed" / relative
            copy(source, destination)
            originals[relative.as_posix()] = {
                "origin": "installed-sysroot",
                "path": str(source),
                "artifact": destination.relative_to(notices).as_posix(),
                "hash": file_hash(source),
            }
    for source in sysroot.iterdir():
        if source.name.upper().startswith(("LICENSE", "COPYRIGHT", "COPYING", "NOTICE")):
            installed(source)
    for doc in [sysroot / "share/doc/rust", target_libdir.parent / "share/doc/rust"]:
        if not doc.is_dir():
            continue
        for current, _, files in os.walk(doc):
            for name in files:
                source = pathlib.Path(current) / name
                if name.upper().startswith(("LICENSE", "COPYRIGHT", "COPYING", "NOTICE")) or "licenses" in source.relative_to(doc).parts:
                    installed(source)
    # Root source notices supplement the actual distribution, never fabricate
    # a stdlib third-party notice from a short MIT/Apache label.
    fallback = {}
    for name in ["COPYRIGHT", "LICENSE-MIT", "LICENSE-APACHE"]:
        if any(pathlib.PurePosixPath(path).name == name for path in originals):
            continue
        url = f"https://raw.githubusercontent.com/rust-lang/rust/{commit}/{name}"
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read()
        if not data:
            raise RuntimeError("Empty official Rust source notice: " + name)
        destination = directory / "official-source" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        fallback[name] = {"origin": "official-source-at-observed-compiler-commit", "url": url, "artifact": destination.relative_to(notices).as_posix(), "hash": hashlib.sha256(data).hexdigest()}
    # Rust's distributed generated COPYRIGHT files include std's dependency
    # notices; the short source-root COPYRIGHT explicitly points to those files.
    generated = [entry for name, entry in originals.items() if pathlib.PurePosixPath(name).name in ["COPYRIGHT-library.html", "COPYRIGHT.html"]]
    if not generated:
        raise RuntimeError("Installed Rust distribution lacks generated COPYRIGHT-library.html/COPYRIGHT.html; root MIT/Apache source notices alone do not cover std runtime dependencies")
    runtime = {}
    for source in target_libdir.rglob("*"):
        if source.is_file() and (source.suffix in [".rlib", ".so", ".a"] or ".so." in source.name):
            runtime[source.relative_to(target_libdir).as_posix()] = {"hash": file_hash(source), "bytes": source.stat().st_size}
    if not any(name.startswith("libstd-") for name in runtime):
        raise RuntimeError("Actual Rust target library directory omitted the std runtime")
    return {"rustcVerbose": verbose, "rustcVerboseHash": hashlib.sha256(verbose.encode()).hexdigest(), "commit": commit, "host": fields.get("host"), "release": fields.get("release"), "sysroot": str(sysroot), "targetLibraryDirectory": str(target_libdir), "compiler": {"path": str(compiler), "hash": file_hash(compiler)}, "installedNotices": originals, "sourceFallbackNotices": fallback, "generatedStdOrToolchainCopyright": generated, "runtimeFiles": runtime}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=pathlib.Path, required=True)
    args = parser.parse_args()
    work = args.work.resolve()
    notices = work / "notices"
    notices.mkdir(exist_ok=True)
    copied = {}
    def copy(source, destination):
        if source.is_file():
            data = source.read_bytes()
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            copied[destination.relative_to(notices).as_posix()] = hashlib.sha256(data).hexdigest()
    # A superset avoids discarding applicable embedded third-party notices.
    # This is not labelled an exact linked-package inventory.
    for name in ["skia", "harfbuzz", "ots"]:
        base = work / name
        for directory, dirs, files in os.walk(base):
            dirs[:] = [value for value in dirs if value not in [".git", "out", "target"]]
            for filename in files:
                if filename.upper().startswith(("LICENSE", "COPYING", "NOTICE")):
                    source = pathlib.Path(directory) / filename
                    copy(source, notices / "source-notices" / name / source.relative_to(base))
    metadata = json.loads((work / "cargo-metadata.json").read_text())
    for package in metadata["packages"]:
        base = pathlib.Path(package["manifest_path"]).parent
        for directory, dirs, files in os.walk(base):
            dirs[:] = [value for value in dirs if value not in [".git", "target"]]
            for filename in files:
                if filename.upper().startswith(("LICENSE", "COPYING", "NOTICE")):
                    source = pathlib.Path(directory) / filename
                    copy(source, notices / "cargo" / f'{package["name"]}-{package["version"]}' / source.relative_to(base))
    rust_toolchain = rust_notices(notices, copy)
    (notices / "rust-toolchain/toolchain.json").write_text(json.dumps(rust_toolchain, indent=2) + "\n")
    # Keep the installed Linux copyright texts and their referenced common
    # licenses as a declared superset, alongside the actual linked-library map.
    for directory, _, files in os.walk("/usr/share/doc"):
        if "copyright" in files:
            source = pathlib.Path(directory) / "copyright"
            copy(source, notices / "installed-linux" / source.relative_to("/usr/share/doc"))
    common = pathlib.Path("/usr/share/common-licenses")
    if common.is_dir():
        for source in common.iterdir():
            copy(source, notices / "common-licenses" / source.name)
    installed = subprocess.check_output(["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n"], text=True)
    (notices / "installed-packages.txt").write_text(installed)
    (notices / "collection.json").write_text(json.dumps({"schema": 1, "scope": "Original source/Cargo/installed-Rust/installed-Linux notice supersets; not a claim that every listed package was linked", "linkedLibraryEvidence": "../evidence/linked-libraries.txt", "rustToolchain": rust_toolchain, "originalFiles": copied}, indent=2) + "\n")

if __name__ == "__main__":
    main()
