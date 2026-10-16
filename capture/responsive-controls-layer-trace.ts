// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Supplemental hosted observation. No trace value is a native rendering input.
import { chromium, type Browser, type Page } from "playwright";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  collectBrowserProvenance,
  verifyBrowserProvenance,
} from "./browser-provenance.ts";
import {
  decodeLayerTrace,
  pointerStates,
  readStrictComparison,
  traceCategories,
  traceLimits,
  type TraceState,
} from "./controls-layer-trace-contract.ts";

const repository = fileURLToPath(new URL("../", import.meta.url));
const revision = "971a7443b0c9b0a9b2860529b33331b76077ec62";
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const flags = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i],
    value = process.argv[i + 1];
  if (
    !key ||
    !["--url", "--out", "--report", "--diagnostic", "--comparator"].includes(
      key,
    ) ||
    !value ||
    value.startsWith("--") ||
    flags.has(key)
  )
    throw new Error(
      "Usage: responsive-controls-layer-trace.ts --url URL --out DIR --report REPORT --diagnostic EXISTING_DIAGNOSTIC_DIR --comparator COMPARATOR",
    );
  flags.set(key, value);
}
if (flags.size !== 5) throw new Error("All five trace arguments are required");
const url = flags.get("--url")!,
  out = resolve(flags.get("--out")!),
  diagnostic = resolve(flags.get("--diagnostic")!),
  comparator = resolve(flags.get("--comparator")!);
if (
  !["http:", "https:"].includes(new URL(url).protocol) ||
  out === diagnostic ||
  out.startsWith(diagnostic + "/") ||
  diagnostic.startsWith(out + "/")
)
  throw new Error(
    "Trace URL/output must be separate from existing diagnostic captures",
  );
