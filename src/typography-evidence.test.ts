// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  compareNativeShaping,
  comparePainterPackages,
  compareSidecarModules,
  strictTypographyPixels,
  validateSoftwareOriginSource,
  validateTypographyBrowserSample,
} from "../capture/compare-typography.ts";
import {
  typographyHash,
  validateTypographyProbe,
} from "../capture/typography.ts";

const bytes = readFileSync(
  new URL("../typography-probe.json", import.meta.url),
);
const probe = validateTypographyProbe(JSON.parse(bytes.toString("utf8")));
const hashes = {
  probeHash: typographyHash(bytes),
  fixtureHash: "c".repeat(64),
  fontHash: "f".repeat(64),
};
const identity = {
  sourceHash: typographyHash(
    JSON.stringify([hashes.probeHash, hashes.fixtureHash, hashes.fontHash]),
  ),
  ...hashes,
};

// Protocol fixtures do not claim to reproduce real glyphs or certify pixels.
function shapingTrace(variant: "upstream-v2.8.1" | "fork-v2.8.1-sytue.16") {
  const cases = probe.scales.flatMap((scale) =>
    probe.samples.flatMap((sample) =>
      (["text", "H", "space"] as const).map((purpose) => {
        const text =
          purpose === "text" ? sample.text : purpose === "H" ? "H" : " ";
        const runes = Array.from(text),
          fontSize = sample.fontSize ?? probe.font.size;
        const measured = { width: runes.length, height: 20, baseline: 15 };
        const physicalOrigin = { x: sample.x * scale, y: sample.y * scale };
        const glyphs = runes.map((_, index) => ({
          id: index + 1,
          textIndex: index,
          runesCount: 1,
          glyphsCount: 1,
          mask: 0,
          advance: 64,
          xAdvance: 64,
          yAdvance: 0,
          xOffset: -4,
          yOffset: 2,
          xBearing: -8,
          yBearing: 64,
          width: 32,
          height: -64,
        }));
        return {
          input: {
            frameID: `scale-${scale}`,
            nodeID: sample.id,
            purpose,
            text,
            fontSize,
            scale,
            textStyle: {},
            expectedMetrics: { ...measured },
            ...(purpose === "text" ? { physicalOrigin } : {}),
          },
          requestedSize26_6: fontSize * 64,
          effectiveShaperPixels: Math.ceil(fontSize),
          measured,
          scaledAdvance: runes.length * scale,
          returnedLogicalHeight: 20,
          returnedLogicalBaseline: 15,
          runs: [
            {
              runeOffset: 0,
              runeCount: runes.length,
              visualIndex: 0,
              direction: 0,
              size: fontSize * 64,
              advance: runes.length * 64,
              lineBounds: { ascent: 960, descent: -256, gap: 0 },
              glyphBounds: { ascent: 960, descent: -256, gap: 0 },
              fontHash: identity.fontHash,
              unitsPerEm: 1000,
              runX: 0,
              sharedScaledAscent: 15 * scale,
              textureRunOrigin: { x: 0, y: 15 * scale },
              ...(purpose === "text"
                ? {
                    viewportRunBaseline: {
                      x: physicalOrigin.x,
                      y: physicalOrigin.y + 15 * scale,
                    },
                  }
                : {}),
              glyphs,
            },
          ],
        };
      }),
    ),
  );
  return {
    schema: 1,
    diagnosticOnly: true,
    pixelPerfectVerified: false,
    ...identity,
    variant,
    originQuantization: variant === "upstream-v2.8.1" ? "ceil" : "nearest",
    fontExtents: {
      unitsPerEm: 1000,
      available: true,
      ascender: 1069,
      descender: -293,
      lineGap: 0,
    },
    cases,
  };
}

function pair() {
  return {
    upstream: shapingTrace("upstream-v2.8.1"),
    fork: shapingTrace("fork-v2.8.1-sytue.16"),
  };
}
function compare(value: ReturnType<typeof pair>) {
  return compareNativeShaping(value.upstream, value.fork, probe, identity);
}

test("the declared seven samples at both scales require all 42 text/H/space cases", () => {
  const result = compare(pair());
  expect(result.original.size).toBe(42);
  expect(result.changed.size).toBe(42);
  expect(result.original.has("scale-2/probe-fractional/text")).toBe(true);
});

