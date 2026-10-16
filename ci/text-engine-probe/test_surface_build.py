#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Astro Fyne contributors.
"""Hosted negative controls for missing or contradictory actual build receipts."""
import importlib.util
import pathlib
import unittest
from driver import validate_surface_contract

spec = importlib.util.spec_from_file_location("surface_build", pathlib.Path(__file__).with_name("surface-build.py"))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class BuildReceipts(unittest.TestCase):
    def test_replayed_contract_does_not_cover_changed_native_source(self):
        sources = {name: "a" * 64 for name in ["build.rs", "text_engine.cc", "text_engine.h"]}
        contract = {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
                    "nativeScalerInternalsObserved": False, "system": "Linux", "machine": "aarch64",
                    "requiredR32Shift": 16, "libraryHash": "c" * 64,
                    "sourceHashes": {"assembly/" + name: value for name, value in sources.items()}}
        validate_surface_contract(contract, "c" * 64, sources)
        for name in sources:
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, "compiled source differs"):
                validate_surface_contract(contract, "c" * 64, {**sources, name: "b" * 64})
        for changed in [{"schema": True}, {"diagnosticOnly": 1}, {"pixelPerfectVerified": 0},
                        {"nativeScalerInternalsObserved": 0}, {"requiredR32Shift": True}, {"requiredR32Shift": 16.0},
                        {"requiredR32Shift": 0}, {"system": "Darwin"}, {"machine": "x86_64"},
                        {"libraryHash": "b" * 64}]:
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                validate_surface_contract({**contract, **changed}, "c" * 64, sources)

    def test_old_cargo_command_without_public_define_is_rejected(self):
        old = ('[astro-fyne-fontations-experiment 0.0.0] running: "clang++" "-DSK_RELEASE" '
               '"-c" "/tmp/skia/src/ports/SkTypeface_fontations.cpp"')
        commands = build.cargo_commands(old)
        with self.assertRaisesRegex(RuntimeError, "SK_R32_SHIFT=16"):
            build.compile_sources(commands, ["src/ports/SkTypeface_fontations.cpp"])
        fixed = old.replace('"-DSK_RELEASE"', '"-DSK_RELEASE" "-DSK_R32_SHIFT=16"')
        selected = build.compile_sources(build.cargo_commands(fixed), ["src/ports/SkTypeface_fontations.cpp"])
        self.assertEqual(len(selected), 1)

    def test_conflicting_or_hidden_public_definitions_are_rejected(self):
        for flags in [[], ["-DSK_R32_SHIFT=0"],
                      ["-DSK_R32_SHIFT=16", "-USK_R32_SHIFT"],
                      ["-DSK_R32_SHIFT=16", "-DSK_R32_SHIFT=16"],
                      ["-DSK_R32_SHIFT=16", "-DSK_B32_SHIFT=16"],
                      ["-DSK_R32_SHIFT=16", "-DSK_USER_CONFIG_HEADER=other.h"],
                      ["-DSK_R32_SHIFT=16", "@hidden.rsp"],
                      ["-DSK_R32_SHIFT=16", "-include", "hidden.h"]]:
            with self.subTest(flags=flags), self.assertRaises(RuntimeError):
                build.public_defines(["clang++", *flags])
        build.public_defines(["clang++", "-D", "SK_R32_SHIFT=16", "-DSK_GAMMA_APPLY_TO_A8"])

    def test_missing_and_duplicate_actual_source_commands_fail(self):
        command = ["clang++", "-DSK_R32_SHIFT=16", "-c", "../../src/core/SkBitmapDevice.cpp"]
        with self.assertRaisesRegex(RuntimeError, "Missing"):
            build.compile_sources([command], build.SKIA_SOURCES)
        with self.assertRaisesRegex(RuntimeError, "Duplicate"):
            build.compile_sources([command, command], ["src/core/SkBitmapDevice.cpp"])

    def test_failed_or_changed_cabi_compiler_is_not_a_success_receipt(self):
        receipt = {"schema": 1, "diagnosticOnly": True, "pixelPerfectVerified": False,
                   "returncode": 0, "compilerHashBefore": "a" * 64,
                   "compilerHashAfter": "a" * 64,
                   "argv": ["clang++", "-DSK_R32_SHIFT=16", "/tmp/assembly/text_engine.cc"]}
        build.validate_cabi(receipt)
        for changed in [{"returncode": 1}, {"returncode": None}, {"returncode": False}, {"schema": True},
                        {"diagnosticOnly": 1}, {"pixelPerfectVerified": 0}, {"compilerHashAfter": "b" * 64},
                        {"argv": ["clang++", "/tmp/assembly/text_engine.cc"]}]:
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                build.validate_cabi({**receipt, **changed})


if __name__ == "__main__":
    unittest.main()
