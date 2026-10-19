// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { catalogueHash, parseCatalogue } from "../src/catalogue.ts";
import type { CatalogueSpec } from "../src/catalogue-types.ts";
import { sceneColorRGBA } from "../src/reverse.ts";
import type { JavascriptArchive } from "../src/javascript-types.ts";

declare global {
  interface Window {
    afyCatalogue: {
      ready(): boolean;
      calls(): unknown[][];
      export(): Record<"left" | "right", JavascriptArchive>;
      exportCatalogue(): Promise<CatalogueSpec>;
      invalid(): string[];
    };
  }
}
type Used = {
  count: string;
  paddingLeft: number;
  paddingRight: number;
  color: string;
  fontFamily: string;
};
type Frame = {
  label: string;
  islands: Record<"left" | "right", Used>;
  calls: unknown[][];
  archives: Record<"left" | "right", JavascriptArchive>;
  stableDOMObjects: number;
  focusExportRejected: boolean;
};

/** Compare the generated Astro page with the actual native checkpoint. */
export async function captureCatalogue(url: string, out: string) {
  const prepared = JSON.parse(
    await readFile(join(out, "prepare.json"), "utf8"),
  );
  const native = JSON.parse(
    await readFile(join(out, "native-prepare.json"), "utf8"),
  ) as { restored: Record<"left" | "right", Used>; replayCalls: number };
  const spec = await parseCatalogue(
    await readFile(join(out, "native-prepare.catalogue.json"), "utf8"),
  );
  const prototype = JSON.parse(
    spec.components[0]!.payload,
  ) as JavascriptArchive;
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [],
    fontResponses: Promise<{ url: string; hash: string; bytes: number }>[] = [],
    frames: Frame[] = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (/\.ttf(?:$|\?)/i.test(response.url()))
        fontResponses.push(
          (async () => {
            assert.equal(response.ok(), true, "font request failed");
            const bytes = await response.body();
            return {
              url: response.url(),
              hash: catalogueHash(bytes),
              bytes: bytes.length,
            };
          })(),
        );
    });
    assert.equal((await page.goto(url))?.ok(), true);
    await page.waitForFunction(() => !!window.afyCatalogue?.ready());
    const fonts = await page.evaluate(async () => {
      const loaded = await document.fonts.load(
        '400 16px "CatalogueNoto"',
        "0123Increment",
      );
      await document.fonts.ready;
      return {
        loaded: loaded.length,
        check: document.fonts.check(
          '400 16px "CatalogueNoto"',
          "0123Increment",
        ),
        faces: [...document.fonts]
          .filter((face) => face.family.replaceAll('"', "") === "CatalogueNoto")
          .map((face) => ({
            family: face.family,
            status: face.status,
            weight: face.weight,
          })),
        astroIslands: document.querySelectorAll("astro-island").length,
      };
    });
    assert.equal(fonts.loaded, 1);
    assert.equal(fonts.check, true);
    assert.equal(fonts.astroIslands, 2);
    assert.ok(
      fonts.faces.some(
        (face) => face.status === "loaded" && face.weight === "400",
      ),
    );
    assert.deepEqual(await page.evaluate(() => window.afyCatalogue.invalid()), [
      "constructor",
      "toString",
    ]);
    await page.evaluate(() => {
      const refs: Element[] = [];
      for (const id of ["left", "right"])
        for (const target of [
          "catalogue-card",
          "catalogue-count",
          "catalogue-increment",
        ]) {
          const matches = document.querySelectorAll(
            `[data-catalogue-island="${id}"] [id="${target}"]`,
          );
          if (matches.length !== 1)
            throw new Error("Missing or duplicate catalogue target");
          refs.push(matches[0]!);
        }
      (window as any).afyCatalogueObjects = refs;
    });
    async function capture(label: string): Promise<Frame> {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const focusExportRejected = await page.evaluate(async () => {
        const active = document.activeElement;
        if (
          !active ||
          active === document.body ||
          active === document.documentElement
        )
          return false;
        let rejected = false;
        try {
          await window.afyCatalogue.exportCatalogue();
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.includes("Clear focus before exporting")
          )
            throw error;
          rejected = true;
        }
        if (!rejected || !(active instanceof HTMLElement))
          throw new Error("Focused catalogue export was accepted");
        active.blur();
        if (
          document.activeElement !== document.body &&
          document.activeElement !== document.documentElement
        )
          throw new Error("Catalogue focus did not clear");
        return true;
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const result = await page.evaluate(() => {
        const islands = {} as Record<"left" | "right", Used>;
        const refs = (window as any).afyCatalogueObjects as Element[];
        let index = 0;
        for (const id of ["left", "right"] as const) {
          const scope = document.querySelector(
            `[data-catalogue-island="${id}"]`,
          )!;
          for (const target of [
            "catalogue-card",
            "catalogue-count",
            "catalogue-increment",
          ])
            if (scope.querySelector(`[id="${target}"]`) !== refs[index++])
              throw new Error("Catalogue DOM identity changed");
          const card = scope.querySelector('[id="catalogue-card"]')!,
            style = getComputedStyle(card);
          islands[id] = {
            count: scope.querySelector('[id="catalogue-count"]')!.textContent!,
            paddingLeft: Number.parseFloat(style.paddingLeft),
            paddingRight: Number.parseFloat(style.paddingRight),
            color: style.color,
            fontFamily: style.fontFamily,
          };
        }
        return {
          islands,
          calls: window.afyCatalogue.calls(),
          archives: window.afyCatalogue.export(),
          stableDOMObjects: refs.length,
        };
      });
      const frame = { label, ...result, focusExportRejected };
      frames.push(frame);
      return frame;
    }
    function styles(actual: Used, expected: Used) {
      assert.equal(actual.paddingLeft, expected.paddingLeft);
      assert.equal(actual.paddingRight, expected.paddingRight);
      assert.deepEqual(
        sceneColorRGBA(actual.color),
        sceneColorRGBA(expected.color),
      );
      assert.equal(actual.fontFamily.replaceAll('"', ""), expected.fontFamily);
    }
    function sources(archive: JavascriptArchive) {
      assert.equal(archive.code, prototype.code);
      assert.equal(archive.codeHash, prototype.codeHash);
      assert.deepEqual(archive.sources, prototype.sources);
      assert.deepEqual(archive.stylesheets, prototype.stylesheets);
      assert.deepEqual(archive.actions, prototype.actions);
    }
    const initial = await capture("restored-from-native");
    assert.deepEqual(
      initial.calls,
      [],
      "mounting replayed native host effects",
    );
    for (const id of ["left", "right"] as const) {
      assert.equal(initial.islands[id].count, native.restored[id].count);
      styles(initial.islands[id], native.restored[id]);
      sources(initial.archives[id]);
    }
    assert.equal(initial.islands.left.count, "1");
    assert.equal(initial.islands.right.count, "0");
    for (const [id, left, right] of [
      ["right", "1", "1"],
      ["right", "1", "2"],
      ["left", "2", "2"],
    ] as const) {
      await page
        .locator(`[data-catalogue-island="${id}"] [id="catalogue-increment"]`)
        .click();
      const frame = await capture(`click-${id}-${left}-${right}`);
      assert.equal(frame.focusExportRejected, true);
      assert.equal(frame.islands.left.count, left);
      assert.equal(frame.islands.right.count, right);
      for (const side of ["left", "right"] as const) {
        assert.equal(
          frame.islands[side].paddingLeft,
          Number(frame.islands[side].count) > 0 ? 18 : 12,
        );
        assert.equal(frame.islands[side].paddingRight, 14);
        sources(frame.archives[side]);
      }
    }
    const final = frames.at(-1)!;
    assert.deepEqual(final.calls, [
      ["right", 1],
      ["right", 2],
      ["left", 2],
    ]);
    assert.equal(final.archives.left.events.length, 2);
    assert.equal(final.archives.right.events.length, 2);
    const exportedCatalogue = await page.evaluate(() =>
      window.afyCatalogue.exportCatalogue(),
    );
    const exported = await parseCatalogue(JSON.stringify(exportedCatalogue));
    assert.deepEqual(exported.components, spec.components);
    assert.deepEqual(exported.stylesheets, spec.stylesheets);
    assert.deepEqual(exported.resources, spec.resources);
    assert.deepEqual(exported.fontFaces, spec.fontFaces);
    assert.deepEqual(
      exported.islands.map(({ key }) => key),
      ["same-key", "same-key"],
    );
    for (const id of ["left", "right"] as const)
      assert.deepEqual(
        JSON.parse(
          exported.islands.find((island) => island.id === id)!.statePayload!,
        ),
        final.archives[id],
      );
    const responses = await Promise.all(fontResponses);
    assert.ok(
      responses.some((response) => response.hash === prepared.fontHash),
      "the actual browser-loaded font bytes differ from the native resource",
    );
    assert.deepEqual(errors, []);
    await writeFile(
      join(out, "browser.json"),
      JSON.stringify(
        {
          schema: 1,
          url,
          browserVersion: browser.version(),
          frames,
          fonts,
          fontResponses: responses,
          unknownIslandsRejected: ["constructor", "toString"],
          finalArchives: final.archives,
          exportedCatalogue,
          realAstroIslands: fonts.astroIslands,
          stableDOMObjectsPerFrame: 6,
          pixelPerfectVerified: false,
          universalCSSVerified: false,
        },
        null,
        2,
      ) + "\n",
    );
  } catch (error) {
    await writeFile(
      join(out, "browser-failure.json"),
      JSON.stringify(
        {
          schema: 1,
          accepted: false,
          message: error instanceof Error ? error.message : String(error),
          errors,
          frames,
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  const [url, out] = process.argv.slice(2);
  assert.ok(
    url && out,
    "Usage: bun capture/catalogue-roundtrip.ts <url> <artifacts>",
  );
  await captureCatalogue(url, out);
}
