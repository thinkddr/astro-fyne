// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import {
  behaviorScenarioHash,
  validateBehaviorScenario,
  validateBehaviorTrace,
  type BehaviorFrame,
} from "../src/behavior-contract.ts";

const args = process.argv.slice(2);
if (args.length !== 4)
  throw new Error(
    "Usage: keyed-behavior.ts URL SCENARIO.json OUTPUT.json SOURCE_SHA256",
  );
const [url, scenarioPath, outputPath, sourceHash] = args as [
  string,
  string,
  string,
  string,
];
const scenario = validateBehaviorScenario(
  JSON.parse(await readFile(scenarioPath, "utf8")),
);
const identity = { sourceHash, scenarioHash: behaviorScenarioHash(scenario) };
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(url);
  if (!response?.ok()) throw new Error("Keyed browser fixture did not load");
  await page.locator('html[data-keyed-ready="true"]').waitFor();
  await page.evaluate(() => {
    (
      window as unknown as {
        keyedOriginal: {
          a: Element | null;
          b: Element | null;
          branch: Element | null;
          x: Element | null;
          z: Element | null;
        };
      }
    ).keyedOriginal = {
      a: document.getElementById("a-input"),
      b: document.getElementById("b-input"),
      branch: document.getElementById("a-branch-input"),
      x: document.getElementById("side-X-input"),
      z: document.getElementById("side-Z-input"),
    };
  });
  const frames: BehaviorFrame[] = [];
  const observations: { prefix: string; previous: number }[] = [];
  async function snapshot(action: string) {
    const frame = await page.evaluate(
      ({ ids, action }) => {
        const nodes: Record<string, string | null> = Object.create(null);
        for (const id of ids) {
          const matches = document.querySelectorAll(`#${CSS.escape(id)}`);
          if (matches.length > 1)
            throw new Error(`Duplicate browser node: ${id}`);
          nodes[id] = matches.length ? (matches[0]!.textContent ?? "") : null;
        }
        const original = (
          window as unknown as {
            keyedOriginal: {
              a: Element | null;
              b: Element | null;
              branch: Element | null;
              x: Element | null;
              z: Element | null;
            };
          }
        ).keyedOriginal;
        const a =
            document.getElementById("a-renamed-input") ??
            document.getElementById("a-input"),
          b = document.getElementById("b-input");
        const branch = document.getElementById("a-branch-input");
        const x = document.getElementById("side-X-input");
        const z = document.getElementById("side-Z-input");
        const order = [...document.getElementById("keyed-list")!.children]
          .map((element) => element.id)
          .join(",");
        const primitiveOrder = [
          ...document.getElementById("primitive-list")!.children,
        ]
          .map((element) => element.id)
          .join(",");
        const sideOrder = [...document.getElementById("side-lists")!.children]
          .map((element) => element.id)
          .join(",");
        const code =
          order === "a-row,b-row"
            ? 12
            : order === "b-row,a-row"
              ? 21
              : order === "b-row"
                ? 2
                : order === "c-row,a-row,b-row"
                  ? 312
                  : order === "c-row,b-row,a-row"
                    ? 321
                    : order === "c-row,b-row"
                      ? 32
                      : -1;
        const primitiveCode =
          primitiveOrder === "x-primitive,y-primitive"
            ? 12
            : primitiveOrder === "y-primitive,x-primitive"
              ? 21
              : -1;
        const sideCode =
          sideOrder === "side-X-row,side-Y-row,side-Z-row"
            ? 234
            : sideOrder === "side-A-row,side-Z-row,side-X-row"
              ? 142
              : -1;
        if (code < 0 || primitiveCode < 0 || sideCode < 0)
          throw new Error("Unexpected keyed DOM order");
        const focus =
          document.activeElement === a
            ? 1
            : document.activeElement === b
              ? 2
              : branch !== null && document.activeElement === branch
                ? 4
                : x !== null && document.activeElement === x
                  ? 5
                  : z !== null && document.activeElement === z
                    ? 6
                    : document.activeElement === document.body
                      ? 0
                      : 3;
        return {
          action,
          nodes,
          measurements: [
            focus,
            Number(a !== null && a === original.a),
            Number(b !== null && b === original.b),
            code,
            primitiveCode,
            Number(branch !== null && branch === original.branch),
            Number(x !== null && x === original.x),
            Number(z !== null && z === original.z),
            sideCode,
          ],
        };
      },
      { ids: scenario.ids, action },
    );
    frames.push({ action: frame.action, nodes: frame.nodes });
    for (const [index, value] of frame.measurements.entries())
      observations.push({
        prefix: `${frames.length - 1}:${["focus", "same-a", "same-b", "order", "primitive-order", "same-branch-a", "same-x", "same-z", "side-order"][index]}`,
        previous: value,
      });
  }
  await snapshot("initial");
  for (const action of scenario.actions) {
    if (action === "focus-x" || action === "focus-z") {
      await page
        .locator(action === "focus-x" ? "#side-X-input" : "#side-Z-input")
        .focus();
    } else if (
      action === "edit-a" ||
      action === "edit-branch-a" ||
      action === "edit-b"
    ) {
      const input = page.locator(
        action === "edit-a"
          ? "#a-input, #a-renamed-input"
          : action === "edit-b"
            ? "#b-input"
            : "#a-branch-input",
      );
      await input.focus();
      await input.press("End");
      await input.pressSequentially("!");
    } else {
      // Programmatic click preserves input focus, like native Tappable.Tapped.
      // Pointer focus transfer is a different scenario and is not mixed in.
      await page
        .locator(`[id="${action}"]`)
        .evaluate((element) => (element as HTMLElement).click());
    }
    await page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => done())),
    );
    await snapshot(action);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const trace = validateBehaviorTrace(
    { schema: 1, ...identity, frames, observations, unexpectedCalls: [] },
    scenario,
    identity,
  );
  await writeFile(outputPath, JSON.stringify(trace, null, 2) + "\n");
} finally {
  await browser.close();
}
