// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// CI-only: browser rectangles are an oracle, never a native layout profile.
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  behaviorScenarioHash,
  validateBehaviorScenario,
  validateBehaviorTrace,
  type BehaviorFrame,
} from "../src/behavior-contract.ts";

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function argsFrom(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (
      !key ||
      !["--url", "--out", "--report"].includes(key) ||
      !value ||
      value.startsWith("--") ||
      values.has(key)
    )
      throw new Error(
        "Usage: responsive-controls.ts --url URL --out DIR --report REPORT.json",
      );
    values.set(key, value);
  }
  const url = values.get("--url"),
    out = values.get("--out"),
    report = values.get("--report");
  if (
    !url ||
    !out ||
    !report ||
    !["http:", "https:"].includes(new URL(url).protocol)
  )
    throw new Error(
      "An HTTP(S) page, output directory and generated report are required",
    );
  return { url, out: resolve(out), report: resolve(report) };
}
const args = argsFrom(process.argv.slice(2));
const report = JSON.parse(await readFile(args.report, "utf8")) as {
  sourceHash?: unknown;
  fonts?: {
    family?: unknown;
    weight?: unknown;
    style?: unknown;
    hash?: unknown;
    webSrc?: unknown;
  }[];
};
if (
  typeof report.sourceHash !== "string" ||
  !/^[a-f0-9]{64}$/.test(report.sourceHash) ||
  !Array.isArray(report.fonts) ||
  report.fonts.length !== 1
)
  throw new Error(
    "Controls report requires a source digest and exactly one explicit font",
  );
const font = report.fonts[0];
if (
  !font ||
  font.family !== "AstroNoto" ||
  font.weight !== 400 ||
  font.style !== "normal" ||
  typeof font.hash !== "string" ||
  !/^[a-f0-9]{64}$/.test(font.hash) ||
  font.webSrc !== "/fonts/NotoSans-Regular.ttf"
)
  throw new Error(
    "Controls report must bind AstroNoto regular to the public font bytes",
  );
const sourceHash = report.sourceHash,
  fontHash = font.hash;
const scenario = validateBehaviorScenario(
  JSON.parse(
    await readFile(
      new URL("../responsive-controls-scenario.json", import.meta.url),
      "utf8",
    ),
  ),
);
const identity = { sourceHash, scenarioHash: behaviorScenarioHash(scenario) };
const geometryIds = [
  "responsive-controls",
  "controls-editor-row",
  "controls-toggle-row",
  ...scenario.ids,
];
if (new Set(geometryIds).size !== geometryIds.length)
  throw new Error("Controls geometry IDs overlap");
