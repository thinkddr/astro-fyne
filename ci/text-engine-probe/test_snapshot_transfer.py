#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Hosted immutable glyph snapshot, empty-line and failed-call controls."""
import argparse
import ctypes as C
import json
import pathlib

from driver import (FONT_HASH, POLICY_FIELDS, Glyph, Metrics, Policy, SurfaceMetadata,
                    compiled_source_hashes, digest, fields, png, surface_metadata, validate_surface_contract)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--library", type=pathlib.Path, required=True)
    parser.add_argument("--source-root", type=pathlib.Path, required=True)
    parser.add_argument("--surface-build-contract", type=pathlib.Path, required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    root, out = args.source_root.resolve(), args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    source = pathlib.Path(__file__).resolve().parent
    probe_bytes = (root / "typography-probe.json").read_bytes()
    probe = json.loads(probe_bytes)
    font = (root / probe["font"]["path"]).read_bytes()
    pin = json.loads((source / "probe-pin.json").read_bytes())
    require(digest(probe_bytes) == pin["probeHash"] and digest(font) == FONT_HASH == pin["fontHash"]
            and digest((root / probe["fixture"]).read_bytes()) == pin["fixtureHash"],
            "Snapshot controls require the unchanged source, fixture and font")
    require(probe["scales"] == [1, 2] and len(probe["samples"]) == 7,
            "Snapshot controls require both DPRs and all seven original rows")
    policy_bytes = (source / "policy.json").read_bytes()
    requested = json.loads(policy_bytes)
    policy = Policy(**{name: requested[name] for name in POLICY_FIELDS + ["contrast", "gamma"]})
    library_path = args.library.resolve(strict=True)
    library_hash = digest(library_path.read_bytes())
    contract_bytes = args.surface_build_contract.read_bytes()
    validate_surface_contract(json.loads(contract_bytes), library_hash, compiled_source_hashes(root))
    library = C.CDLL(str(library_path))
    library.atf_error.restype = C.c_char_p
    library.atf_abi_size.argtypes, library.atf_abi_size.restype = [C.c_uint32], C.c_size_t
    for index, structure in enumerate([Policy, Glyph, Metrics, SurfaceMetadata], 1):
        require(library.atf_abi_size(index) == C.sizeof(structure), "Native snapshot ABI size mismatch")
    library.atf_open.argtypes, library.atf_open.restype = [C.POINTER(C.c_uint8), C.c_size_t], C.c_void_p
    library.atf_close.argtypes, library.atf_close.restype = [C.c_void_p], None
    library.atf_shape.argtypes = [C.c_void_p, C.POINTER(C.c_uint8), C.c_size_t, C.c_float, C.c_float, C.POINTER(Policy)]
    library.atf_shape.restype = C.c_void_p
    library.atf_free_run.argtypes, library.atf_free_run.restype = [C.c_void_p], None
    library.atf_run_metrics.argtypes, library.atf_run_metrics.restype = [C.c_void_p, C.POINTER(Metrics)], C.c_int
    library.atf_copy_glyphs.argtypes, library.atf_copy_glyphs.restype = [C.c_void_p, C.POINTER(Glyph), C.c_size_t], C.c_int
    paint_args = [C.POINTER(C.c_uint8), C.c_size_t, C.c_uint32, C.c_uint32,
                  C.c_uint32, C.c_float, C.c_float, C.c_uint32]
    library.atf_paint.argtypes, library.atf_paint.restype = [C.c_void_p] + paint_args, C.c_int
    library.atf_paint_snapshot.argtypes = [C.c_void_p, C.POINTER(Glyph), C.c_size_t,
                                         C.c_float, C.c_float, C.POINTER(Policy)] + paint_args
    library.atf_paint_snapshot.restype = C.c_int
    library.atf_last_surface_metadata.argtypes = [C.POINTER(SurfaceMetadata), C.c_size_t]
    library.atf_last_surface_metadata.restype = C.c_int

    def checked(result):
        require(result, library.atf_error().decode("utf-8", "replace"))
        return result

    font_memory = (C.c_uint8 * len(font)).from_buffer_copy(font)
    engine = checked(library.atf_open(font_memory, len(font)))
    runs, snapshots, frames, checks = [], [], [], []
    empty_run = None
    try:
        for sample in probe["samples"]:
            encoded = sample["text"].encode("utf-8")
            text = (C.c_uint8 * len(encoded)).from_buffer_copy(encoded)
            size = sample.get("fontSize", probe["font"]["size"])
            run = checked(library.atf_shape(engine, text, len(encoded), size,
                                           probe["font"]["lineHeight"], C.byref(policy)))
            runs.append(run)
            metrics = Metrics()
            checked(library.atf_run_metrics(run, C.byref(metrics)))
            glyphs = (Glyph * metrics.glyph_count)()
            checked(library.atf_copy_glyphs(run, glyphs, metrics.glyph_count))
            snapshots.append({"sample": sample, "fontSize": size, "metrics": metrics, "glyphs": glyphs})

        background = bytes.fromhex(probe["background"][1:]) + b"\xff"
        require(len(background) == 4, "Expected an opaque RGB source background")
        foreground = int(probe["foreground"][1:], 16)
        originals = {}
        for scale in probe["scales"]:
            width, height = probe["viewport"]["width"] * scale, probe["viewport"]["height"] * scale
            raw = bytearray(background * (width * height))
            pixels = (C.c_uint8 * len(raw)).from_buffer(raw)
            for run, sample in zip(runs, probe["samples"], strict=True):
                checked(library.atf_paint(run, pixels, len(raw), width, height, scale,
                                         sample["x"], sample["y"], foreground))
            originals[scale] = bytes(raw)
            (out / f"original-{scale}.png").write_bytes(png(width, height, raw))
        colors = [(0, 1, 255, 255), (255, 128, 0, 255), (127, 254, 1, 255),
                  (17, 35, 43, 255), (1, 127, 128, 255), (254, 255, 127, 255)]
        colored = {}
        for scale in [1, 2]:
            width, height = 64 * scale, 40 * scale
            background_pixels = bytes(channel for i in range(width * height)
                                      for channel in colors[i % len(colors)])
            original_pixels = bytearray(background_pixels)
            pixels = (C.c_uint8 * len(original_pixels)).from_buffer(original_pixels)
            checked(library.atf_paint(runs[0], pixels, len(original_pixels), width, height,
                                     scale, -0.25, 0.125, foreground))
            require(bytes(original_pixels) != background_pixels, "Colored control painted no visible glyphs")
            colored[scale] = (background_pixels, bytes(original_pixels))
            (out / f"colored-original-{scale}.png").write_bytes(png(width, height, original_pixels))
        for run in runs:
            library.atf_free_run(run)
        runs.clear()

        # Every original run is destroyed before the copied records are painted.
        for scale in probe["scales"]:
            width, height = probe["viewport"]["width"] * scale, probe["viewport"]["height"] * scale
            guard = b"\xa5" * 16
            memory = bytearray(guard + background * (width * height) + guard)
            length = width * height * 4
            pixels = (C.c_uint8 * length).from_buffer(memory, len(guard))
            surfaces = []
            for snapshot in snapshots:
                sample, glyphs = snapshot["sample"], snapshot["glyphs"]
                checked(library.atf_paint_snapshot(engine, glyphs, len(glyphs), snapshot["fontSize"],
                                                 probe["font"]["lineHeight"], C.byref(policy), pixels,
                                                 length, width, height, scale, sample["x"], sample["y"], foreground))
                surfaces.append({"sampleId": sample["id"], **surface_metadata(library, width, height, policy)})
            actual = bytes(pixels)
            require(memory[:16] == guard and memory[-16:] == guard, "Snapshot paint changed guards")
            require(actual == originals[scale], "Freed-run glyph snapshots changed original full-frame RGBA")
            image = png(width, height, actual)
            (out / f"snapshot-{scale}.png").write_bytes(image)
            frames.append({"scale": scale, "width": width, "height": height, "changedPixels": 0,
                           "originalHash": digest((out / f"original-{scale}.png").read_bytes()),
                           "snapshotHash": digest(image), "rgbaHash": digest(actual), "surfaces": surfaces})

        for scale, (background_pixels, expected) in colored.items():
            width, height = 64 * scale, 40 * scale
            memory = bytearray(b"\xa5" * 16 + background_pixels + b"\x5a" * 16)
            pixels = (C.c_uint8 * len(background_pixels)).from_buffer(memory, 16)
            glyphs = snapshots[0]["glyphs"]
            checked(library.atf_paint_snapshot(engine, glyphs, len(glyphs), snapshots[0]["fontSize"],
                                             probe["font"]["lineHeight"], C.byref(policy), pixels,
                                             len(background_pixels), width, height, scale, -0.25, 0.125, foreground))
            require(bytes(pixels) == expected and memory[:16] == b"\xa5" * 16 and memory[-16:] == b"\x5a" * 16,
                    "Fractional snapshot changed colored backdrop blending, clipping or guards")
            image = png(width, height, bytes(pixels))
            (out / f"colored-snapshot-{scale}.png").write_bytes(image)
            checks.append({"kind": "colored-fractional-snapshot", "scale": scale, "width": width, "height": height,
                           "origin": {"x": -0.25, "lineY": 0.125}, "changedPixels": 0,
                           "backgroundHash": digest(background_pixels), "rgbaHash": digest(expected),
                           "pngHash": digest(image), "surface": surface_metadata(library, width, height, policy)})

        size, line_height = probe["font"]["size"], probe["font"]["lineHeight"]
        empty_run = checked(library.atf_shape(engine, None, 0, size, line_height, C.byref(policy)))
        empty_metrics = Metrics()
        checked(library.atf_run_metrics(empty_run, C.byref(empty_metrics)))
        require(empty_metrics.glyph_count == 0 and empty_metrics.advance_css == 0,
                "Empty text must be a zero-glyph zero-advance native line")
        expected_metrics = {**fields(snapshots[0]["metrics"]), "advance_css": 0.0, "glyph_count": 0}
        require(fields(empty_metrics) == expected_metrics, "Empty line lost the native font baseline/metrics")
        checked(library.atf_copy_glyphs(empty_run, None, 0))
        require(library.atf_copy_glyphs(empty_run, None, 1) == 0, "Wrong empty-line copy count was accepted")
        require(not library.atf_shape(engine, None, 1, size, line_height, C.byref(policy)),
                "Null nonempty text pointer was accepted")
        raw = bytes(channel for color in colors for channel in color)
        for scale in [1, 2]:
            for kind in ["empty-run", "empty-snapshot"]:
                memory = bytearray(b"\xa5" * 16 + raw + b"\x5a" * 16)
                before = bytes(memory)
                pixels = (C.c_uint8 * len(raw)).from_buffer(memory, 16)
                if kind == "empty-run":
                    result = library.atf_paint(empty_run, pixels, len(raw), 3, 2, scale, 0.25, -0.5, foreground)
                else:
                    result = library.atf_paint_snapshot(engine, None, 0, size, line_height, C.byref(policy),
                                                       pixels, len(raw), 3, 2, scale, 0.25, -0.5, foreground)
                checked(result)
                require(bytes(memory) == before, "Empty line changed fixed destination/guard bytes")
                checks.append({"kind": kind, "scale": scale, "bytesUnchanged": True,
                               "surface": surface_metadata(library, 3, 2, policy)})

        valid = snapshots[0]["glyphs"]
        cases = [
            ("null-engine", {"engine": None}), ("null-policy", {"policy": None}),
            ("null-nonempty-glyphs", {"glyphs": None}), ("oversize-count", {"count": 4097}),
            ("zero-font-size", {"size": 0}), ("nan-font-size", {"size": float("nan")}),
            ("infinite-line-height", {"heightCss": float("inf")}), ("zero-line-height", {"heightCss": 0}),
            ("null-output", {"nullOutput": True}), ("short-buffer", {"length": len(raw) - 1}),
            ("invalid-scale", {"scale": 3}), ("nan-origin", {"x": float("nan")}),
            ("invalid-color", {"color": 0x1000000}),
        ]
        for name, field, value in [
            ("zero-glyph", "glyph", 0), ("outside-face-glyph", "glyph", 65535),
            ("wide-glyph", "glyph", 65536), ("nan-nominal", "nominal_advance_css", float("nan")),
            ("infinite-nominal", "nominal_advance_css", float("inf")),
            ("nan-x", "x_css", float("nan")), ("infinite-y", "y_css", float("inf")),
        ]:
            bad = (Glyph * len(valid)).from_buffer_copy(bytes(valid))
            setattr(bad[-1], field, value)
            cases.append((name, {"glyphs": bad}))
        bad_policy = Policy.from_buffer_copy(bytes(policy))
        bad_policy.hinting = 4
        cases.append(("invalid-policy", {"policy": C.byref(bad_policy)}))
        last_success = SurfaceMetadata()
        checked(library.atf_last_surface_metadata(C.byref(last_success), C.sizeof(last_success)))
        for label, overrides in cases:
            memory = bytearray(b"\xa5" * 16 + raw + b"\x5a" * 16)
            before = bytes(memory)
            pixels = (C.c_uint8 * len(raw)).from_buffer(memory, 16)
            values = {"engine": engine, "glyphs": valid, "count": len(valid), "size": size,
                      "heightCss": line_height, "policy": C.byref(policy), "length": len(raw),
                      "scale": 1, "x": 0, "color": foreground, **overrides}
            result = library.atf_paint_snapshot(values["engine"], values["glyphs"], values["count"],
                                               values["size"], values["heightCss"], values["policy"],
                                               None if values.get("nullOutput") else pixels,
                                               values["length"], 3, 2, values["scale"], values["x"], 0, values["color"])
            error = library.atf_error().decode("utf-8", "replace")
            require(result == 0 and error, "Invalid snapshot was accepted: " + label)
            require(bytes(memory) == before, "Invalid snapshot changed caller bytes: " + label)
            metadata = SurfaceMetadata()
            checked(library.atf_last_surface_metadata(C.byref(metadata), C.sizeof(metadata)))
            require(bytes(metadata) == bytes(last_success), "Invalid snapshot changed last-success metadata")
            checks.append({"kind": "invalid-snapshot", "case": label, "bytesUnchanged": True, "error": error})
        (out / "snapshot-transfer.json").write_text(json.dumps({
            "schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
            "nativeScalerInternalsObserved": False, "libraryHash": library_hash,
            "testHash": digest(pathlib.Path(__file__).read_bytes()), "fontHash": digest(font),
            "probeHash": digest(probe_bytes), "policyHash": digest(policy_bytes),
            "surfaceBuildContractHash": digest(contract_bytes), "originalRunsFreedBeforeSnapshotPaint": True,
            "samples": [{"id": item["sample"]["id"], "fontSize": item["fontSize"],
                         "metrics": fields(item["metrics"]), "glyphs": [fields(glyph) for glyph in item["glyphs"]]}
                        for item in snapshots], "emptyMetrics": fields(empty_metrics),
            "frames": frames, "checks": checks,
            "scope": "Standalone immutable native glyph snapshots, not Fyne widget/editor/inverse/GPU parity",
        }, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    finally:
        if empty_run:
            library.atf_free_run(empty_run)
        for run in runs:
            library.atf_free_run(run)
        library.atf_close(engine)


if __name__ == "__main__":
    main()
