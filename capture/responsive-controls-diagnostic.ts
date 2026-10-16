// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Hosted Linux observation only. None of this data is a native layout input.
import { chromium, type CDPSession, type Page } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectBrowserProvenance,
  verifyBrowserProvenance,
} from "./browser-provenance.ts";
import {
  decodeLayoutSnapshot,
  readBoxModel,
  readComputedStyle,
  readContentQuads,
  readUAInput,
} from "./controls-diagnostic-contract.ts";

const revision = "971a7443b0c9b0a9b2860529b33331b76077ec62";
const styles = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "font-kerning",
  "font-feature-settings",
  "font-variant-ligatures",
  "text-rendering",
  "white-space",
  "color",
  "background-color",
  "opacity",
  "display",
  "position",
  "transform",
  "filter",
  "backdrop-filter",
  "mix-blend-mode",
  "isolation",
  "contain",
  "will-change",
  "overflow-x",
  "overflow-y",
  "vertical-align",
  "box-sizing",
  "padding-top",
  "padding-bottom",
  "border-top-width",
  "border-bottom-width",
  "align-content",
  "align-items",
  "justify-content",
  "outline-width",
  "outline-style",
  "outline-color",
  "outline-offset",
  "caret-color",
] as const;
const states = ["initial", "click-input", "click-commit"] as const;
const screenshotOptions = {
  animations: "disabled",
  caret: "initial",
  scale: "device",
} as const;
const repository = fileURLToPath(new URL("../", import.meta.url));
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const flags = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index],
    value = process.argv[index + 1];
  if (
    !key ||
    !["--url", "--out", "--report", "--reference", "--comparator"].includes(
      key,
    ) ||
    !value ||
    value.startsWith("--") ||
    flags.has(key)
  )
    throw new Error(
      "Usage: responsive-controls-diagnostic.ts --url URL --out DIR --report REPORT --reference ORIGINAL_CONTROLS_DIR --comparator COMPARATOR",
    );
  flags.set(key, value);
}
const url = flags.get("--url"),
  output = flags.get("--out"),
  reportPath = flags.get("--report"),
  referencePath = flags.get("--reference"),
  comparatorPath = flags.get("--comparator");
if (
  !url ||
  !output ||
  !reportPath ||
  !referencePath ||
  !comparatorPath ||
  !["http:", "https:"].includes(new URL(url).protocol)
)
  throw new Error("All five diagnostic arguments are required");
const out = resolve(output),
  reference = resolve(referencePath),
  comparator = resolve(comparatorPath);
if (
  out === reference ||
  out.startsWith(`${reference}/`) ||
  reference.startsWith(`${out}/`)
)
  throw new Error(
    "Supplemental observations must be outside the original controls capture directory",
  );
await mkdir(out, { recursive: true });
async function save(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
  return sha(await readFile(path));
}
const reportBytes = await readFile(resolve(reportPath));
const report = JSON.parse(reportBytes.toString()) as {
  sourceHash: string;
  fonts: {
    family: string;
    weight: number;
    style: string;
    hash: string;
    webSrc: string;
  }[];
};
const font = report.fonts?.[0];
if (
  !/^[a-f0-9]{64}$/.test(report.sourceHash) ||
  report.fonts?.length !== 1 ||
  font?.family !== "AstroNoto" ||
  font.weight !== 400 ||
  font.style !== "normal" ||
  font.webSrc !== "/fonts/NotoSans-Regular.ttf" ||
  !/^[a-f0-9]{64}$/.test(font.hash)
)
  throw new Error(
    "Diagnostic requires the unchanged explicit controls font/report contract",
  );
