#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Observe the hosted system's empty Fontconfig query, never browser internals."""
import argparse
import ctypes as C
import hashlib
import json
import locale
import os
import pathlib
import platform


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--sources", type=pathlib.Path, required=True)
    args = parser.parse_args()
    if platform.system() != "Linux":
        raise RuntimeError("This diagnostic requires the hosted Linux environment")
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    sources_bytes = args.sources.read_bytes()
    sources = json.loads(sources_bytes)
    pins = json.loads(pathlib.Path(__file__).with_name("font-policy-source-pin.json").read_text())
    if sources.get("chromiumFontPolicySources") != pins:
        raise RuntimeError("Resolved Fontconfig policy sources differ from the committed pins")
    source_root = args.sources.resolve().parent / "font-policy-source"
    for name, identity in pins["files"].items():
        data = (source_root / name).read_bytes()
        blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if blob != identity["gitBlob"] or sha(data) != identity["sha256"]:
            raise RuntimeError("Resolved font-policy source changed: " + name)

    fc = C.CDLL("libfontconfig.so.1")
    signatures = {
        "FcInit": ([], C.c_int),
        "FcGetVersion": ([], C.c_int),
        "FcConfigGetCurrent": ([], C.c_void_p),
        "FcConfigReference": ([C.c_void_p], C.c_void_p),
        "FcConfigDestroy": ([C.c_void_p], None),
        "FcConfigGetConfigFiles": ([C.c_void_p], C.c_void_p),
        "FcStrListNext": ([C.c_void_p], C.c_char_p),
        "FcStrListDone": ([C.c_void_p], None),
        "FcPatternCreate": ([], C.c_void_p),
        "FcPatternDuplicate": ([C.c_void_p], C.c_void_p),
        "FcPatternDestroy": ([C.c_void_p], None),
        "FcPatternAddBool": ([C.c_void_p, C.c_char_p, C.c_int], C.c_int),
        "FcPatternAddString": ([C.c_void_p, C.c_char_p, C.c_char_p], C.c_int),
        "FcPatternDel": ([C.c_void_p, C.c_char_p], C.c_int),
        "FcConfigSubstitute": ([C.c_void_p, C.c_void_p, C.c_int], C.c_int),
        "FcConfigSubstituteWithPat": ([C.c_void_p, C.c_void_p, C.c_void_p, C.c_int], C.c_int),
        "FcDefaultSubstitute": ([C.c_void_p], None),
        "FcPatternGetBool": ([C.c_void_p, C.c_char_p, C.c_int, C.POINTER(C.c_int)], C.c_int),
        "FcPatternGetInteger": ([C.c_void_p, C.c_char_p, C.c_int, C.POINTER(C.c_int)], C.c_int),
        "FcNameUnparse": ([C.c_void_p], C.c_void_p),
        "FcStrFree": ([C.c_void_p], None),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(fc, name)
        function.argtypes, function.restype = arguments, result

    def checked(value, operation):
        if not value:
            raise RuntimeError("Fontconfig failed: " + operation)
        return value

    class DlInfo(C.Structure):
        _fields_ = [("filename", C.c_char_p), ("base", C.c_void_p),
                    ("symbol", C.c_char_p), ("address", C.c_void_p)]

    dl = C.CDLL("libdl.so.2")
    dl.dladdr.argtypes, dl.dladdr.restype = [C.c_void_p, C.POINTER(DlInfo)], C.c_int
    info = DlInfo()
    checked(dl.dladdr(C.cast(fc.FcGetVersion, C.c_void_p), C.byref(info)), "dladdr")
    library = pathlib.Path(os.fsdecode(info.filename)).resolve(strict=True)
    library_bytes = library.read_bytes()

    def config_entries(config):
        result = []
        entries = checked(fc.FcConfigGetConfigFiles(config), "config files")
        try:
            while True:
                name = fc.FcStrListNext(entries)
                if name is None:
                    break
                requested = pathlib.Path(os.fsdecode(name))
                resolved = requested.resolve(strict=True)
                record = {"path": str(requested), "resolvedPath": str(resolved)}
                if resolved.is_dir():
                    listing = []
                    for child in sorted(resolved.iterdir(), key=lambda entry: entry.name):
                        if child.is_symlink():
                            kind = "symlink"
                        elif child.is_dir():
                            kind = "directory"
                        elif child.is_file():
                            kind = "file"
                        else:
                            kind = "other"
                        entry = {"name": child.name, "type": kind}
                        if child.is_symlink():
                            entry["target"] = os.readlink(child)
                        listing.append(entry)
                    encoded = json.dumps(listing, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
                    result.append({**record, "type": "directory", "entries": listing, "listingHash": sha(encoded)})
                    continue
                if not resolved.is_file():
                    raise RuntimeError("Unexpected loaded Fontconfig entry type: " + str(requested))
                data = resolved.read_bytes()
                identity = sha(data)
                target = output / "config-files" / (identity + ".conf")
                target.parent.mkdir(exist_ok=True)
                target.write_bytes(data)
                result.append({**record, "type": "file", "sha256": identity, "length": len(data),
                               "retainedPath": target.relative_to(output).as_posix()})
        finally:
            fc.FcStrListDone(entries)
        if not result:
            raise RuntimeError("Missing loaded Fontconfig configuration entries")
        return result

    def pattern(pattern_):
        address = checked(fc.FcNameUnparse(pattern_), "pattern serialization")
        try:
            text = C.string_at(address).decode("utf-8", "strict")
        finally:
            fc.FcStrFree(address)
        properties = {}
        for key in ["antialias", "autohint", "embeddedbitmap", "hinting", "hintstyle", "rgba"]:
            value = C.c_int()
            getter = fc.FcPatternGetInteger if key in ["hintstyle", "rgba"] else fc.FcPatternGetBool
            result = getter(pattern_, key.encode(), 0, C.byref(value))
            if result not in [0, 1, 3]:
                raise RuntimeError("Unexpected Fontconfig property type/result: " + key)
            if result == 0 and key not in ["hintstyle", "rgba"] and value.value not in [0, 1, 2]:
                raise RuntimeError("Invalid Fontconfig boolean: " + key)
            properties[key] = {"result": result, "present": result == 0,
                               "value": value.value if result == 0 else None}
        return {"unparsed": text, "properties": properties}

    checked(fc.FcInit(), "initialization")
    config = checked(fc.FcConfigReference(checked(fc.FcConfigGetCurrent(), "current config")), "config reference")
    query, result = None, None
    try:
        before = config_entries(config)
        query = checked(fc.FcPatternCreate(), "query creation")
        checked(fc.FcPatternAddBool(query, b"scalable", 1), "scalable query")
        checked(fc.FcPatternAddString(query, b"fontwrapper", b"SFNT"), "fontwrapper query")
        initial = pattern(query)
        checked(fc.FcConfigSubstitute(config, query, 0), "FcMatchPattern substitution")
        fc.FcDefaultSubstitute(query)
        substituted = pattern(query)
        result = checked(fc.FcPatternDuplicate(query), "query duplication")
        for name in [b"family", b"pixelsize", b"size"]:
            fc.FcPatternDel(result, name)
        checked(fc.FcConfigSubstituteWithPat(config, result, query, 1), "FcMatchFont substitution")
        observed = pattern(result)
        after = config_entries(config)
        if before != after or sha(library.read_bytes()) != sha(library_bytes):
            raise RuntimeError("Fontconfig library/configuration changed during observation")
        report = {
            "schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
            "browserEffectivePolicyVerified": False,
            "scope": "Standalone process querying its own installed Fontconfig; no browser renderer, global device scale, preferences, SkFont, surface or scaler observation",
            "sourceManifestHash": sha(sources_bytes), "sourcePins": pins,
            "observerHash": sha(pathlib.Path(__file__).read_bytes()),
            "fontconfigVersion": fc.FcGetVersion(),
            "library": {"path": str(library), "sha256": sha(library_bytes), "length": len(library_bytes)},
            "environment": {name: os.environ.get(name) for name in ["FONTCONFIG_FILE", "FONTCONFIG_PATH", "FONTCONFIG_SYSROOT", "FC_FONTATIONS", "FC_DEBUG", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_MESSAGES"]},
            "processLocale": {"LC_CTYPE": locale.setlocale(locale.LC_CTYPE), "LC_MESSAGES": locale.setlocale(locale.LC_MESSAGES)},
            "fontconfigBooleanEncoding": {"false": 0, "true": 1, "dontCare": 2},
            "configEntries": before, "configEntriesStable": True,
            "configurationBinding": "Every reported loaded file's bytes and each reported directory's immediate names/types/symlink targets; not a recursive hash of unrelated files",
            "initialPattern": initial, "defaultSubstitutedPattern": substituted,
            "emptyQueryResult": observed,
            "policyAppliedToNative": False,
            "missingPropertiesUseBrowserDefaults": "Not resolved here: LinuxUi defaults, global device scale, startup environment and browser-linked Fontconfig remain unobserved",
        }
        (output / "fontconfig.json").write_text(json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2) + "\n")
    finally:
        if result:
            fc.FcPatternDestroy(result)
        if query:
            fc.FcPatternDestroy(query)
        fc.FcConfigDestroy(config)


if __name__ == "__main__":
    main()
