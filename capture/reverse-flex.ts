// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import type { ElementHandle } from "playwright";
import { validateSceneDocument } from "../src/reverse.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i],
    value = process.argv[i + 1];
  if (
    !key ||
    !["--mode", "--url", "--out", "--source-hash"].includes(key) ||
    !value ||
    args.has(key)
  )
    throw new Error("Invalid reverse-flex argument");
  args.set(key, value);
}
const mode = args.get("--mode"),
  url = args.get("--url"),
  sourceHash = args.get("--source-hash");
if (
  !["source", "scene"].includes(mode ?? "") ||
  !url ||
  !args.get("--out") ||
  !/^[a-f0-9]{64}$/.test(sourceHash ?? "")
)
  throw new Error(
    "Required: --mode source|scene --url URL --out DIR --source-hash SHA256",
  );
if (!["http:", "https:"].includes(new URL(url).protocol))
  throw new Error("Preview must use HTTP(S)");
const out = resolve(args.get("--out")!);
const hash = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const scenarioBytes = await readFile(
  new URL("../reverse-flex-scenario.json", import.meta.url),
);
const scenario = JSON.parse(scenarioBytes.toString()) as {
  schema: number;
  cases: { name: string; width: number; height: number; scale: number }[];
  ids: string[];
  buttons: string[];
  expectedPointerActions: string[];
  expectedFocusOrder: string[];
};
assert.equal(scenario.schema, 1);
assert.equal(scenario.cases.length, 6);
assert.ok(
  scenario.ids.length > 50 &&
    new Set(scenario.ids).size === scenario.ids.length,
);
assert.deepEqual(scenario.buttons, ["action-a", "action-b", "action-c"]);
const scenarioHash = hash(scenarioBytes);
const scene =
  mode === "scene"
    ? validateSceneDocument(
        JSON.parse(await readFile(join(out, "scene.json"), "utf8")),
      )
    : undefined;
