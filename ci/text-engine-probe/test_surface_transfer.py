#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Hosted C ABI controls with fixed channel expectations, never reference pixels."""
import argparse
import ctypes as C
import json
import pathlib

from driver import FONT_HASH, Policy, SurfaceMetadata, digest, fields, surface_metadata


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--library", type=pathlib.Path, required=True)
    parser.add_argument("--source-root", type=pathlib.Path, required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    library = C.CDLL(str(args.library.resolve(strict=True)))
    library.atf_error.restype = C.c_char_p
    library.atf_abi_size.argtypes, library.atf_abi_size.restype = [C.c_uint32], C.c_size_t
    require(library.atf_abi_size(4) == C.sizeof(SurfaceMetadata), "Surface ABI size mismatch")
    require(library.atf_abi_size(5) == 0, "Unknown ABI index was accepted")
    library.atf_last_surface_metadata.argtypes = [C.POINTER(SurfaceMetadata), C.c_size_t]
    library.atf_last_surface_metadata.restype = C.c_int
    metadata = SurfaceMetadata()
    C.memset(C.byref(metadata), 0xa5, C.sizeof(metadata))
    untouched_metadata = bytes(metadata)
    require(library.atf_last_surface_metadata(C.byref(metadata), C.sizeof(metadata)) == 0,
            "Metadata was fabricated before a successful paint")
    require(bytes(metadata) == untouched_metadata, "Missing metadata changed output")
    library.atf_open.argtypes, library.atf_open.restype = [C.POINTER(C.c_uint8), C.c_size_t], C.c_void_p
    library.atf_close.argtypes, library.atf_close.restype = [C.c_void_p], None
    library.atf_shape.argtypes = [C.c_void_p, C.POINTER(C.c_uint8), C.c_size_t, C.c_float, C.c_float, C.POINTER(Policy)]
    library.atf_shape.restype = C.c_void_p
    library.atf_free_run.argtypes, library.atf_free_run.restype = [C.c_void_p], None
    library.atf_paint.argtypes = [C.c_void_p, C.POINTER(C.c_uint8), C.c_size_t, C.c_uint32,
                               C.c_uint32, C.c_uint32, C.c_float, C.c_float, C.c_uint32]
    library.atf_paint.restype = C.c_int
    font = (args.source_root / "example/public/fonts/NotoSans-Regular.ttf").read_bytes()
    require(digest(font) == FONT_HASH, "Transfer control font differs from the declared source")
    original = (C.c_uint8 * len(font)).from_buffer_copy(font)
    engine = library.atf_open(original, len(font))
    require(engine, "Could not open transfer-control font")
    # The glyph is entirely outside the surface, so expected bytes are authored constants.
    policy = Policy(3, 1, 1, 1, 0, 2, 1, 1, 0.2, 1.2)
    text = (C.c_uint8 * 1)(ord("A"))
    run = None
    checks = []
    try:
        run = library.atf_shape(engine, text, 1, 14, 20, C.byref(policy))
        require(run, "Could not shape transfer-control text")
        colors = [(0, 1, 255, 255), (255, 128, 0, 255), (127, 254, 1, 255),
                  (17, 35, 43, 255), (1, 127, 128, 255), (254, 255, 127, 255)]
        for scale, width, height in [(1, 3, 2), (2, 5, 3)]:
            raw = bytes(channel for i in range(width * height) for channel in colors[i % len(colors)])
            guard = b"\xa5" * 16
            memory = bytearray(guard + raw + guard)
            pixels = (C.c_uint8 * len(raw)).from_buffer(memory, len(guard))
            require(library.atf_paint(run, pixels, len(raw), width, height, scale, -1024, -1024, 0x11232b) == 1,
                    "Off-canvas transfer failed: " + library.atf_error().decode("utf-8", "replace"))
            require(memory == guard + raw + guard, "RGBA→N32→RGBA changed fixed channel bytes or guards")
            observed = surface_metadata(library, width, height, policy)
            require([observed[name] for name in ["internal_first_b", "internal_first_g", "internal_first_r", "internal_first_a"]]
                    == [255, 1, 0, 255], "Actual N32 first pixel is not the fixed BGRA conversion")
            checks.append({"kind": "opaque-transfer", "scale": scale, "width": width, "height": height,
                           "inputHash": digest(raw), "outputHash": digest(bytes(pixels)), "surface": observed})

        width, height = 3, 2
        raw = bytes(channel for color in colors for channel in color)
        for label, overrides, alpha in [
            ("null-run", {"run": None}, None), ("null-output", {"nullOutput": True}, None),
            ("short-buffer", {"length": len(raw) - 1}, None), ("zero-width", {"width": 0}, None),
            ("oversize-width", {"width": 4097}, None), ("invalid-scale", {"scale": 3}, None),
            ("nan-origin", {"x": float("nan")}, None), ("infinite-origin", {"y": float("inf")}, None),
            ("invalid-color", {"color": 0x1000000}, None),
            ("transparent-alpha", {}, 0), ("partial-alpha", {}, 254),
        ]:
            memory = bytearray(b"\xa5" * 16 + raw + b"\x5a" * 16)
            pixels = (C.c_uint8 * len(raw)).from_buffer(memory, 16)
            if alpha is not None:
                pixels[3] = alpha
            before = bytes(memory)
            arguments = {"run": run, "length": len(raw), "width": width, "height": height,
                         "scale": 1, "x": 0, "y": 0, "color": 0x11232b, **overrides}
            result = library.atf_paint(arguments["run"], None if arguments.get("nullOutput") else pixels,
                                       arguments["length"], arguments["width"], arguments["height"],
                                       arguments["scale"], arguments["x"], arguments["y"], arguments["color"])
            require(result == 0, "Invalid paint was accepted: " + label)
            require(bytes(memory) == before, "Failed paint mutated caller bytes: " + label)
            checks.append({"kind": "invalid-call", "case": label, "bytesUnchanged": True,
                           "error": library.atf_error().decode("utf-8", "replace")})

        # Invalid metadata output must not overwrite even a previously successful observation.
        for size in [0, C.sizeof(metadata) - 1, C.sizeof(metadata) + 1]:
            require(library.atf_last_surface_metadata(C.byref(metadata), size) == 0,
                    "Wrong metadata output size was accepted")
            require(bytes(metadata) == untouched_metadata, "Wrong metadata size changed caller output")
        require(library.atf_last_surface_metadata(None, C.sizeof(metadata)) == 0, "Null metadata output was accepted")
        require(library.atf_last_surface_metadata(C.byref(metadata), C.sizeof(metadata)) == 1,
                "Failed calls discarded the last successful metadata")
        require(fields(metadata) == observed, "Failed paint changed last-success metadata")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
                                       "nativeScalerInternalsObserved": False, "libraryHash": digest(args.library.read_bytes()),
                                       "fontHash": digest(font), "checks": checks,
                                       "metadataOutputErrorsAtomic": True}, indent=2, allow_nan=False) + "\n")
    finally:
        if run:
            library.atf_free_run(run)
        library.atf_close(engine)


if __name__ == "__main__":
    main()
