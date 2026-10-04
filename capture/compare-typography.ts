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
    requireValue(
      Array.isArray(item.runs) && item.runs.length > 0,
      `${label} omitted actual shaped runs`,
    );
    for (const run of item.runs) {
      requireValue(
        Array.isArray(run.glyphs) && run.glyphs.length > 0,
        `${label} omitted actual glyphs`,
      );
      for (const glyph of run.glyphs)
        requireValue(
          Number.isInteger(glyph.id) && glyph.id > 0,
          `${label} produced a replacement glyph`,
        );
    }
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
      same(
        moduleVersions(
          nativeModules.filter((item) => item.Path !== "fyne.io/fyne/v2"),
        ),
        moduleVersions(sidecarModules),
        `${variant} native and sidecar dependencies`,
      );
      return { trace, nativeModules };
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
          return (
            finite(baseline.y, "Native physical baseline") -
            browserText.baseline.viewportY * scale
          );
        });
        return {
          nodeID: sample.id,
          fontSize: sample.fontSize ?? probe.font.size,
          effectiveNativeShaperPixels: shaped.effectiveShaperPixels,
          nativeDriverMinusDomRangeWidth:
            finite(nativeText.driverText.width, "Native width") -
            browserText.dom.full.bounds.width,
          nativeDriverMinusCanvasWidth:
            nativeText.driverText.width -
            finite(browserText.canvas.full.width, "Canvas width"),
          logicalBaselineMinusInlineMarker:
            finite(nativeText.intendedLogicalBaseline, "Logical baseline") -
            browserText.baseline.viewportY,
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
