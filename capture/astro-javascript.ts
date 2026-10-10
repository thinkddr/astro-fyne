// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import type { JavascriptFrame } from "../src/javascript-types.ts";

const [base, out] = process.argv.slice(2);
if (!base || !out)
  throw new Error("Usage: astro-javascript.ts <preview-url> <artifacts>");
const expected = JSON.parse(await readFile(join(out, "native.json"), "utf8"));
const scenario = JSON.parse(await readFile(join(out, "scenario.json"), "utf8"));
const values = (frames: JavascriptFrame[]) => {
  const result: Record<string, string> = {};
  const text = (frame: JavascriptFrame): string =>
    frame.tag === "#text"
      ? (frame.text ?? "")
      : (frame.children ?? []).map(text).join("");
  const walk = (frames: JavascriptFrame[]) => {
    for (const frame of frames) {
      if (frame.attrs?.id)
        result[frame.attrs.id] =
          frame.tag === "input" ? (frame.value ?? "") : text(frame);
      walk(frame.children ?? []);
    }
  };
  walk(frames);
  return result;
};
const browser = await chromium.launch({ headless: true });
const result: Record<string, unknown[]> = {};
try {
  for (const [name, path] of [
    ["original", "/astro-javascript-original"],
    ["restored", "/astro-javascript-roundtrip/JavascriptBrowser"],
  ]) {
    const page = await browser.newPage(),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(new URL(path!, base).href);
    assert.ok(response?.ok());
    await page.locator("#astro-js-count").waitFor({ state: "attached" });
    await page.waitForFunction(
      () => document.querySelectorAll("astro-island[ssr]").length === 0,
    );
    const settle = () =>
      page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
    await settle();
    const perform = async (step: { id: string; value?: string }) => {
      const element = page.locator(`[id=${JSON.stringify(step.id)}]`);
      if (step.value !== undefined) {
        await element.selectText();
        await element.pressSequentially(step.value);
        await element.evaluate((element) => (element as HTMLElement).blur());
      } else
        await element.evaluate((element) => (element as HTMLElement).click());
      await settle();
    };
    if (name === "original")
      for (const step of scenario.prefix) await perform(step);
    const frames: unknown[] = [];
    for (let i = 0; i <= scenario.suffix.length; i++) {
      if (i) await perform(scenario.suffix[i - 1]);
      const expectedValues = values(expected.frames[i]);
      const actual = await page.evaluate(
        (ids) =>
          Object.fromEntries(
            ids.map((id) => {
              const element = document.getElementById(id)!;
              return [
                id,
                element instanceof HTMLInputElement
                  ? element.value
                  : element.textContent,
              ];
            }),
          ),
        Object.keys(expectedValues),
      );
      assert.deepEqual(
        actual,
        expectedValues,
        `${name} Astro differs from generated Go at frame ${i}`,
      );
      frames.push(actual);
    }
    assert.deepEqual(errors, [], `${name} Astro page errors`);
    result[name!] = frames;
    await page.close();
  }
  await writeFile(
    join(out, "astro.json"),
    JSON.stringify({ passed: true, frames: result }, null, 2) + "\n",
  );
  console.log(
    `Original/restored Astro JavaScript passed: ${Object.values(result).reduce((total, frames) => total + frames.length, 0)} native state frames.`,
  );
} finally {
  await browser.close();
}