await mkdir(out, { recursive: true });
async function save(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const bytes = JSON.stringify(value, null, 2) + "\n";
  await writeFile(path, bytes);
  return sha(bytes);
}
const failures: { stage: string; error: string }[] = [];
const fail = (stage: string, error: unknown) =>
  failures.push({
    stage,
    error:
      error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
const reportPath = resolve(flags.get("--report")!),
  reportBytes = await readFile(reportPath),
  report = JSON.parse(reportBytes.toString());
const font = report.fonts?.[0];
if (
  !/^[a-f0-9]{64}$/.test(report.sourceHash) ||
  report.name !== "ResponsiveControls" ||
  report.visual?.measured !== false ||
  report.fonts?.length !== 1 ||
  font?.family !== "AstroNoto" ||
  font.weight !== 400 ||
  font.style !== "normal" ||
  font.webSrc !== "/fonts/NotoSans-Regular.ttf" ||
  !/^[a-f0-9]{64}$/.test(font.hash)
)
  throw new Error(
    "Trace requires the unchanged source-only controls report/font",
  );
const sourceNames = [
  "capture/responsive-controls-layer-trace.ts",
  "capture/controls-layer-trace-contract.ts",
  "capture/controls-layer-trace-source-pin.json",
  "src/controls-layer-trace-contract.test.ts",
  "capture/responsive-controls-diagnostic.ts",
  "capture/controls-diagnostic-contract.ts",
  "capture/controls-diagnostic-source-pin.json",
  "src/controls-diagnostic-contract.test.ts",
  "capture/browser-provenance.ts",
  "capture/responsive-controls.ts",
  "example/src/pages/responsive-controls.astro",
  "example/src/components/ResponsiveControlsConformance.tsx",
  "responsive-controls.json",
  "responsive-controls-scenario.json",
  ".github/workflows/native-fontations-text.yml",
  "ci/text-engine-probe/README.md",
  "package.json",
  "bun.lock",
  "example/public/fonts/NotoSans-Regular.ttf",
  "example/public/fonts/LICENSE-NotoSans.txt",
];
const sources = Object.fromEntries(
  await Promise.all(
    sourceNames.map(async (path) => [
      path,
      sha(await readFile(resolve(repository, path))),
    ]),
  ),
);
if (sources["example/public/fonts/NotoSans-Regular.ttf"] !== font.hash)
  throw new Error("Trace source font differs from report");
const scenario = JSON.parse(
  await readFile(
    resolve(repository, "responsive-controls-scenario.json"),
    "utf8",
  ),
);
if (
  !Array.isArray(scenario.ids) ||
  scenario.ids.length !== 10 ||
  new Set(scenario.ids).size !== 10 ||
  scenario.ids.some((id: unknown) => typeof id !== "string")
)
  throw new Error("Original controls IDs differ");
const expectedIDs = [
  "responsive-controls",
  "controls-editor-row",
  "controls-toggle-row",
  ...scenario.ids,
].sort();
const baselineHashes: Record<string, string> = {};
for (const scale of [1, 2])
  for (const mode of ["uninstrumented", "observed"])
    for (const [i, state] of pointerStates.entries()) {
      const path = resolve(
        diagnostic,
        `scale-${scale}/${mode}/${i}-${state}/web.png`,
      );
      try {
        baselineHashes[path] = sha(await readFile(path));
      } catch (error) {
        fail("existing-reference", error);
      }
    }
let previousBrowserHash: string | null = null;
try {
  const previous = JSON.parse(
    await readFile(resolve(diagnostic, "source-manifest.json"), "utf8"),
  );
  if (
    previous.sourceHash !== report.sourceHash ||
    previous.reportHash !== sha(reportBytes)
  )
    throw new Error("Existing diagnostic source/report differs");
  for (const [path, hash] of Object.entries(previous.sources ?? {}))
    if (sources[path] !== hash)
      throw new Error(`Existing diagnostic source changed: ${path}`);
  const provenance = JSON.parse(
    await readFile(resolve(diagnostic, "browser-provenance.json"), "utf8"),
  );
  const previousHash = provenance.observation?.executable?.hash;
  if (typeof previousHash !== "string" || !/^[a-f0-9]{64}$/.test(previousHash))
    throw new Error("Existing diagnostic browser binary binding is absent");
  previousBrowserHash = previousHash;
} catch (error) {
  fail("existing-diagnostic-binding", error);
}

const pins = JSON.parse(
  await readFile(
    new URL("./controls-layer-trace-source-pin.json", import.meta.url),
    "utf8",
  ),
);
const seenPins = new Set<string>();
for (const pin of pins.files ?? []) {
  try {
    const allowedRevision =
      pin.repository === "chromium/chromium"
        ? revision
        : pin.repository === "google/perfetto"
          ? "da65f7e907e0caf473ddec16e15427465f503d05"
          : null;
    if (
      pin.revision !== allowedRevision ||
      !allowedRevision ||
      !/^[a-f0-9]{64}$/.test(pin.sha256) ||
      !/^[a-f0-9]{40}$/.test(pin.gitBlob) ||
      !Number.isSafeInteger(pin.bytes) ||
      pin.bytes < 1 ||
      pin.path.startsWith("/") ||
      pin.path
        .split("/")
        .some((part: string) => part === ".." || part === "") ||
      pin.output !==
        `${pin.repository === "chromium/chromium" ? "chromium" : "perfetto"}/${pin.path}` ||
      seenPins.has(pin.output) ||
      pin.url !==
        `https://raw.githubusercontent.com/${pin.repository}/${pin.revision}/${pin.path}`
    )
      throw new Error("Invalid trace source/notice pin");
    seenPins.add(pin.output);
    const response = await fetch(pin.url, {
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`Trace source ${pin.path} returned ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const blob = createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    if (
      bytes.length !== pin.bytes ||
      sha(bytes) !== pin.sha256 ||
      blob !== pin.gitBlob
    )
      throw new Error(`Trace source bytes differ: ${pin.path}`);
    const destination = resolve(out, "upstream-source", pin.output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  } catch (error) {
    fail("upstream-source", error);
  }
}
if (
  pins.chromiumRevision !== revision ||
  pins.files?.length !== 25 ||
  seenPins.size !== 25
)
  fail(
    "upstream-source",
    "Expected all 25 pinned protocol/source/notice inputs",
  );
await save(resolve(out, "source-manifest.json"), {
  schema: 1,
  diagnosticOnly: true,
  pixelPerfectVerified: false,
  sourceHash: report.sourceHash,
  reportHash: sha(reportBytes),
  sources,
  baselineHashes,
  upstream: pins,
});
await writeFile(resolve(out, "generated-report.json"), reportBytes);

const screenshotOptions = {
  animations: "disabled",
  caret: "initial",
  scale: "device",
} as const;
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
}
async function authoredState(page: Page, scale: number) {
  const value = await page.evaluate((sourceHash) => {
    const input = document.getElementById("controls-input") as HTMLInputElement;
    return {
      sourceHash: document.documentElement.dataset.responsiveControlsSourceHash,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scale: devicePixelRatio,
      },
      activeElement:
        document.activeElement?.id || document.activeElement?.tagName,
      input: {
        value: input?.value,
        disabled: input?.disabled,
        selectionStart: input?.selectionStart,
        selectionEnd: input?.selectionEnd,
      },
      nodes: [
        ...document.querySelectorAll<HTMLElement>(
          "#responsive-controls, #responsive-controls *",
        ),
      ].map((element) => {
        const r = element.getBoundingClientRect(),
          css = getComputedStyle(element);
        return {
          id: element.id,
          text:
            element instanceof HTMLInputElement
              ? element.value
              : element.textContent,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          style: Object.fromEntries(
            [
              "font-family",
              "font-size",
              "font-weight",
              "font-style",
              "line-height",
              "color",
              "background-color",
              "opacity",
              "transform",
              "filter",
              "backdrop-filter",
              "mix-blend-mode",
              "isolation",
              "contain",
              "will-change",
            ].map((name) => [name, css.getPropertyValue(name)]),
          ),
        };
      }),
    };
  }, report.sourceHash);
  if (
    value.sourceHash !== report.sourceHash ||
    value.viewport.width !== 224 ||
    value.viewport.height !== 320 ||
    value.viewport.scale !== scale ||
    value.input.value !== "A" ||
    value.input.disabled ||
    !isDeepStrictEqual(value.nodes.map((node) => node.id).sort(), expectedIDs)
  )
    throw new Error("Original controls source/state/IDs/viewport differ");
  return value;
}
type Capture = {
  mode: string;
  scale: number;
  state: string;
  screenshot: string;
  hash: string;
  authored: Awaited<ReturnType<typeof authoredState>>;
  afterHash: string;
};
const captures: Capture[] = [],
  traceReports: unknown[] = [];
let browser: Browser | undefined;
let initialProvenance:
  Awaited<ReturnType<typeof collectBrowserProvenance>> | undefined;
try {
  browser = await chromium.launch({ headless: true });
  initialProvenance = await collectBrowserProvenance(browser);
  await save(resolve(out, "browser-provenance.json"), initialProvenance);
  if (
    ![revision, `@${revision}`].includes(
      initialProvenance.observation.version.revision,
    ) ||
    (previousBrowserHash !== null &&
      previousBrowserHash !== initialProvenance.observation.executable.hash)
  )
    throw new Error(
      "Trace browser differs from original pinned diagnostic binary",
    );
  for (const scale of [1, 2])
    for (const mode of ["trace-control", "traced"]) {
      const dir = resolve(out, `scale-${scale}`, mode);
      await mkdir(dir, { recursive: true });
      const page = await browser.newPage({
        viewport: { width: 224, height: 320 },
        deviceScaleFactor: scale,
      });
      const session = await page.context().newCDPSession(page);
      const events: unknown[] = [],
        treeEvents: unknown[] = [],
        paintEvents: unknown[] = [],
        usage: unknown[] = [],
        traceStates: TraceState[] = [],
        fontResponses: Promise<Buffer>[] = [];
      let layers: { layerId: string }[] | null = null,
        startRequested = false,
        started = false,
        ended = false,
        completion: unknown = null,
        bytes = 0,
        receivedEvents = 0,
        committedFrameId: string | null = null,
        overflow = false,
        writes = Promise.resolve();
      let complete: (value: unknown) => void = () => {};
      const completed = new Promise<unknown>((done) => {
        complete = done;
      });
      const raw = resolve(dir, "trace-packets.ndjson");
      await writeFile(raw, "");
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("response", (response) => {
        if (response.url() === new URL(font.webSrc, url).href) {
          if (!response.ok()) pageErrors.push(`Font HTTP ${response.status()}`);
          fontResponses.push(response.body());
        }
      });
      session.on("LayerTree.layerTreeDidChange", (event) => {
        treeEvents.push(event);
        layers = event.layers ?? null;
      });
      session.on("LayerTree.layerPainted", (event) => {
        paintEvents.push(event);
      });
      session.on("Tracing.dataCollected", (packet) => {
        receivedEvents += packet.value.length;
        const line = JSON.stringify(packet) + "\n",
          size = Buffer.byteLength(line);
        if (
          bytes + size > traceLimits.bytes ||
          events.length + packet.value.length > traceLimits.events
        ) {
          overflow = true;
          return;
        }
        bytes += size;
        for (const event of packet.value) events.push(event);
        writes = writes
          .then(() => appendFile(raw, line))
          .catch((error) => {
            fail(`trace-write-${scale}`, error);
          });
      });
      session.on("Tracing.bufferUsage", (value) => {
        usage.push(value);
      });
      session.on("Tracing.tracingComplete", (value) => {
        completion = value;
        complete(value);
      });
      async function marker(id: string) {
        if (mode === "traced")
          await session.send("Tracing.recordClockSyncMarker", { syncId: id });
      }
      async function stopTrace() {
        if (!startRequested || ended) return;
        ended = true;
        try {
          await session.send("Tracing.end");
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              completed,
              new Promise((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("Trace completion timeout")),
                  20000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          fail(`trace-stop-${scale}`, error);
        }
        await writes;
      }
      try {
        if (mode === "traced") {
          const available = await session.send("Tracing.getCategories");
          await save(resolve(dir, "categories.json"), available);
          // Clock-sync metadata has a source-defined internal category; its actual markers are required below.
          if (
            !traceCategories
              .filter((category) => category !== "__metadata")
              .every((category) => available.categories.includes(category))
          )
            throw new Error(
              "Actual browser does not report every requested trace category",
            );
          const request = {
            transferMode: "ReportEvents" as const,
            bufferUsageReportingInterval: 1000,
            traceConfig: {
              recordMode: "recordUntilFull" as const,
              traceBufferSizeInKb: 32768,
              enableSampling: false,
              enableSystrace: false,
              includedCategories: [...traceCategories],
            },
          };
          await save(resolve(dir, "trace-request.json"), request);
          startRequested = true;
          await session.send("Tracing.start", request);
          started = true;
        }
        for (const [index, state] of pointerStates.entries()) {
          const stateDir = resolve(dir, `${index}-${state}`),
            prefix = `controls-${scale}-${state}`;
          const markers = {
            begin: `${prefix}-begin`,
            captureBefore: `${prefix}-capture-before`,
            captureAfter: `${prefix}-capture-after`,
            end: `${prefix}-end`,
          };
          try {
            if (state !== "initial") await marker(markers.begin);
            if (state === "initial") {
              const response = await page.goto(url);
              if (!response?.ok())
                throw new Error(`Original source HTTP ${response?.status()}`);
              await page.waitForFunction(
                () =>
                  document.getElementById("responsive-controls") !== null &&
                  document.querySelectorAll("astro-island[ssr]").length === 0,
              );
              await page.evaluate(async () => {
                const fonts = await document.fonts.load(
                  "400 14px AstroNoto",
                  "Responsive controls ABCDEF0123456789",
                );
                await document.fonts.ready;
                if (
                  fonts.length !== 1 ||
                  fonts[0]!.status !== "loaded" ||
                  !document.fonts.check(
                    "400 14px AstroNoto",
                    "Responsive controls ABCDEF0123456789",
                  )
                )
                  throw new Error("Original controls font did not load");
              });
              const served = await Promise.all(fontResponses);
              if (
                !served.length ||
                served.some((value) => sha(value) !== font.hash)
              )
                throw new Error(
                  "Actual font response differs from original source",
                );
              await writeFile(resolve(dir, "served-font.ttf"), served[0]!);
              await session.send("DOM.enable");
              await save(
                resolve(dir, "layer-observer-document.json"),
                await session.send("DOM.getDocument"),
              );
              await session.send("LayerTree.enable");
              const navigation = (await session.send("Page.getFrameTree"))
                .frameTree.frame;
              if (
                navigation.url !== new URL(url).href ||
                page.url() !== navigation.url
              )
                throw new Error(
                  "Initial trace window requires the committed original URL",
                );
              committedFrameId = navigation.id;
              await save(resolve(dir, "navigation-frame.json"), navigation);
              // Loading about:blank precedes the observed state; stale URL/PID
              // checks remain strict throughout the actual capture window.
              await marker(markers.begin);
            } else
              await page
                .locator(
                  state === "click-input"
                    ? "#controls-input"
                    : "#controls-commit",
                )
                .click();
            await settle(page);
            if (pageErrors.length) throw new Error(pageErrors.join("\n"));
            const authored = await authoredState(page, scale),
              focus =
                index === 0
                  ? "BODY"
                  : index === 1
                    ? "controls-input"
                    : "controls-commit";
            if (authored.activeElement !== focus)
              throw new Error(`Real pointer focus differs: ${state}`);
            await save(resolve(stateDir, "authored-state.json"), authored);
            await marker(markers.captureBefore);
            const screenshot = resolve(stateDir, "web.png");
            const image = await page.screenshot({
              path: screenshot,
              ...screenshotOptions,
            });
            await marker(markers.captureAfter);
            const frame = (await session.send("Page.getFrameTree")).frameTree
              .frame;
            if (
              frame.id !== committedFrameId ||
              frame.url !== new URL(url).href ||
              frame.url !== page.url()
            )
              throw new Error("Original trace frame changed during capture");
            const latest = layers as { layerId: string }[] | null,
              reasons = [];
            for (const layer of latest ?? [])
              reasons.push({
                layerId: layer.layerId,
                ...(await session.send("LayerTree.compositingReasons", {
                  layerId: layer.layerId,
                })),
              });
            await save(resolve(stateDir, "layers.json"), {
              availability: latest === null ? "not-reported" : "reported",
              latestLayers: latest,
              treeEvents: treeEvents.splice(0),
              paintEvents: paintEvents.splice(0),
              reasons,
              transformConvention: "CDP column-major; legacy offsets are zero",
              perTextMembership: "unobserved",
            });
            const after = await page.screenshot({
              path: resolve(stateDir, "after-observation.png"),
              ...screenshotOptions,
            });
            const afterState = await authoredState(page, scale);
            if (!isDeepStrictEqual(authored, afterState))
              throw new Error("Layer/frame observation changed authored state");
            await marker(markers.end);
            traceStates.push({
              state,
              frameId: frame.id,
              url: page.url(),
              markers,
              layerIds:
                latest === null ? null : latest.map((layer) => layer.layerId),
            });
            captures.push({
              mode,
              scale,
              state,
              screenshot,
              hash: sha(image),
              authored,
              afterHash: sha(after),
            });
          } catch (error) {
            fail(`${mode}-${scale}-${state}`, error);
            await save(resolve(stateDir, "failure.json"), {
              error: String(error),
              markers,
            });
          }
          await save(resolve(out, "capture-progress.json"), {
            captures,
            failures,
          });
        }
      } catch (error) {
        fail(`${mode}-${scale}`, error);
      } finally {
        await stopTrace();
        await writes;
        await save(resolve(dir, "trace-receipt.json"), {
          startRequested,
          started,
          endRequested: ended,
          completion,
          retainedBytes: bytes,
          receivedEvents,
          retainedEvents: events.length,
          overflow,
          limits: traceLimits,
          bufferUsage: usage,
        });
        if (mode === "traced") {
          try {
            if (overflow)
              throw new Error(
                "Trace exceeded its explicit byte/event bound; partial raw packets retained",
              );
            const decoded = decodeLayerTrace(events, completion, traceStates);
            const hash = await save(resolve(dir, "decoded.json"), decoded);
            traceReports.push({
              scale,
              decodedHash: hash,
              rawHash: sha(await readFile(raw)),
              states: decoded,
            });
          } catch (error) {
            fail(`decode-${scale}`, error);
            await save(resolve(dir, "decode-failure.json"), {
              error: String(error),
              states: traceStates,
            });
          }
        }
        try {
          await session.detach();
        } catch (error) {
          fail("CDP-detach", error);
        }
        try {
          await page.close();
        } catch (error) {
          fail(`${mode}-${scale}-page-close`, error);
        }
      }
    }
} catch (error) {
  fail("browser", error);
} finally {
  if (browser && initialProvenance)
    try {
      await save(
        resolve(out, "final-browser-provenance.json"),
        await verifyBrowserProvenance(browser, initialProvenance),
      );
    } catch (error) {
      fail("final-browser-provenance", error);
    }
  try {
    await browser?.close();
  } catch (error) {
    fail("browser-close", error);
  }
}

const comparisons: unknown[] = [];
async function compare(
  kind: string,
  scale: number,
  state: string,
  reference: string,
  candidate: string,
) {
  const dir = resolve(out, `scale-${scale}/comparisons/${state}-${kind}`),
    output = resolve(dir, "diff.png");
  await mkdir(dir, { recursive: true });
  try {
    const arguments_ = [
      "--reference",
      reference,
      "--native",
      candidate,
      "--out",
      output,
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
      child.stdout.on("data", (value) => {
        stdout += value;
      });
      child.stderr.on("data", (value) => {
        stderr += value;
      });
      child.on("error", reject);
      child.on("close", (code) => done({ code, stdout, stderr }));
    });
    await save(resolve(dir, "execution.json"), {
      executable: comparator,
      executableHash: sha(await readFile(comparator)),
      arguments: arguments_,
      ...result,
    });
    const parsed = readStrictComparison(
      JSON.parse(result.stdout),
      224 * scale,
      320 * scale,
      result.code,
    );
    comparisons.push({
      kind,
      scale,
      state,
      referenceHash: sha(await readFile(reference)),
      candidateHash: sha(await readFile(candidate)),
      result: parsed,
    });
    if (parsed.exact !== true)
      fail(
        `comparison-${scale}-${state}-${kind}`,
        "Strict full-frame RGBA comparison differs",
      );
  } catch (error) {
    comparisons.push({
      kind,
      scale,
      state,
      invalid: true,
      error: String(error),
    });
    fail(`comparison-${scale}-${state}-${kind}`, error);
  }
}
for (const scale of [1, 2])
  for (const [index, state] of pointerStates.entries()) {
    const control = resolve(
        out,
        `scale-${scale}/trace-control/${index}-${state}/web.png`,
      ),
      traced = resolve(out, `scale-${scale}/traced/${index}-${state}/web.png`);
    for (const [kind, a, b] of [
      ["trace-versus-control", control, traced],
      [
        "control-observation",
        control,
        resolve(dirname(control), "after-observation.png"),
      ],
      [
        "traced-observation",
        traced,
        resolve(dirname(traced), "after-observation.png"),
      ],
      [
        "existing-uninstrumented",
        resolve(
          diagnostic,
          `scale-${scale}/uninstrumented/${index}-${state}/web.png`,
        ),
        traced,
      ],
      [
        "existing-observed",
        resolve(
          diagnostic,
          `scale-${scale}/observed/${index}-${state}/web.png`,
        ),
        traced,
      ],
    ])
      await compare(kind!, scale, state, a!, b!);
    const before = captures.find(
        (item) =>
          item.scale === scale &&
          item.mode === "trace-control" &&
          item.state === state,
      ),
      after = captures.find(
        (item) =>
          item.scale === scale &&
          item.mode === "traced" &&
          item.state === state,
      );
    if (
      !before ||
      !after ||
      !isDeepStrictEqual(before.authored, after.authored)
    )
      fail(
        `author-state-${scale}-${state}`,
        "Control and traced authored state differ or are absent",
      );
  }
for (const [path, hash] of Object.entries(sources))
  try {
    if (sha(await readFile(resolve(repository, path))) !== hash)
      fail("source-stability", path);
  } catch (error) {
    fail("source-stability", error);
  }
for (const [path, hash] of Object.entries(baselineHashes))
  try {
    if (sha(await readFile(path)) !== hash) fail("reference-stability", path);
  } catch (error) {
    fail("reference-stability", error);
  }
if (
  captures.length !== 12 ||
  traceReports.length !== 2 ||
  comparisons.length !== 30
)
  fail(
    "matrix",
    "Required 12 capture states, two traces or 30 comparison slots are missing",
  );
await save(resolve(out, "trace-diagnostic.json"), {
  schema: 1,
  diagnosticOnly: true,
  pixelPerfectVerified: false,
  nativeInput: false,
  browserEffectivePolicyObserved: false,
  sourceHash: report.sourceHash,
  reportHash: sha(reportBytes),
  sourceManifestHash: sha(await readFile(resolve(out, "source-manifest.json"))),
  screenshotOptions,
  captures,
  traceReports,
  comparisons,
  failures,
  observationChecksPassed: failures.length === 0,
  limitations: [
    "Current layer eligibility is not a cached tile LCD flag or actual glyph mask",
    "Surface pixel geometry/gamma/contrast and per-text layer membership remain unobserved",
    "Marker-time joins do not expose the exact screenshot swap/tree identity",
    "Original 22-frame collector and the existing 14 diagnostic comparisons remain separate and unchanged",
    "Tracing and per-state CDP reads require their own strict whole-frame neutrality results",
  ],
});
if (failures.length) process.exitCode = 1;