const sources = Object.fromEntries(
  await Promise.all(
    [
      "capture/responsive-controls-diagnostic.ts",
      "capture/controls-diagnostic-contract.ts",
      "capture/controls-diagnostic-source-pin.json",
      "capture/browser-provenance.ts",
      "src/controls-diagnostic-contract.test.ts",
      ".github/workflows/native-fontations-text.yml",
      "ci/text-engine-probe/README.md",
      "capture/responsive-controls.ts",
      "example/src/pages/responsive-controls.astro",
      "example/src/components/ResponsiveControlsConformance.tsx",
      "responsive-controls.json",
      "responsive-controls-scenario.json",
      "package.json",
      "bun.lock",
      "example/public/fonts/NotoSans-Regular.ttf",
      "example/public/fonts/LICENSE-NotoSans.txt",
    ].map(async (path) => [
      path,
      sha(await readFile(resolve(repository, path))),
    ]),
  ),
);
if (sources["example/public/fonts/NotoSans-Regular.ttf"] !== font.hash)
  throw new Error("Current source font differs from the generated report");
const originals = [];
for (const name of ["00-initial", "01-click-input"]) {
  const png = resolve(reference, name, "web.png"),
    geometryPath = resolve(reference, name, "geometry.json");
  const geometry = JSON.parse(await readFile(geometryPath, "utf8")) as {
    sourceHash?: unknown;
    screenshotHash?: unknown;
    case?: unknown;
    viewport?: { width?: unknown; height?: unknown; scale?: unknown };
  };
  const hash = sha(await readFile(png));
  if (
    geometry.sourceHash !== report.sourceHash ||
    geometry.screenshotHash !== hash ||
    geometry.case !== name ||
    geometry.viewport?.width !== 224 ||
    geometry.viewport.height !== 320 ||
    geometry.viewport.scale !== 1
  )
    throw new Error(`Original reference identity differs: ${name}`);
  originals.push({
    case: name,
    screenshot: png,
    hash,
    geometryPath,
    geometryHash: sha(await readFile(geometryPath)),
  });
}
const pins = JSON.parse(
  await readFile(
    new URL("./controls-diagnostic-source-pin.json", import.meta.url),
    "utf8",
  ),
) as {
  revision: string;
  files: {
    path: string;
    bytes: number;
    sha256: string;
    gitBlob: string;
    url: string;
  }[];
};
if (
  pins.revision !== revision ||
  !Array.isArray(pins.files) ||
  pins.files.length === 0
)
  throw new Error("Missing exact protocol/source pins");
