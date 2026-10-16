// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Additive hosted evidence. These measurements never become native layout inputs.
import { chromium } from "playwright";
import {
  collectBrowserProvenance,
  verifyBrowserProvenance,
} from "./browser-provenance.ts";
import { validateBrowserProvenance } from "./browser-provenance-validation.ts";
import { readTypographyProbe } from "./typography.ts";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const flags = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index],
    value = process.argv[index + 1];
  if (
    !key ||
    ![
      "--url",
      "--out",
      "--native",
      "--comparator",
      "--browser-provenance",
    ].includes(key) ||
    !value ||
    value.startsWith("--") ||
    flags.has(key)
  )
    throw new Error(
      "Usage: input-editor-metrics.ts --url URL --out DIR --native NATIVE_EDITOR_DIR --comparator COMPARATOR --browser-provenance ORIGINAL_BROWSER_PROVENANCE",
    );
  flags.set(key, value);
}
const url = flags.get("--url"),
  output = flags.get("--out"),
  native = flags.get("--native"),
  comparatorPath = flags.get("--comparator"),
  provenancePath = flags.get("--browser-provenance");
if (
  !url ||
  !output ||
  !native ||
  !comparatorPath ||
  !provenancePath ||
  !["http:", "https:"].includes(new URL(url).protocol)
)
  throw new Error("All five editor evidence arguments are required");
const out = resolve(output),
  nativeDir = resolve(native),
  comparator = resolve(comparatorPath);
const comparatorHash = hash(await readFile(comparator));
const referenceProvenancePath = resolve(provenancePath);
const referenceProvenanceBytes = await readFile(referenceProvenancePath);
const referenceBrowserBytes = await readFile(
  resolve(dirname(referenceProvenancePath), "browser-text.json"),
);
const referenceProvenance = JSON.parse(referenceProvenanceBytes.toString());
const referenceBrowser = JSON.parse(referenceBrowserBytes.toString());
const { identity: originalIdentity, probe: originalProbe } =
  await readTypographyProbe(resolve(root, "typography-probe.json"));
validateBrowserProvenance(referenceProvenance, referenceBrowser, {
  identity: originalIdentity,
  collectorHash: hash(
    await readFile(resolve(root, "capture/browser-provenance.ts")),
  ),
  captureHash: hash(
    await readFile(resolve(root, "capture/typography-probe.ts")),
  ),
  viewport: originalProbe.viewport,
  scales: originalProbe.scales,
});
if (
  out === nativeDir ||
  out.startsWith(nativeDir + "/") ||
  nativeDir.startsWith(out + "/")
)
  throw new Error("Browser output must be separate from native evidence");
interface Sample {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  padding: number;
  border: number;
  lineHeightSource: "normal-font-metrics" | "authored";
}
const probeBytes = await readFile(resolve(root, "input-editor-metrics.json"));
const probe = JSON.parse(probeBytes.toString()) as {
  schema: number;
  fixture: string;
  id: string;
  viewport: { width: number; height: number };
  scales: number[];
  font: {
    family: string;
    path: string;
    webSrc: string;
    weight: number;
    style: string;
  };
  samples: Sample[];
};
if (
  probe.schema !== 1 ||
  probe.viewport.width !== 512 ||
  probe.viewport.height !== 320 ||
  JSON.stringify(probe.scales) !== "[1,2]" ||
  probe.font.family !== "AstroNoto" ||
  probe.font.weight !== 400 ||
  probe.font.style !== "normal" ||
  probe.font.webSrc !== "/fonts/NotoSans-Regular.ttf" ||
  probe.samples.length !== 6 ||
  new Set(probe.samples.map((s) => s.id)).size !== 6
)
  throw new Error("Held-out editor profile is incomplete");
