// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { validateMotion, type MotionSample } from "../src/motion.ts";
import type { Geometry, MotionProbeCase } from "./motion-probe.ts";

const [input, output] = process.argv.slice(2);
assert.ok(
  input && output,
  "Usage: bun capture/motion-catalogue.ts <native.json> <artifacts>",
);
const root = resolve(import.meta.dir, ".."),
  out = resolve(output);
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
await mkdir(out, { recursive: true });
const raw = await readFile(resolve(input));
const native = JSON.parse(raw.toString("utf8")) as {
  schema: number;
  nativeObjects: boolean;
  cases: MotionProbeCase[];
};
assert.equal(native.schema, 1);
assert.equal(native.nativeObjects, true);
assert.equal(native.cases.length, 8);
for (const item of native.cases) {
  validateMotion(item.spec);
  assert.ok(item.samples.length > 0);
}
const sourceInputs = [];
for (const path of [
  "capture/motion-catalogue.ts",
  "capture/motion-probe.ts",
  "src/motion.ts",
  "src/motion-web.ts",
  "native/motion/clip.go",
  "native/motion/json.go",
  "native/motion/controller.go",
  "native/motion/binding.go",
  "native/motion/probe_test.go",
  "native/motion/motion_test.go",
  "native/go.mod",
  "native/go.sum",
  "package.json",
  "bun.lock",
]) {
  const bytes = await readFile(join(root, path));
  sourceInputs.push({ path, hash: hash(bytes) });
  await mkdir(dirname(join(out, "inputs", path)), { recursive: true });
  await writeFile(join(out, "inputs", path), bytes);
}
await writeFile(
  join(out, "inputs.json"),
  JSON.stringify(sourceInputs, null, 2) + "\n",
);
const built = await Bun.build({
  entrypoints: [join(root, "capture/motion-probe.ts")],
  target: "browser",
  format: "esm",
});
assert.equal(
  built.success,
  true,
  built.logs.map((log) => log.message).join("\n"),
);
const script = await built.outputs[0]!.text();
await writeFile(join(out, "browser-probe.js"), script);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === "/probe.js")
      return new Response(script, {
        headers: { "Content-Type": "text/javascript" },
      });
    return new Response(
      '<!doctype html><html><body><script type="module" src="/probe.js"></script></body></html>',
      { headers: { "Content-Type": "text/html" } },
    );
  },
});
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const geometryTolerance = 1 / 64;
let compared = 0;
function compareGeometry(
  actual: Record<string, Geometry>,
  expected: Record<string, Geometry>,
  label: string,
) {
  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(expected).sort(),
    `target inventory ${label}`,
  );
  for (const [id, g] of Object.entries(expected))
    for (const axis of ["x", "y", "width", "height"] as const) {
      const value = actual[id]![axis];
      assert.ok(
        Number.isFinite(value) &&
          Math.abs(value - g[axis]) <= geometryTolerance,
        `${label} ${id}.${axis}: browser=${value}, native=${g[axis]}`,
      );
      compared++;
    }
}
function compareSample(
  actual: MotionSample,
  expected: MotionSample,
  label: string,
) {
  assert.equal(actual.active, expected.active, `active ${label}`);
  assert.ok(
    Math.abs(actual.progress - expected.progress) <= 1e-10,
    `iteration progress ${label}`,
  );
  assert.equal(actual.values.length, expected.values.length);
  for (const [i, value] of actual.values.entries()) {
    const reference = expected.values[i]!;
    assert.deepEqual(
      [value.track, value.target, value.property],
      [reference.track, reference.target, reference.property],
    );
    assert.ok(
      Math.abs(value.value - reference.value) <= 1e-8,
      `analytical numeric sample ${label}`,
    );
  }
}
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 768 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  assert.ok((await page.goto(server.url.href))?.ok());
  await page.waitForFunction(() => !!window.afyMotionProbe);
  const actual = await page.evaluate(
    (cases) => window.afyMotionProbe.run(cases),
    native.cases,
  );
  await writeFile(
    join(out, "browser.json"),
    JSON.stringify(actual, null, 2) + "\n",
  );
  assert.equal(actual.cases.length, native.cases.length);
  for (const [index, item] of actual.cases.entries()) {
    const expected = native.cases[index]!;
    assert.equal(item.name, expected.name);
    assert.equal(item.samples.length, expected.samples.length);
    for (const [i, sample] of item.samples.entries()) {
      const ref = expected.samples[i]!;
      assert.equal(sample.timeMs, ref.timeMs);
      compareSample(sample.sample, ref.sample, `${item.name}/${ref.timeMs}`);
      compareGeometry(
        sample.geometry,
        ref.geometry,
        `${item.name}/${ref.timeMs}`,
      );
    }
    assert.equal(item.controls.length, expected.controls.length);
    for (const [i, step] of item.controls.entries()) {
      const ref = expected.controls[i]!;
      assert.equal(step.operation, ref.operation);
      assert.deepEqual(step.state, ref.state);
      compareSample(
        step.sample,
        ref.sample,
        `${item.name}/${step.operation}/${i}`,
      );
      compareGeometry(
        step.geometry,
        ref.geometry,
        `${item.name}/${step.operation}/${i}`,
      );
    }
    assert.deepEqual(
      item.beforeFailure,
      item.afterFailure,
      `failed call atomicity ${item.name}`,
    );
    assert.deepEqual(item.rejected, [
      "nonfinite-seek",
      "nonfinite-rate",
      "foreign-state",
    ]);
    compareGeometry(
      item.closedGeometry,
      expected.targets,
      `closed ${item.name}`,
    );
    assert.equal(item.closedTickRejected, true);
    assert.equal(item.remainingAnimations, 0);
  }
  const linear = native.cases[0]!;
  compareGeometry(
    actual.independence.first,
    linear.samples.find((item) => item.timeMs === 250)!.geometry,
    "independent first",
  );
  compareGeometry(
    actual.independence.second,
    linear.samples.find((item) => item.timeMs === 750)!.geometry,
    "independent second",
  );
  assert.deepEqual(
    actual.independence.first,
    actual.independence.firstAfterOtherSeek,
  );
  assert.deepEqual(
    actual.constraintRejections.map((item) => item.name),
    [
      "min-width",
      "min-height",
      "max-width",
      "max-height",
      "padding",
      "border",
      "margin",
      "transform",
      "translate",
      "rotate",
      "scale",
      "existing-animation",
    ],
  );
  for (const item of actual.constraintRejections) {
    assert.equal(
      item.rejected,
      true,
      `unsafe browser target was accepted: ${item.name}`,
    );
    assert.match(item.diagnostic, /native motion adapter/);
    assert.deepEqual(
      item.before,
      item.after,
      `failed target admission changed geometry, styles or caller effects: ${item.name}`,
    );
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(out, "summary.json"),
    JSON.stringify(
      {
        schema: 1,
        accepted: true,
        nativeInputHash: hash(raw),
        browserBundleHash: hash(script),
        sourceInputsHash: hash(await readFile(join(out, "inputs.json"))),
        browserVersion: browser.version(),
        cases: actual.cases.length,
        geometryObservations: compared,
        constrainedTargetsRejected: actual.constraintRejections.length,
        tolerance: {
          geometryCSSPx: geometryTolerance,
          analyticalNumeric: 1e-8,
        },
        realNativeObjects: true,
        realWebAnimations: true,
        pixelPerfectVerified: false,
        universalCSSVerified: false,
      },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  await writeFile(
    join(out, "failure.json"),
    JSON.stringify(
      {
        schema: 1,
        accepted: false,
        message: error instanceof Error ? error.message : String(error),
        errors,
        compared,
        tolerance: { geometryCSSPx: geometryTolerance },
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  await browser.close();
  server.stop(true);
}
