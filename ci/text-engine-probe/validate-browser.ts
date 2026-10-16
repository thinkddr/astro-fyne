// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrowserProvenance } from "../../capture/browser-provenance-validation.ts";
import {
  readTypographyProbe,
  typographyHash,
} from "../../capture/typography.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { probe, identity } = await readTypographyProbe(
  resolve(root, "typography-probe.json"),
);
const directory = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Expected browser evidence directory");
validateBrowserProvenance(
  JSON.parse(
    await readFile(resolve(directory, "browser-provenance.json"), "utf8"),
  ),
  JSON.parse(await readFile(resolve(directory, "browser-text.json"), "utf8")),
  {
    identity,
    collectorHash: typographyHash(
      await readFile(resolve(root, "capture/browser-provenance.ts")),
    ),
    captureHash: typographyHash(
      await readFile(resolve(root, "capture/typography-probe.ts")),
    ),
    viewport: probe.viewport,
    scales: probe.scales,
  },
);
