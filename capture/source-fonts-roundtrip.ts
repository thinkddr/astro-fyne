// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import {
  collectBrowserProvenance,
  verifyBrowserProvenance,
} from "./browser-provenance.ts";
import { catalogueHash, parseCatalogue } from "../src/catalogue.ts";
import type { CatalogueSpec } from "../src/catalogue-types.ts";
import type { JavascriptArchive } from "../src/javascript-types.ts";

declare global {
  interface Window {
    afySourceFonts: {
      ready(): boolean;
      calls(): unknown[][];
      export(): JavascriptArchive;
      exportCatalogue(): Promise<CatalogueSpec>;
    };
  }
}
type Used = {
  text: string;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  fontSize: string;
  lineHeight: string;
  color: string;
  backgroundColor: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
};
type Frame = {
  label: string;
  used: Record<"count" | "button" | "seed", Used>;
  calls: unknown[][];
  archive: JavascriptArchive;
  stableDOMObjects: number;
  focusExportRejected: boolean;
  authoredFamily?: string;
};
type FontResponse = {
  url: string;
  status: number;
  accepted: boolean;
  hash: string;
  bytes: number;
  error?: string;
};
type FontObservation = {
  characterSet: string;
  probes: {
    weight: number;
    query: string;
    text: string;
    loaded: number;
    check: boolean;
    error?: string;
    checkError?: string;
  }[];
  faces: { family: string; status: string; weight: string; style: string }[];
  allFaces: {
    family: string;
    status: string;
    weight: string;
    style: string;
    stretch: string;
    unicodeRange: string;
    featureSettings: string;
    variationSettings: string;
    display: string;
    ascentOverride: string;
    descentOverride: string;
    lineGapOverride: string;
  }[];
  astroIslands: number;
};

