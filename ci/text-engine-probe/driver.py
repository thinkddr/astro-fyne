#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Hosted native probe driver; no reference-image input or fitting path."""
import argparse, ctypes as C, hashlib, json, pathlib, struct, zlib

FONT_HASH = "6b04c8dd65af6b73eb4279472ed1580b29102d6496a377340e80a40cdb3b22c9"
POLICY_FIELDS = ["hinting", "auto_hint", "embedded_bitmaps", "subpixel", "linear_metrics", "edging", "baseline_snap", "pixel_geometry"]

class Policy(C.Structure):
    _fields_ = [(name, C.c_uint32) for name in POLICY_FIELDS] + [("contrast", C.c_float), ("gamma", C.c_float)]

class Glyph(C.Structure):
    _fields_ = [("glyph", C.c_uint32), ("cluster_utf8", C.c_uint32)] + [(name, C.c_int32) for name in ["x_advance_16_16", "y_advance_16_16", "x_offset_16_16", "y_offset_16_16"]] + [(name, C.c_float) for name in ["nominal_advance_css", "x_css", "y_css"]]

class Metrics(C.Structure):
    _fields_ = [(name, C.c_float) for name in ["advance_css", "ascent_css", "descent_css", "leading_css", "baseline_css"]] + [("glyph_count", C.c_uint32)]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def png(width, height, rgba):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    rows = b"".join(b"\0" + rgba[y * width * 4:(y + 1) * width * 4] for y in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")

def fields(value):
    return {name: getattr(value, name) for name, _ in value._fields_}

def sfnt_tables(data):
    if len(data) < 12 or data[:4] != b"\0\1\0\0":
        raise RuntimeError("Expected the declared static TrueType sfnt")
    count = struct.unpack_from(">H", data, 4)[0]
    if 12 + count * 16 > len(data):
        raise RuntimeError("Truncated font directory")
    tables = {}
    for index in range(count):
        tag, _, offset, length = struct.unpack_from(">4sIII", data, 12 + index * 16)
        name = tag.decode("ascii")
        if name in tables or offset + length > len(data):
            raise RuntimeError("Invalid font table directory")
        tables[name] = {"length": length, "hash": digest(data[offset:offset + length])}
    return tables

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=pathlib.Path, required=True)
    parser.add_argument("--library", type=pathlib.Path, required=True)
    parser.add_argument("--policy", type=pathlib.Path, required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    root, output = args.source_root.resolve(), args.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    probe_bytes = (root / "typography-probe.json").read_bytes()
    probe = json.loads(probe_bytes)
    font = (root / probe["font"]["path"]).read_bytes()
    pin = json.loads(pathlib.Path(__file__).with_name("probe-pin.json").read_text())
    if digest(probe_bytes) != pin["probeHash"] or digest((root / probe["fixture"]).read_bytes()) != pin["fixtureHash"] or digest(font) != pin["fontHash"]:
        raise RuntimeError("Original source/fixture/font differs from the declared source pin")
    if digest(font) != FONT_HASH:
        raise RuntimeError("Original source font is not the declared Noto font")
    expected_text = ["Hgx", "AVATAR To Wa", "ffi office afflict", "0123456789", "Responsive controls", "Cafe\u0301 A\u0308", "AVATAR ffi Hgx"]
    if probe["schema"] != 1 or probe["scales"] != [1, 2] or len(probe["samples"]) != 7 or [sample["text"] for sample in probe["samples"]] != expected_text:
        raise RuntimeError("This bounded experiment requires the unchanged seven-row source probe")
    policy_bytes = args.policy.read_bytes()
    requested = json.loads(policy_bytes)
    if requested["schema"] != 1 or requested["diagnosticOnly"] is not True or requested["browserEffectivePolicyVerified"] is not False:
        raise RuntimeError("Native policy must remain an independent diagnostic")
    library_path = args.library.resolve(strict=True)
    library = C.CDLL(str(library_path))
    library.atf_error.restype = C.c_char_p
    library.atf_abi_size.argtypes, library.atf_abi_size.restype = [C.c_uint32], C.c_size_t
    for index, type_ in enumerate([Policy, Glyph, Metrics], 1):
        if library.atf_abi_size(index) != C.sizeof(type_):
            raise RuntimeError("Native ABI and driver layouts differ")
    library.atf_surface_defaults.argtypes = [C.POINTER(C.c_float), C.POINTER(C.c_float)]
    library.atf_surface_defaults.restype = None
    contrast, gamma = C.c_float(), C.c_float()
    library.atf_surface_defaults(C.byref(contrast), C.byref(gamma))
    effective = {name: requested[name] for name in POLICY_FIELDS}
    for name, default in [("contrast", contrast.value), ("gamma", gamma.value)]:
        value = requested[name]
        effective[name] = default if value == "skia-public-default" else value
    for name in POLICY_FIELDS:
        if type(effective[name]) is not int:
            raise RuntimeError("Every native policy enum/boolean must be an explicit integer")
    policy = Policy(**effective)
    library.atf_open.argtypes, library.atf_open.restype = [C.POINTER(C.c_uint8), C.c_size_t], C.c_void_p
    library.atf_close.argtypes = [C.c_void_p]
    library.atf_close.restype = None
    library.atf_effective_font.argtypes, library.atf_effective_font.restype = [C.c_void_p, C.POINTER(C.c_size_t)], C.POINTER(C.c_uint8)
    library.atf_shape.argtypes = [C.c_void_p, C.POINTER(C.c_uint8), C.c_size_t, C.c_float, C.c_float, C.POINTER(Policy)]
    library.atf_shape.restype = C.c_void_p
    library.atf_free_run.argtypes = [C.c_void_p]
    library.atf_free_run.restype = None
    library.atf_run_metrics.argtypes, library.atf_run_metrics.restype = [C.c_void_p, C.POINTER(Metrics)], C.c_int
    library.atf_copy_glyphs.argtypes, library.atf_copy_glyphs.restype = [C.c_void_p, C.POINTER(Glyph), C.c_size_t], C.c_int
    library.atf_paint.argtypes = [C.c_void_p, C.POINTER(C.c_uint8), C.c_size_t, C.c_uint32, C.c_uint32, C.c_uint32, C.c_float, C.c_float, C.c_uint32]
    library.atf_paint.restype = C.c_int
    def checked(value):
        if not value:
            raise RuntimeError(library.atf_error().decode("utf-8", "replace"))
        return value
    original = (C.c_uint8 * len(font)).from_buffer_copy(font)
    engine = checked(library.atf_open(original, len(font)))
    runs, samples = [], []
    try:
        effective_length = C.c_size_t()
        effective_pointer = checked(library.atf_effective_font(engine, C.byref(effective_length)))
        effective_font = C.string_at(effective_pointer, effective_length.value)
        (output / "effective-font.ttf").write_bytes(effective_font)
        # Shape once per logical font/text, then reuse the same immutable run at both DPRs.
        for sample in probe["samples"]:
            encoded = sample["text"].encode("utf-8")
            text = (C.c_uint8 * len(encoded)).from_buffer_copy(encoded)
            run = checked(library.atf_shape(engine, text, len(encoded), sample.get("fontSize", probe["font"]["size"]), probe["font"]["lineHeight"], C.byref(policy)))
            runs.append(run)
            metrics = Metrics()
            checked(library.atf_run_metrics(run, C.byref(metrics)))
            glyphs = (Glyph * metrics.glyph_count)()
            checked(library.atf_copy_glyphs(run, glyphs, metrics.glyph_count))
            samples.append({"id": sample["id"], "text": sample["text"], "metrics": fields(metrics), "glyphs": [fields(glyph) for glyph in glyphs], "origin": {"x": sample["x"], "lineY": sample["y"], "baselineY": sample["y"] + metrics.baseline_css, "method": "native/backend.go rounded ascent/descent plus floored half-leading, using native SkFont metrics"}})
        frames = []
        foreground = int(probe["foreground"][1:], 16)
        background = bytes.fromhex(probe["background"][1:]) + b"\xff"
        if len(background) != 4:
            raise RuntimeError("Expected the original opaque RGB background")
        for scale in probe["scales"]:
            width, height = probe["viewport"]["width"] * scale, probe["viewport"]["height"] * scale
            rgba = bytearray(background * (width * height))
            pixels = (C.c_uint8 * len(rgba)).from_buffer(rgba)
            for run, sample in zip(runs, probe["samples"], strict=True):
                checked(library.atf_paint(run, pixels, len(rgba), width, height, scale, sample["x"], sample["y"], foreground))
            if any(alpha != 255 for alpha in rgba[3::4]):
                raise RuntimeError("Native output lost the declared opaque-alpha contract")
            directory = output / f"scale-{scale}"
            directory.mkdir(exist_ok=True)
            image = png(width, height, bytes(rgba))
            (directory / "native.png").write_bytes(image)
            frames.append({"scale": scale, "path": f"scale-{scale}/native.png", "hash": digest(image), "width": width, "height": height})
        fixture_hash = digest((root / probe["fixture"]).read_bytes())
        identity = {"probeHash": digest(probe_bytes), "fixtureHash": fixture_hash, "fontHash": digest(font)}
        identity["sourceHash"] = digest(json.dumps([identity["probeHash"], fixture_hash, identity["fontHash"]], separators=(",", ":")).encode())
        if identity["sourceHash"] != pin["sourceHash"]:
            raise RuntimeError("Native source identity differs from declared probe")
        report = {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False, "browserEffectivePolicyVerified": False, "nativeScalerInternalsObserved": False, "nativePolicyScope": "Explicit SkFont and SkSurfaceProps requests; effective scaler/hint engine/mask is not instrumented", **identity, "originalFontTables": sfnt_tables(font), "effectiveFontTables": sfnt_tables(effective_font), "effectiveFontHash": digest(effective_font), "libraryHash": digest(library_path.read_bytes()), "driverHash": digest(pathlib.Path(__file__).read_bytes()), "policyHash": digest(policy_bytes), "requestedPolicy": requested, "nativePolicy": fields(policy), "hbUnits": "16.16 CSS px", "shapeReusedAcrossDPR": True, "samples": samples, "frames": frames}
        (output / "native-text.json").write_text(json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2) + "\n")
    finally:
        for run in runs:
            library.atf_free_run(run)
        library.atf_close(engine)

if __name__ == "__main__":
    main()
