// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readTypographyProbe,
  typographyHash,
  type TypographyCase,
  type TypographyIdentity,
  type TypographyProbe,
} from "./typography.ts";

type RecordValue = Record<string, any>;
const variants = ["upstream-v2.8.1", "fork-v2.8.1-sytue.16"] as const;

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown, label: string): RecordValue {
  requireValue(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as RecordValue;
}

function finite(value: unknown, label: string): number {
  requireValue(
    typeof value === "number" && Number.isFinite(value),
    `${label} must be finite`,
  );
  return value;
}

function integer(
  value: unknown,
  label: string,
  min = -2147483648,
  max = 2147483647,
) {
  const result = finite(value, label);
  requireValue(
    Number.isInteger(result) && result >= min && result <= max,
    `${label} must be an integer in ${min}..${max}`,
  );
  return result;
}

function point(value: unknown, label: string, pixels = false) {
  const item = record(value, label);
  for (const key of ["x", "y"])
    if (pixels) integer(item[key], `${label} ${key}`);
    else finite(item[key], `${label} ${key}`);
  return item;
}

function metrics(value: unknown, label: string) {
  const item = record(value, label);
  for (const key of ["width", "height", "baseline"])
    finite(item[key], `${label} ${key}`);
  requireValue(
    item.width >= 0 && item.height >= 0,
    `${label} dimensions must be nonnegative`,
  );
  return item;
}

function bounds(value: unknown, label: string) {
  const item = record(value, label);
  for (const key of ["ascent", "descent", "gap"])
    integer(item[key], `${label} ${key}`);
}

function shapeCase(item: RecordValue, label: string) {
  integer(item.requestedSize26_6, `${label} requestedSize26_6`, 1);
  integer(item.effectiveShaperPixels, `${label} effectiveShaperPixels`, 1);
  metrics(item.measured, `${label} measured`);
  const input = record(item.input, `${label} input`);
  metrics(input.expectedMetrics, `${label} expected metrics`);
  same(
    item.measured,
    input.expectedMetrics,
    `${label} captured kernel metrics`,
  );
  for (const key of [
    "scaledAdvance",
    "returnedLogicalHeight",
    "returnedLogicalBaseline",
  ])
    finite(item[key], `${label} ${key}`);
  if (input.purpose === "text")
    point(input.physicalOrigin, `${label} physical origin`, true);
  else
    requireValue(
      !Object.hasOwn(input, "physicalOrigin"),
      `${label} metric-only case must not invent a painted origin`,
    );
  requireValue(
    Array.isArray(item.runs) && item.runs.length > 0,
    `${label} omitted actual shaped runs`,
  );
  for (const [index, value] of item.runs.entries()) {
    const run = record(value, `${label} run ${index}`),
      runLabel = `${label} run ${index}`;
    integer(run.runeOffset, `${runLabel} runeOffset`, 0);
    integer(run.runeCount, `${runLabel} runeCount`, 1);
    integer(run.visualIndex, `${runLabel} visualIndex`, 0);
    integer(run.direction, `${runLabel} direction`, 0, 255);
    integer(run.size, `${runLabel} size`, 1);
    integer(run.advance, `${runLabel} advance`);
    integer(run.unitsPerEm, `${runLabel} unitsPerEm`, 1, 65535);
    bounds(run.lineBounds, `${runLabel} lineBounds`);
    bounds(run.glyphBounds, `${runLabel} glyphBounds`);
    finite(run.runX, `${runLabel} runX`);
    finite(run.sharedScaledAscent, `${runLabel} sharedScaledAscent`);
    point(run.textureRunOrigin, `${runLabel} textureRunOrigin`, true);
    if (input.purpose === "text")
      point(run.viewportRunBaseline, `${runLabel} viewportRunBaseline`, true);
    requireValue(
      Array.isArray(run.glyphs) && run.glyphs.length > 0,
      `${runLabel} omitted actual glyphs`,
    );
    for (const [glyphIndex, value] of run.glyphs.entries()) {
      const glyph = record(value, `${runLabel} glyph ${glyphIndex}`),
        glyphLabel = `${runLabel} glyph ${glyphIndex}`;
      integer(glyph.id, `${glyphLabel} id`, 1, 4294967295);
      for (const key of ["textIndex", "runesCount", "glyphsCount"])
        integer(glyph[key], `${glyphLabel} ${key}`, 0);
      integer(glyph.mask, `${glyphLabel} mask`, 0, 4294967295);
      for (const key of [
        "advance",
        "xAdvance",
        "yAdvance",
        "xOffset",
        "yOffset",
        "xBearing",
        "yBearing",
        "width",
        "height",
      ])
        integer(glyph[key], `${glyphLabel} ${key}`);
    }
  }
}

function rectangle(value: unknown, label: string) {
  const item = point(value, label);
  requireValue(
    finite(item.width, `${label} width`) >= 0 &&
      finite(item.height, `${label} height`) >= 0,
    `${label} dimensions must be nonnegative`,
  );
  return item;
}

export function validateTypographyBrowserSample(value: unknown, label: string) {
  const item = record(value, label),
    dom = record(item.dom, `${label} DOM`),
    baseline = record(item.baseline, `${label} baseline`),
    canvas = record(item.canvas, `${label} Canvas`);
  requireValue(
    dom.available === true && dom.method === "dom-range",
    `${label} must preserve actual DOM Range observations`,
  );
  requireValue(
    baseline.method === "inline-marker",
    `${label} must preserve the actual inline marker`,
  );
  rectangle(item.elementBox, `${label} element box`);
  rectangle(item.contentBox, `${label} content box`);
  finite(baseline.viewportY, `${label} baseline viewportY`);
  finite(baseline.contentOffsetY, `${label} baseline contentOffsetY`);
  rectangle(baseline.markerBox, `${label} baseline marker`);
  const full = record(dom.full, `${label} full range`);
  rectangle(full.bounds, `${label} full range bounds`);
  requireValue(
    Array.isArray(full.rects) && full.rects.length > 0,
    `${label} omitted DOM rectangles`,
  );
  for (const rect of full.rects) rectangle(rect, `${label} DOM rectangle`);
  requireValue(
    canvas.method === "canvas-text-metrics",
    `${label} omitted Canvas TextMetrics`,
  );
  const values = record(canvas.full, `${label} Canvas metrics`);
  requireValue(
    finite(values.width, `${label} Canvas width`) >= 0,
    `${label} Canvas width must be nonnegative`,
  );
  for (const key of [
    "actualBoundingBoxLeft",
    "actualBoundingBoxRight",
    "actualBoundingBoxAscent",
    "actualBoundingBoxDescent",
    "fontBoundingBoxAscent",
    "fontBoundingBoxDescent",
    "emHeightAscent",
    "emHeightDescent",
    "hangingBaseline",
    "alphabeticBaseline",
    "ideographicBaseline",
  ]) {
    requireValue(
      Object.hasOwn(values, key),
      `${label} Canvas ${key} must be explicitly present or null`,
    );
    if (values[key] !== null) finite(values[key], `${label} Canvas ${key}`);
  }
  return item;
}

function same(actual: unknown, expected: unknown, label: string) {
  requireValue(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} differs`,
  );
}

function identity(value: unknown, expected: TypographyIdentity, label: string) {
  const item = record(value, label);
  requireValue(
    item.schema === 1 &&
      item.diagnosticOnly === true &&
      item.pixelPerfectVerified === false,
    `${label} must remain an uncertified diagnostic`,
  );
  for (const key of [
    "sourceHash",
    "probeHash",
    "fixtureHash",
    "fontHash",
  ] as const)
    same(item[key], expected[key], `${label} ${key}`);
  return item;
}

export function strictTypographyPixels(value: unknown, label: string) {
  const item = record(value, label);
  requireValue(
    item.tolerance?.channel === 0 &&
      item.tolerance?.pixels === 0 &&
      Number.isSafeInteger(item.changedPixels) &&
      item.changedPixels >= 0 &&
      item.exact === (item.changedPixels === 0) &&
      item.accepted === item.exact,
    `${label} must preserve zero-tolerance pixel results`,
  );
  return item;
}

function cases(value: unknown, probe: TypographyProbe, label: string) {
  requireValue(
    Array.isArray(value) &&
      value.length === probe.samples.length * probe.scales.length * 3,
    `${label} omitted shaping cases`,
  );
  const result = new Map<string, RecordValue>();
  for (const raw of value) {
    const item = record(raw, label),
      input = record(item.input, `${label} input`);
    const sample = probe.samples.find((sample) => sample.id === input.nodeID);
    requireValue(
      sample &&
        probe.scales.includes(input.scale) &&
        input.frameID === `scale-${input.scale}` &&
        ["text", "H", "space"].includes(input.purpose),
      `${label} contains an unknown case`,
    );
    same(
      input.text,
      input.purpose === "H"
        ? "H"
        : input.purpose === "space"
          ? " "
          : sample.text,
      `${label} source text`,
    );
    same(
      input.fontSize,
      sample.fontSize ?? probe.font.size,
      `${label} font size`,
    );
    const key = `${input.frameID}/${input.nodeID}/${input.purpose}`;
    requireValue(!result.has(key), `${label} contains duplicate cases`);
    shapeCase(item, `${label} ${key}`);
    result.set(key, item);
  }
  return result;
}

export function compareNativeShaping(
  upstream: unknown,
  fork: unknown,
  probe: TypographyProbe,
  expected: TypographyIdentity,
) {
  const left = identity(upstream, expected, "upstream shaping"),
    right = identity(fork, expected, "fork shaping");
  same(left.variant, variants[0], "upstream shaping variant");
  same(right.variant, variants[1], "fork shaping variant");
  same(left.originQuantization, "ceil", "upstream origin policy");
  same(right.originQuantization, "nearest", "fork origin policy");
  for (const [label, trace] of [
    ["upstream", left],
    ["fork", right],
  ] as const) {
    const extents = record(trace.fontExtents, `${label} font extents`);
    integer(extents.unitsPerEm, `${label} font extents unitsPerEm`, 1, 65535);
    requireValue(
      typeof extents.available === "boolean",
      `${label} font extents availability must be explicit`,
    );
    for (const key of ["ascender", "descender", "lineGap"])
      finite(extents[key], `${label} font extents ${key}`);
  }
  same(left.fontExtents, right.fontExtents, "font extents");
  const original = cases(left.cases, probe, "upstream"),
    changed = cases(right.cases, probe, "fork");
  for (const [key, before] of original) {
    const after = changed.get(key);
    requireValue(after, `fork omitted ${key}`);
    for (const field of [
      "requestedSize26_6",
      "effectiveShaperPixels",
      "measured",
      "scaledAdvance",
      "returnedLogicalHeight",
      "returnedLogicalBaseline",
    ])
      same(before[field], after[field], `${key} ${field}`);
    same(before.runs.length, after.runs.length, `${key} run count`);
    for (let index = 0; index < before.runs.length; index++) {
      const a = before.runs[index],
        b = after.runs[index];
      for (const field of [
        "runeOffset",
        "runeCount",
        "visualIndex",
        "direction",
        "size",
        "advance",
        "lineBounds",
        "glyphBounds",
        "fontHash",
        "unitsPerEm",
        "runX",
        "sharedScaledAscent",
        "textureRunOrigin",
        "glyphs",
      ])
        same(a[field], b[field], `${key} run ${index} ${field}`);
      same(a.fontHash, expected.fontHash, `${key} primary font`);
    }
  }
  return { original, changed };
}

function moduleStream(bytes: string) {
  const matches = bytes.trim().split(/\n(?=\{)/);
  return matches.map((item) => record(JSON.parse(item), "Go module"));
}

function moduleVersions(modules: RecordValue[]) {
  return modules
    .filter((item) => !item.Main)
    .map((item) =>
      JSON.stringify([
        item.Path,
        item.Version,
        item.Replace?.Path ?? null,
        item.Replace?.Version ?? null,
      ]),
    )
    .sort();
}

export function compareSidecarModules(
  native: RecordValue[],
  sidecar: RecordValue[],
  label = "sidecar",
) {
  const nativeVersions = new Map<string, string>();
  for (const item of native.filter(
    (item) => !item.Main && item.Path !== "fyne.io/fyne/v2",
  )) {
    requireValue(
      typeof item.Path === "string" &&
        item.Path &&
        !nativeVersions.has(item.Path),
      `${label} native dependency paths must be unique`,
    );
    nativeVersions.set(item.Path, moduleVersions([item])[0]!);
  }
  const dependencies = sidecar.filter((item) => !item.Main),
    seen = new Set<string>();
  requireValue(
    dependencies.length > 0,
    `${label} omitted all dependency modules`,
  );
  for (const item of dependencies) {
    requireValue(
      typeof item.Path === "string" && item.Path && !seen.has(item.Path),
      `${label} dependency paths must be unique`,
    );
    seen.add(item.Path);
    requireValue(
      nativeVersions.has(item.Path),
      `${label} introduced dependency ${item.Path}`,
    );
    same(
      moduleVersions([item])[0],
      nativeVersions.get(item.Path),
      `${label} dependency ${item.Path}`,
    );
  }
  return {
    relation: "subset" as const,
    nativeDependencies: nativeVersions.size,
    sidecarDependencies: dependencies.length,
  };
}

export function validateSoftwareOriginSource(
  draw: string,
  scale: string | undefined,
  variant: (typeof variants)[number],
) {
  const text = draw.match(/func drawText\([^]*?\n\}/)?.[0];
  requireValue(text, `${variant} omitted the retained software text painter`);
  const helper =
    variant === variants[0] ? "scale\\.ToScreenCoordinate" : "toScreenPos";
  for (const axis of ["X", "Y"])
    requireValue(
      new RegExp(
        `scaled${axis}\\s*:=\\s*${helper}\\(c,\\s*pos\\.${axis}\\s*\\+\\s*offset${axis}\\)`,
      ).test(text),
      `${variant} text origin does not use position plus alignment offset`,
    );
  if (variant === variants[0])
    requireValue(
      typeof scale === "string" &&
        /func ToScreenCoordinate\(c fyne.Canvas, v float32\) int\s*\{\s*return int\(math.Ceil\(float64\(v \* c.Scale\(\)\)\)\)\s*\}/.test(
          scale,
        ),
      "Upstream text origin must retain the ceiling scale helper",
    );
  else
    requireValue(
      /func toScreenPos\(c fyne.Canvas, v float32\) int\s*\{\s*return int\(math.Round\(float64\(v \* c.Scale\(\)\)\)\)\s*\}/.test(
        draw,
      ),
      "Fork text origin must retain the nearest-pixel helper",
    );
}

function nativeOrigin(
  value: RecordValue,
  scale: number,
  variant: (typeof variants)[number],
) {
  const absolute = point(value.absolutePosition, "Actual native text position"),
    scaled = point(value.scaledPosition, "Native scaled position");
  const x = finite(Math.fround(absolute.x * scale), "Native scaled X"),
    y = finite(Math.fround(absolute.y * scale), "Native scaled Y");
  same(
    [Math.fround(scaled.x), Math.fround(scaled.y)],
    [x, y],
    "Native position scale derivation",
  );
  point(value.ceilOrigin, "Native ceiling origin", true);
  point(value.nearestOrigin, "Native nearest origin", true);
  point(value.physicalOrigin, "Native physical origin", true);
  const ceil = { x: Math.ceil(x), y: Math.ceil(y) },
    round = (value: number) =>
      value < 0 ? -Math.round(-value) : Math.round(value),
    nearest = { x: round(x), y: round(y) };
  same(value.ceilOrigin, ceil, "Native ceiling origin");
  same(value.nearestOrigin, nearest, "Native nearest origin");
  same(
    value.physicalOrigin,
    variant === variants[0] ? ceil : nearest,
    "Native source-derived physical origin",
  );
  same(
    value.originDerivation,
    "verified software painter formula applied to actual canvas.Text position; not inferred from ink bounds",
    "Native origin provenance",
  );
}

async function json(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function png(path: string, hash: string, width: number, height: number) {
  const bytes = await readFile(path);
  requireValue(
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.readUInt32BE(16) === width &&
      bytes.readUInt32BE(20) === height &&
      typographyHash(bytes) === hash,
    `${path} differs from its capture identity`,
  );
}

export async function compareTypography(directory: string) {
  const root = resolve(directory),
    { probe, identity: expected } = await readTypographyProbe(
      fileURLToPath(new URL("../typography-probe.json", import.meta.url)),
    );
  const browser = identity(
    await json(resolve(root, "browser-text.json")),
    expected,
    "browser",
  );
  requireValue(
    Array.isArray(browser.cases) && browser.cases.length === 2,
    "Browser omitted scales",
  );
  const traces = await Promise.all(
    variants.map(async (variant) => {
      const directory = resolve(root, variant);
      const trace = identity(
        await json(resolve(directory, "native-shaping.json")),
        expected,
        variant,
      );
      const input = await readFile(resolve(directory, "texttrace-input.json"));
      same(
        trace.inputHash,
        typographyHash(input),
        `${variant} captured input hash`,
      );
      const download = record(
        await json(resolve(directory, "fyne-module.json")),
        variant,
      );
      same(
        [download.Path, download.Version, download.Sum, download.GoModSum],
        variant === variants[0]
          ? [
              "fyne.io/fyne/v2",
              "v2.8.1",
              "h1:EztGuE2W3Qhd0cWVmU+h5rkzNezUD1To6UqsoLQYUIM=",
              "h1:kpeuFrClm0fiAgJYr2soTfwKMT5rzNcSKzmgGjxvHOY=",
            ]
          : [
              "github.com/thinkddr/fyne/v2",
              "v2.8.1-sytue.16",
              "h1:JTIsUHcA/X/LShfpiPY2dXwOK0BKXkD53x7VLB5uCbY=",
              "h1:kpeuFrClm0fiAgJYr2soTfwKMT5rzNcSKzmgGjxvHOY=",
            ],
        `${variant} immutable public module`,
      );
      validateSoftwareOriginSource(
        await readFile(resolve(directory, "software-painter.go.txt"), "utf8"),
        variant === variants[0]
          ? await readFile(resolve(directory, "scale-helper.go.txt"), "utf8")
          : undefined,
        variant,
      );
      const nativeModules = moduleStream(
        await readFile(resolve(directory, "native-modules.jsonl"), "utf8"),
      );
      const sidecarModules = moduleStream(
        await readFile(resolve(directory, "sidecar-modules.jsonl"), "utf8"),
      );
      const importedFyne = nativeModules.find(
        (item) => item.Path === "fyne.io/fyne/v2",
      );
      requireValue(importedFyne, `${variant} does not resolve Fyne`);
      same(
        importedFyne.Replace?.Sum ?? importedFyne.Sum,
        download.Sum,
        `${variant} resolved Fyne bytes`,
      );
      const sidecarDependencies = compareSidecarModules(
        nativeModules,
        sidecarModules,
        `${variant} native and sidecar`,
      );
      return { trace, nativeModules, sidecarDependencies };
    }),
  );
  same(
    moduleVersions(
      traces[0]!.nativeModules.filter(
        (item) => item.Path !== "fyne.io/fyne/v2",
      ),
    ),
    moduleVersions(
      traces[1]!.nativeModules.filter(
        (item) => item.Path !== "fyne.io/fyne/v2",
      ),
    ),
    "A/B dependency versions",
  );
  const shaping = compareNativeShaping(
    traces[0]!.trace,
    traces[1]!.trace,
    probe,
    expected,
  );
  const frames = [];
  for (const scale of probe.scales) {
    const frameID = `scale-${scale}`;
    const web = identity(
      await json(resolve(root, frameID, "web-text.json")),
      expected,
      frameID,
    ) as TypographyCase & RecordValue;
    same(
      web.viewport,
      { ...probe.viewport, scale },
      `${frameID} browser viewport`,
    );
    same(web.case, frameID, `${frameID} browser case`);
    same(
      web,
      browser.cases.find((item: RecordValue) => item.case === frameID),
      `${frameID} aggregate capture`,
    );
    requireValue(
      web.samples.length === probe.samples.length,
      `${frameID} missing browser samples`,
    );
    await png(
      resolve(root, frameID, "web.png"),
      web.screenshot.hash,
      probe.viewport.width * scale,
      probe.viewport.height * scale,
    );
    for (const variant of variants) {
      const folder = resolve(root, variant, frameID);
      const native = identity(
        await json(resolve(folder, "native-text.json")),
        expected,
        `${variant}/${frameID}`,
      );
      same(native.variant, variant, "Native frame variant");
      same(native.viewport, web.viewport, "Native viewport");
      same(native.frameID, frameID, "Native frame ID");
      requireValue(
        native.texts.length === probe.samples.length,
        "Missing native texts",
      );
      await png(
        resolve(folder, "native.png"),
        native.pngHash,
        probe.viewport.width * scale,
        probe.viewport.height * scale,
      );
      const trace =
        variant === variants[0] ? shaping.original : shaping.changed;
      const samples = probe.samples.map((sample) => {
        const browserText = web.samples.find(
          (item) => item.nodeID === sample.id,
        );
        const nativeText = native.texts.find(
          (item: RecordValue) => item.nodeID === sample.id,
        );
        const shaped = trace.get(`${frameID}/${sample.id}/text`);
        requireValue(
          browserText && nativeText && shaped,
          `${frameID}/${sample.id} missing evidence`,
        );
        validateTypographyBrowserSample(
          browserText,
          `${frameID}/${sample.id} browser`,
        );
        nativeOrigin(nativeText, scale, variant);
        same(
          [browserText.text, nativeText.text],
          [sample.text, sample.text],
          "Captured text",
        );
        same(
          [browserText.fontHash, nativeText.fontHash],
          [expected.fontHash, expected.fontHash],
          "Captured font",
        );
        same(
          nativeText.driverText,
          shaped.measured,
          "Captured and traced text metrics",
        );
        same(
          nativeText.physicalOrigin,
          shaped.input.physicalOrigin,
          "Captured and traced physical origin",
        );
        const runBaselines = shaped.runs.map((run: RecordValue) => {
          const baseline = record(
            run.viewportRunBaseline,
            "Physical run baseline",
          );
          same(
            [baseline.x, baseline.y],
            [
              nativeText.physicalOrigin.x + run.textureRunOrigin.x,
              nativeText.physicalOrigin.y + run.textureRunOrigin.y,
            ],
            "Physical baseline derivation",
          );
          return finite(
            finite(baseline.y, "Native physical baseline") -
              browserText.baseline.viewportY * scale,
            "Physical baseline delta",
          );
        });
        return {
          nodeID: sample.id,
          fontSize: sample.fontSize ?? probe.font.size,
          effectiveNativeShaperPixels: shaped.effectiveShaperPixels,
          nativeDriverMinusDomRangeWidth: finite(
            finite(nativeText.driverText.width, "Native width") -
              browserText.dom.full.bounds.width,
            "DOM width delta",
          ),
          nativeDriverMinusCanvasWidth: finite(
            nativeText.driverText.width -
              finite(browserText.canvas.full.width, "Canvas width"),
            "Canvas width delta",
          ),
          logicalBaselineMinusInlineMarker: finite(
            finite(nativeText.intendedLogicalBaseline, "Logical baseline") -
              browserText.baseline.viewportY,
            "Logical baseline delta",
          ),
          physicalBaselineMinusBrowserMarkerTimesScale: runBaselines,
        };
      });
      frames.push({
        variant,
        frameID,
        samples,
        pixels: strictTypographyPixels(
          await json(resolve(folder, "pixels.json")),
          folder,
        ),
      });
    }
  }
  const pairPixels = await Promise.all(
    probe.scales.map(async (scale) => ({
      scale,
      pixels: strictTypographyPixels(
        await json(
          resolve(
            root,
            "upstream-versus-fork",
            `scale-${scale}`,
            "pixels.json",
          ),
        ),
        `A/B scale ${scale}`,
      ),
    })),
  );
  const summary = {
    schema: 1,
    diagnosticOnly: true,
    pixelPerfectVerified: false,
    ...expected,
    tolerance: { channel: 0, pixels: 0 },
    nativeShapingIdentical: true,
    sidecarDependencyRelation: traces.map((trace, index) => ({
      variant: variants[index],
      ...trace.sidecarDependencies,
    })),
    shapingCases: shaping.original.size,
    metricUnits:
      "logical CSS pixels; physical baseline deltas are device pixels",
    widthInterpretation:
      "DOM Range boxes are advance/selection boxes, not ink boxes or additive glyph widths; Canvas metrics are separate observations",
    exactBrowserFrames: frames.filter((frame) => frame.pixels.exact).length,
    differentBrowserFrames: frames.filter((frame) => !frame.pixels.exact)
      .length,
    frames,
    pairPixels,
  };
  await writeFile(
    resolve(root, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      shapingCases: summary.shapingCases,
      nativeShapingIdentical: true,
      differentBrowserFrames: summary.differentBrowserFrames,
      pixelPerfectVerified: false,
    }),
  );
}

if (import.meta.main) {
  requireValue(
    process.argv.length === 3 && process.argv[2],
    "Usage: compare-typography.ts ARTIFACT_DIRECTORY",
  );
  await compareTypography(process.argv[2]);
}