test("dropping a real declared case or replacing it with a duplicate fails", () => {
  for (const variant of ["upstream", "fork"] as const) {
    const dropped = pair();
    dropped[variant].cases.pop();
    expect(() => compare(dropped)).toThrow("omitted shaping cases");
    const duplicated = pair();
    duplicated[variant].cases[0] = structuredClone(
      duplicated[variant].cases[1]!,
    );
    expect(() => compare(duplicated)).toThrow("duplicate cases");
  }
});

test("a one-unit signed glyph offset change cannot be hidden by matching advances", () => {
  const value = pair();
  const sample = value.fork.cases.find(
    (item) =>
      item.input.nodeID === "probe-combining" &&
      item.input.scale === 2 &&
      item.input.purpose === "text",
  )!;
  sample.runs[0]!.glyphs[0]!.xOffset += 1;
  expect(() => compare(value)).toThrow("glyphs differs");
});

test("trace-level and run-level font identity must match the supplied identity", () => {
  const trace = pair();
  trace.fork.fontHash = "e".repeat(64);
  expect(() => compare(trace)).toThrow("fontHash differs");
  const both = pair();
  for (const variant of [both.upstream, both.fork])
    variant.cases[0]!.runs[0]!.fontHash = "e".repeat(64);
  expect(() => compare(both)).toThrow("primary font differs");
});

test("missing metrics on both variants are invalid even when their absence matches", () => {
  for (const field of [
    "requestedSize26_6",
    "effectiveShaperPixels",
    "measured",
    "scaledAdvance",
    "returnedLogicalHeight",
    "returnedLogicalBaseline",
  ]) {
    const value = pair();
    for (const variant of [value.upstream, value.fork])
      Reflect.deleteProperty(variant.cases[0]!, field);
    expect(() => compare(value)).toThrow();
  }
  for (const field of [
    "size",
    "advance",
    "lineBounds",
    "glyphBounds",
    "runX",
    "sharedScaledAscent",
    "textureRunOrigin",
  ]) {
    const value = pair();
    for (const variant of [value.upstream, value.fork])
      Reflect.deleteProperty(variant.cases[0]!.runs[0]!, field);
    expect(() => compare(value)).toThrow();
  }
});

test("signed glyph data must be present, finite integer 26.6 values", () => {
  for (const field of [
    "xOffset",
    "yOffset",
    "xBearing",
    "yBearing",
    "advance",
    "width",
    "height",
  ]) {
    for (const mutation of [undefined, NaN, Infinity, 0.5, "0"]) {
      const value = pair();
      for (const variant of [value.upstream, value.fork]) {
        const glyph = variant.cases[0]!.runs[0]!.glyphs[0]!;
        if (mutation === undefined) Reflect.deleteProperty(glyph, field);
        else Reflect.set(glyph, field, mutation);
      }
      expect(() => compare(value)).toThrow();
    }
  }
});

test("shaping evidence always remains an uncertified diagnostic", () => {
  for (const [field, value] of [
    ["pixelPerfectVerified", true],
    ["diagnosticOnly", false],
  ] as const) {
    const traces = pair();
    Reflect.set(traces.fork, field, value);
    expect(() => compare(traces)).toThrow("uncertified diagnostic");
  }
});

test("pixel deltas and exact frames preserve zero-tolerance acceptance", () => {
  expect(
    strictTypographyPixels(
      {
        changedPixels: 3,
        exact: false,
        accepted: false,
        tolerance: { channel: 0, pixels: 0 },
      },
      "pixels",
    ).accepted,
  ).toBe(false);
  expect(
    strictTypographyPixels(
      {
        changedPixels: 0,
        exact: true,
        accepted: true,
        tolerance: { channel: 0, pixels: 0 },
      },
      "pixels",
    ).exact,
  ).toBe(true);
  for (const item of [
    {
      changedPixels: 3,
      exact: false,
      accepted: true,
      tolerance: { channel: 0, pixels: 0 },
    },
    {
      changedPixels: 3,
      exact: true,
      accepted: true,
      tolerance: { channel: 0, pixels: 0 },
    },
    {
      changedPixels: 0,
      exact: true,
      accepted: true,
      tolerance: { channel: 1, pixels: 0 },
    },
    {
      changedPixels: 0,
      exact: true,
      accepted: true,
      tolerance: { channel: 0, pixels: 1 },
    },
    {
      changedPixels: NaN,
      exact: false,
      accepted: false,
      tolerance: { channel: 0, pixels: 0 },
    },
  ])
    expect(() => strictTypographyPixels(item, "pixels")).toThrow(
      "zero-tolerance",
    );
});