for (const sample of probe.samples) {
  if (
    ![
      sample.x,
      sample.y,
      sample.width,
      sample.height,
      sample.fontSize,
      sample.lineHeight,
      sample.padding,
      sample.border,
    ].every(
      (value) =>
        typeof value === "number" && Number.isFinite(value) && value >= 0,
    ) ||
    !sample.id ||
    sample.text !== "Hgx" ||
    !["authored", "normal-font-metrics"].includes(sample.lineHeightSource)
  )
    throw new Error("Invalid held-out editor sample");
}
const fontHash = hash(await readFile(resolve(root, probe.font.path)));
const fixtureHash = hash(await readFile(resolve(root, probe.fixture)));
const sourceHash = hash(
  JSON.stringify([hash(probeBytes), fixtureHash, fontHash]),
);
const providerBytes = await readFile(resolve(nativeDir, "provider-build.json"));
const provider = JSON.parse(providerBytes.toString()) as {
  sources: Record<string, string>;
  binary: { sha256: string };
  buildInfo: { sha256: string };
};
if (
  !provider.sources ||
  Object.keys(provider.sources).length === 0 ||
  !/^[a-f0-9]{64}$/.test(provider.binary?.sha256) ||
  !/^[a-f0-9]{64}$/.test(provider.buildInfo?.sha256)
)
  throw new Error("Actual provider build record is missing");
