// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// CI-only bitmap oracle; no captured coordinates enter the native widget.
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function argumentsFrom(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index],
      value = argv[index + 1];
    if (
      !flag ||
      !["--url", "--out", "--analysis"].includes(flag) ||
      !value ||
      value.startsWith("--") ||
      values.has(flag)
    )
      throw new Error(
        "Usage: responsive-bitmap.ts --url URL --out DIR --analysis ANALYSIS.json",
      );
    values.set(flag, value);
  }
  const url = values.get("--url"),
    out = values.get("--out"),
    analysis = values.get("--analysis");
  if (
    !url ||
    !out ||
    !analysis ||
    !["http:", "https:"].includes(new URL(url).protocol)
  )
    throw new Error(
      "Bitmap capture requires an HTTP(S) page, output directory and compiler analysis",
    );
  return { url, out: resolve(out), analysis: resolve(analysis) };
}
const args = argumentsFrom(process.argv.slice(2));
const analysis = JSON.parse(await readFile(args.analysis, "utf8")) as {
  name?: unknown;
  sourceHash?: unknown;
  program?: {
    hasStyles?: unknown;
    resources?: {
      path?: unknown;
      hash?: unknown;
      mediaType?: unknown;
      width?: unknown;
      height?: unknown;
      srcs?: unknown;
      content?: unknown;
    }[];
  };
};
if (
  analysis.name !== "ResponsiveBitmap" ||
  typeof analysis.sourceHash !== "string" ||
  !/^[a-f0-9]{64}$/.test(analysis.sourceHash) ||
  analysis.program?.hasStyles !== false ||
  !Array.isArray(analysis.program.resources) ||
  analysis.program.resources.length !== 1
)
  throw new Error(
    "Bitmap analysis must identify the source-only widget and exactly one bitmap",
  );
const resource = analysis.program.resources[0];
if (
  !resource ||
  resource.path !== "example/public/images/local-image.png" ||
  typeof resource.hash !== "string" ||
  !/^[a-f0-9]{64}$/.test(resource.hash) ||
  resource.mediaType !== "image/png" ||
  resource.width !== 16 ||
  resource.height !== 16 ||
  !Array.isArray(resource.srcs) ||
  resource.srcs.length !== 1 ||
  resource.srcs[0] !== "/images/local-image.png" ||
  typeof resource.content !== "string" ||
  sha(Buffer.from(resource.content, "base64")) !== resource.hash
)
  throw new Error(
    "Bitmap analysis must bind the original natural 16x16 PNG bytes",
  );
const sourceHash = analysis.sourceHash,
  imageHash = resource.hash;
const scenarioBytes = await readFile(
  new URL("../responsive-bitmap-scenario.json", import.meta.url),
);
const scenario = JSON.parse(scenarioBytes.toString("utf8")) as {
  schema?: unknown;
  cases?: { name: string; width: number; height: number; scale: number }[];
  ids?: string[];
};
const expectedIds = [
  "responsive-bitmap",
  "bitmap-left",
  "bitmap-image",
  "bitmap-right",
];
const widths = [224, 368, 512, 368, 224];
const caseNames = [
  "01-224",
  "02-368",
  "03-512",
  "04-368-return",
  "05-224-return",
];
if (
  Object.keys(scenario).length !== 3 ||
  scenario.schema !== 1 ||
  !Array.isArray(scenario.cases) ||
  scenario.cases.length !== widths.length ||
  !Array.isArray(scenario.ids) ||
  JSON.stringify(scenario.ids) !== JSON.stringify(expectedIds)
)
  throw new Error(
    "Bitmap scenario must declare all five resize cases and four physical nodes",
  );
for (const [index, item] of scenario.cases.entries())
  if (
    !item ||
    Object.keys(item).length !== 4 ||
    item.name !== caseNames[index] ||
    item.width !== widths[index] ||
    item.height !== 96 ||
    item.scale !== 1
  )
    throw new Error(
      "Bitmap corpus certifies only the declared unscaled natural-size cases",
    );
