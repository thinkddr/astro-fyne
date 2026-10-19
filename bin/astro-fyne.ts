#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { main } from "../src/cli.ts";

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
