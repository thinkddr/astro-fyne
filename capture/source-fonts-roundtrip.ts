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
type FaceObservation = {
  family: string;
  status: string;
  weight: string;
  style: string;
};
type AuthoredFontMatch = {
  alias: string;
  weight: number;
  query: string;
  canonicalQuery: string;
  loaded: number;
  referenceEquality: boolean;
  error?: string;
  canonical?: FaceObservation;
  faces: FaceObservation[];
  check?: boolean;
  checkError?: string;
  authoredCSSQuery?: true;
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
  authoredMatches?: AuthoredFontMatch[];
  unmatchedQueries?: AuthoredFontMatch[];
};

/** Capture the source-font CLI checkpoint in the generated Astro island. */
export async function captureSourceFonts(
  url: string,
  out: string,
  expectedFamily = "SourceNoto",
  aliases?: readonly [string, string],
  rejectedAliases: readonly string[] = [],
  aliasesAreCSS = false,
) {
  if (aliasesAreCSS && !aliases)
    throw new Error("Authored CSS font queries require explicit aliases");
  assert.ok(Array.isArray(rejectedAliases) && rejectedAliases.length <= 16);
  const rejectedFamilyAliases = rejectedAliases.slice();
  assert.ok(rejectedFamilyAliases.every((alias) => typeof alias === "string"));
  const familyAliases = aliases
    ? ([aliases[0], aliases[1]] as const)
    : expectedFamily === "SourceStraße"
      ? (["SOURCESTRAẞE", "sourceſtraße"] as const)
      : undefined;
  let browser: Browser | undefined;
  let fonts: FontObservation | undefined;
  let astralFontProbe: unknown;
  const errors: string[] = [],
    fontResponses: Promise<FontResponse>[] = [],
    frames: Frame[] = [],
    authoredFontMatches: AuthoredFontMatch[] = [];
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
    fonts = await page.evaluate(
      async ({
        family,
        aliases,
        rejected,
        aliasesAreCSS,
      }): Promise<FontObservation> => {
        const probes: FontObservation["probes"] = [],
          canonicalFaces = new Map<number, FontFace>();
        const observe = (face: FontFace) => ({
          family: face.family,
          status: face.status,
          weight: face.weight,
          style: face.style,
        });
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
          let loaded: FontFace[] = [];
          try {
            loaded = await document.fonts.load(query, text);
            probe.loaded = loaded.length;
          } catch (error) {
            probe.error =
              error instanceof Error ? error.message : String(error);
          }
          try {
            probe.check = document.fonts.check(query, text);
          } catch (error) {
            probe.checkError =
              error instanceof Error ? error.message : String(error);
          }
          if (loaded.length === 1) canonicalFaces.set(weight, loaded[0]!);
          probes.push(probe);
        }
        await document.fonts.ready;
        const authoredMatches: AuthoredFontMatch[] = [];
        if (aliases)
          for (const alias of aliases)
            for (const weight of [400, 700]) {
              const query = `${weight} 16px ${aliasesAreCSS ? alias : JSON.stringify(alias)}`,
                canonical = canonicalFaces.get(weight);
              let loaded: FontFace[] = [],
                failure: string | undefined;
              try {
                loaded = await document.fonts.load(
                  query,
                  "012IncrementNative override",
                );
              } catch (error) {
                failure =
                  error instanceof Error ? error.message : String(error);
              }
              authoredMatches.push({
                alias,
                weight,
                query,
                canonicalQuery: `${weight} 16px ${JSON.stringify(family)}`,
                loaded: loaded.length,
                referenceEquality:
                  loaded.length === 1 && loaded[0] === canonical,
                ...(failure === undefined ? {} : { error: failure }),
                ...(canonical ? { canonical: observe(canonical) } : {}),
                faces: loaded.map(observe),
                ...(aliasesAreCSS ? { authoredCSSQuery: true as const } : {}),
              });
            }
        const unmatchedQueries: AuthoredFontMatch[] = [];
        for (const alias of rejected)
          for (const weight of [400, 700]) {
            const query = `${weight} 16px ${JSON.stringify(alias)}`,
              canonical = canonicalFaces.get(weight),
              row: AuthoredFontMatch = {
                alias,
                weight,
                query,
                canonicalQuery: `${weight} 16px ${JSON.stringify(family)}`,
                loaded: 0,
                referenceEquality: false,
                ...(canonical ? { canonical: observe(canonical) } : {}),
                faces: [],
              };
            try {
              const loaded = await document.fonts.load(
                query,
                "012IncrementNative override",
              );
              row.loaded = loaded.length;
              row.referenceEquality =
                loaded.length === 1 && loaded[0] === canonical;
              row.faces = loaded.map(observe);
            } catch (error) {
              row.error =
                error instanceof Error ? error.message : String(error);
            }
            try {
              row.check = document.fonts.check(
                query,
                "012IncrementNative override",
              );
            } catch (error) {
              row.checkError =
                error instanceof Error ? error.message : String(error);
            }
            unmatchedQueries.push(row);
          }
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
          ...(aliases ? { authoredMatches } : {}),
          ...(rejected.length ? { unmatchedQueries } : {}),
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
      },
      {
        family: expectedFamily,
        aliases: familyAliases,
        rejected: rejectedFamilyAliases,
        aliasesAreCSS,
      },
    );
    authoredFontMatches.push(...(fonts.authoredMatches ?? []));
    assert.equal(fonts.characterSet.toLowerCase(), "utf-8");
    if (familyAliases) {
      assert.equal(authoredFontMatches.length, 4);
      for (const match of authoredFontMatches) {
        assert.equal(match.error, undefined);
        assert.equal(match.loaded, 1);
        assert.equal(match.referenceEquality, true);
        assert.ok(match.canonical);
        assert.deepEqual(match.faces, [match.canonical]);
        assert.equal(
          match.canonical.family.replaceAll('"', ""),
          expectedFamily,
        );
        assert.equal(match.canonical.status, "loaded");
        assert.equal(match.canonical.weight, String(match.weight));
        assert.equal(match.canonical.style, "normal");
      }
    }
    if (rejectedFamilyAliases.length) {
      assert.equal(
        fonts.unmatchedQueries?.length,
        rejectedFamilyAliases.length * 2,
      );
      for (const match of fonts.unmatchedQueries!) {
        assert.equal(match.error, undefined);
        assert.equal(match.checkError, undefined);
        assert.equal(typeof match.check, "boolean");
        assert.equal(match.loaded, 0);
        assert.equal(match.referenceEquality, false);
        assert.deepEqual(match.faces, []);
        assert.ok(match.canonical);
        assert.equal(
          match.canonical.family.replaceAll('"', ""),
          expectedFamily,
        );
        assert.equal(match.canonical.status, "loaded");
        assert.equal(match.canonical.weight, String(match.weight));
      }
    }
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
      if (familyAliases) {
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
    if (familyAliases) {
      assert.equal(initial.authoredFamily, familyAliases[1]);
      assert.equal(native.restored.authoredFamily, initial.authoredFamily);
      assert.ok(
        checkpoint.stylesheets!.some((sheet) =>
          sheet.text.includes(
            "font-family:" +
              (aliasesAreCSS
                ? familyAliases[0]
                : JSON.stringify(familyAliases[0])),
          ),
        ),
      );
      if (aliasesAreCSS)
        assert.ok(
          checkpoint.stylesheets!.some((sheet) =>
            sheet.text.includes(
              "#font-seed{font-family:" + familyAliases[1] + "}\r\n",
            ),
          ),
        );
      assert.ok(
        !checkpoint.stylesheets!.some((sheet) =>
          sheet.text.includes("font-family:" + JSON.stringify(expectedFamily)),
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
    if (familyAliases) {
      assert.equal(final.authoredFamily, familyAliases[0]);
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
    if (familyAliases) assert.equal(responses.length, 2);
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
    if (rejectedFamilyAliases.length) {
      const regular = spec.fontFaces.find(
          (face) =>
            face.family === expectedFamily &&
            face.weight === 400 &&
            face.style === "normal",
        )!,
        resource = spec.resources.find(
          (item) => item.name === regular.resource,
        )!,
        probePage = await browser.newPage();
      try {
        assert.equal(
          (
            await probePage.goto(new URL("font-matching-probe/", url).href)
          )?.ok(),
          true,
        );
        const result = await probePage.evaluate(
          async ({ content }) => {
            const canonical = "𐐀Source",
              changed = "𐐨Source",
              observation = {
                characterSet: document.characterSet,
                secureContext: isSecureContext,
                canonical,
                changed,
                initialFaces: document.fonts.size,
                resourceHash: "",
                bytes: 0,
                registered: false,
                removed: false,
                remainingFaces: document.fonts.size,
                constructed: null as FaceObservation | null,
                queries: [] as {
                  family: string;
                  query: string;
                  loaded: number;
                  referenceEquality: boolean;
                  faces: FaceObservation[];
                  check: boolean;
                  error?: string;
                }[],
                error: null as string | null,
                glyphFallbackObserved: false,
                pixelPerfectVerified: false,
              };
            let owned: FontFace | undefined;
            const observe = (face: FontFace): FaceObservation => ({
              family: face.family,
              status: face.status,
              weight: face.weight,
              style: face.style,
            });
            try {
              const bytes = Uint8Array.from(atob(content), (value) =>
                  value.charCodeAt(0),
                ),
                digest = await crypto.subtle.digest("SHA-256", bytes);
              observation.bytes = bytes.byteLength;
              observation.resourceHash = [...new Uint8Array(digest)]
                .map((value) => value.toString(16).padStart(2, "0"))
                .join("");
              owned = new FontFace(canonical, bytes, {
                weight: "400",
                style: "normal",
              });
              await owned.load();
              document.fonts.add(owned);
              observation.registered = document.fonts.has(owned);
              observation.constructed = observe(owned);
              for (const family of [canonical, changed]) {
                const query = `400 16px ${JSON.stringify(family)}`;
                try {
                  const loaded = await document.fonts.load(
                    query,
                    "012IncrementNative override",
                  );
                  observation.queries.push({
                    family,
                    query,
                    loaded: loaded.length,
                    referenceEquality:
                      loaded.length === 1 && loaded[0] === owned,
                    faces: loaded.map(observe),
                    check: document.fonts.check(
                      query,
                      "012IncrementNative override",
                    ),
                  });
                } catch (error) {
                  observation.queries.push({
                    family,
                    query,
                    loaded: 0,
                    referenceEquality: false,
                    faces: [],
                    check: false,
                    error:
                      error instanceof Error ? error.message : String(error),
                  });
                }
              }
            } catch (error) {
              observation.error =
                error instanceof Error ? error.message : String(error);
            } finally {
              if (owned) observation.removed = document.fonts.delete(owned);
              observation.remainingFaces = document.fonts.size;
            }
            return observation;
          },
          { content: resource.content },
        );
        astralFontProbe = result;
        assert.equal(result.error, null);
        assert.equal(result.characterSet.toLowerCase(), "utf-8");
        assert.equal(result.secureContext, true);
        assert.equal(result.initialFaces, 0);
        assert.equal(result.resourceHash, regular.hash);
        assert.equal(
          result.bytes,
          Buffer.from(resource.content, "base64").length,
        );
        assert.equal(result.registered, true);
        assert.equal(result.removed, true);
        assert.equal(result.remainingFaces, 0);
        assert.ok(result.constructed);
        assert.equal(
          result.constructed.family.replaceAll('"', ""),
          result.canonical,
        );
        assert.equal(result.constructed.status, "loaded");
        assert.equal(result.constructed.weight, "400");
        assert.equal(result.constructed.style, "normal");
        assert.equal(result.queries.length, 2);
        for (const row of result.queries) assert.equal(row.error, undefined);
        assert.equal(result.queries[0]!.family, result.canonical);
        assert.equal(result.queries[0]!.loaded, 1);
        assert.equal(result.queries[0]!.referenceEquality, true);
        assert.deepEqual(result.queries[0]!.faces, [result.constructed]);
        assert.equal(result.queries[1]!.family, result.changed);
        assert.equal(result.queries[1]!.loaded, 0);
        assert.equal(result.queries[1]!.referenceEquality, false);
        assert.deepEqual(result.queries[1]!.faces, []);
      } finally {
        await probePage.close();
      }
    }
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
          ...(rejectedFamilyAliases.length ? { astralFontProbe } : {}),
          expectedFonts,
          fontResponses: responses,
          initialArchive: initial.archive,
          finalArchive: final.archive,
          exportedCatalogue,
          realAstroIslands: fonts.astroIslands,
          stableDOMObjectsPerFrame: 3,
          ...(familyAliases
            ? {
                fontFamilyProfile: {
                  canonical: expectedFamily,
                  canonicalCSS: JSON.stringify(expectedFamily),
                  authoredCSS: familyAliases[0],
                  observedAliases: frames.map((frame) => frame.authoredFamily),
                  nativeFrameCanonical: true,
                  managedComputedStyleCanonical: true,
                  rawCSSFontFaceReferenceMatchingObserved: true,
                  ...(aliasesAreCSS
                    ? { authoredQueriesUseCSSSyntax: true }
                    : {}),
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
          ...(rejectedFamilyAliases.length
            ? { astralFontProbe: astralFontProbe ?? null }
            : {}),
          fontResponses: await Promise.all(fontResponses),
          ...(familyAliases ? { authoredFontMatches } : {}),
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