const scenarioHash = sha(scenarioBytes);
await mkdir(args.out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 224, height: 96 },
    deviceScaleFactor: 1,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const imageUrl = new URL("/images/local-image.png", args.url).href;
  const servedImages: Promise<Uint8Array>[] = [];
  page.on("response", (response) => {
    if (response.url() === imageUrl) {
      if (!response.ok())
        errors.push(`Bitmap response returned ${response.status()}`);
      servedImages.push(response.body());
    }
  });
  const response = await page.goto(args.url);
  if (!response?.ok())
    throw new Error(`Bitmap fixture returned ${response?.status()}`);
  await page.waitForFunction(
    () =>
      document.getElementById("responsive-bitmap") !== null &&
      document.querySelectorAll("astro-island[ssr]").length === 0,
  );
  await page.evaluate(async () => {
    const image = document.getElementById("bitmap-image");
    if (!(image instanceof HTMLImageElement))
      throw new Error("Bitmap fixture image is absent");
    await image.decode();
    (window as unknown as { bitmapOriginal: Element[] }).bitmapOriginal = [
      ...document.getElementById("responsive-bitmap")!.querySelectorAll("*"),
    ];
  });
  if (!servedImages.length)
    throw new Error("Chromium did not request the declared bitmap");
  for (const bytes of await Promise.all(servedImages))
    if (sha(bytes) !== imageHash)
      throw new Error(
        "PNG bytes served to Chromium differ from the compiled resource",
      );
  await writeFile(
    resolve(args.out, "web-resource.json"),
    JSON.stringify(
      {
        schema: 1,
        sourceHash,
        path: resource.path,
        hash: imageHash,
        mediaType: "image/png",
        width: 16,
        height: 16,
        src: "/images/local-image.png",
      },
      null,
      2,
    ) + "\n",
  );
  for (const item of scenario.cases) {
    await page.setViewportSize({ width: item.width, height: item.height });
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    if (errors.length) throw new Error(errors.join("\n"));
    const nodes = await page.evaluate(
      ({ sourceHash, ids, viewport, imageUrl }) => {
        if (
          document.documentElement.dataset.responsiveBitmapSourceHash !==
          sourceHash
        )
          throw new Error("Bitmap page belongs to a different source revision");
        if (
          innerWidth !== viewport.width ||
          innerHeight !== viewport.height ||
          devicePixelRatio !== viewport.scale ||
          document.documentElement.scrollWidth !== innerWidth ||
          document.documentElement.scrollHeight !== innerHeight
        )
          throw new Error(
            "Bitmap viewport/scale/overflow differs from its case",
          );
        const root = document.getElementById("responsive-bitmap")!;
        const children = [...root.querySelectorAll("*")];
        const original = (window as unknown as { bitmapOriginal: Element[] })
          .bitmapOriginal;
        if (
          children.length !== 3 ||
          children.some((element, index) => element !== original[index]) ||
          root.textContent?.trim()
        )
          throw new Error(
            "Resize remounted the bitmap DOM or inserted unexpected content",
          );
        const result: Record<
          string,
          {
            parent: string | null;
            x: number;
            y: number;
            width: number;
            height: number;
          }
        > = Object.create(null);
        for (const id of ids) {
          const matches = document.querySelectorAll(`#${CSS.escape(id)}`);
          const element = matches[0];
          if (matches.length !== 1 || !(element instanceof HTMLElement))
            throw new Error(`Bitmap ID ${id} is missing or duplicated`);
          const css = getComputedStyle(element);
          if (
            css.transform !== "none" ||
            css.boxShadow !== "none" ||
            css.backgroundImage !== "none" ||
            css.opacity !== "1" ||
            [
              css.borderTopWidth,
              css.borderRightWidth,
              css.borderBottomWidth,
              css.borderLeftWidth,
              css.borderTopLeftRadius,
              css.borderTopRightRadius,
              css.borderBottomLeftRadius,
              css.borderBottomRightRadius,
            ].some((value) => value !== "0px")
          )
            throw new Error(
              `Bitmap ID ${id} uses effects outside the pixel corpus`,
            );
          if (id === "bitmap-image") {
            if (
              !(element instanceof HTMLImageElement) ||
              !element.complete ||
              element.naturalWidth !== 16 ||
              element.naturalHeight !== 16 ||
              element.currentSrc !== imageUrl ||
              element.getAttribute("src") !== "/images/local-image.png" ||
              element.srcset ||
              css.objectFit !== "fill" ||
              css.objectPosition !== "50% 50%" ||
              [
                css.paddingTop,
                css.paddingRight,
                css.paddingBottom,
                css.paddingLeft,
              ].some((value) => value !== "0px")
            )
              throw new Error(
                "Bitmap element no longer uses the validated unscaled resource",
              );
          } else if (
            element.tagName !== (id === "responsive-bitmap" ? "MAIN" : "DIV")
          )
            throw new Error(`Unexpected bitmap tag for ${id}`);
          const bounds = element.getBoundingClientRect();
          const parent =
            id === "responsive-bitmap" ? null : element.parentElement;
          if (parent && parent !== root)
            throw new Error(`Unexpected bitmap parent for ${id}`);
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
            throw new Error(`Invalid bitmap rectangle ${id}`);
          result[id] = rectangle;
        }
        const image = result["bitmap-image"]!;
        if (
          image.width !== 16 ||
          image.height !== 16 ||
          image.x !== (viewport.width - 16) / 2 ||
          image.y !== 40
        )
          throw new Error(
            "The PNG must remain natural-size at an integer center while flex siblings resize",
          );
        return result;
      },
      { sourceHash, ids: scenario.ids!, viewport: item, imageUrl },
    );
    const directory = resolve(args.out, item.name);
    await mkdir(directory, { recursive: true });
    const screenshot = await page.screenshot({
      path: resolve(directory, "web.png"),
      animations: "disabled",
      scale: "device",
    });
    await writeFile(
      resolve(directory, "geometry.json"),
      JSON.stringify(
        {
          schema: 1,
          sourceHash,
          scenarioHash,
          case: item.name,
          viewport: {
            width: item.width,
            height: item.height,
            scale: item.scale,
          },
          screenshotHash: sha(screenshot),
          nodes,
        },
        null,
        2,
      ) + "\n",
    );
  }
} finally {
  await browser.close();
}
