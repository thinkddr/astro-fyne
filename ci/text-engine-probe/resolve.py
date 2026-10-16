#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Hosted-only source resolution. Never called automatically on import."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, urllib.request

CHROMIUM = "971a7443b0c9b0a9b2860529b33331b76077ec62"
PINS = {
    "skia": ("https://github.com/google/skia.git", "9d07e5bad9e3e21da2426946e589daa647218271"),
    "harfbuzz": ("https://github.com/harfbuzz/harfbuzz.git", "dfdc088c4d7c5d31dd5b13070b919b51f6c21ea8"),
    "ots": ("https://github.com/khaledhosny/ots.git", "46bea9879127d0ff1c6601b078e2ce98e83fcd33"),
}
CRATES = {"font-types-v0_12": "0.12.2", "read-fonts-v0_41": "0.41.0", "skrifa-v0_44": "0.44.0", "cxx-v1": "1.0.199"}

def run(*arguments, cwd=None):
    subprocess.run(arguments, cwd=cwd, check=True)

def api(path):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "astro-fyne-native-text-experiment"}
    if os.environ.get("GH_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GH_TOKEN"]
    with urllib.request.urlopen(urllib.request.Request("https://api.github.com/repos/chromium/chromium/" + path, headers=headers), timeout=120) as response:
        return json.load(response)

