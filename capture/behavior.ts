// SPDX-License-Identifier: Apache-2.0
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
if (args.length !== 3)
  throw new Error("Usage: behavior.ts URL SCENARIO.json OUTPUT.json");
const [url, scenarioPath, outputPath] = args as [string, string, string];
const scenario = JSON.parse(await readFile(scenarioPath, "utf8")) as {
  ids: string[];
  actions: string[];
};
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(url);
  if (!response?.ok())
    throw new Error(`Browser scenario returned ${response?.status()}`);
  await page.locator('html[data-conformance-ready="true"]').waitFor();
  const frames: { action: string; nodes: Record<string, string> }[] = [];
  async function snapshot(action: string) {
    const nodes = await page.evaluate(
      (ids) =>
        Object.fromEntries(
          ids.map((id) => {
            const element = document.getElementById(id);
            return [id, element ? (element.textContent ?? "") : "<absent>"];
          }),
        ),
      scenario.ids,
    );
    frames.push({ action, nodes });
  }
  await snapshot("initial");
  for (const action of scenario.actions) {
    await page.locator(`[id="${action}"]`).click();
    await page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => done())),
    );
    await snapshot(action);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const trace = await page.evaluate(() => {
    const value = (
      window as unknown as {
        astroFyneBehaviorTrace?: {
          observations: unknown[];
          unexpectedCalls: string[];
        };
      }
    ).astroFyneBehaviorTrace;
    if (!value) throw new Error("Browser host trace is missing");
    return value;
  });
  await writeFile(
    outputPath,
    JSON.stringify({ frames, ...trace }, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
