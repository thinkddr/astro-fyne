// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import {
  assertReverseBehaviorTrace,
  reverseControlScenario,
} from "../src/reverse-behavior-contract.ts";

const args = process.argv.slice(2);
if (args.length !== 3)
  throw new Error("Usage: reverse-behavior.ts URL SCENE.json OUTPUT.json");
const [url, scenePath, outputPath] = args as [string, string, string];
const scene: unknown = JSON.parse(await readFile(scenePath, "utf8"));
const { initialValue } = reverseControlScenario(scene);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const response = await page.goto(url);
  if (!response?.ok())
    throw new Error(`Reverse browser host returned HTTP ${response?.status()}`);
  try {
    await page
      .locator('html[data-reverse-scene-actions-ready="true"]')
      .waitFor();
    const edit = page.locator('input[id="edit"]');
    const save = page.locator('button[id="save"]');
    await edit.waitFor();
    await save.waitFor();
    if ((await edit.inputValue()) !== initialValue)
      throw new Error(
        "Reverse browser field does not match the native initial scene",
      );
    if ((await edit.isDisabled()) || (await save.isDisabled()))
      throw new Error("Reverse browser controls are unexpectedly disabled");
    await edit.focus();
    await edit.press("End");
    await edit.pressSequentially("x");
    await edit.press("Enter");
    await edit.press("Enter");
    await edit.evaluate((element) => (element as HTMLInputElement).blur());
    await save.click();
    await edit.focus();
    await edit.press("End");
    await edit.pressSequentially("y");
    await edit.evaluate((element) => (element as HTMLInputElement).blur());
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    if (errors.length) throw new Error(errors.join("\n"));
    const trace = await page.evaluate(() => {
      const events = (
        window as unknown as {
          astroFyneReverseBehaviorTrace?: { events: unknown[] };
        }
      ).astroFyneReverseBehaviorTrace?.events;
      const edit = document.getElementById("edit");
      const save = document.getElementById("save");
      if (
        !events ||
        !(edit instanceof HTMLInputElement) ||
        !(save instanceof HTMLButtonElement)
      )
        throw new Error(
          "Reverse browser trace or semantic controls are missing",
        );
      return {
        schema: 1,
        events,
        finalValue: edit.value,
        disabled: { edit: edit.disabled, save: save.disabled },
      };
    });
    await writeFile(
      outputPath,
      JSON.stringify(assertReverseBehaviorTrace(trace, scene), null, 2) + "\n",
    );
  } catch (error) {
    if (errors.length)
      throw new Error(
        `Reverse browser errors:\n${errors.join("\n")}\n${String(error)}`,
      );
    throw error;
  }
} finally {
  await browser.close();
}