if (scene) {
  assert.equal(scene.schema, 2);
  assert.equal(scene.layout, "flex");
  assert.equal(scene.roots[0]!.id, "reverse-flex");
}
const browser = await chromium.launch();
const errors: string[] = [];
let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
let page: Awaited<ReturnType<typeof browser.newPage>> | undefined;
let scale = 0;
let handles = new Map<string, ElementHandle>();
try {
  for (const item of scenario.cases) {
    assert.match(item.name, /^[A-Za-z0-9_-]+$/);
    assert.ok(
      [1, 2].includes(item.scale) && item.width > 0 && item.height === 1680,
    );
    const retained = context !== undefined && scale === item.scale;
    if (!retained) {
      await context?.close();
      context = await browser.newContext({
        viewport: { width: item.width, height: item.height },
        deviceScaleFactor: item.scale,
        colorScheme: "light",
      });
      page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      scale = item.scale;
      const response = await page.goto(url);
      assert.ok(response?.ok(), "Fixture did not load");
      await page.waitForFunction(
        (ids) => ids.every((id) => document.getElementById(id)),
        scenario.ids,
      );
      handles = new Map();
      for (const id of scenario.ids) {
        const handle = await page.locator(`[id="${id}"]`).elementHandle();
        assert.ok(handle);
        handles.set(id, handle);
      }
    } else {
      await handles.get(scenario.buttons[0]!)!.focus();
      await page!.setViewportSize({ width: item.width, height: item.height });
    }
    await page!.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
    });
    for (const [id, handle] of handles)
      assert.equal(
        await handle.evaluate(
          (el, id) => el === document.getElementById(id),
          id,
        ),
        true,
        `Resize remounted browser ${id}`,
      );
    if (retained)
      assert.equal(
        await handles
          .get(scenario.buttons[0]!)!
          .evaluate((el) => document.activeElement === el),
        true,
        "Resize lost source focus",
      );
    await page!.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
    const nodes = await page!.evaluate(
      ({ ids, sourceHash, source }) => {
        if (
          source &&
          document.documentElement.dataset.reverseFlexSourceHash !== sourceHash
        )
          throw new Error("Original source analysis differs");
        const root = document.getElementById("reverse-flex")!;
        const elements = [root, ...root.querySelectorAll("*")];
        if (
          elements.length !== ids.length ||
          elements.some((el) => !ids.includes(el.id)) ||
          root.textContent?.trim()
        )
          throw new Error("Fixture inventory or empty-text contract differs");
        return Object.fromEntries(
          ids.map((id) => {
            const matches = document.querySelectorAll(`[id="${id}"]`);
            if (matches.length !== 1) throw new Error("Duplicate/missing ID");
            const el = matches[0]!;
            if (!["DIV", "BUTTON"].includes(el.tagName))
              throw new Error("Unsupported fixture element");
            const css = getComputedStyle(el);
            if (
              css.direction !== "ltr" ||
              css.writingMode !== "horizontal-tb" ||
              css.flexWrap !== "nowrap" ||
              css.order !== "0" ||
              [
                css.marginTop,
                css.marginRight,
                css.marginBottom,
                css.marginLeft,
              ].some((v) => v !== "0px") ||
              css.transform !== "none" ||
              css.boxShadow !== "none" ||
              css.backgroundImage !== "none" ||
              css.opacity !== "1" ||
              [
                css.borderTopLeftRadius,
                css.borderTopRightRadius,
                css.borderBottomLeftRadius,
                css.borderBottomRightRadius,
              ].some((v) => v !== "0px")
            )
              throw new Error(`Unsupported fixture CSS at ${id}`);
            const border = [
              css.borderTopWidth,
              css.borderRightWidth,
              css.borderBottomWidth,
              css.borderLeftWidth,
            ];
            if (
              new Set(border).size !== 1 ||
              !Number.isInteger(parseFloat(border[0]!))
            )
              throw new Error(
                "Only uniform integral borders belong to this fixture",
              );
            const rect = el.getBoundingClientRect();
            const parent = id === "reverse-flex" ? null : el.parentElement;
            const origin = parent?.getBoundingClientRect();
            if (parent && !ids.includes(parent.id))
              throw new Error("Unexpected parent");
            const result = {
              parent: parent?.id ?? null,
              x: rect.x - (origin?.x ?? 0),
              y: rect.y - (origin?.y ?? 0),
              width: rect.width,
              height: rect.height,
              children: Array.from(el.children).map((child) => child.id),
            };
            if (
              ![result.x, result.y, result.width, result.height].every(
                Number.isFinite,
              )
            )
              throw new Error("Nonfinite geometry");
            return [id, result];
          }),
        );
      },
      { ids: scenario.ids, sourceHash, source: mode === "source" },
    );
    const directory = join(out, item.name);
    await mkdir(directory, { recursive: true });
    const screenshot = await page!.screenshot({
      path: join(directory, mode === "source" ? "web.png" : "inverse-web.png"),
    });
    await page!.evaluate(() => {
      (window as Window & { reverseFlexEvents?: string[] }).reverseFlexEvents =
        [];
    });
    const pointerOrder = [...scenario.buttons].sort(
      (a, b) => nodes[a]!.x - nodes[b]!.x,
    );
    for (const id of pointerOrder) {
      const box = await handles.get(id)!.boundingBox();
      assert.ok(box);
      await page!.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    const pointerActions = await page!.evaluate(
      () =>
        (window as Window & { reverseFlexEvents?: string[] }).reverseFlexEvents,
    );
    assert.deepEqual(
      pointerActions,
      scenario.expectedPointerActions,
      "Coordinate hits changed actions",
    );
    await handles.get(scenario.buttons[0]!)!.focus();
    const focusOrder = [scenario.buttons[0]!];
    for (let i = 1; i < scenario.buttons.length; i++) {
      await page!.keyboard.press("Tab");
      focusOrder.push(
        await page!.evaluate(() => document.activeElement?.id ?? ""),
      );
    }
    assert.deepEqual(
      focusOrder,
      scenario.expectedFocusOrder,
      "Reversal changed source navigation order",
    );
    await page!.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
    const record = {
      schema: 1,
      sourceHash,
      scenarioHash,
      case: item.name,
      viewport: { width: item.width, height: item.height, scale: item.scale },
      nodes,
      pointerActions,
      focusOrder,
      identityChecked: true,
      identityGroup: `scale-${item.scale}`,
      screenshotHash: hash(screenshot),
      browserVersion: browser.version(),
      visualVerified: false,
    };
    if (mode === "scene") {
      const native = JSON.parse(
        await readFile(join(directory, "source-native.json"), "utf8"),
      ) as {
        schema: number;
        sourceHash: string;
        scenarioHash: string;
        case: string;
        viewport: { width: number; height: number; scale: number };
        screenshotHash: string;
        nodes: typeof nodes;
        pointerActions: string[];
        focusOrder: string[];
      };
      assert.equal(native.schema, 1);
      assert.equal(native.sourceHash, sourceHash);
      assert.equal(native.scenarioHash, scenarioHash);
      assert.equal(native.case, item.name);
      assert.deepEqual(native.viewport, {
        width: item.width,
        height: item.height,
        scale: item.scale,
      });
      assert.equal(
        native.screenshotHash,
        hash(await readFile(join(directory, "source-native.png"))),
      );
      assert.deepEqual(
        Object.keys(native.nodes).sort(),
        Object.keys(nodes).sort(),
      );
      for (const id of scenario.ids) {
        const n = native.nodes[id]!,
          web = nodes[id]!;
        assert.deepEqual(web.children, n.children);
        assert.equal(web.parent, n.parent);
        for (const key of ["x", "y", "width", "height"] as const)
          assert.ok(
            Math.abs(web[key] - n[key]) <= 1 / 64,
            `Inverse geometry differs: ${id}.${key}`,
          );
      }
      assert.deepEqual(pointerActions, native.pointerActions);
      assert.deepEqual(focusOrder, native.focusOrder);
    }
    await writeFile(
      join(directory, mode === "source" ? "web.json" : "inverse-web.json"),
      JSON.stringify(record, null, 2) + "\n",
    );
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
} finally {
  await context?.close();
  await browser.close();
}
