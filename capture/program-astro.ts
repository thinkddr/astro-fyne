// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, out] = process.argv.slice(2);
if (!url || !out)
  throw new Error(
    "Usage: program-astro.ts <preview-url> <roundtrip-artifacts>",
  );
const cases = JSON.parse(
  await readFile(join(out, "scenario.json"), "utf8"),
) as { name: string; ids: string[]; suffix: { id: string }[] }[];
const expected = JSON.parse(
  await readFile(join(out, "native-export.json"), "utf8"),
);
const browser = await chromium.launch({ headless: true }),
  traces: Record<string, unknown> = {};
try {
  const page = await browser.newPage(),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const c of cases) {
    const response = await page.goto(
      new URL(`/program-roundtrip/${c.name}/Portable${c.name}`, url).href,
    );
    assert.ok(response?.ok(), `Astro page ${c.name} did not load`);
    await page
      .locator(`[id=${JSON.stringify(c.ids[0])}]`)
      .waitFor({ state: "attached" });
    const capture = () =>
      page.evaluate((ids) => {
        const nodes: Record<string, string | null> = {};
        for (const id of ids) {
          const elements = document.querySelectorAll(`#${CSS.escape(id)}`);
          if (elements.length > 1)
            throw new Error("Duplicate Astro island node " + id);
          const element = elements[0];
          nodes[id] = element
            ? element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement
              ? element.value
              : element.textContent
            : null;
        }
        return nodes;
      }, c.ids);
    const frames = [await capture()];
    await page
      .locator(`[id=${JSON.stringify(c.suffix[0]!.id)}]`)
      .evaluate((element) => (element as HTMLElement).click());
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    frames.push(await capture());
    traces[c.name] = frames;
    assert.deepEqual(
      frames,
      expected[c.name].frames
        .slice(0, 2)
        .map((frame: { nodes: unknown }) => frame.nodes),
      `${c.name}: Astro hydration changed declared state`,
    );
  }
  assert.deepEqual(errors, [], "Astro island errors");
  await writeFile(
    join(out, "astro-traces.json"),
    JSON.stringify({ passed: true, traces }, null, 2) + "\n",
  );
  console.log(
    `Astro portable islands passed: ${cases.length} pages, ${cases.length * 2} state frames.`,
  );
} finally {
  await browser.close();
}
