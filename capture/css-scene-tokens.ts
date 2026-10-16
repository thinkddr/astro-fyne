// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { validateSceneDocument } from "../src/reverse.ts";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index],
    value = process.argv[index + 1];
  assert.ok(
    key && ["--url", "--out"].includes(key) && value && !args.has(key),
    "Required: --url URL --out DIRECTORY",
  );
  args.set(key, value);
}
assert.equal(args.size, 2);
const url = new URL(args.get("--url")!);
assert.ok(["http:", "https:"].includes(url.protocol));
const out = resolve(args.get("--out")!);
const root = resolve(import.meta.dir, "..");
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const tokens = {
  "--Accent": "#112233",
  "--accent": "#445566",
  "--space": "8px",
  "--color-primary": "#11232b",
};
const prepared = JSON.parse(await readFile(join(out, "prepared.json"), "utf8"));
const entry = await readFile(
  join(root, "example/src/pages/css-token-roundtrip/CSSTokens.tsx"),
);
assert.equal(prepared.schema, 1);
assert.equal(prepared.sourceOnly, true);
assert.equal(prepared.preactHash, hash(entry));
assert.match(prepared.sourceHash, /^[a-f0-9]{64}$/);
assert.deepEqual(prepared.tokens, tokens);
const fixtureHash = hash(
  await readFile(join(root, "native/reverse/cmd/css-token-fixture/main.go")),
);
const generatedHash = hash(
  await readFile(join(root, "native/.css-token-roundtrip/css_tokens.gen.go")),
);
const browser = await chromium.launch();
try {
  for (const scale of [1, 2]) {
    const directory = join(out, `scale-${scale}`);
    const sceneBytes = await readFile(join(directory, "scene.json"));
    const scene = validateSceneDocument(
      JSON.parse(sceneBytes.toString("utf8")),
    );
    assert.equal(scene.schema, 2);
    assert.equal(scene.layout, "flex");
    assert.deepEqual(scene.tokens, tokens);
    assert.deepEqual(scene.viewport, { width: 160, height: 80, scale });
    for (const [name, screenshot] of [
      ["native", "native.png"],
      ["restored-native", "restored-native.png"],
    ] as const) {
      const evidence = JSON.parse(
        await readFile(join(directory, `${name}.json`), "utf8"),
      );
      assert.equal(evidence.schema, 1);
      assert.equal(evidence.sourceOnly, true);
      assert.deepEqual(evidence.tokens, tokens);
      assert.deepEqual(evidence.viewport, scene.viewport);
      assert.equal(
        evidence.screenshotHash,
        hash(await readFile(join(directory, screenshot))),
      );
      if (name === "native") assert.equal(evidence.fixtureHash, fixtureHash);
      else {
        assert.equal(evidence.sourceHash, prepared.sourceHash);
        assert.equal(evidence.originalSceneHash, hash(sceneBytes));
        assert.equal(evidence.globalThemeUnchanged, true);
        assert.equal(evidence.explicitTokensRequired, true);
      }
    }
    const context = await browser.newContext({
      viewport: { width: 160, height: 80 },
      deviceScaleFactor: scale,
      colorScheme: "light",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const response = await page.goto(url.href);
      assert.ok(response?.ok(), "Token fixture preview did not load");
      await page.locator("#css-token-root").waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      });
      const observed = await page.evaluate((names) => {
        const root = document.getElementById("css-token-root");
        const child = document.getElementById("css-token-box");
        if (
          !(root instanceof HTMLElement) ||
          !(child instanceof HTMLElement) ||
          child.parentElement !== root ||
          root.querySelectorAll("*").length !== 1 ||
          root.textContent !== ""
        )
          throw new Error("Token fixture DOM inventory differs");
        return {
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            scale: window.devicePixelRatio,
          },
          userAgent: navigator.userAgent,
          nodes: [root, child].map((node) => {
            if (document.querySelectorAll(`[id="${node.id}"]`).length !== 1)
              throw new Error("Duplicate token fixture ID");
            const css = getComputedStyle(node),
              rectangle = node.getBoundingClientRect();
            return {
              id: node.id,
              tag: node.tagName,
              className: node.className,
              rectangle: {
                x: rectangle.x,
                y: rectangle.y,
                width: rectangle.width,
                height: rectangle.height,
              },
              inline: Object.fromEntries(
                names.map((name) => [name, node.style.getPropertyValue(name)]),
              ),
              computed: Object.fromEntries(
                names.map((name) => [name, css.getPropertyValue(name)]),
              ),
              absentCase: css.getPropertyValue("--ACCENT"),
              background: css.backgroundColor,
            };
          }),
        };
      }, Object.keys(tokens));
      assert.deepEqual(observed.viewport, scene.viewport);
      assert.equal(observed.nodes.length, 2);
      const [rootNode, childNode] = observed.nodes;
      assert.ok(rootNode && childNode);
      assert.equal(rootNode.id, "css-token-root");
      assert.equal(childNode.id, "css-token-box");
      assert.deepEqual(rootNode.rectangle, {
        x: 0,
        y: 0,
        width: 160,
        height: 80,
      });
      assert.deepEqual(childNode.rectangle, {
        x: 16,
        y: 16,
        width: 80,
        height: 32,
      });
      assert.deepEqual(rootNode.inline, tokens);
      assert.deepEqual(
        childNode.inline,
        Object.fromEntries(Object.keys(tokens).map((name) => [name, ""])),
      );
      for (const node of observed.nodes) {
        assert.deepEqual(
          node.computed,
          tokens,
          `${node.id}: inherited literal token values differ`,
        );
        assert.equal(node.className, "");
        assert.equal(node.absentCase, "");
      }
      assert.equal(rootNode.background, "rgb(255, 255, 255)");
      assert.equal(childNode.background, "rgb(36, 100, 168)");
      assert.deepEqual(errors, []);
      const screenshot = await page.screenshot({ fullPage: false });
      assert.equal(screenshot.readUInt32BE(16), 160 * scale);
      assert.equal(screenshot.readUInt32BE(20), 80 * scale);
      await writeFile(join(directory, "web.png"), screenshot);
      await writeFile(
        join(directory, "web.json"),
        JSON.stringify(
          {
            schema: 1,
            accepted: true,
            sourceOnly: true,
            sceneHash: hash(sceneBytes),
            sourceHash: prepared.sourceHash,
            preactHash: hash(entry),
            generatedHash,
            fixtureHash,
            screenshotHash: hash(screenshot),
            browser: { name: "chromium", version: browser.version() },
            ...observed,
            errors,
            limitations: [
              "Literal custom-property inheritance only; no var()-driven native paint or authored stylesheet reconstruction.",
            ],
          },
          null,
          2,
        ) + "\n",
      );
    } catch (error) {
      await page
        .screenshot({
          path: join(directory, "failed-web.png"),
          fullPage: false,
        })
        .catch(() => {});
      await writeFile(
        join(directory, "web-failure.json"),
        JSON.stringify(
          {
            schema: 1,
            accepted: false,
            errors,
            message: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ) + "\n",
      );
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
