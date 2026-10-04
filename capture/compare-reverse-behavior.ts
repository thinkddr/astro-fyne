// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { readFile } from "node:fs/promises";
import { compareReverseBehaviorTraces } from "../src/reverse-behavior-contract.ts";

const args = process.argv.slice(2);
if (args.length !== 3)
  throw new Error(
    "Usage: compare-reverse-behavior.ts BROWSER.json NATIVE.json SCENE.json",
  );
const [browser, native, scene] = await Promise.all(
  args.map(async (path) => JSON.parse(await readFile(path, "utf8")) as unknown),
);
process.stdout.write(
  JSON.stringify(compareReverseBehaviorTraces(browser, native, scene)) + "\n",
);