def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=pathlib.Path, required=True)
    args = parser.parse_args()
    work = args.work.resolve()
    work.mkdir(parents=True, exist_ok=True)
    prototype = pathlib.Path(__file__).resolve().parent
    assembly = work / "assembly"
    assembly.mkdir(exist_ok=True)
    for name in ["Cargo.toml", "Cargo.lock", "build.rs", "text_engine.h", "text_engine.cc", "driver.py", "policy.json", "probe-pin.json"]:
        shutil.copyfile(prototype / name, assembly / name)
    source_records = {}
    for name, (url, revision) in PINS.items():
        destination = work / name
        if destination.exists():
            raise RuntimeError("Resolver requires a fresh directory: " + str(destination))
        run("git", "init", str(destination))
        run("git", "-C", str(destination), "remote", "add", "origin", url)
        run("git", "-C", str(destination), "fetch", "--depth=1", "origin", revision)
        run("git", "-C", str(destination), "checkout", "--detach", "FETCH_HEAD")
        actual = subprocess.check_output(["git", "-C", str(destination), "rev-parse", "HEAD"], text=True).strip()
        if actual != revision:
            raise RuntimeError("Resolved source differs from exact pin")
        source_records[name] = {"url": url, "revision": actual}
    policy_pins = json.loads((prototype / "font-policy-source-pin.json").read_text())
    if policy_pins.get("schema") != 1 or policy_pins.get("chromiumCommit") != CHROMIUM:
        raise RuntimeError("Font policy source pin differs from the selected Chromium commit")
    for name, identity in policy_pins["files"].items():
        path = pathlib.PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts:
            raise RuntimeError("Invalid font policy source path")
        data = fetch(f"https://raw.githubusercontent.com/chromium/chromium/{CHROMIUM}/{path}")
        blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if blob != identity["gitBlob"] or hashlib.sha256(data).hexdigest() != identity["sha256"]:
            raise RuntimeError("Pinned font policy source differs: " + name)
        destination = work / "font-policy-source" / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    # Preserve exact relative paths expected by Skia's generated CXX header.
    rust_path = pathlib.Path("src/ports/fontations/src")
    (assembly / rust_path).mkdir(parents=True)
    for name in ["base.rs", "bitmap.rs", "colr.rs", "ffi.rs", "hinting.rs", "names.rs", "verbs_points_pen.rs"]:
        shutil.copyfile(work / "skia" / rust_path / name, assembly / rust_path / name)
    # Standalone Skia's older 0.43/0.40 crates must not enter this assembly.
    # Copy exact Chromium-vendored primary runtime crates, not version labels alone.
    parent = "third_party/rust/chromium_crates_io/vendor"
    entries = api(f"contents/{parent}?ref={CHROMIUM}")
    vendor_manifest = {}
    for name, version in CRATES.items():
        entry = next(item for item in entries if item["name"] == name and item["type"] == "dir")
        tree = api("git/trees/" + entry["sha"] + "?recursive=1")
        if tree.get("truncated"):
            raise RuntimeError("Truncated vendor source tree")
        files = {}
        for item in tree["tree"]:
            if item["type"] == "tree":
                continue
            path = pathlib.PurePosixPath(item["path"])
            if item["type"] != "blob" or item["mode"] not in ["100644", "100755"] or path.is_absolute() or ".." in path.parts:
                raise RuntimeError("Unsupported vendor tree entry")
            data = fetch(f"https://raw.githubusercontent.com/chromium/chromium/{CHROMIUM}/{parent}/{name}/{path}")
            git_hash = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
            if git_hash != item["sha"]:
                raise RuntimeError("Vendor Git object mismatch")
            destination = assembly / "vendor" / name / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            files[str(path)] = hashlib.sha256(data).hexdigest()
        vendor_manifest[name] = {"version": version, "chromiumCommit": CHROMIUM, "gitTree": entry["sha"], "files": files}
    # Chromium's CXX source includes this forwarding header from its source root.
    forwarding_path = "third_party/rust/cxx/v1/cxx.h"
    forwarding_entry = api(f"contents/{forwarding_path}?ref={CHROMIUM}")
    forwarding_bytes = fetch(f"https://raw.githubusercontent.com/chromium/chromium/{CHROMIUM}/{forwarding_path}")
    forwarding_blob = hashlib.sha1(b"blob " + str(len(forwarding_bytes)).encode() + b"\0" + forwarding_bytes).hexdigest()
    if forwarding_entry.get("type") != "file" or forwarding_blob != forwarding_entry.get("sha"):
        raise RuntimeError("Chromium CXX forwarding header Git object mismatch")
    forwarding_destination = assembly / forwarding_path
    forwarding_destination.parent.mkdir(parents=True, exist_ok=True)
    forwarding_destination.write_bytes(forwarding_bytes)
    included_path = "third_party/rust/chromium_crates_io/vendor/cxx-v1/include/cxx.h"
    included_bytes = (assembly / "vendor/cxx-v1/include/cxx.h").read_bytes()
    included_destination = assembly / included_path
    included_destination.parent.mkdir(parents=True, exist_ok=True)
    included_destination.write_bytes(included_bytes)
    chromium_cxx_headers = {
        forwarding_path: {"gitBlob": forwarding_blob, "sha256": hashlib.sha256(forwarding_bytes).hexdigest()},
        included_path: {"verifiedVendorPath": "cxx-v1/include/cxx.h", "sha256": hashlib.sha256(included_bytes).hexdigest()},
    }
    # Keep Chromium's lock separately; assembly uses the actual hosted standalone lock.
    chrome_lock = fetch(f"https://raw.githubusercontent.com/chromium/chromium/{CHROMIUM}/third_party/rust/chromium_crates_io/Cargo.lock")
    (work / "chromium-Cargo.lock").write_bytes(chrome_lock)
    metadata = subprocess.check_output(["cargo", "metadata", "--locked", "--format-version", "1"], cwd=assembly)
    (work / "cargo-metadata.json").write_bytes(metadata)
    actual = json.loads(metadata)
    expected = {"font-types": "0.12.2", "read-fonts": "0.41.0", "skrifa": "0.44.0", "cxx": "1.0.199", "cxx-build": "1.0.199"}
    for name, version in expected.items():
        packages = [p for p in actual["packages"] if p["name"] == name]
        if len(packages) != 1 or packages[0]["version"] != version:
            raise RuntimeError("Wrong or ambiguous selected crate: " + name)
    (work / "sources.json").write_text(json.dumps({"schema": 1, "diagnosticOnly": True, "compiled": False, "chromiumCommit": CHROMIUM, "sources": source_records, "vendoredPrimaryCrates": vendor_manifest, "chromiumCxxHeaders": chromium_cxx_headers, "chromiumFontPolicySources": policy_pins, "cargoLockHash": hashlib.sha256((assembly / "Cargo.lock").read_bytes()).hexdigest()}, indent=2) + "\n")
    notices = work / "notices"
    notices.mkdir()
    for source in [work / "skia" / "LICENSE", work / "harfbuzz" / "COPYING", work / "ots" / "LICENSE"]:
        shutil.copyfile(source, notices / (source.parent.name + "-" + source.name))
    chromium_license = fetch(f"https://raw.githubusercontent.com/chromium/chromium/{CHROMIUM}/LICENSE")
    (notices / "LICENSE-Chromium").write_bytes(chromium_license)
    for package in actual["packages"]:
        directory = pathlib.Path(package["manifest_path"]).parent
        target = notices / (package["name"] + "-" + package["version"])
        target.mkdir(exist_ok=True)
        for source in directory.iterdir():
            if source.is_file() and source.name.upper().startswith(("LICENSE", "COPYING", "NOTICE")):
                shutil.copyfile(source, target / source.name)
    print("Resolved pinned source and verified the committed Cargo lock; not yet compiled")

if __name__ == "__main__":
    main()