await mkdir(args.out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 224, height: 320 },
    deviceScaleFactor: 1,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fontUrl = new URL(font.webSrc as string, args.url).href;
  const servedFonts: Promise<Uint8Array>[] = [];
  page.on("response", (response) => {
    if (response.url() === fontUrl) {
      if (!response.ok())
        errors.push(`Font response returned ${response.status()}`);
      servedFonts.push(response.body());
    }
  });
  const response = await page.goto(args.url);
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
      throw new Error("The explicit font face did not load");
    (window as unknown as { controlsOriginal: Element[] }).controlsOriginal = [
      document.getElementById("controls-input")!,
      document.getElementById("controls-commit")!,
      document.getElementById("controls-toggle-disabled")!,
    ];
  });
  if (!servedFonts.length)
    throw new Error("No browser request used the declared public font");
  for (const bytes of await Promise.all(servedFonts))
    if (sha(bytes) !== fontHash)
      throw new Error(
        "The font actually served to Chromium differs from the generated font",
      );
  await writeFile(
    resolve(args.out, "web-font.json"),
    JSON.stringify(
      {
        schema: 1,
        sourceHash,
        family: "AstroNoto",
        weight: 400,
        style: "normal",
        hash: fontHash,
        webSrc: font.webSrc,
      },
      null,
      2,
    ) + "\n",
  );
  const frames: BehaviorFrame[] = [];
  const observations: { prefix: string; previous: number }[] = [];
  async function snapshot(action: string) {
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    if (errors.length) throw new Error(errors.join("\n"));
    const state = await page.evaluate(
      ({ sourceHash, ids, geometryIds }) => {
        if (
          document.documentElement.dataset.responsiveControlsSourceHash !==
          sourceHash
        )
          throw new Error(
            "Controls fixture belongs to another source revision",
          );
        if (
          devicePixelRatio !== 1 ||
          innerHeight !== 320 ||
          document.documentElement.scrollWidth !== innerWidth ||
          document.documentElement.scrollHeight !== innerHeight
        )
          throw new Error(
            "Controls viewport/overflow differs from its declared case",
          );
        const root = document.getElementById("responsive-controls")!;
        const elements = [root, ...root.querySelectorAll("*")];
        if (
          elements.length !== geometryIds.length ||
          elements.some((element) => !geometryIds.includes(element.id))
        )
          throw new Error(
            "Controls DOM must contain exactly its declared nodes",
          );
        const nodes: Record<string, string | null> = Object.create(null);
        const rectangles: Record<
          string,
          {
            parent: string | null;
            x: number;
            y: number;
            width: number;
            height: number;
          }
        > = Object.create(null);
        for (const id of geometryIds) {
          const matches = document.querySelectorAll(`#${CSS.escape(id)}`);
          const element = matches[0];
          if (matches.length !== 1 || !(element instanceof HTMLElement))
            throw new Error(`Controls ID ${id} is missing or duplicated`);
          if (ids.includes(id)) {
            nodes[id] =
              element instanceof HTMLInputElement
                ? element.value
                : (element.textContent ?? "");
            const css = getComputedStyle(element);
            if (
              css.fontFamily !== "AstroNoto" ||
              css.fontSize !== "14px" ||
              css.fontWeight !== "400" ||
              css.fontStyle !== "normal" ||
              css.lineHeight !== "20px" ||
              css.whiteSpace !== "nowrap"
            )
              throw new Error(
                `Controls ID ${id} does not use the declared font contract`,
              );
          }
          const bounds = element.getBoundingClientRect();
          const parent =
            id === "responsive-controls" ? null : element.parentElement;
          if (parent && !geometryIds.includes(parent.id))
            throw new Error(`Unexpected parent for controls ID ${id}`);
          const origin = parent?.getBoundingClientRect();
          const rectangle = {
            parent: parent?.id ?? null,
            x: bounds.x - (origin?.x ?? 0),
            y: bounds.y - (origin?.y ?? 0),
            width: bounds.width,
            height: bounds.height,
          };
          if (
            ![
              rectangle.x,
              rectangle.y,
              rectangle.width,
              rectangle.height,
            ].every(Number.isFinite) ||
            rectangle.width < 0 ||
            rectangle.height < 0
          )
            throw new Error(`Invalid controls rectangle ${id}`);
          rectangles[id] = rectangle;
        }
        const input = document.getElementById(
          "controls-input",
        ) as HTMLInputElement;
        const commit = document.getElementById(
          "controls-commit",
        ) as HTMLButtonElement;
        const toggle = document.getElementById(
          "controls-toggle-disabled",
        ) as HTMLButtonElement;
        const original = (window as unknown as { controlsOriginal: Element[] })
          .controlsOriginal;
        const focus =
          document.activeElement === input
            ? 1
            : document.activeElement === commit
              ? 2
              : document.activeElement === toggle
                ? 3
                : document.activeElement === document.body
                  ? 0
                  : -1;
        if (focus < 0)
          throw new Error("Controls focus moved to an undeclared element");
        return {
          nodes,
          rectangles,
          width: innerWidth,
          observations: [
            focus,
            Number(input === original[0]),
            Number(commit === original[1]),
            Number(toggle === original[2]),
            Number(input.disabled),
            Number(commit.disabled),
          ],
        };
      },
      { sourceHash, ids: scenario.ids, geometryIds },
    );
    const index = frames.length;
    frames.push({ action, nodes: state.nodes });
    const names = [
      "focus",
      "same-input",
      "same-commit",
      "same-toggle",
      "input-disabled",
      "button-disabled",
    ];
    for (const [column, previous] of state.observations.entries())
      observations.push({ prefix: `${index}:${names[column]!}`, previous });
    const caseName = `${String(index).padStart(2, "0")}-${action}`;
    const dir = resolve(args.out, caseName);
    await mkdir(dir, { recursive: true });
    const screenshot = await page.screenshot({
      path: resolve(dir, "web.png"),
      animations: "disabled",
      caret: "initial",
      scale: "device",
    });
    await writeFile(
      resolve(dir, "geometry.json"),
      JSON.stringify(
        {
          schema: 1,
          ...identity,
          case: caseName,
          viewport: { width: state.width, height: 320, scale: 1 },
          screenshotHash: sha(screenshot),
          nodes: state.rectangles,
        },
        null,
        2,
      ) + "\n",
    );
  }
  await snapshot("initial");
  for (const action of scenario.actions) {
    if (action.startsWith("resize-")) {
      const width = Number(action.slice("resize-".length));
      if (![224, 368, 512].includes(width))
        throw new Error(`Unknown controls resize ${action}`);
      await page.setViewportSize({ width, height: 320 });
    } else if (action.startsWith("type-")) {
      const text = action.slice("type-".length);
      if (!["BC", "D", "E", "F"].includes(text))
        throw new Error(`Unknown controls typing ${action}`);
      if (
        !(await page
          .locator("#controls-input")
          .evaluate((element) => document.activeElement === element))
      )
        throw new Error(
          "Typing would silently create focus instead of preserving it",
        );
      await page.locator("#controls-input").press("End");
      await page.locator("#controls-input").pressSequentially(text);
    } else if (action === "press-enter") {
      if (
        !(await page
          .locator("#controls-input")
          .evaluate((element) => document.activeElement === element))
      )
        throw new Error("Enter requires the existing input focus");
      await page.locator("#controls-input").press("Enter");
    } else if (action === "click-canvas") {
      await page.mouse.click(4, 316);
    } else {
      const targets: Record<string, string> = {
        "click-input": "controls-input",
        "click-commit": "controls-commit",
        "click-toggle-disabled": "controls-toggle-disabled",
        "click-disabled-input": "controls-input",
        "click-disabled-button": "controls-commit",
      };
      const id = targets[action];
      if (!id) throw new Error(`Unknown controls action ${action}`);
      // force performs a real pointer gesture on disabled controls; it does not
      // synthesize a click event or make the disabled element focusable.
      await page
        .locator(`#${id}`)
        .click({ force: action.startsWith("click-disabled-") });
    }
    await snapshot(action);
  }
  const trace = validateBehaviorTrace(
    { schema: 1, ...identity, frames, observations, unexpectedCalls: [] },
    scenario,
    identity,
  );
  await writeFile(
    resolve(args.out, "web-behavior.json"),
    JSON.stringify(trace, null, 2) + "\n",
  );
  // Font equality and box/event gates provide no raster certification. The
  // separate PNG comparator must retain its nonzero exit status on any delta.
  await writeFile(
    resolve(args.out, "visual-status.json"),
    JSON.stringify(
      {
        schema: 1,
        ...identity,
        fontHash,
        pixelPerfectVerified: false,
        reason:
          "Text, focus decoration and caret PNG parity require a separate strict comparison",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