for (const [path, expected] of Object.entries(provider.sources)) {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === ".." || part === "") ||
    !/^[a-f0-9]{64}$/.test(expected) ||
    hash(await readFile(resolve(root, path))) !== expected
  )
    throw new Error("Current provider source differs: " + path);
}
const sources = Object.fromEntries(
  await Promise.all(
    [
      "capture/input-editor-metrics.ts",
      "capture/browser-provenance.ts",
      "capture/browser-provenance-validation.ts",
      "capture/typography-probe.ts",
      "capture/typography.ts",
      "native/fontations/editor_probe_test.go",
      "native/fontations/editor_test.go",
      "native/backend.go",
      "native/controls.go",
      "native/responsive_text.go",
      "native/fontations/backend.go",
      "input-editor-metrics.json",
      probe.fixture,
      probe.font.path,
      "example/public/fonts/LICENSE-NotoSans.txt",
      "ci/text-engine-probe/policy.json",
      "native/go.mod",
      "native/go.sum",
    ].map(async (path) => [path, hash(await readFile(resolve(root, path)))]),
  ),
);
await mkdir(out, { recursive: true });
const frames: unknown[] = [];
const failures: { scale: number; stage: string; error: string }[] = [];
function validBounds(value: unknown, width: number, height: number) {
  if (value === null || typeof value !== "object") return false;
  const box = value as Record<string, unknown>;
  if (
    !Object.values(box).every(
      (n) => typeof n === "number" && Number.isSafeInteger(n),
    )
  )
    return false;
  return (
    typeof box.minX === "number" &&
    typeof box.maxX === "number" &&
    typeof box.minY === "number" &&
    typeof box.maxY === "number" &&
    box.minX >= 0 &&
    box.minX < box.maxX &&
    box.maxX <= width &&
    box.minY >= 0 &&
    box.minY < box.maxY &&
    box.maxY <= height
  );
}
async function compare(scale: number, dir: string) {
  const reference = resolve(dir, "web.png"),
    candidate = resolve(nativeDir, `scale-${scale}/native.png`);
  const arguments_ = [
    "--reference",
    reference,
    "--native",
    candidate,
    "--out",
    resolve(dir, "diff.png"),
  ];
  let result: {
    code: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    error: string | null;
  };
  result = await new Promise((done) => {
    const child = spawn(comparator, arguments_, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      error: string | null = null;
    child.stdout.on("data", (bytes: Buffer) => {
      stdout += bytes.toString();
    });
    child.stderr.on("data", (bytes: Buffer) => {
      stderr += bytes.toString();
    });
    child.on("error", (failure) => {
      error = String(failure);
    });
    child.on("close", (code, signal) =>
      done({ code, signal, stdout, stderr, error }),
    );
  });
  await writeFile(resolve(dir, "comparison.stdout.json"), result.stdout);
  await writeFile(resolve(dir, "comparison.stderr.log"), result.stderr);
  await writeFile(
    resolve(dir, "comparison.execution.json"),
    JSON.stringify(
      {
        executable: comparator,
        executableHash: comparatorHash,
        arguments: arguments_,
        ...result,
      },
      null,
      2,
    ) + "\n",
  );
  if (hash(await readFile(comparator)) !== comparatorHash)
    throw new Error("Comparator changed during capture");
  if (
    result.error ||
    result.signal !== null ||
    ![0, 1].includes(result.code ?? -1)
  )
    throw new Error(
      "Strict whole-frame comparator failed: " + JSON.stringify(result),
    );
  const value = JSON.parse(result.stdout) as Record<string, unknown>;
  const tolerance = value.tolerance as
    { channel?: unknown; pixels?: unknown } | undefined;
  if (
    value.totalPixels !== 512 * 320 * scale * scale ||
    value.pixelsOverTolerance !== value.changedPixels ||
    value.width !== 512 * scale ||
    value.height !== 320 * scale ||
    tolerance?.channel !== 0 ||
    tolerance.pixels !== 0 ||
    typeof value.changedPixels !== "number" ||
    !Number.isSafeInteger(value.changedPixels) ||
    value.changedPixels < 0 ||
    value.changedPixels > 512 * 320 * scale * scale ||
    typeof value.maxChannelDelta !== "number" ||
    !Number.isSafeInteger(value.maxChannelDelta) ||
    value.maxChannelDelta < 0 ||
    value.maxChannelDelta > 255 ||
    value.exact !== (value.changedPixels === 0) ||
    value.accepted !== value.exact ||
    result.code !== (value.exact ? 0 : 1) ||
    (value.exact && value.maxChannelDelta !== 0) ||
    (!value.exact && value.maxChannelDelta === 0) ||
    (value.exact
      ? value.bounds !== null
      : !validBounds(value.bounds, 512 * scale, 320 * scale))
  )
    throw new Error(
      "Whole-frame comparator returned an inconsistent strict result",
    );
  if (value.exact === false) {
    const box = value.bounds as {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    };
    if (
      (value.changedPixels as number) >
      (box.maxX - box.minX) * (box.maxY - box.minY)
    )
      throw new Error("Changed-pixel count exceeds its bounds");
  }
  const record = {
    reference: { path: reference, hash: hash(await readFile(reference)) },
    candidate: { path: candidate, hash: hash(await readFile(candidate)) },
    diff: {
      path: resolve(dir, "diff.png"),
      hash: hash(await readFile(resolve(dir, "diff.png"))),
    },
    result: value,
  };
  await writeFile(
    resolve(dir, "comparison.json"),
    JSON.stringify(record, null, 2) + "\n",
  );
  return record;
}
const browser = await chromium.launch({ headless: true });
try {
  const provenance = await collectBrowserProvenance(browser);
  if (
    ![
      "971a7443b0c9b0a9b2860529b33331b76077ec62",
      "@971a7443b0c9b0a9b2860529b33331b76077ec62",
    ].includes(provenance.observation.version.revision) ||
    !isDeepStrictEqual(
      provenance.observation.version,
      referenceProvenance.observation.version,
    ) ||
    provenance.observation.executable.hash !==
      referenceProvenance.observation.executable.hash ||
    provenance.observation.executable.architecture !==
      referenceProvenance.observation.executable.architecture
  )
    throw new Error(
      "Held-out browser differs from the actual pinned original typography executable/version",
    );
  await writeFile(
    resolve(out, "browser-provenance.initial.json"),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  for (const scale of probe.scales) {
    const dir = resolve(out, `scale-${scale}`);
    await mkdir(dir, { recursive: true });
    const scaleErrors: { stage: string; error: string }[] = [];
    const observations: unknown[] = [];
    let captured: Record<string, unknown> | null = null;
    let comparison: Awaited<ReturnType<typeof compare>> | null = null;
    const page = await browser.newPage({
      viewport: probe.viewport,
      deviceScaleFactor: scale,
    });
    const errors: string[] = [],
      fonts: Promise<Buffer>[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url() === new URL(probe.font.webSrc, url).href) {
        if (!response.ok()) errors.push("Font response failed");
        fonts.push(response.body());
      }
    });
    try {
      const response = await page.goto(url);
      if (!response?.ok()) throw new Error("Editor page failed");
      await page.evaluate(async () => {
        await document.fonts.load("400 20px AstroNoto", "Hgx");
        await document.fonts.ready;
      });
      if (
        !fonts.length ||
        (await Promise.all(fonts)).some((bytes) => hash(bytes) !== fontHash)
      )
        throw new Error("Actual served editor font differs");
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      const identity = await page.evaluate(() => ({
        sourceHash: document.documentElement.dataset.editorSourceHash,
        width: innerWidth,
        height: innerHeight,
        scale: devicePixelRatio,
        inputs: document.querySelectorAll("input").length,
        focus: document.activeElement?.tagName,
      }));
      if (
        identity.sourceHash !== sourceHash ||
        identity.width !== 512 ||
        identity.height !== 320 ||
        identity.scale !== scale ||
        identity.inputs !== 6 ||
        identity.focus !== "BODY" ||
        errors.length
      )
        throw new Error(
          "Original held-out editor identity differs: " +
            JSON.stringify({ identity, errors }),
        );
      const screenshot = await page.screenshot({
        path: resolve(dir, "web.png"),
        animations: "disabled",
        caret: "initial",
        scale: "device",
      });
      const session = await page.context().newCDPSession(page);
      await session.send("DOM.enable");
      await session.send("CSS.enable");
      const documentTree = await session.send("DOM.getDocument", {
        depth: -1,
        pierce: true,
      });
      const nodes: any[] = [];
      function visit(node: any, depth = 0) {
        if (depth > 64 || nodes.length > 10000)
          throw new Error("Editor DOM evidence exceeds bounds");
        nodes.push(node);
        for (const child of [
          ...(node.children ?? []),
          ...(node.shadowRoots ?? []),
        ])
          visit(child, depth + 1);
      }
      visit(documentTree.root);
      const nativeBytes = await readFile(
        resolve(nativeDir, `scale-${scale}/native.json`),
      );
      const actualNative = JSON.parse(nativeBytes.toString()) as {
        schema: number;
        sourceHash: string;
        fontHash: string;
        fixtureHash: string;
        probeHash: string;
        providerBuildHash: string;
        testBinaryHash: string;
        testBuildInfoHash: string;
        viewport: { width: number; height: number; scale: number };
        screenshotHash: string;
        lines: Record<
          string,
          {
            text: string;
            position: { X: number; Y: number };
            size: { Width: number; Height: number };
            authoredLineHeightCSS: number;
            lineHeightSource: string;
          }
        >;
      };
      if (
        actualNative.schema !== 1 ||
        actualNative.sourceHash !== sourceHash ||
        actualNative.fontHash !== fontHash ||
        actualNative.fixtureHash !== fixtureHash ||
        actualNative.probeHash !== hash(probeBytes) ||
        actualNative.providerBuildHash !== hash(providerBytes) ||
        actualNative.testBinaryHash !== provider.binary.sha256 ||
        actualNative.testBuildInfoHash !== provider.buildInfo.sha256 ||
        actualNative.viewport.width !== 512 ||
        actualNative.viewport.height !== 320 ||
        actualNative.viewport.scale !== scale ||
        actualNative.screenshotHash !==
          hash(
            await readFile(resolve(nativeDir, `scale-${scale}/native.png`)),
          ) ||
        Object.keys(actualNative.lines).length !== 6
      )
        throw new Error("Native held-out evidence is stale or incomplete");
      for (const sample of probe.samples) {
        const evidence: Record<string, unknown> = { id: sample.id };
        try {
          const authored = await page.evaluate((sample) => {
            const input = document.getElementById(sample.id);
            if (!(input instanceof HTMLInputElement))
              throw new Error("Authored editor input missing");
            const style = getComputedStyle(input),
              rect = input.getBoundingClientRect();
            const canvas = document.createElement("canvas"),
              context = canvas.getContext("2d");
            if (!context) throw new Error("Canvas metrics unavailable");
            context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const metrics = context.measureText(input.value);
            return {
              value: input.value,
              rectangle: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              lineHeight: style.lineHeight,
              canvas: {
                font: context.font,
                metrics: Object.fromEntries(
                  [
                    "width",
                    "fontBoundingBoxAscent",
                    "fontBoundingBoxDescent",
                    "actualBoundingBoxAscent",
                    "actualBoundingBoxDescent",
                  ].map((name) => {
                    const value = (
                      metrics as unknown as Record<string, unknown>
                    )[name];
                    return [
                      name,
                      typeof value === "number" && Number.isFinite(value)
                        ? value
                        : null,
                    ];
                  }),
                ),
              },
            };
          }, sample);
          evidence.authored = authored;
          if (
            authored.value !== sample.text ||
            authored.lineHeight !== `${sample.lineHeight}px` ||
            JSON.stringify(authored.rectangle) !==
              JSON.stringify({
                x: sample.x,
                y: sample.y,
                width: sample.width,
                height: sample.height,
              })
          )
            throw new Error(
              "Authored outer editor style changed: " + sample.id,
            );
          const matches = nodes.filter((node) => {
            const attributes: string[] = node.attributes ?? [];
            return attributes.some(
              (name, index) =>
                index % 2 === 0 &&
                name === "id" &&
                attributes[index + 1] === sample.id,
            );
          });
          const input = matches[0];
          evidence.domInput = input;
          const ua = input?.shadowRoots?.filter(
            (node: any) => node.shadowRootType === "user-agent",
          );
          const editors = ua?.[0]?.children?.filter(
            (node: any) => node.nodeType === 1,
          );
          const editor = editors?.[0];
          if (
            matches.length !== 1 ||
            input?.nodeName !== "INPUT" ||
            ua?.length !== 1 ||
            editors?.length !== 1 ||
            editor?.nodeName !== "DIV" ||
            !Number.isSafeInteger(editor.nodeId) ||
            editor.nodeId <= 0
          )
            throw new Error(
              "Expected direct plain-input UA editor: " + sample.id,
            );
          const computed = await session.send("CSS.getComputedStyleForNode", {
            nodeId: editor.nodeId,
          });
          const style = Object.fromEntries(
            computed.computedStyle.map(
              (item: { name: string; value: string }) => [
                item.name,
                item.value,
              ],
            ),
          );
          const box = (
            await session.send("DOM.getBoxModel", { nodeId: editor.nodeId })
          ).model;
          const fonts = await session.send("CSS.getPlatformFontsForNode", {
            nodeId: editor.nodeId,
          });
          Object.assign(evidence, { style, box, fonts });
          if (
            fonts.fonts.length !== 1 ||
            fonts.fonts[0]?.isCustomFont !== true ||
            !Number.isSafeInteger(fonts.fonts[0]?.glyphCount) ||
            fonts.fonts[0]!.glyphCount < 1
          )
            throw new Error(
              "UA editor did not use the served custom face: " + sample.id,
            );
          const expectedLine =
            sample.lineHeightSource === "normal-font-metrics"
              ? "normal"
              : `${sample.lineHeight}px`;
          if (
            style["line-height"] !== expectedLine ||
            style["font-size"] !== `${sample.fontSize}px` ||
            style["font-weight"] !== "400" ||
            style["font-family"] !== "AstroNoto" ||
            box.content.length !== 8 ||
            !box.content.every(
              (n: unknown) => typeof n === "number" && Number.isFinite(n),
            )
          )
            throw new Error(
              "Observed UA editor style/box differs: " + sample.id,
            );
          const line = actualNative.lines[sample.id];
          evidence.native = line ?? null;
          if (
            !line ||
            line.text !== sample.text ||
            line.authoredLineHeightCSS !== sample.lineHeight ||
            line.lineHeightSource !== sample.lineHeightSource ||
            line.size.Height !== box.height ||
            line.position.X !== box.content[0] ||
            line.position.Y !== box.content[1]
          )
            throw new Error(
              "Native internal line box differs from original UA editor: " +
                sample.id,
            );
          const quads = [];
          for (const child of editor.children ?? [])
            if (child.nodeType === 3 && child.nodeValue)
              quads.push({
                text: child.nodeValue,
                ...(await session.send("DOM.getContentQuads", {
                  nodeId: child.nodeId,
                })),
              });
          evidence.textQuads = quads;
          if (!quads.length)
            throw new Error("UA editor text quads missing: " + sample.id);
          observations.push({
            ...evidence,
            accepted: true,
            baseline: null,
            baselineReason:
              "UA editor baseline is not exposed by these CDP methods",
          });
        } catch (error) {
          observations.push({
            ...evidence,
            accepted: false,
            error: String(error),
          });
          scaleErrors.push({
            stage: "geometry:" + sample.id,
            error: String(error),
          });
        }
      }
      await session.detach();
      captured = {
        sourceHash,
        fontHash,
        fixtureHash,
        probeHash: hash(probeBytes),
        nativeReportHash: hash(nativeBytes),
        screenshotHash: hash(screenshot),
        viewport: identity,
      };
    } catch (error) {
      scaleErrors.push({ stage: "capture", error: String(error) });
    } finally {
      try {
        await page.close();
      } catch (error) {
        scaleErrors.push({ stage: "page-close", error: String(error) });
      }
    }
    // Geometry or capture failures must not suppress the independent PNG attempt.
    try {
      comparison = await compare(scale, dir);
      if (comparison.result.exact !== true)
        scaleErrors.push({
          stage: "pixels",
          error: "Whole-frame pixels differ with zero tolerance",
        });
    } catch (error) {
      scaleErrors.push({ stage: "comparator", error: String(error) });
    }
    for (const sample of probe.samples)
      if (
        !observations.some((item) => (item as { id: string }).id === sample.id)
      )
        observations.push({
          id: sample.id,
          accepted: false,
          error: "Capture failed before this case could be observed",
        });
    const frame = {
      schema: 1,
      diagnosticOnly: true,
      pixelPerfectVerified: false,
      scale,
      captured,
      observations,
      comparison,
      errors: scaleErrors,
      accepted: scaleErrors.length === 0,
    };
    await writeFile(
      resolve(dir, "web.json"),
      JSON.stringify(frame, null, 2) + "\n",
    );
    frames.push(frame);
    failures.push(...scaleErrors.map((failure) => ({ scale, ...failure })));
  }
  const finalProvenance = await verifyBrowserProvenance(browser, provenance);
  await writeFile(
    resolve(out, "browser-provenance.json"),
    JSON.stringify(
      {
        schema: 1,
        diagnosticOnly: true,
        pixelPerfectVerified: false,
        sourceHash,
        captureHash: sources["capture/input-editor-metrics.ts"],
        reference: {
          path: referenceProvenancePath,
          hash: hash(referenceProvenanceBytes),
          browserHash: hash(referenceBrowserBytes),
        },
        observation: provenance.observation,
        provenanceHash: provenance.hash,
        finalProvenanceHash: finalProvenance.hash,
      },
      null,
      2,
    ) + "\n",
  );
  if (
    hash(await readFile(referenceProvenancePath)) !==
      hash(referenceProvenanceBytes) ||
    hash(
      await readFile(
        resolve(dirname(referenceProvenancePath), "browser-text.json"),
      ),
    ) !== hash(referenceBrowserBytes)
  )
    throw new Error(
      "Original browser provenance changed during held-out capture",
    );
  try {
    await browser.close();
  } catch (error) {
    failures.push({ scale: 0, stage: "browser-close", error: String(error) });
  }
  for (const [path, expected] of Object.entries(sources))
    if (hash(await readFile(resolve(root, path))) !== expected)
      throw new Error("Source changed during editor capture: " + path);
  await writeFile(
    resolve(out, "summary.json"),
    JSON.stringify(
      {
        schema: 1,
        diagnosticOnly: true,
        pixelPerfectVerified: false,
        sourceHash,
        fontHash,
        sources,
        comparatorHash,
        browserProvenanceHash: provenance.hash,
        finalBrowserProvenanceHash: finalProvenance.hash,
        originalBrowserProvenanceHash: hash(referenceProvenanceBytes),
        browserVersion: browser.version(),
        expectedCases: 12,
        expectedWholeFrames: 2,
        accepted: failures.length === 0,
        failures,
        frames,
        limitations: [
          "No UA alphabetic baseline, focused caret or glyph mask observation",
          "Any exact result applies only to these two unfocused whole frames",
          "Original seven-row and 22-state profiles remain separate",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  if (failures.length)
    throw new Error(
      `Held-out editor evidence failed in ${failures.length} checks; see retained summary.json`,
    );
} catch (error) {
  await writeFile(
    resolve(out, "failure.json"),
    JSON.stringify(
      {
        diagnosticOnly: true,
        pixelPerfectVerified: false,
        sourceHash,
        error: String(error),
        frames,
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  try {
    await browser.close();
  } catch (error) {
    await writeFile(
      resolve(out, "browser-close-failure.json"),
      JSON.stringify({ error: String(error) }) + "\n",
    );
  }
}
