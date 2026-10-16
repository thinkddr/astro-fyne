#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Hosted native full-surface/region equivalence; no browser image input."""
import argparse
import ctypes as C
import json
import math
import pathlib

from driver import (FONT_HASH, POLICY_FIELDS, Glyph, Metrics, Policy, SurfaceMetadata,
                    compiled_source_hashes, digest, fields, png, surface_metadata,
                    validate_surface_contract)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def differences(first, second):
    require(len(first) == len(second) and len(first) % 4 == 0, "RGBA lengths differ")
    changed = sum(first[i:i + 4] != second[i:i + 4] for i in range(0, len(first), 4))
    delta = max((abs(a - b) for a, b in zip(first, second, strict=True)), default=0)
    return {"changedPixels": changed, "maxChannelDelta": delta}


def crop(raw, width, box):
    x, y, w, h = box
    return b"".join(raw[((y + row) * width + x) * 4:((y + row) * width + x + w) * 4]
                    for row in range(h))


def copy_back(canvas, width, box, region):
    x, y, w, h = box
    require(len(region) == w * h * 4, "Region copy-back size differs")
    for row in range(h):
        offset = ((y + row) * width + x) * 4
        canvas[offset:offset + w * 4] = region[row * w * 4:(row + 1) * w * 4]


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
    report = {"schema": 1, "diagnosticOnly": True, "accepted": False,
              "pixelPerfectVerified": False, "browserEffectivePolicyVerified": False,
              "nativeScalerInternalsObserved": False, "browserEvidenceRead": False,
              "testHash": digest(pathlib.Path(__file__).read_bytes()),
              "stage": "initializing", "cases": [], "checks": [],
              "scope": "Standalone native region transport, not browser/Fyne widget/editor/inverse/GPU parity"}

    def save():
        (out / "region-transfer.json").write_text(json.dumps(
            report, indent=2, ensure_ascii=False, allow_nan=False) + "\n")

    def image(name, width, height, raw):
        path = out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        data = png(width, height, raw)
        path.write_bytes(data)
        return {"path": name, "width": width, "height": height,
                "hash": digest(data), "rgbaHash": digest(raw)}

    library, engine, run = None, None, None
    save()
    try:
        probe_bytes = (root / "typography-probe.json").read_bytes()
        probe = json.loads(probe_bytes)
        pin = json.loads((source / "probe-pin.json").read_bytes())
        font = (root / probe["font"]["path"]).read_bytes()
        require(digest(probe_bytes) == pin["probeHash"] and digest(font) == FONT_HASH == pin["fontHash"]
                and digest((root / probe["fixture"]).read_bytes()) == pin["fixtureHash"],
                "Region controls require the unchanged original font, source and fixture")
        require(probe["scales"] == [1, 2] and len(probe["samples"]) == 7
                and probe["samples"][0]["text"] == "Hgx", "Unexpected original probe")
        policy_bytes = (source / "policy.json").read_bytes()
        requested = json.loads(policy_bytes)
        require(all(type(requested[name]) is int for name in POLICY_FIELDS)
                and all(type(requested[name]) in [int, float] and math.isfinite(requested[name])
                        for name in ["contrast", "gamma"]), "Invalid explicit typed native policy")
        policy = Policy(**{name: requested[name] for name in POLICY_FIELDS + ["contrast", "gamma"]})
        library_path = args.library.resolve(strict=True)
        contract_bytes = args.surface_build_contract.read_bytes()
        contract = json.loads(contract_bytes)
        current_sources = compiled_source_hashes(root)
        validate_surface_contract(contract, digest(library_path.read_bytes()), current_sources)
        expected_receipts = {"skia-commands.txt", "cargo-build.log", "cabi-command.json"}
        require(set(contract["receiptHashes"]) == expected_receipts, "Incomplete actual compiler receipts")
        for name, expected in contract["receiptHashes"].items():
            require(digest((args.surface_build_contract.parent / name).read_bytes()) == expected,
                    "Changed actual compiler receipt: " + name)
        report.update(libraryHash=digest(library_path.read_bytes()),
                      currentCompiledSourceHashes=current_sources,
                      fontHash=digest(font), probeHash=digest(probe_bytes),
                      fixtureHash=pin["fixtureHash"], sourceHash=pin["sourceHash"],
                      policyHash=digest(policy_bytes), requestedPolicy=requested,
                      nativePolicy=fields(policy), surfaceBuildContractHash=digest(contract_bytes),
                      compilerReceiptHashes=contract["receiptHashes"])
        library = C.CDLL(str(library_path))
        library.atf_error.restype = C.c_char_p
        library.atf_abi_size.argtypes, library.atf_abi_size.restype = [C.c_uint32], C.c_size_t
        for index, structure in enumerate([Policy, Glyph, Metrics, SurfaceMetadata], 1):
            require(library.atf_abi_size(index) == C.sizeof(structure), "Region native ABI size mismatch")
        library.atf_open.argtypes, library.atf_open.restype = [C.POINTER(C.c_uint8), C.c_size_t], C.c_void_p
        library.atf_close.argtypes, library.atf_close.restype = [C.c_void_p], None
        library.atf_effective_font.argtypes = [C.c_void_p, C.POINTER(C.c_size_t)]
        library.atf_effective_font.restype = C.POINTER(C.c_uint8)
        library.atf_shape.argtypes = [C.c_void_p, C.POINTER(C.c_uint8), C.c_size_t,
                                     C.c_float, C.c_float, C.POINTER(Policy)]
        library.atf_shape.restype = C.c_void_p
        library.atf_free_run.argtypes, library.atf_free_run.restype = [C.c_void_p], None
        library.atf_run_metrics.argtypes, library.atf_run_metrics.restype = [C.c_void_p, C.POINTER(Metrics)], C.c_int
        library.atf_copy_glyphs.argtypes = [C.c_void_p, C.POINTER(Glyph), C.c_size_t]
        library.atf_copy_glyphs.restype = C.c_int
        paint = [C.POINTER(C.c_uint8), C.c_size_t, C.c_uint32, C.c_uint32,
                 C.c_uint32, C.c_float, C.c_float, C.c_uint32]
        snapshot = [C.c_void_p, C.POINTER(Glyph), C.c_size_t, C.c_float, C.c_float, C.POINTER(Policy)]
        library.atf_paint.argtypes, library.atf_paint.restype = [C.c_void_p] + paint, C.c_int
        library.atf_paint_snapshot.argtypes, library.atf_paint_snapshot.restype = snapshot + paint, C.c_int
        library.atf_paint_snapshot_region.argtypes = snapshot + paint + [C.c_int32, C.c_int32]
        library.atf_paint_snapshot_region.restype = C.c_int
        library.atf_last_surface_metadata.argtypes = [C.POINTER(SurfaceMetadata), C.c_size_t]
        library.atf_last_surface_metadata.restype = C.c_int

        def checked(result):
            require(result, library.atf_error().decode("utf-8", "replace"))
            return result

        font_memory = (C.c_uint8 * len(font)).from_buffer_copy(font)
        engine = checked(library.atf_open(font_memory, len(font)))
        effective_size = C.c_size_t()
        effective = checked(library.atf_effective_font(engine, C.byref(effective_size)))
        report["effectiveFontHash"] = digest(C.string_at(effective, effective_size.value))
        encoded = b"Hgx"
        text = (C.c_uint8 * len(encoded)).from_buffer_copy(encoded)
        size, line_height = probe["font"]["size"], probe["font"]["lineHeight"]
        run = checked(library.atf_shape(engine, text, len(encoded), size, line_height, C.byref(policy)))
        metrics = Metrics()
        checked(library.atf_run_metrics(run, C.byref(metrics)))
        require(metrics.glyph_count > 0, "Native Hgx control is empty")
        glyphs = (Glyph * metrics.glyph_count)()
        checked(library.atf_copy_glyphs(run, glyphs, metrics.glyph_count))
        report["sample"] = {"text": "Hgx", "fontSize": size, "lineHeight": line_height,
                            "metrics": fields(metrics), "glyphs": [fields(g) for g in glyphs]}
        colors = [(0, 1, 255, 255), (255, 128, 0, 255), (127, 254, 1, 255),
                  (17, 35, 43, 255), (1, 127, 128, 255), (254, 255, 127, 255)]
        report["backgroundColorsRGBA"] = colors
        foreground = int(probe["foreground"][1:], 16)
        origins = [
            ("positive-quarter", 8.25, 9.125), ("negative-quarter", -0.25, -0.125),
            ("negative-half-below", -0.5000000596046448, -0.5000000596046448),
            ("negative-half", -0.5, -0.5),
            ("negative-half-above", -0.4999999701976776, -0.4999999701976776),
            ("y-half-below", 16.25, 17.499998092651367),
            ("y-half", 16.25, 17.5), ("y-half-above", 16.25, 17.500001907348633),
            ("x-half-below", 17.499998092651367, 8.125),
            ("x-half", 17.5, 8.125), ("x-half-above", 17.500001907348633, 8.125),
        ]
        references = []
        report["stage"] = "original-native-references"
        for scale in [1, 2]:
            width, height = 96 * scale, 64 * scale
            background = bytes(channel for y in range(height) for x in range(width)
                               for channel in colors[(x + 3 * y) % len(colors)])
            for label, x, y in origins:
                x, y = C.c_float(x).value, C.c_float(y).value
                raw = bytearray(background)
                pixels = (C.c_uint8 * len(raw)).from_buffer(raw)
                checked(library.atf_paint(run, pixels, len(raw), width, height, scale, x, y, foreground))
                coverage = differences(raw, background)["changedPixels"]
                require(coverage > 0, "Original native control painted no glyphs: " + label)
                name = f"scale-{scale}/{label}"
                reference = image(name + "/original.png", width, height, raw)
                record = {"id": label, "scale": scale, "width": width, "height": height,
                          "originCSS": {"x": x, "y": y}, "backgroundHash": digest(background),
                          "visibleGlyphPixels": coverage, "original": reference, "regions": []}
                report["cases"].append(record)
                references.append((record, background, bytes(raw)))
        library.atf_free_run(run)
        run = None
        report["originalRunFreedBeforeAnyRegionPaint"] = True
        report["stage"] = "regions"
        save()
        prefix, suffix = b"\xa5" * 16, b"\x5a" * 16
        for record, background, original in references:
            width, height, scale = record["width"], record["height"], record["scale"]
            x, y = record["originCSS"]["x"], record["originCSS"]["y"]
            name = f"scale-{scale}/{record['id']}"
            assembled = bytearray(background)
            covered = 0
            for index, box in enumerate([(0, 0, 13, 17), (13, 0, width - 13, 17),
                                         (0, 17, 13, height - 17), (13, 17, width - 13, height - 17)]):
                rx, ry, rw, rh = box
                initial = crop(background, width, box)
                expected = crop(original, width, box)
                memory = bytearray(prefix + initial + suffix)
                pixels = (C.c_uint8 * len(initial)).from_buffer(memory, len(prefix))
                checked(library.atf_paint_snapshot_region(engine, glyphs, len(glyphs), size, line_height,
                                                         C.byref(policy), pixels, len(initial), rw, rh,
                                                         scale, x, y, foreground, rx, ry))
                actual = bytes(pixels)
                png_record = image(name + f"/region-{index}.png", rw, rh, actual)
                delta = differences(actual, expected)
                item = {"boxPhysical": list(box), **delta, "png": png_record,
                        "surface": surface_metadata(library, rw, rh, policy),
                        "guardsUnchanged": memory[:16] == prefix and memory[-16:] == suffix}
                record["regions"].append(item)
                save()
                require(item["guardsUnchanged"], "Region paint changed guards: " + name)
                require(delta["changedPixels"] == 0, "Native region differs from full-native crop: " + name)
                partial = bytearray(background)
                copy_back(partial, width, box, actual)
                for row in range(height):
                    start, end = row * width * 4, (row + 1) * width * 4
                    if ry <= row < ry + rh:
                        left, right = start + rx * 4, start + (rx + rw) * 4
                        require(partial[start:left] == background[start:left]
                                and partial[right:end] == background[right:end], "Copy-back escaped horizontal clip")
                        require(partial[left:right] == original[left:right], "Copy-back changed original region placement")
                    else:
                        require(partial[start:end] == background[start:end], "Copy-back escaped vertical clip")
                item["outsideClipUnchanged"] = True
                item["partial"] = image(name + f"/partial-{index}.png", width, height, partial)
                covered += differences(actual, initial)["changedPixels"]
                copy_back(assembled, width, box, actual)
            record["recomposed"] = image(name + "/recomposed.png", width, height, assembled)
            record["recomposedDifference"] = differences(assembled, original)
            require(record["recomposedDifference"]["changedPixels"] == 0
                    and covered == record["visibleGlyphPixels"], "Region partition lost visible native glyph pixels")
            # Record the old Go float32 origin rebasing only as a non-gating diagnostic.
            box = (13, 17, width - 13, height - 17)
            initial, expected = crop(background, width, box), crop(original, width, box)
            legacy = bytearray(initial)
            pixels = (C.c_uint8 * len(legacy)).from_buffer(legacy)
            legacy_x, legacy_y = C.c_float(x - box[0] / scale).value, C.c_float(y - box[1] / scale).value
            checked(library.atf_paint_snapshot(engine, glyphs, len(glyphs), size, line_height,
                                             C.byref(policy), pixels, len(legacy), box[2], box[3],
                                             scale, legacy_x, legacy_y, foreground))
            record["legacyOriginRebaseDiagnostic"] = {
                "usedForAcceptance": False, "boxPhysical": list(box),
                "rebasedOriginCSS": {"x": legacy_x, "y": legacy_y},
                **differences(legacy, expected), "png": image(name + "/legacy-rebased.png", box[2], box[3], legacy)}
            save()
        report["stage"] = "empty-and-invalid-controls"
        raw = bytes(channel for color in colors for channel in color)
        for scale in [1, 2]:
            for dx, dy in [(13, 17), (-3, 5), (-4096, 4096), (4096, -4096)]:
                memory = bytearray(prefix + raw + suffix)
                before = bytes(memory)
                pixels = (C.c_uint8 * len(raw)).from_buffer(memory, 16)
                checked(library.atf_paint_snapshot_region(engine, None, 0, size, line_height,
                                                         C.byref(policy), pixels, len(raw), 3, 2,
                                                         scale, 17.499998092651367, -0.5, foreground, dx, dy))
                require(bytes(memory) == before, "Empty-glyph region changed destination/guards")
                report["checks"].append({"kind": "empty-glyph-region", "scale": scale,
                                         "destinationOffsetPhysical": [dx, dy], "bytesUnchanged": True,
                                         "surface": surface_metadata(library, 3, 2, policy)})
        last = SurfaceMetadata()
        checked(library.atf_last_surface_metadata(C.byref(last), C.sizeof(last)))
        invalid = [("x-minus-4097", {"dx": -4097}), ("x-plus-4097", {"dx": 4097}),
                   ("y-minus-4097", {"dy": -4097}), ("y-plus-4097", {"dy": 4097}),
                   ("scale-zero", {"scale": 0}), ("scale-three", {"scale": 3}),
                   ("transparent", {"alpha": 0}), ("partial-alpha", {"alpha": 127}),
                   ("empty-width", {"width": 0}), ("empty-height", {"height": 0}),
                   ("short-buffer", {"length": len(raw) - 1})]
        for label, overrides in invalid:
            memory = bytearray(prefix + raw + suffix)
            if "alpha" in overrides:
                memory[16 + 3] = overrides["alpha"]
            before = bytes(memory)
            pixels = (C.c_uint8 * len(raw)).from_buffer(memory, 16)
            values = {"dx": 13, "dy": 17, "scale": 1, "width": 3, "height": 2,
                      "length": len(raw), **overrides}
            result = library.atf_paint_snapshot_region(engine, glyphs, len(glyphs), size, line_height,
                                                      C.byref(policy), pixels, values["length"], values["width"],
                                                      values["height"], values["scale"], 0.25, -0.5,
                                                      foreground, values["dx"], values["dy"])
            error = library.atf_error().decode("utf-8", "replace")
            require(result == 0 and error and bytes(memory) == before,
                    "Invalid region was accepted or changed destination/guards: " + label)
            observed = SurfaceMetadata()
            checked(library.atf_last_surface_metadata(C.byref(observed), C.sizeof(observed)))
            require(bytes(observed) == bytes(last), "Invalid region changed last-success metadata: " + label)
            report["checks"].append({"kind": "invalid-region", "case": label,
                                     "bytesUnchanged": True, "lastMetadataUnchanged": True, "error": error})
        report.update(stage="complete", accepted=True)
        save()
    except Exception as error:
        report.update(stage="failed", error=str(error))
        save()
        raise
    finally:
        if library is not None and run:
            library.atf_free_run(run)
        if library is not None and engine:
            library.atf_close(engine)


if __name__ == "__main__":
    main()