function browserSample() {
  const box = { x: 16, y: 16, width: 32, height: 20 };
  return {
    elementBox: box,
    contentBox: box,
    dom: {
      available: true,
      method: "dom-range",
      full: { bounds: box, rects: [box] },
    },
    baseline: {
      method: "inline-marker",
      viewportY: 31,
      contentOffsetY: 15,
      markerBox: { x: 48, y: 31, width: 0, height: 0 },
    },
    canvas: {
      method: "canvas-text-metrics",
      full: {
        width: 32,
        actualBoundingBoxLeft: -1,
        actualBoundingBoxRight: 33,
        actualBoundingBoxAscent: 15,
        actualBoundingBoxDescent: 4,
        fontBoundingBoxAscent: 15,
        fontBoundingBoxDescent: 4,
        emHeightAscent: null,
        emHeightDescent: null,
        hangingBaseline: null,
        alphabeticBaseline: null,
        ideographicBaseline: null,
      },
    },
  };
}

test("browser geometry and nullable Canvas metrics are validated before arithmetic", () => {
  expect(() =>
    validateTypographyBrowserSample(browserSample(), "browser"),
  ).not.toThrow();
  const missing = browserSample();
  Reflect.deleteProperty(missing.dom.full.bounds, "width");
  expect(() => validateTypographyBrowserSample(missing, "browser")).toThrow();
  const baseline = browserSample();
  baseline.baseline.viewportY = Infinity;
  expect(() => validateTypographyBrowserSample(baseline, "browser")).toThrow();
  const canvas = browserSample();
  Reflect.deleteProperty(canvas.canvas.full, "emHeightAscent");
  expect(() => validateTypographyBrowserSample(canvas, "browser")).toThrow(
    "explicitly present or null",
  );
});

test("sidecar dependencies may omit unused modules but cannot add or change dependencies", () => {
  const native = [
    { Path: "converter", Main: true },
    { Path: "fyne.io/fyne/v2", Version: "v2.8.1" },
    { Path: "github.com/go-text/typesetting", Version: "v0.3.4" },
    { Path: "unused.example/module", Version: "v1.0.0" },
  ];
  const sidecar = [
    { Path: "fyne.io/fyne/v2", Main: true },
    { Path: "github.com/go-text/typesetting", Version: "v0.3.4" },
  ];
  expect(compareSidecarModules(native, sidecar).relation).toBe("subset");
  expect(() =>
    compareSidecarModules(native, [
      { Path: "new.example/module", Version: "v1.0.0" },
    ]),
  ).toThrow("introduced dependency");
  expect(() =>
    compareSidecarModules(native, [
      { Path: "github.com/go-text/typesetting", Version: "v0.3.5" },
    ]),
  ).toThrow("differs");
  expect(() =>
    compareSidecarModules(native, [
      {
        Path: "github.com/go-text/typesetting",
        Version: "v0.3.4",
        Replace: { Path: "different.example/fork", Version: "v0.3.4" },
      },
    ]),
  ).toThrow("differs");
  expect(() => compareSidecarModules(native, [])).toThrow(
    "omitted all dependency",
  );
});

function compiledPainterPair() {
  const files = [{ name: "font.go", hash: "a".repeat(64) }],
    shapingFiles = [{ name: "shaping.go", hash: "b".repeat(64) }];
  const native = {
    schema: 1,
    diagnosticOnly: true,
    pixelPerfectVerified: false,
    fileSelection:
      "Go list production compilation and embedding inputs; tests and unused module graph entries excluded",
    packages: [
      {
        importPath: "fyne.io/fyne/v2/internal/painter",
        module: {
          path: "fyne.io/fyne/v2",
          version: "v2.8.1" as string | null,
          main: false,
          replacement: null,
        },
        files,
        sourceHash: typographyHash(JSON.stringify(files)),
      },
      {
        importPath: "github.com/go-text/typesetting/shaping",
        module: {
          path: "github.com/go-text/typesetting",
          version: "v0.3.4" as string | null,
          main: false,
          replacement: null,
        },
        files: shapingFiles,
        sourceHash: typographyHash(JSON.stringify(shapingFiles)),
      },
    ],
  };
  const sidecar = structuredClone(native);
  sidecar.packages[0]!.module.version = null;
  sidecar.packages[0]!.module.main = true;
  return { native, sidecar };
}

test("actual compiled packages permit only the source-verified Fyne main-module alias", () => {
  const { native, sidecar } = compiledPainterPair();
  const result = comparePainterPackages(native, sidecar);
  expect(result.relation).toBe("exact-compiled-packages");
  expect(result.packages).toBe(2);
  expect(result.fynePackages).toBe(1);
});

