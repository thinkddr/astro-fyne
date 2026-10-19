// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { validateJavascriptArchive } from "../src/javascript.ts";
import type { JavascriptArchive } from "../src/javascript-types.ts";
import {
  collectBrowserProvenance,
  verifyBrowserProvenance,
} from "./browser-provenance.ts";

type Rect = { x: number; y: number; width: number; height: number };
type Sample = {
  timeMs: number;
  objects: Record<string, Rect>;
  snapshot: Record<string, Rect>;
  archive: JavascriptArchive;
  image: string;
};
const ids = ["zero-root", "zero-panel", "zero-static", "zero-following"];
declare global {
  interface Window {
    afyZero: {
      ready(): boolean;
      export(): JavascriptArchive;
      advance(time: number): void;
      pause(): void;
      play(): void;
    };
    afyZeroObjects: (HTMLElement | null)[];
  }
}
async function json(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
async function committed(page: Page, time: number, state?: string) {
  await page.waitForFunction(
    ({ time, state }) =>
      window.afyZero?.ready() &&
      window.afyZero.export().animation!.timeMs === time &&
      (!state || window.afyZero.export().animation!.playState === state),
    { time, state },
  );
}
async function rects(page: Page) {
  return page.evaluate(
    (ids) =>
      Object.fromEntries(
        ids.map((id) => {
          const node = document.getElementById(id);
          if (!node) throw new Error(`Missing ${id}`);
          const { x, y, width, height } = node.getBoundingClientRect();
          return [id, { x, y, width, height }];
        }),
      ),
    ids,
  );
}
async function retainObjects(page: Page) {
  await page.evaluate((ids) => {
    window.afyZeroObjects = ids.map((id) => document.getElementById(id));
  }, ids);
}
async function stableObjects(page: Page) {
  assert.equal(
    await page.evaluate(
      (ids) =>
        ids.every(
          (id, index) =>
            document.getElementById(id) === window.afyZeroObjects[index],
        ),
      ids,
    ),
    true,
    "zero flow replaced a browser node",
  );
}
async function pixels(page: Page, a: Buffer, b: Buffer) {
  const result = await page.evaluate(
    async ([a, b]) => {
      async function decode(value: string) {
        const image = new Image();
        image.src = "data:image/png;base64," + value;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        return {
          width: image.width,
          height: image.height,
          data: ctx.getImageData(0, 0, image.width, image.height).data,
        };
      }
      const first = await decode(a!),
        second = await decode(b!);
      if (first.width !== second.width || first.height !== second.height)
        throw new Error("zero-height PNG sizes differ");
      let changedPixels = 0,
        maxChannelDelta = 0;
      for (let index = 0; index < first.data.length; index += 4) {
        let changed = false;
        for (let channel = 0; channel < 4; channel++) {
          const delta = Math.abs(
            first.data[index + channel]! - second.data[index + channel]!,
          );
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          if (delta) changed = true;
        }
        if (changed) changedPixels++;
      }
      return {
        width: first.width,
        height: first.height,
        changedPixels,
        maxChannelDelta,
      };
    },
    [a.toString("base64"), b.toString("base64")],
  );
  assert.equal(
    result.changedPixels,
    0,
    "zero-height profile has differing RGBA pixels",
  );
  return result;
}
async function sourceTime(page: Page, time: number) {
  return page.evaluate(async (time) => {
    const animation = document
      .getElementById("zero-panel")!
      .getAnimations()[0]!;
    animation.currentTime = time;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (animation.playState !== "paused" || animation.currentTime !== time)
      throw new Error(
        "authored zero animation did not retain its exact paused time",
      );
    return {
      currentTime: animation.currentTime,
      playState: animation.playState,
    };
  }, time);
}

export async function captureCSSZeroHeight(base: string, out: string) {
  const evidence = JSON.parse(
    await readFile(join(out, "native-source.json"), "utf8"),
  ) as {
    actualGeneratedConstructor: boolean;
    profiles: { scale: number; samples: Sample[] }[];
  };
  assert.equal(evidence.actualGeneratedConstructor, true);
  assert.equal(evidence.profiles.length, 2);
  const source = await validateJavascriptArchive(
      JSON.parse(await readFile(join(out, "source.javascript.json"), "utf8")),
    ),
    checkpoint = await validateJavascriptArchive(
      JSON.parse(
        await readFile(join(out, "native-checkpoint.javascript.json"), "utf8"),
      ),
    );
  const browser = await chromium.launch({ headless: true }),
    errors: string[] = [],
    comparisons: unknown[] = [],
    files: { file: string; sha256: string; bytes: number }[] = [];
  const retainPNG = async (file: string, bytes: Buffer) => {
    files.push({
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    });
  };
  try {
    const before = await collectBrowserProvenance(browser);
    await json(join(out, "browser-provenance.before.json"), before);
    for (const profile of evidence.profiles) {
      const context = await browser.newContext({
        viewport: { width: 320, height: 240 },
        deviceScaleFactor: profile.scale,
        colorScheme: "light",
        reducedMotion: "no-preference",
      });
      try {
        const original = await context.newPage(),
          generated = await context.newPage(),
          restored = await context.newPage();
        for (const page of [original, generated, restored])
          page.on("pageerror", (error) => errors.push(error.message));
        assert.equal(
          (await original.goto(base + "/css-zero-height-original"))?.ok(),
          true,
        );
        await original.waitForFunction(
          () =>
            document.getElementById("zero-panel")?.getAnimations().length === 1,
        );
        await original.evaluate(async () => {
          const animation = document
            .getElementById("zero-panel")!
            .getAnimations()[0]!;
          animation.pause();
          await animation.ready;
        });
        await retainObjects(original);
        assert.equal(
          (await generated.goto(base + "/css-zero-height-roundtrip"))?.ok(),
          true,
        );
        await committed(generated, 0);
        await retainObjects(generated);
        assert.equal(profile.samples.length, 8);
        let firstSource: Buffer | undefined, firstManaged: Buffer | undefined;
        for (const sample of profile.samples) {
          const timing = await sourceTime(original, sample.timeMs);
          await generated.evaluate(
            (time) => window.afyZero.advance(time),
            sample.timeMs,
          );
          await committed(generated, sample.timeMs);
          assert.deepEqual(await rects(original), sample.objects);
          assert.deepEqual(await rects(generated), sample.objects);
          assert.deepEqual(sample.snapshot, sample.objects);
          await stableObjects(original);
          await stableObjects(generated);
          const archive = await generated.evaluate(() =>
            window.afyZero.export(),
          );
          assert.deepEqual(
            archive,
            sample.archive,
            "managed browser changed the full native checkpoint",
          );
          await json(
            join(
              out,
              `managed-dpr${profile.scale}-${sample.timeMs}ms.javascript.json`,
            ),
            archive,
          );
          assert.equal(
            await generated.evaluate(
              () =>
                document.getElementById("zero-panel")!.getAnimations().length,
            ),
            0,
            "managed zero panel installed another animation",
          );
          const prefix = `dpr${profile.scale}-${sample.timeMs}ms`,
            sourceName = `authored-${prefix}.png`,
            webName = `managed-${prefix}.png`;
          const a = await original.screenshot({ path: join(out, sourceName) }),
            b = await generated.screenshot({ path: join(out, webName) }),
            native = await readFile(join(out, sample.image));
          await retainPNG(sourceName, a);
          await retainPNG(webName, b);
          await retainPNG(sample.image, native);
          comparisons.push({
            phase: "source",
            scale: profile.scale,
            timeMs: sample.timeMs,
            timing,
            sourceNative: await pixels(original, native, a),
            managedNative: await pixels(generated, native, b),
          });
          if (!firstSource) {
            firstSource = a;
            firstManaged = b;
          }
          if (sample.timeMs === 2100)
            comparisons.push({
              phase: "zero-paint-residue",
              scale: profile.scale,
              source: await pixels(original, firstSource!, a),
              managed: await pixels(generated, firstManaged!, b),
            });
          if (sample.timeMs === 100) {
            await generated.evaluate(() => window.afyZero.pause());
            await committed(generated, 100, "paused");
            const paused = await generated.evaluate(() =>
              window.afyZero.export(),
            );
            assert.deepEqual(paused, checkpoint);
            if (profile.scale === 1)
              await json(
                join(out, "browser-checkpoint.javascript.json"),
                paused,
              );
            await generated.evaluate(() => window.afyZero.play());
            await committed(generated, 100, "running");
          }
        }
        assert.equal(
          (
            await restored.goto(base + "/css-zero-height-roundtrip?restore=1")
          )?.ok(),
          true,
        );
        await committed(restored, 100, "paused");
        await retainObjects(restored);
        assert.deepEqual(
          await restored.evaluate(() => window.afyZero.export()),
          checkpoint,
        );
        for (const time of [100, 350, 1100, 2100]) {
          if (time === 350)
            await restored.evaluate(() => window.afyZero.play());
          await restored.evaluate((time) => window.afyZero.advance(time), time);
          await committed(restored, time);
          const sample = profile.samples.find(
            (sample) => sample.timeMs === time,
          )!;
          await sourceTime(original, time);
          await stableObjects(restored);
          assert.deepEqual(await rects(restored), sample.objects);
          const archive = await restored.evaluate(() =>
            window.afyZero.export(),
          );
          assert.deepEqual(archive, time === 100 ? checkpoint : sample.archive);
          await json(
            join(out, `restored-dpr${profile.scale}-${time}ms.javascript.json`),
            archive,
          );
          const name = `restored-dpr${profile.scale}-${time}ms.png`,
            a = await original.screenshot({
              path: join(
                out,
                `restored-source-dpr${profile.scale}-${time}ms.png`,
              ),
            }),
            b = await restored.screenshot({ path: join(out, name) }),
            native = await readFile(join(out, sample.image));
          await retainPNG(
            `restored-source-dpr${profile.scale}-${time}ms.png`,
            a,
          );
          await retainPNG(name, b);
          comparisons.push({
            phase: "restore",
            scale: profile.scale,
            timeMs: time,
            sourceNative: await pixels(original, native, a),
            managedNative: await pixels(restored, native, b),
          });
        }
      } finally {
        await context.close();
      }
    }
    assert.deepEqual(errors, []);
    const after = await verifyBrowserProvenance(browser, before);
    await json(join(out, "browser-provenance.after.json"), after);
    await json(join(out, "comparison.json"), {
      schema: 1,
      kind: "astro-fyne-css-zero-height-comparison",
      codeHash: source.codeHash,
      profiles: evidence.profiles.map((profile) => profile.scale),
      comparisons,
      files,
      exactIntegerProfile: true,
      pixelPerfectVerified: false,
      universalCSSVerified: false,
      actualGeneratedConstructor: true,
      fullManagedCheckpointsRetained: true,
      browserProvenance: await Promise.all(
        (
          [
            ["before", before],
            ["after", after],
          ] as const
        ).map(async ([phase, observation]) => {
          const file = `browser-provenance.${phase}.json`;
          return {
            file,
            sha256: createHash("sha256")
              .update(await readFile(join(out, file)))
              .digest("hex"),
            observationHash: observation.hash,
          };
        }),
      ),
      errors,
    });
  } finally {
    await browser.close();
  }
}