for (const pin of pins.files) {
  if (
    !/^[a-f0-9]{64}$/.test(pin.sha256) ||
    !/^[a-f0-9]{40}$/.test(pin.gitBlob) ||
    !Number.isSafeInteger(pin.bytes) ||
    pin.bytes <= 0 ||
    pin.path.startsWith("/") ||
    pin.path.split("/").includes("..") ||
    pin.url !==
      `https://raw.githubusercontent.com/chromium/chromium/${revision}/${pin.path}`
  )
    throw new Error("Invalid pinned source entry");
  const response = await fetch(pin.url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok)
    throw new Error(`Pinned source returned ${response.status}: ${pin.path}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const gitBlob = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  if (
    bytes.length !== pin.bytes ||
    sha(bytes) !== pin.sha256 ||
    gitBlob !== pin.gitBlob
  )
    throw new Error(`Pinned source bytes differ: ${pin.path}`);
  const path = resolve(out, "upstream-source", pin.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
await save(resolve(out, "source-manifest.json"), {
  schema: 1,
  diagnosticOnly: true,
  pixelPerfectVerified: false,
  sourceHash: report.sourceHash,
  reportHash: sha(reportBytes),
  sources,
  originals,
  upstream: pins,
});

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
}
async function authoredState(page: Page) {
  return page.evaluate(
    ({ sourceHash, names }) => {
      if (
        document.documentElement.dataset.responsiveControlsSourceHash !==
          sourceHash ||
        innerWidth !== 224 ||
        innerHeight !== 320 ||
        ![1, 2].includes(devicePixelRatio)
      )
        throw new Error("Original fixture identity or viewport differs");
      const nodes = [
        ...document.querySelectorAll<HTMLElement>(
          "#responsive-controls, #responsive-controls *",
        ),
      ].map((element) => {
        const css = getComputedStyle(element),
          rect = element.getBoundingClientRect();
        const computed = Object.fromEntries(
          names.map((name) => [name, css.getPropertyValue(name)]),
        );
        const ranges: {
          text: string;
          rects: { x: number; y: number; width: number; height: number }[];
        }[] = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode,
            range = document.createRange();
          range.selectNodeContents(text);
          ranges.push({
            text: text.nodeValue ?? "",
            rects: [...range.getClientRects()].map(
              ({ x, y, width, height }) => ({ x, y, width, height }),
            ),
          });
        }
        return {
          id: element.id,
          text:
            element instanceof HTMLInputElement
              ? element.value
              : element.textContent,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          computed,
          ranges,
        };
      });
      const input = document.getElementById(
        "controls-input",
      ) as HTMLInputElement;
      const canvas = document.createElement("canvas"),
        context = canvas.getContext("2d");
      if (!context || input.value !== "A" || input.disabled)
        throw new Error("Unexpected baseline input state");
      const css = getComputedStyle(input);
      context.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      context.textBaseline = "alphabetic";
      const metrics = context.measureText(input.value);
      const measurements = Object.fromEntries(
        [
          "width",
          "actualBoundingBoxLeft",
          "actualBoundingBoxRight",
          "actualBoundingBoxAscent",
          "actualBoundingBoxDescent",
          "fontBoundingBoxAscent",
          "fontBoundingBoxDescent",
          "emHeightAscent",
          "emHeightDescent",
          "alphabeticBaseline",
        ].map((key) => {
          const value = (metrics as unknown as Record<string, unknown>)[key];
          return [
            key,
            typeof value === "number" && Number.isFinite(value) ? value : null,
          ];
        }),
      );
      return {
        viewport: {
          width: innerWidth,
          height: innerHeight,
          scale: devicePixelRatio,
        },
        activeElement:
          document.activeElement?.id || document.activeElement?.tagName,
        nodes,
        input: {
          value: input.value,
          selectionStart: input.selectionStart,
          selectionEnd: input.selectionEnd,
        },
        canvas: {
          font: context.font,
          textBaseline: context.textBaseline,
          metrics: measurements,
          normalLineHeight: null,
          reason:
            "Canvas metrics do not expose the UA editor baseline or its used normal line height",
        },
      };
    },
    { sourceHash: report.sourceHash, names: [...styles] },
  );
}
async function observe(session: CDPSession, dir: string) {
  const tree = await session.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  await save(resolve(dir, "dom-tree.json"), tree);
  const selected = readUAInput(tree.root);
  const editor = await session.send("CSS.getComputedStyleForNode", {
    nodeId: selected.editor.nodeId,
  });
  const input = await session.send("CSS.getComputedStyleForNode", {
    nodeId: selected.input.nodeId,
  });
  const fonts = await session.send("CSS.getPlatformFontsForNode", {
    nodeId: selected.editor.nodeId,
  });
  if (
    fonts.fonts.length !== 1 ||
    fonts.fonts[0]?.isCustomFont !== true ||
    !Number.isSafeInteger(fonts.fonts[0]?.glyphCount) ||
    fonts.fonts[0]!.glyphCount < 1
  )
    throw new Error("UA editor did not report one actually used custom font");
  const ua = {
    selection:
      "single direct DIV in the plain text input user-agent shadow root",
    input: {
      node: selected.input,
      style: readComputedStyle(input.computedStyle),
      extraFields: input.extraFields ?? null,
      box: readBoxModel(
        (
          await session.send("DOM.getBoxModel", {
            nodeId: selected.input.nodeId,
          })
        ).model,
      ),
    },
    editor: {
      node: selected.editor,
      style: readComputedStyle(editor.computedStyle),
      extraFields: editor.extraFields ?? null,
      box: readBoxModel(
        (
          await session.send("DOM.getBoxModel", {
            nodeId: selected.editor.nodeId,
          })
        ).model,
      ),
      fonts,
    },
    textQuads: await Promise.all(
      selected.editorNodes
        .filter((node) => node.nodeType === 3 && node.nodeValue.length > 0)
        .map(async (node) => ({
          node,
          quads: readContentQuads(
            (await session.send("DOM.getContentQuads", { nodeId: node.nodeId }))
              .quads,
          ),
        })),
    ),
    baseline: null,
    baselineReason:
      "These public CDP methods expose boxes and font usage, not the internal alphabetic baseline; no baseline is inferred from ink",
  };
  await save(resolve(dir, "ua-editor.json"), ua);
  const raw = await session.send("DOMSnapshot.captureSnapshot", {
    computedStyles: [...styles],
    includePaintOrder: true,
    includeDOMRects: true,
    includeBlendedBackgroundColors: true,
    includeTextColorOpacities: true,
  });
  await save(resolve(dir, "layout.raw.json"), raw);
  const layout = decodeLayoutSnapshot(raw, styles);
  if (
    !layout.some((node) => node.attributes.id === "controls-input") ||
    layout.some((node) => node.backendNodeId === selected.editor.backendNodeId)
  )
    throw new Error(
      "DOMSnapshot did not follow its pinned author-tree/UA exclusion contract",
    );
  await save(resolve(dir, "layout.json"), {
    records: layout,
    userAgentTreeIncluded: false,
    reason:
      "Pinned InspectorDOMSnapshotAgent intentionally skips user-agent shadow trees",
  });
  return {
    uaHash: sha(await readFile(resolve(dir, "ua-editor.json"))),
    layoutHash: sha(await readFile(resolve(dir, "layout.raw.json"))),
  };
}
async function compare(
  reference: string,
  candidate: string,
  diff: string,
  scale: number,
) {
  const arguments_ = [
    "--reference",
    reference,
    "--native",
    candidate,
    "--out",
    diff,
  ];
  const result = await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((done, reject) => {
    const child = spawn(comparator, arguments_, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (bytes: Buffer) => {
      stdout += bytes.toString();
    });
    child.stderr.on("data", (bytes: Buffer) => {
      stderr += bytes.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
  await save(`${diff}.execution.json`, {
    executable: comparator,
    executableHash: sha(await readFile(comparator)),
    arguments: arguments_,
    ...result,
  });
  if (![0, 1].includes(result.code ?? -1))
    throw new Error(`Diagnostic comparison failed: ${result.stderr}`);
  const comparison = JSON.parse(result.stdout) as Record<string, unknown>;
  const tolerance = comparison.tolerance as
    { channel?: unknown; pixels?: unknown } | undefined;
  if (
    comparison.width !== 224 * scale ||
    comparison.height !== 320 * scale ||
    tolerance?.channel !== 0 ||
    tolerance.pixels !== 0 ||
    typeof comparison.changedPixels !== "number" ||
    !Number.isSafeInteger(comparison.changedPixels) ||
    comparison.changedPixels < 0 ||
    comparison.changedPixels > 224 * 320 * scale * scale ||
    comparison.exact !== (comparison.changedPixels === 0) ||
    comparison.accepted !== comparison.exact ||
    result.code !== (comparison.exact ? 0 : 1)
  )
    throw new Error(
      "Diagnostic comparator returned an inconsistent strict result",
    );
  return {
    reference: { path: reference, hash: sha(await readFile(reference)) },
    candidate: { path: candidate, hash: sha(await readFile(candidate)) },
    result: comparison,
  };
}

const browser = await chromium.launch({ headless: true });
const captures: {
  mode: string;
  scale: number;
  state: string;
  screenshot: string;
  screenshotHash: string;
  authoredStateHash: string;
  observation: unknown;
}[] = [];
try {
  const provenance = await collectBrowserProvenance(browser);
  if (
    provenance.observation.version.revision !== `@${revision}` &&
    provenance.observation.version.revision !== revision
  )
    throw new Error(
      "Diagnostic browser revision differs from its exact source/protocol pins",
    );
  await save(resolve(out, "browser-provenance.json"), provenance);
  for (const scale of [1, 2])
    for (const mode of ["uninstrumented", "observed"]) {
      const page = await browser.newPage({
        viewport: { width: 224, height: 320 },
        deviceScaleFactor: scale,
      });
      let session: CDPSession | undefined;
      const treeEvents: unknown[] = [],
        paintEvents: unknown[] = [],
        errors: string[] = [],
        fonts: Promise<Buffer>[] = [];
      let latestLayers: { layerId: string }[] | null = null;
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        if (response.url() === new URL(font.webSrc, url).href) {
          if (!response.ok())
            errors.push(`Font response returned ${response.status()}`);
          fonts.push(response.body());
        }
      });
      try {
        if (mode === "observed") {
          session = await page.context().newCDPSession(page);
          session.on("LayerTree.layerTreeDidChange", (event) => {
            treeEvents.push(event);
            latestLayers = event.layers ?? null;
          });
          session.on("LayerTree.layerPainted", (event) => {
            paintEvents.push(event);
          });
          await session.send("DOM.enable");
          await session.send("CSS.enable");
          await session.send("LayerTree.enable");
        }
        const response = await page.goto(url);
        if (!response?.ok())
          throw new Error(`Controls fixture returned ${response?.status()}`);
        await page.waitForFunction(
          () =>
            document.getElementById("responsive-controls") !== null &&
            document.querySelectorAll("astro-island[ssr]").length === 0,
        );
        await page.evaluate(async () => {
          const loaded = await document.fonts.load(
            "400 14px AstroNoto",
            "Responsive controls ABCDEF0123456789",
          );
          await document.fonts.ready;
          if (
            loaded.length !== 1 ||
            loaded[0]!.status !== "loaded" ||
            !document.fonts.check(
              "400 14px AstroNoto",
              "Responsive controls ABCDEF0123456789",
            )
          )
            throw new Error("Original controls font did not load");
        });
        if (
          !fonts.length ||
          (await Promise.all(fonts)).some((bytes) => sha(bytes) !== font.hash)
        )
          throw new Error(
            "Actual browser font response differs from the generated report",
          );
        await mkdir(resolve(out, `scale-${scale}`, mode), { recursive: true });
        await writeFile(
          resolve(out, `scale-${scale}`, mode, "served-font.ttf"),
          (await Promise.all(fonts))[0]!,
        );
        for (const [index, state] of states.entries()) {
          if (state === "click-input")
            await page.locator("#controls-input").click();
          if (state === "click-commit")
            await page.locator("#controls-commit").click();
          await settle(page);
          if (errors.length) throw new Error(errors.join("\n"));
          const dir = resolve(out, `scale-${scale}`, mode, `${index}-${state}`);
          const authored = await authoredState(page);
          const expectedFocus =
            state === "initial"
              ? "BODY"
              : state === "click-input"
                ? "controls-input"
                : "controls-commit";
          if (authored.activeElement !== expectedFocus)
            throw new Error(`Actual pointer focus differs at ${mode}/${state}`);
          const authoredStateHash = await save(
            resolve(dir, "authored-state.json"),
            authored,
          );
          // Capture before the per-state CDP reads; subsequent reads are retained separately.
          const screenshot = resolve(dir, "web.png");
          const bytes = await page.screenshot({
            path: screenshot,
            ...screenshotOptions,
          });
          let observation: unknown = null;
          if (session) {
            observation = await observe(session, dir);
            const layers = latestLayers as { layerId: string }[] | null;
            const reasons = [];
            for (const layer of layers ?? [])
              reasons.push({
                layerId: layer.layerId,
                ...(await session.send("LayerTree.compositingReasons", {
                  layerId: layer.layerId,
                })),
              });
            const layersHash = await save(resolve(dir, "layers.json"), {
              treeAvailability: layers === null ? "not-reported" : "reported",
              latestLayers: layers,
              reasons,
              treeEvents: treeEvents.splice(0),
              paintEvents: paintEvents.splice(0),
              interpretation:
                "Observed layer/paint metadata does not expose an actual glyph mask or effective AA/font policy",
            });
            observation = {
              ...(observation as Record<string, unknown>),
              layersHash,
            };
            const after = await page.screenshot({
              path: resolve(dir, "after-observation.png"),
              ...screenshotOptions,
            });
            await save(resolve(dir, "after-observation.json"), {
              screenshotHash: sha(after),
              authoredStateHash: await save(
                resolve(dir, "after-authored-state.json"),
                await authoredState(page),
              ),
            });
          }
          captures.push({
            mode,
            scale,
            state,
            screenshot,
            screenshotHash: sha(bytes),
            authoredStateHash,
            observation,
          });
          await save(resolve(out, "capture-progress.json"), { captures });
        }
      } finally {
        await session?.detach();
        await page.close();
      }
    }
  const comparisons = [];
  for (const scale of [1, 2])
    for (const [index, state] of states.entries()) {
      const a = resolve(
          out,
          `scale-${scale}/uninstrumented/${index}-${state}/web.png`,
        ),
        b = resolve(out, `scale-${scale}/observed/${index}-${state}/web.png`);
      comparisons.push({
        kind: "instrumentation-pass",
        scale,
        state,
        ...(await compare(
          a,
          b,
          resolve(
            out,
            `scale-${scale}/observed/${index}-${state}/uninstrumented.diff.png`,
          ),
          scale,
        )),
      });
      comparisons.push({
        kind: "per-state-observation",
        scale,
        state,
        ...(await compare(
          b,
          resolve(
            out,
            `scale-${scale}/observed/${index}-${state}/after-observation.png`,
          ),
          resolve(
            out,
            `scale-${scale}/observed/${index}-${state}/after-observation.diff.png`,
          ),
          scale,
        )),
      });
      if (scale === 1 && index < 2) {
        const original = resolve(
          reference,
          index === 0 ? "00-initial/web.png" : "01-click-input/web.png",
        );
        comparisons.push({
          kind: "original-reference",
          scale,
          state,
          ...(await compare(
            original,
            a,
            resolve(
              out,
              `scale-${scale}/uninstrumented/${index}-${state}/original.diff.png`,
            ),
            scale,
          )),
        });
      }
    }
  const final = await verifyBrowserProvenance(browser, provenance);
  for (const [path, hash] of Object.entries(sources))
    if (sha(await readFile(resolve(repository, path))) !== hash)
      throw new Error(`Source changed during diagnostic: ${path}`);
  for (const original of originals)
    if (
      sha(await readFile(original.screenshot)) !== original.hash ||
      sha(await readFile(original.geometryPath)) !== original.geometryHash
    )
      throw new Error(
        `Original reference changed during diagnostic: ${original.case}`,
      );
  await save(resolve(out, "diagnostic.json"), {
    schema: 1,
    diagnosticOnly: true,
    pixelPerfectVerified: false,
    nativeInput: false,
    sourceHash: report.sourceHash,
    sourceManifestHash: sha(
      await readFile(resolve(out, "source-manifest.json")),
    ),
    browserProvenanceHash: provenance.hash,
    finalBrowserProvenanceHash: final.hash,
    fontHash: font.hash,
    screenshotOptions,
    states,
    captures,
    comparisons,
    limitations: [
      "The original 22-frame collector, source and strict gate are separate and unchanged",
      "Separate passes and caret timing can differ; all differences are retained without masking or AA inference",
      "DOMSnapshot excludes UA editor nodes; direct DOM/CSS methods supply those observations",
      "No public baseline/mask/scaler-policy observation is asserted",
      "Nothing in this diagnostic feeds native layout or painting",
    ],
  });
} catch (error) {
  await save(resolve(out, "failure.json"), {
    diagnosticOnly: true,
    pixelPerfectVerified: false,
    error: error instanceof Error ? error.stack : String(error),
    captures,
  });
  throw error;
} finally {
  await browser.close();
}