test("changed compiled dependency identity, changed source or a missing package fails", () => {
  const module = compiledPainterPair();
  module.sidecar.packages[1]!.module.version = "v0.3.5";
  expect(() => comparePainterPackages(module.native, module.sidecar)).toThrow(
    "compiled module identity differs",
  );
  for (const index of [0, 1]) {
    const source = compiledPainterPair(),
      item = source.sidecar.packages[index]!;
    item.files[0]!.hash = "e".repeat(64);
    item.sourceHash = typographyHash(JSON.stringify(item.files));
    expect(() => comparePainterPackages(source.native, source.sidecar)).toThrow(
      "compiled source differs",
    );
  }
  const missing = compiledPainterPair();
  missing.sidecar.packages.pop();
  expect(() => comparePainterPackages(missing.native, missing.sidecar)).toThrow(
    "compiled import paths differs",
  );
});

test("equal missing inventories, duplicate imports and stale file digests fail closed", () => {
  const missing = compiledPainterPair();
  missing.native.packages.shift();
  missing.sidecar.packages.shift();
  expect(() => comparePainterPackages(missing.native, missing.sidecar)).toThrow(
    "actual Fyne painter",
  );
  const duplicate = compiledPainterPair();
  duplicate.sidecar.packages[1] = structuredClone(
    duplicate.sidecar.packages[0]!,
  );
  expect(() =>
    comparePainterPackages(duplicate.native, duplicate.sidecar),
  ).toThrow("unique");
  const stale = compiledPainterPair();
  stale.sidecar.packages[1]!.files[0]!.hash = "e".repeat(64);
  expect(() => comparePainterPackages(stale.native, stale.sidecar)).toThrow(
    "inventory hash differs",
  );
  const main = compiledPainterPair();
  main.sidecar.packages[1]!.module.main = true;
  expect(() => comparePainterPackages(main.native, main.sidecar)).toThrow(
    "unexpected compiled module owner",
  );
});

test("unused graph entries neither invalidate compiled identity nor substitute for it", () => {
  const graph = [{ Path: "github.com/go-text/typesetting", Version: "v0.3.4" }],
    eagerGraph = [
      ...graph,
      { Path: "github.com/hashicorp/consul/api", Version: "v1.0.0" },
    ];
  expect(() => compareSidecarModules(graph, eagerGraph)).toThrow(
    "introduced dependency",
  );
  const compiled = compiledPainterPair();
  expect(() =>
    comparePainterPackages(compiled.native, compiled.sidecar),
  ).not.toThrow();
  expect(() => compareSidecarModules(graph, graph)).not.toThrow();
  compiled.sidecar.packages[1]!.module.version = "v0.3.5";
  expect(() =>
    comparePainterPackages(compiled.native, compiled.sidecar),
  ).toThrow("compiled module identity differs");
});

test("retained painter source must prove its position policy, not only image dimensions", () => {
  const ceil =
    "func ToScreenCoordinate(c fyne.Canvas, v float32) int {\nreturn int(math.Ceil(float64(v * c.Scale())))\n}";
  const upstream =
    "func drawText(c fyne.Canvas) {\nscaledX := scale.ToScreenCoordinate(c, pos.X+offsetX)\nscaledY := scale.ToScreenCoordinate(c, pos.Y+offsetY)\n}";
  const fork =
    "func drawText(c fyne.Canvas) {\nscaledX := toScreenPos(c, pos.X+offsetX)\nscaledY := toScreenPos(c, pos.Y+offsetY)\n}\nfunc toScreenPos(c fyne.Canvas, v float32) int {\nreturn int(math.Round(float64(v * c.Scale())))\n}";
  expect(() =>
    validateSoftwareOriginSource(upstream, ceil, "upstream-v2.8.1"),
  ).not.toThrow();
  expect(() =>
    validateSoftwareOriginSource(fork, undefined, "fork-v2.8.1-sytue.16"),
  ).not.toThrow();
  expect(() =>
    validateSoftwareOriginSource(upstream, undefined, "upstream-v2.8.1"),
  ).toThrow("ceiling scale helper");
  expect(() =>
    validateSoftwareOriginSource(
      fork.replace("math.Round", "math.Ceil"),
      undefined,
      "fork-v2.8.1-sytue.16",
    ),
  ).toThrow("nearest-pixel helper");
});
