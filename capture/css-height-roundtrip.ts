// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { validateJavascriptArchive } from "../src/javascript.ts";
import type { JavascriptArchive } from "../src/javascript-types.ts";
import { captureCSSHeightQuantization } from "./css-height-quantization.ts";

declare global {
  interface Window {
    afyHeight: {
      ready(): boolean;
      export(): JavascriptArchive;
      advance(time: number): void;
      pause(): void;
      play(): void;
      clock(time: number): void;
      reads(): number;
      unmount(): void;
    };
    afyHeightCancelled: number;
  }
}
type Rect = { x: number; y: number; width: number; height: number };
type Sample = {
  timeMs: number;
  objects: Record<string, Rect>;
  snapshot: Record<string, Rect>;
  image: string;
};
const ids = ["height-root", "height-panel", "height-sibling"];
async function committed(page: Page, timeMs: number) {
  await page.waitForFunction(
    (time) =>
      window.afyHeight?.ready() &&
      window.afyHeight.export().animation!.timeMs === time,
    timeMs,
  );
}
async function geometry(page: Page) {
  return page.evaluate(
    (ids) =>
      Object.fromEntries(
        ids.map((id) => {
          const element = document.getElementById(id);
          if (!element) throw new Error(`Missing ${id}`);
          const { x, y, width, height } = element.getBoundingClientRect();
          return [id, { x, y, width, height }];
        }),
      ),
    ids,
  );
}
function compareRects(
  actual: Record<string, Rect>,
  expected: Record<string, Rect>,
) {
  for (const id of ids)
    for (const key of ["x", "y", "width", "height"] as const)
      assert.ok(
        Math.abs(actual[id]![key] - expected[id]![key]) < 0.0001,
        `${id}.${key}: browser ${actual[id]![key]} native ${expected[id]![key]}`,
      );
}
async function comparePixels(
  page: Page,
  native: Buffer,
  web: Buffer,
  strict = true,
) {
  const diff = await page.evaluate(
    async ([native, web]) => {
      async function pixels(encoded: string) {
        const img = new Image();
        img.src = "data:image/png;base64," + encoded;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return {
          width: img.width,
          height: img.height,
          data: ctx.getImageData(0, 0, img.width, img.height).data,
        };
      }
      const a = await pixels(native!),
        b = await pixels(web!);
      if (a.width !== b.width || a.height !== b.height)
        throw new Error("Viewport pixel sizes differ");
      let changedPixels = 0,
        maxChannelDelta = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        let changed = false;
        for (let channel = 0; channel < 4; channel++) {
          const delta = Math.abs(a.data[i + channel]! - b.data[i + channel]!);
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          if (delta) changed = true;
        }
        if (changed) changedPixels++;
      }
      return {
        width: a.width,
        height: a.height,
        changedPixels,
        maxChannelDelta,
      };
    },
    [native.toString("base64"), web.toString("base64")],
  );
  if (strict)
    assert.equal(
      diff.changedPixels,
      0,
      "CSS height profile has differing RGBA pixels",
    );
  return diff;
}
export async function captureCSSHeight(base: string, out: string) {
  const evidence = JSON.parse(
    await readFile(join(out, "native-height.json"), "utf8"),
  ) as {
    schema: number;
    kind: string;
    codeHash: string;
    samples: Sample[];
    restoredInitial: Sample;
    restoredContinued: Sample;
    fractionalSample: Sample;
    easedSample: Sample;
  };
  const archive = await validateJavascriptArchive(
      JSON.parse(await readFile(join(out, "source.javascript.json"), "utf8")),
    ),
    checkpoint = await validateJavascriptArchive(
      JSON.parse(
        await readFile(join(out, "checkpoint.javascript.json"), "utf8"),
      ),
    );
  assert.equal(evidence.schema, 1);
  assert.equal(evidence.kind, "astro-fyne-css-height-native-evidence");
  assert.equal(evidence.codeHash, archive.codeHash);
  assert.equal(evidence.samples.length, 8);
  const browser = await chromium.launch({ headless: true }),
    errors: string[] = [],
    profiles: unknown[] = [];
  try {
    const original = await browser.newPage({
        viewport: { width: 320, height: 240 },
        deviceScaleFactor: 1,
      }),
      generated = await browser.newPage({
        viewport: { width: 320, height: 240 },
        deviceScaleFactor: 1,
      });
    for (const page of [original, generated])
      page.on("pageerror", (error) => errors.push(error.message));
    assert.equal(
      (await original.goto(base + "/css-height-original"))?.ok(),
      true,
    );
    await original.waitForFunction(
      () =>
        document.getElementById("height-panel")?.getAnimations().length === 1,
    );
    await original.evaluate(() =>
      document.getElementById("height-panel")!.getAnimations()[0]!.pause(),
    );
    assert.equal(
      (await generated.goto(base + "/css-height-roundtrip"))?.ok(),
      true,
    );
    await committed(generated, 0);
    await generated.evaluate((ids) => {
      (window as any).heightObjects = ids.map((id) =>
        document.getElementById(id),
      );
    }, ids);
    for (const sample of evidence.samples) {
      await original.evaluate((time) => {
        document
          .getElementById("height-panel")!
          .getAnimations()[0]!.currentTime = time;
      }, sample.timeMs);
      await generated.evaluate(
        (time) => window.afyHeight.advance(time),
        sample.timeMs,
      );
      await committed(generated, sample.timeMs);
      compareRects(await geometry(original), sample.objects);
      compareRects(await geometry(generated), sample.objects);
      compareRects(sample.snapshot, sample.objects);
      assert.equal(
        await generated.evaluate(
          (ids) =>
            ids.every(
              (id, index) =>
                document.getElementById(id) ===
                (window as any).heightObjects[index],
            ),
          ids,
        ),
        true,
      );
      assert.equal(
        await generated.evaluate(
          () => document.getElementById("height-panel")!.getAnimations().length,
        ),
        0,
        "generated frames must not install another CSS animation",
      );
      const sourcePNG = await original.screenshot({
          path: join(out, `source-height-${sample.timeMs}ms.png`),
        }),
        webPNG = await generated.screenshot({
          path: join(out, `web-height-${sample.timeMs}ms.png`),
        }),
        nativePNG = await readFile(join(out, sample.image));
      profiles.push({
        timeMs: sample.timeMs,
        sourceNative: await comparePixels(original, nativePNG, sourcePNG),
        generatedNative: await comparePixels(generated, nativePNG, webPNG),
      });
    }
    const fractional = [];
    for (const [label, sample, eased] of [
      ["linear", evidence.fractionalSample, false],
      ["ease-in-out", evidence.easedSample, true],
    ] as const) {
      const page = await browser.newPage({
        viewport: { width: 320, height: 240 },
        deviceScaleFactor: 1,
      });
      page.on("pageerror", (error) => errors.push(error.message));
      assert.equal(
        (
          await page.goto(
            base + "/css-height-roundtrip" + (eased ? "?eased=1" : ""),
          )
        )?.ok(),
        true,
      );
      await committed(page, 0);
      await page.evaluate(
        (time) => window.afyHeight.advance(time),
        sample.timeMs,
      );
      await committed(page, sample.timeMs);
      await original.evaluate(
        ({ time, eased }) => {
          const panel = document.getElementById("height-panel")!;
          panel.classList.toggle("eased", eased);
          panel.getAnimations()[0]!.currentTime = time;
        },
        { time: sample.timeMs, eased },
      );
      const sourceBounds = await geometry(original),
        generatedBounds = await geometry(page),
        nativeBounds = sample.objects;
      const sourcePNG = await original.screenshot({
          path: join(out, `source-height-${label}-${sample.timeMs}ms.png`),
        }),
        webPNG = await page.screenshot({
          path: join(out, `web-height-${label}-${sample.timeMs}ms.png`),
        }),
        nativePNG = await readFile(join(out, sample.image));
      fractional.push({
        label,
        timeMs: sample.timeMs,
        certified: false,
        sourceBounds,
        generatedBounds,
        nativeBounds,
        sourceNative: await comparePixels(
          original,
          nativePNG,
          sourcePNG,
          false,
        ),
        generatedNative: await comparePixels(page, nativePNG, webPNG, false),
      });
    }
    const restored = await browser.newPage({
      viewport: { width: 320, height: 240 },
      deviceScaleFactor: 1,
    });
    restored.on("pageerror", (error) => errors.push(error.message));
    assert.equal(
      (await restored.goto(base + "/css-height-roundtrip?restore=1"))?.ok(),
      true,
    );
    await committed(restored, 350);
    compareRects(await geometry(restored), evidence.restoredInitial.objects);
    const first = await restored.evaluate(() => window.afyHeight.export());
    assert.deepEqual(first, checkpoint);
    await restored.evaluate(() => window.afyHeight.advance(600));
    await committed(restored, 600);
    compareRects(await geometry(restored), evidence.restoredContinued.objects);
    const invalid = await restored.evaluate(() => {
      const rejected = [],
        before = window.afyHeight.export(),
        nodes = [...document.querySelectorAll("[id]")];
      for (const time of [NaN, Infinity, 599, -1, 1e12 + 1])
        try {
          window.afyHeight.advance(time);
        } catch {
          rejected.push(String(time));
        }
      return {
        rejected,
        before,
        archive: window.afyHeight.export(),
        sameNodes: nodes.every(
          (node) => document.getElementById(node.id) === node,
        ),
      };
    });
    assert.equal(invalid.rejected.length, 5);
    assert.equal(invalid.archive.animation!.timeMs, 600);
    assert.deepEqual(
      invalid.archive,
      invalid.before,
      "invalid host seeks must preserve the entire checkpoint",
    );
    assert.equal(invalid.sameNodes, true);
    compareRects(await geometry(restored), evidence.restoredContinued.objects);
    await restored.evaluate(() => window.afyHeight.pause());
    await committed(restored, 600);
    assert.equal(
      (await restored.evaluate(() => window.afyHeight.export())).animation!
        .playState,
      "paused",
    );
    await restored.evaluate(() => window.afyHeight.advance(700));
    await committed(restored, 700);
    assert.equal(
      (await restored.evaluate(() => window.afyHeight.export())).animation!
        .playState,
      "paused",
    );
    const automatic = await browser.newPage({
      viewport: { width: 320, height: 240 },
      deviceScaleFactor: 1,
    });
    automatic.on("pageerror", (error) => errors.push(error.message));
    await automatic.addInitScript(() => {
      window.afyHeightCancelled = 0;
      const cancel = window.cancelAnimationFrame.bind(window);
      window.cancelAnimationFrame = (id) => {
        window.afyHeightCancelled++;
        cancel(id);
      };
    });
    assert.equal(
      (await automatic.goto(base + "/css-height-roundtrip?auto=1"))?.ok(),
      true,
    );
    await committed(automatic, 0);
    await automatic.evaluate(() => window.afyHeight.clock(350));
    await committed(automatic, 350);
    const playReads = await automatic.evaluate(() => {
      const before = window.afyHeight.reads();
      window.afyHeight.clock(600);
      window.afyHeight.play();
      return window.afyHeight.reads() - before;
    });
    assert.equal(
      playReads,
      1,
      "already-running play must sample one clock and retain elapsed time",
    );
    await committed(automatic, 600);
    await automatic.evaluate(() => window.afyHeight.pause());
    await committed(automatic, 600);
    await automatic.evaluate(() => window.afyHeight.clock(1100));
    assert.equal(
      (await automatic.evaluate(() => window.afyHeight.export())).animation!
        .timeMs,
      600,
    );
    await automatic.evaluate(() => window.afyHeight.play());
    await committed(automatic, 600);
    await automatic.evaluate(() => window.afyHeight.clock(1350));
    await committed(automatic, 850);
    const captures = await automatic.evaluate(() => [
      window.afyHeight.export(),
      window.afyHeight.export(),
    ]);
    assert.deepEqual(
      captures[0],
      captures[1],
      "capture must freeze one committed time without advancing",
    );
    const cancelled = await automatic.evaluate(() => window.afyHeightCancelled);
    await automatic.evaluate(() => window.afyHeight.unmount());
    await automatic.waitForFunction(() => !window.afyHeight.ready());
    assert.ok(
      (await automatic.evaluate(() => window.afyHeightCancelled)) > cancelled,
      "unmount must cancel its pending animation callback",
    );
    const unmounted = await automatic.evaluate(() => ({
      reads: window.afyHeight.reads(),
      panels: document.querySelectorAll(
        "#height-root,#height-panel,#height-sibling",
      ).length,
    }));
    await automatic.evaluate(async () => {
      window.afyHeight.clock(2000);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      );
    });
    assert.deepEqual(
      await automatic.evaluate(() => ({
        reads: window.afyHeight.reads(),
        panels: document.querySelectorAll(
          "#height-root,#height-panel,#height-sibling",
        ).length,
      })),
      unmounted,
      "unmounted timelines must stop reading their clock and changing DOM",
    );
    assert.equal(unmounted.panels, 0);
    assert.deepEqual(errors, []);
    const browserCheckpoint = await restored.evaluate(() =>
      window.afyHeight.export(),
    );
    for (const key of [
      "schema",
      "kind",
      "code",
      "codeHash",
      "sources",
      "stylesheets",
      "actions",
      "props",
    ] as const)
      assert.deepEqual(
        browserCheckpoint[key],
        archive[key],
        `browser checkpoint changed source ${key}`,
      );
    await writeFile(
      join(out, "browser-checkpoint.javascript.json"),
      JSON.stringify(browserCheckpoint, null, 2) + "\n",
    );
    await writeFile(
      join(out, "comparison.json"),
      JSON.stringify(
        {
          schema: 1,
          kind: "astro-fyne-css-height-comparison",
          codeHash: archive.codeHash,
          profiles,
          fractionalDiagnostics: fractional,
          pixelPerfectVerified: false,
          checkpointRestored: true,
          manualInvalidCallsPreserveFrame: true,
          controlledAutomaticClock: true,
          captureDoesNotPause: true,
          pendingCallbackCancelled: true,
          errors,
        },
        null,
        2,
      ) + "\n",
    );
    await captureCSSHeightQuantization(browser, out);
  } finally {
    await browser.close();
  }
}
