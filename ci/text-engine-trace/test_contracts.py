#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Reject re-bound but contradictory native compile evidence."""
import json
import pathlib
import shlex
import tempfile
import unittest

from contracts import PROBE, binding, digest, driver, fontconfig_binding, read, requested_policy, surfaces


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = pathlib.Path(self.temp.name)
        self.evidence = self.work / "evidence"
        self.out = self.work / "driver-output"
        self.evidence.mkdir()
        self.out.mkdir()
        names = ["assembly/build.rs", "assembly/text_engine.cc", "assembly/text_engine.h",
                 "skia/BUILD.gn", "skia/include/core/SkTypes.h", "skia/include/core/SkColorType.h",
                 "skia/src/core/SkGlyphRunPainter.cpp", "skia/src/core/SkBitmapDevice.cpp"]
        for name in names + ["skia/src/ports/SkTypeface_fontations.cpp", "compiler"]:
            target = self.work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("fixture " + name)
        self.pin = {
            "controlInputs": {"ci/text-engine-probe/" + name: {"sha256": digest(self.work / "assembly" / name)}
                              for name in ["text_engine.cc", "text_engine.h"]},
            "files": {"build.rs.original": {"sha256": digest(self.work / "assembly/build.rs")},
                      "SkTypeface_fontations.cpp.original": {"sha256": digest(self.work / "skia/src/ports/SkTypeface_fontations.cpp")}},
            "fontationsSource": {"path": "src/ports/SkTypeface_fontations.cpp"},
        }
        skia = {name: ["clang++", "-DSK_R32_SHIFT=16", "-c", str(self.work / "skia" / name)]
                for name in ["src/core/SkBitmapDevice.cpp", "src/core/SkGlyphRunPainter.cpp"]}
        self.cargo = {}
        for name in ["src/ports/fontations/src/ffi.rs.cc", "src/ports/SkTypeface_fontations.cpp",
                     "src/ports/SkFontScanner_fontations.cpp", "src/ports/SkTypeface_proxy.cpp"]:
            target = self.work / "skia" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                target.write_text("source " + name)
            self.cargo[name] = ["clang++", "-DSK_R32_SHIFT=16", "-c", str(target)]
        (self.evidence / "skia-commands.txt").write_text("\n".join(shlex.join(argv) for argv in skia.values()) + "\n")
        self.write_cargo()
        library = self.evidence / "libastro_fyne_text_experiment.so"
        library.write_bytes(b"identified binary")
        archives = [self.work / name for name in ["skia/out/text-probe/libskia.a", "harfbuzz/out/libharfbuzz.a",
                    "ots/out/libots.a", "assembly/target/release/libastro_fyne_fontations_experiment.a"]]
        self.cabi = {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
                     "compiler": str(self.work / "compiler"), "compilerHashBefore": digest(self.work / "compiler"),
                     "compilerHashAfter": digest(self.work / "compiler"), "returncode": 0,
                     "argv": ["clang++", "-DSK_R32_SHIFT=16", str(self.work / "assembly/text_engine.cc"),
                              *map(str, archives), "-o", str(library)]}
        self.write_json(self.evidence / "cabi-command.json", self.cabi)
        self.contract = {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
                         "nativeScalerInternalsObserved": False, "system": "Linux", "machine": "aarch64",
                         "requiredR32Shift": 16, "libraryHash": digest(library),
                         "sourceHashes": {name: digest(self.work / name) for name in names},
                         "commands": {"skia": skia, "cargo": self.cargo, "cabi": self.cabi}}
        self.report = {"libraryHash": digest(library)}
        self.publish()

    def write_json(self, path, value):
        path.write_text(json.dumps(value) + "\n")

    def write_cargo(self):
        (self.evidence / "cargo-build.log").write_text("\n".join(
            "[astro-fyne-fontations-experiment 0.0.0] running: " + shlex.join(argv)
            for argv in self.cargo.values()) + "\n")

    def publish(self):
        self.contract["receiptHashes"] = {name: digest(self.evidence / name)
                                          for name in ["skia-commands.txt", "cargo-build.log", "cabi-command.json"]}
        path = self.evidence / "surface-build-contract.json"
        self.write_json(path, self.contract)
        (self.out / path.name).write_bytes(path.read_bytes())
        self.report["surfaceBuildContractHash"] = digest(path)

    def check(self):
        return binding(self.work, self.out, self.report, False, self.pin)

    def test_actual_compile_sources_are_bound(self):
        self.assertTrue(self.check()["threeCompileContextsVerified"])

    def test_current_build_script_cannot_be_replaced(self):
        (self.work / "assembly/build.rs").write_text("different script")
        self.contract["sourceHashes"]["assembly/build.rs"] = digest(self.work / "assembly/build.rs")
        self.publish()
        with self.assertRaisesRegex(RuntimeError, "build script"):
            self.check()

    def test_rehashed_cargo_r32_mismatch_still_fails(self):
        first = next(iter(self.cargo))
        self.cargo[first][1] = "-DSK_R32_SHIFT=0"
        self.write_cargo()
        self.publish()
        with self.assertRaisesRegex(RuntimeError, "SK_R32_SHIFT=16"):
            self.check()

    def test_rehashed_cabi_r32_mismatch_still_fails(self):
        self.cabi["argv"][1] = "-DSK_R32_SHIFT=0"
        self.write_json(self.evidence / "cabi-command.json", self.cabi)
        self.publish()
        with self.assertRaisesRegex(RuntimeError, "SK_R32_SHIFT=16"):
            self.check()

    def test_rebound_library_claim_cannot_replace_actual_binary(self):
        self.report["libraryHash"] = self.contract["libraryHash"] = "0" * 64
        self.publish()
        with self.assertRaisesRegex(RuntimeError, "actual binary"):
            self.check()

    def test_trailing_output_flag_is_an_explicit_evidence_error(self):
        self.cabi["argv"].pop()
        self.write_json(self.evidence / "cabi-command.json", self.cabi)
        self.publish()
        with self.assertRaisesRegex(RuntimeError, "output operand"):
            self.check()

    def test_changed_surface_record_is_not_ignored(self):
        probe = {"samples": [{"id": "row-" + str(i)} for i in range(7)]}
        policy = {"pixel_geometry": 1, "contrast": 0.2, "gamma": 1.2}
        report = {"samples": probe["samples"], "nativePolicy": policy, "frames": []}
        for scale in [1, 2]:
            width, height = 512 * scale, 256 * scale
            record = {name: 0 for name, _ in driver.SurfaceMetadata._fields_}
            record.update(r32_shift=16, g32_shift=8, b32_shift=0, a32_shift=24,
                          cpu_little_endian=1, n32_color_type=6, rgba_color_type=4, bgra_color_type=6,
                          external_color_type=4, internal_color_type=6,
                          external_alpha_type=1, internal_alpha_type=1, external_srgb=1, internal_srgb=1,
                          width=width, height=height, external_row_bytes=width * 4, internal_row_bytes=width * 4,
                          internal_first_a=255, **policy)
            report["frames"].append({"scale": scale, "width": width, "height": height,
                                     "surfaces": [{"sampleId": sample["id"], **record} for sample in probe["samples"]]})
        self.assertEqual(surfaces(report, probe), 14)
        report["frames"][1]["surfaces"][3]["internal_color_type"] = 4
        with self.assertRaisesRegex(RuntimeError, "N32 contract"):
            surfaces(report, probe)
        report["frames"][1]["surfaces"][3]["internal_color_type"] = 6
        report["frames"][0]["surfaces"].pop()
        with self.assertRaisesRegex(RuntimeError, "surface"):
            surfaces(report, probe)
        report["frames"][0]["scale"] = True
        with self.assertRaisesRegex(RuntimeError, "surface"):
            surfaces(report, probe)


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = pathlib.Path(self.temp.name)
        (self.work / "sources.json").write_text("{}\n")
        (self.work / "fontconfig").mkdir()
        self.path = self.work / "fontconfig/fontconfig.json"
        self.policy = read(PROBE / "policy.json")
        expected = self.policy["fontconfigExpected"]
        self.config = {
            "schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
            "browserEffectivePolicyVerified": False, "policyAppliedToNative": False,
            "configEntriesStable": True, "observerHash": digest(PROBE / "observe-fontconfig.py"),
            "sourcePins": read(PROBE / "font-policy-source-pin.json"),
            "sourceManifestHash": digest(self.work / "sources.json"),
            "requestPolicyBinding": {"sha256": digest(PROBE / "policy.json"),
                                     "expectedPropertiesMatched": True, "expectedProperties": expected},
            "emptyQueryResult": {"properties": {name: {"result": 0, "present": True, "value": value}
                                                for name, value in expected.items()}},
        }
        self.path.write_text(json.dumps(self.config))

    def test_current_typed_policy_and_float32_requests(self):
        values = {name: self.policy[name] for name in [*driver.POLICY_FIELDS, "contrast", "gamma"]}
        report = {"policyHash": digest(PROBE / "policy.json"), "requestedPolicy": self.policy,
                  "nativePolicy": driver.fields(driver.Policy(**values))}
        requested_policy(report, PROBE / "policy.json")
        report["nativePolicy"]["gamma"] = self.policy["gamma"]
        with self.assertRaisesRegex(RuntimeError, "float32"):
            requested_policy(report, PROBE / "policy.json")

    def test_boolean_is_not_an_integer_request(self):
        policy = {**self.policy, "auto_hint": False}
        report = {"policyHash": digest(PROBE / "policy.json"), "requestedPolicy": policy}
        with self.assertRaisesRegex(RuntimeError, "typed requested"):
            requested_policy(report, PROBE / "policy.json")

    def test_current_fontconfig_sidecar(self):
        self.assertTrue(fontconfig_binding(self.work, self.work, self.policy)["accepted"])

    def test_missing_fontconfig_sidecar_fails(self):
        self.path.unlink()
        with self.assertRaises(OSError):
            fontconfig_binding(self.work, self.work, self.policy)

    def test_replayed_observer_or_policy_binding_fails(self):
        for field in ["observerHash", "sourceManifestHash"]:
            changed = {**self.config, field: "0" * 64}
            self.path.write_text(json.dumps(changed))
            with self.assertRaisesRegex(RuntimeError, "identities"):
                fontconfig_binding(self.work, self.work, self.policy)
        self.config["requestPolicyBinding"]["sha256"] = "0" * 64
        self.path.write_text(json.dumps(self.config))
        with self.assertRaisesRegex(RuntimeError, "request policy"):
            fontconfig_binding(self.work, self.work, self.policy)

    def test_fontconfig_boolean_does_not_pass_as_integer(self):
        self.config["emptyQueryResult"]["properties"]["rgba"]["value"] = True
        self.path.write_text(json.dumps(self.config))
        with self.assertRaisesRegex(RuntimeError, "typed request"):
            fontconfig_binding(self.work, self.work, self.policy)


if __name__ == "__main__":
    unittest.main()
