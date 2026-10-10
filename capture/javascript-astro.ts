// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import type { JavascriptFrame } from "../src/javascript-types.ts";
const [base, out] = process.argv.slice(2);
if (!base || !out)
  throw new Error("Usage: javascript-astro.ts <preview-url> <artifacts>");
const expected = JSON.parse(await readFile(join(out, "native.json"), "utf8"));
const browser = await chromium.launch({ headless: true }),
  errors: string[] = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(
    new URL("/javascript-roundtrip/JavascriptBrowser", base).href,
  );
  assert.ok(response?.ok());
  await page.locator("#js-count").waitFor({ state: "attached" });
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
  const initial = values(expected.frames[0]);
  const capture = () =>
    page.evaluate(
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
      Object.keys(initial),
    );
  const frames = [await capture()];
  assert.deepEqual(frames[0], initial);
  assert.deepEqual(
    await page.evaluate(() => window.afyJavascriptEvents ?? []),
    [],
    "Astro hydration repeated external effects",
  );
  await page
    .locator("#js-reorder")
    .evaluate((element) => (element as HTMLElement).click());
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
  frames.push(await capture());
  assert.deepEqual(frames[1], values(expected.frames[1]));
  assert.deepEqual(errors, []);
  await writeFile(
    join(out, "astro.json"),
    JSON.stringify({ passed: true, frames }, null, 2) + "\n",
  );
  console.log(
    "Astro JavaScript hydration passed: 2 native state frames; zero replayed effects.",
  );
} finally {
  await browser.close();
}