/** Capture the source-font CLI checkpoint in the generated Astro island. */
export async function captureSourceFonts(
  url: string,
  out: string,
  expectedFamily = "SourceNoto",
) {
  let browser: Browser | undefined;
  let fonts: FontObservation | undefined;
  const errors: string[] = [],
    fontResponses: Promise<FontResponse>[] = [],
    frames: Frame[] = [];
  try {
    const native = JSON.parse(
      await readFile(join(out, "native-prepare.json"), "utf8"),
    ) as {
      restored: { count: string; seed: string; authoredFamily?: string };
      replayCalls: number;
    };
    const spec = await parseCatalogue(
      await readFile(join(out, "native-prepare.catalogue.json"), "utf8"),
    );
    assert.equal(native.replayCalls, 0);
    assert.equal(spec.islands.length, 1);
    const island = spec.islands[0]!;
    assert.equal(island.id, "app");
    assert.ok(island.statePayload && island.stateHash);
    assert.equal(catalogueHash(island.statePayload), island.stateHash);
    const checkpoint = JSON.parse(island.statePayload) as JavascriptArchive;
    const component = spec.components.find(
      (item) => item.id === island.component,
    )!;
    assert.equal(component.kind, "javascript");
    const prototype = JSON.parse(component.payload) as JavascriptArchive;
    assert.equal(spec.fontFaces.length, 2);
    const expectedFonts = [400, 700].map((weight) => {
      const faces = spec.fontFaces.filter(
        (face) =>
          face.family === expectedFamily &&
          face.weight === weight &&
          face.style === "normal",
      );
      assert.equal(faces.length, 1);
      const face = faces[0]!,
        resource = spec.resources.find((item) => item.name === face.resource)!;
      assert.equal(resource.mediaType, "font/ttf");
      assert.equal(resource.hash, face.hash);
      const bytes = Buffer.from(resource.content, "base64");
      assert.equal(catalogueHash(bytes), face.hash);
      return { weight, hash: face.hash, bytes: bytes.length };
    });
    assert.equal(new Set(expectedFonts.map((font) => font.hash)).size, 2);
    browser = await chromium.launch({ headless: true });
    const provenance = await collectBrowserProvenance(browser),
      beforeText = JSON.stringify(provenance, null, 2) + "\n";
    await writeFile(join(out, "browser-provenance-before.json"), beforeText);
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (!/\.ttf(?:$|\?)/i.test(response.url())) return;
      fontResponses.push(
        (async (): Promise<FontResponse> => {
          try {
            assert.equal(response.ok(), true, "font request failed");
            const bytes = await response.body();
            return {
              url: response.url(),
              status: response.status(),
              accepted: true,
              hash: catalogueHash(bytes),
              bytes: bytes.length,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            errors.push(message);
            return {
              url: response.url(),
              status: response.status(),
              accepted: false,
              hash: "",
              bytes: 0,
              error: message,
            };
          }
        })(),
      );
    });
    assert.equal((await page.goto(url))?.ok(), true);
    await page.waitForFunction(() => !!window.afySourceFonts?.ready());
    fonts = await page.evaluate(async (family): Promise<FontObservation> => {
      const probes: FontObservation["probes"] = [];
      for (const weight of [400, 700]) {
        const query = `${weight} 16px ${JSON.stringify(family)}`,
          text = "012IncrementNative override",
          probe: FontObservation["probes"][number] = {
            weight,
            query,
            text,
            loaded: 0,
            check: false,
          };
        try {
          probe.loaded = (await document.fonts.load(query, text)).length;
        } catch (error) {
          probe.error = error instanceof Error ? error.message : String(error);
        }
        try {
          probe.check = document.fonts.check(query, text);
        } catch (error) {
          probe.checkError =
            error instanceof Error ? error.message : String(error);
        }
        probes.push(probe);
      }
      await document.fonts.ready;
      const allFaces = [...document.fonts].map((face) => ({
        family: face.family,
        status: face.status,
        weight: face.weight,
        style: face.style,
        stretch: face.stretch,
        unicodeRange: face.unicodeRange,
        featureSettings: face.featureSettings,
        variationSettings: face.variationSettings,
        display: face.display,
        ascentOverride: face.ascentOverride,
        descentOverride: face.descentOverride,
        lineGapOverride: face.lineGapOverride,
      }));
      return {
        characterSet: document.characterSet,
        probes,
        allFaces,
        faces: allFaces
          .filter((face) => face.family.replaceAll('"', "") === family)
          .map((face) => ({
            family: face.family,
            status: face.status,
            weight: face.weight,
            style: face.style,
          })),
        astroIslands: document.querySelectorAll("astro-island").length,
      };
    }, expectedFamily);
    assert.equal(fonts.characterSet.toLowerCase(), "utf-8");
    assert.equal(fonts.astroIslands, 1);
    for (const probe of fonts.probes) {
      assert.equal(probe.error, undefined);
      assert.equal(probe.checkError, undefined);
      assert.equal(probe.loaded, 1);
      assert.equal(probe.check, true);
      assert.ok(
        fonts.faces.some(
          (face) =>
            face.status === "loaded" &&
            face.weight === String(probe.weight) &&
            face.style === "normal",
        ),
      );
    }
    await page.evaluate(() => {
      const refs: Element[] = [],
        scope = document.querySelector('[data-catalogue-island="app"]');
      if (!scope) throw new Error("Missing source-font island");
      for (const id of ["font-count", "font-increment", "font-seed"]) {
        const matches = scope.querySelectorAll(`[id="${id}"]`);
        if (matches.length !== 1)
          throw new Error("Missing or duplicate source-font target");
        refs.push(matches[0]!);
      }
      (window as any).afySourceFontObjects = refs;
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
          await window.afySourceFonts.exportCatalogue();
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.includes("Clear focus before exporting")
          )
            throw error;
          rejected = true;
        }
        if (!rejected || !(active instanceof HTMLElement))
          throw new Error("Focused source-font export was accepted");
        active.blur();
        if (
          document.activeElement !== document.body &&
          document.activeElement !== document.documentElement
        )
          throw new Error("Source-font focus did not clear");
        return true;
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const result = await page.evaluate(() => {
        const scope = document.querySelector('[data-catalogue-island="app"]')!,
          refs = (window as any).afySourceFontObjects as Element[],
          used = {} as Record<"count" | "button" | "seed", Used>;
        for (const [index, [key, id]] of [
          ["count", "font-count"],
          ["button", "font-increment"],
          ["seed", "font-seed"],
        ].entries()) {
          const target = scope.querySelector(`[id="${id}"]`)!;
          if (target !== refs[index])
            throw new Error("Source-font DOM identity changed");
          const style = getComputedStyle(target);
          used[key as keyof typeof used] = {
            text: target.textContent!,
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            color: style.color,
            backgroundColor: style.backgroundColor,
            paddingTop: style.paddingTop,
            paddingRight: style.paddingRight,
            paddingBottom: style.paddingBottom,
            paddingLeft: style.paddingLeft,
          };
        }
        const authoredFamily = scope
          .querySelector('[id="font-root"]')
          ?.getAttribute("data-authored-family");
        return {
          used,
          ...(authoredFamily == null ? {} : { authoredFamily }),
          calls: window.afySourceFonts.calls(),
          archive: window.afySourceFonts.export(),
          stableDOMObjects: refs.length,
        };
      });
      const frame = { label, ...result, focusExportRejected };
      frames.push(frame);
      for (const key of ["count", "button", "seed"] as const) {
        const style = frame.used[key];
        assert.equal(style.fontFamily.replaceAll('"', ""), expectedFamily);
        assert.equal(style.fontWeight, key === "button" ? "700" : "400");
        assert.equal(style.fontStyle, "normal");
        assert.equal(style.fontSize, "16px");
        assert.equal(style.lineHeight, "24px");
      }
      assert.equal(frame.used.button.text, "Increment");
      assert.equal(frame.stableDOMObjects, 3);
      for (const field of [
        "code",
        "codeHash",
        "sources",
        "stylesheets",
        "actions",
      ] as const)
        assert.deepEqual(frame.archive[field], prototype[field]);
      assert.deepEqual(frame.archive.props, checkpoint.props);
      if (expectedFamily === "SourceStraße") {
        const families: Record<string, string> = {};
        function visit(nodes: NonNullable<JavascriptArchive["frame"]>) {
          for (const node of nodes) {
            if (
              [
                "font-root",
                "font-count",
                "font-increment",
                "font-seed",
              ].includes(node.attrs?.id ?? "")
            ) {
              assert.equal(
                node.style?.fontFamily,
                JSON.stringify(expectedFamily),
              );
              families[node.attrs!.id!] = String(node.style!.fontFamily);
            }
            visit(node.children ?? []);
          }
        }
        visit(frame.archive.frame!);
        assert.equal(Object.keys(families).length, 4);
      }
      return frame;
    }
    const initial = await capture("restored-from-native");
    assert.equal(initial.focusExportRejected, false);
    assert.deepEqual(
      initial.calls,
      [],
      "mounting replayed native host effects",
    );
    assert.equal(initial.used.count.text, "Native override:1");
    assert.equal(initial.used.count.text, native.restored.count);
    assert.equal(initial.used.seed.text, native.restored.seed);
    assert.deepEqual(initial.archive, checkpoint);
    if (expectedFamily === "SourceStraße") {
      assert.equal(initial.authoredFamily, "sourceſtraße");
      assert.equal(native.restored.authoredFamily, initial.authoredFamily);
      assert.ok(
        checkpoint.stylesheets!.some((sheet) =>
          sheet.text.includes('font-family:"SOURCESTRASSE"'),
        ),
      );
      assert.ok(
        !checkpoint.stylesheets!.some((sheet) =>
          sheet.text.includes('font-family:"SourceStraße"'),
        ),
      );
    }
    await page
      .locator('[data-catalogue-island="app"] [id="font-increment"]')
      .click();
    const final = await capture("click-app-2");
    assert.equal(final.focusExportRejected, true);
    assert.equal(final.used.count.text, "Native override:2");
    assert.equal(final.used.seed.text, initial.used.seed.text);
    assert.deepEqual(final.calls, [[2]]);
    if (expectedFamily === "SourceStraße") {
      assert.equal(final.authoredFamily, "SOURCESTRASSE");
      assert.notEqual(final.authoredFamily, initial.authoredFamily);
    }
    assert.equal(
      final.archive.events.length,
      initial.archive.events.length + 1,
    );
    assert.deepEqual(
      final.archive.events.slice(0, initial.archive.events.length),
      initial.archive.events,
    );
    assert.equal(final.archive.events.at(-1)!.type, "click");
    assert.deepEqual(
      final.archive.journal.slice(0, initial.archive.journal.length),
      initial.archive.journal,
    );
    const exportedCatalogue = await page.evaluate(() =>
      window.afySourceFonts.exportCatalogue(),
    );
    const exported = await parseCatalogue(JSON.stringify(exportedCatalogue));
    assert.deepEqual({ ...exported, islands: spec.islands }, spec);
    assert.equal(exported.islands.length, spec.islands.length);
    const {
        statePayload: _payload,
        stateHash: _hash,
        ...exportedIsland
      } = exported.islands[0]!,
      {
        statePayload: _oldPayload,
        stateHash: _oldHash,
        ...sourceIsland
      } = island;
    assert.deepEqual(exportedIsland, sourceIsland);
    assert.deepEqual(
      JSON.parse(exported.islands[0]!.statePayload!),
      final.archive,
    );
    assert.equal(
      catalogueHash(exported.islands[0]!.statePayload!),
      exported.islands[0]!.stateHash,
    );
    const responses = await Promise.all(fontResponses);
    assert.ok(responses.length >= 2);
    for (const font of expectedFonts)
      assert.ok(
        responses.some(
          (response) =>
            response.accepted &&
            response.hash === font.hash &&
            response.bytes === font.bytes,
        ),
        `Browser font bytes differ from the ${font.weight} native resource`,
      );
    assert.ok(
      responses.every(
        (response) =>
          response.accepted &&
          expectedFonts.some((font) => font.hash === response.hash),
      ),
    );
    assert.deepEqual(errors, []);
    const verified = await verifyBrowserProvenance(browser, provenance),
      afterText = JSON.stringify(verified, null, 2) + "\n";
    await writeFile(join(out, "browser-provenance-after.json"), afterText);
    await writeFile(
      join(out, "browser.json"),
      JSON.stringify(
        {
          schema: 1,
          url,
          browserVersion: browser.version(),
          browserProvenanceHash: verified.hash,
          browserProvenance: {
            before: {
              file: "browser-provenance-before.json",
              bytes: Buffer.byteLength(beforeText),
              hash: catalogueHash(beforeText),
            },
            after: {
              file: "browser-provenance-after.json",
              bytes: Buffer.byteLength(afterText),
              hash: catalogueHash(afterText),
            },
            sameProcessVerified: true,
            effectiveFontPolicyObserved: false,
          },
          frames,
          fonts,
          expectedFonts,
          fontResponses: responses,
          initialArchive: initial.archive,
          finalArchive: final.archive,
          exportedCatalogue,
          realAstroIslands: fonts.astroIslands,
          stableDOMObjectsPerFrame: 3,
          ...(expectedFamily === "SourceStraße"
            ? {
                fontFamilyProfile: {
                  canonical: expectedFamily,
                  canonicalCSS: JSON.stringify(expectedFamily),
                  authoredCSS: "SOURCESTRASSE",
                  observedAliases: frames.map((frame) => frame.authoredFamily),
                  nativeFrameCanonical: true,
                  managedComputedStyleCanonical: true,
                  authoredInlineAssignmentSourceBound: true,
                },
              }
            : {}),
          errors,
          pixelPerfectVerified: false,
          universalCSSVerified: false,
          fallbackFreeRenderingVerified: false,
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
          fonts: fonts ?? null,
          fontResponses: await Promise.all(fontResponses),
          pixelPerfectVerified: false,
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  } finally {
    await browser?.close();
  }
}

if (import.meta.main) {
  const [url, out, family] = process.argv.slice(2);
  assert.ok(
    url && out,
    "Usage: bun capture/source-fonts-roundtrip.ts <url> <artifacts> [family]",
  );
  await captureSourceFonts(url, out, family);
}
