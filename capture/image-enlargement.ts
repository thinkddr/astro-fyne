// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Response } from "playwright";
import { validateSceneDocument } from "../src/reverse.ts";

const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i],
    value = process.argv[i + 1];
  if (
    !key ||
    !["--base-url", "--out", "--direction", "--analysis"].includes(key) ||
    !value ||
    value.startsWith("--") ||
    args.has(key)
  )
    throw new Error(`Invalid enlargement argument: ${key}`);
  args.set(key, value);
}
if (
  !args.has("--base-url") ||
  !args.has("--out") ||
  !["source", "inverse"].includes(args.get("--direction") ?? "")
)
  throw new Error(
    "Required: --base-url URL --out DIR --direction source|inverse [--analysis PATH]",
  );
const base = new URL(args.get("--base-url")!);
if (!["http:", "https:"].includes(base.protocol))
  throw new Error("Enlargement preview must use HTTP(S)");
const out = resolve(args.get("--out")!);
const scenarioBytes = await readFile(
  new URL("../image-enlargement-scenario.json", import.meta.url),
);
const scenario = JSON.parse(scenarioBytes.toString("utf8")) as {
  schema: number;
  viewport: { width: number; height: number };
  cases: { name: string; entry: string; scale: number }[];
  assets: {
    id: string;
    path: string;
    src: string;
    hash: string;
    mediaType: string;
    width: number;
    height: number;
    x: number;
    y: number;
    renderWidth: number;
    renderHeight: number;
  }[];
};
if (
  scenario.schema !== 1 ||
  scenario.viewport.width !== 160 ||
  scenario.viewport.height !== 80 ||
  scenario.cases.length !== 2 ||
  scenario.assets.length !== 3
)
  throw new Error("Expected three enlargement assets and two DPR cases");
for (const [i, item] of scenario.cases.entries())
  if (
    item.name !== `scale-${i + 1}` ||
    item.entry !== "ImageEnlargement" ||
    item.scale !== i + 1
  )
    throw new Error("Unexpected enlargement case");
for (const [i, asset] of scenario.assets.entries()) {
  const name = ["even", "odd", "alpha"][i];
  if (
    asset.id !== `${name}-image` ||
    asset.path !== `example/public/images/enlargement-${name}.png` ||
    asset.src !== `/images/enlargement-${name}.png` ||
    !/^[a-f0-9]{64}$/.test(asset.hash) ||
    asset.mediaType !== "image/png" ||
    asset.width !== 16 ||
    asset.height !== 16 ||
    asset.x !== 16 + 48 * i ||
    asset.y !== 16 ||
    asset.renderWidth !== 32 ||
    asset.renderHeight !== 32 ||
    sha(await readFile(asset.path)) !== asset.hash
  )
    throw new Error(
      `Enlargement resource ${name} differs from its source bytes or box`,
    );
}
const scenarioHash = sha(scenarioBytes);
const wrapperHash = sha(
  await readFile(
    new URL("../example/src/pages/image-enlargement.astro", import.meta.url),
  ),
);
await mkdir(out, { recursive: true });

if (args.get("--direction") === "source") {
  const analysisPath = args.get("--analysis");
  if (!analysisPath) throw new Error("Source capture requires --analysis PATH");
  const analysis = JSON.parse(await readFile(analysisPath, "utf8")) as {
    name: string;
    sourceHash: string;
    program: {
      hasStyles: boolean;
      resources: {
        path: string;
        hash: string;
        width: number;
        height: number;
        content: string;
      }[];
    };
  };
  if (
    analysis.name !== "ImageEnlargement" ||
    !/^[a-f0-9]{64}$/.test(analysis.sourceHash) ||
    analysis.program.hasStyles !== false ||
    analysis.program.resources.length !== 3
  )
    throw new Error(
      "Source analysis must describe the source-only enlargement widget",
    );
  for (const asset of scenario.assets) {
    const resource = analysis.program.resources.find(
      (resource) => resource.path === asset.path,
    );
    if (
      !resource ||
      resource.hash !== asset.hash ||
      resource.width !== 16 ||
      resource.height !== 16 ||
      sha(Buffer.from(resource.content, "base64")) !== asset.hash
    )
      throw new Error(
        `Compiled resource ${asset.id} was replaced or pre-enlarged`,
      );
  }
  const browser = await chromium.launch({ headless: true });
  try {
    for (const item of scenario.cases) {
      const directory = join(out, item.name);
      await mkdir(directory, { recursive: true });
      const context = await browser.newContext({
        viewport: { width: 160, height: 80 },
        deviceScaleFactor: item.scale,
        colorScheme: "light",
      });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        const responses = new Map<string, Response[]>();
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("response", (response) => {
          if (response.request().resourceType() === "image") {
            const found = responses.get(response.url()) ?? [];
            found.push(response);
            responses.set(response.url(), found);
          }
        });
        const response = await page.goto(
          new URL("/image-enlargement", base).href,
        );
        if (!response?.ok())
          throw new Error(`${item.name}: source page did not load`);
        await page.waitForFunction(
          () =>
            document.getElementById("enlargement-root") !== null &&
            document.querySelectorAll("astro-island[ssr]").length === 0,
        );
        const readGeometry = () =>
          page.evaluate(
            async ({ assets, sourceHash }) => {
              for (const image of document.images) await image.decode();
              if (
                document.documentElement.dataset.imageEnlargementSourceHash !==
                  sourceHash ||
                document.images.length !== 3
              )
                throw new Error("Source page hash or image inventory differs");
              const root = document.getElementById("enlargement-root");
              if (!(root instanceof HTMLElement))
                throw new Error("Missing source flex root");
              const box = root.getBoundingClientRect(),
                css = getComputedStyle(root);
              if (
                box.x !== 0 ||
                box.y !== 0 ||
                box.width !== 160 ||
                box.height !== 80 ||
                css.display !== "flex" ||
                css.flexDirection !== "row" ||
                css.gap !== "16px" ||
                css.paddingTop !== "16px" ||
                css.paddingRight !== "16px" ||
                css.paddingBottom !== "16px" ||
                css.paddingLeft !== "16px"
              )
                throw new Error(
                  "Source no longer uses the declared Flexbox layout",
                );
              const nodes: Record<
                string,
                {
                  parent: string | null;
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                }
              > = {
                "enlargement-root": {
                  parent: null,
                  x: box.x,
                  y: box.y,
                  width: box.width,
                  height: box.height,
                },
              };
              const images = assets.map((asset) => {
                const image = document.getElementById(asset.id);
                if (
                  !(image instanceof HTMLImageElement) ||
                  image.parentElement !== root
                )
                  throw new Error(`Missing source image ${asset.id}`);
                const imageBox = image.getBoundingClientRect(),
                  style = getComputedStyle(image);
                if (
                  !image.complete ||
                  image.naturalWidth !== 16 ||
                  image.naturalHeight !== 16 ||
                  image.getAttribute("src") !== asset.src ||
                  image.currentSrc !== new URL(asset.src, location.href).href ||
                  image.srcset ||
                  image.hasAttribute("sizes") ||
                  imageBox.x !== asset.x ||
                  imageBox.y !== asset.y ||
                  imageBox.width !== 32 ||
                  imageBox.height !== 32 ||
                  style.objectFit !== "fill" ||
                  style.objectPosition !== "50% 50%" ||
                  style.imageRendering !== "auto" ||
                  style.transform !== "none" ||
                  style.filter !== "none" ||
                  style.opacity !== "1" ||
                  style.visibility !== "visible"
                )
                  throw new Error(
                    `Source image ${asset.id} uses different geometry, resource or paint`,
                  );
                nodes[asset.id] = {
                  parent: root.id,
                  x: imageBox.x - box.x,
                  y: imageBox.y - box.y,
                  width: imageBox.width,
                  height: imageBox.height,
                };
                return {
                  id: asset.id,
                  currentSrc: image.currentSrc,
                  naturalWidth: image.naturalWidth,
                  naturalHeight: image.naturalHeight,
                  imageRendering: style.imageRendering,
                };
              });
              return { nodes, images };
            },
            { assets: scenario.assets, sourceHash: analysis.sourceHash },
          );
        const observed = await readGeometry();
        for (const asset of scenario.assets) {
          const found = responses.get(new URL(asset.src, base).href);
          if (
            !found ||
            found.length !== 1 ||
            !found[0]!.ok() ||
            found[0]!.request().redirectedFrom() ||
            found[0]!.headers()["content-type"]?.split(";")[0]?.trim() !==
              "image/png" ||
            sha(await found[0]!.body()) !== asset.hash
          )
            throw new Error(
              `${asset.id}: source response differs from compiled bytes`,
            );
        }
        if (errors.length) throw new Error(errors.join("\n"));
        const png = await page.screenshot({
          fullPage: false,
          animations: "disabled",
          caret: "hide",
          scale: "device",
        });
        if (JSON.stringify(observed) !== JSON.stringify(await readGeometry()))
          throw new Error("Source geometry changed during capture");
        if (
          png.readUInt32BE(16) !== 160 * item.scale ||
          png.readUInt32BE(20) !== 80 * item.scale
        )
          throw new Error("Source physical PNG dimensions differ");
        await writeFile(join(directory, "web.png"), png);
        await writeFile(
          join(directory, "web-geometry.json"),
          JSON.stringify(
            {
              schema: 1,
              scenarioHash,
              wrapperHash,
              sourceHash: analysis.sourceHash,
              case: item.name,
              viewport: { ...scenario.viewport, scale: item.scale },
              screenshotHash: sha(png),
              browserVersion: browser.version(),
              nodes: observed.nodes,
              images: observed.images,
              resources: scenario.assets,
              visualVerified: false,
            },
            null,
            2,
          ) + "\n",
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
} else {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const item of scenario.cases) {
      const directory = join(out, item.name);
      const sceneBytes = await readFile(join(directory, "scene.json"));
      const scene = validateSceneDocument(
        JSON.parse(sceneBytes.toString("utf8")),
      );
      const name = `EnlargementReverse${item.scale}`;
      const report = JSON.parse(
        await readFile(join(directory, `${name}.reverse.report.json`), "utf8"),
      ) as {
        generator: string;
        direction: string;
        name: string;
        sceneHash: string;
        rootId: string;
        visualVerified: boolean;
      };
      const original = JSON.parse(
        await readFile(join(directory, "original-native.json"), "utf8"),
      ) as {
        scenarioHash: string;
        wrapperHash: string;
        screenshotHash: string;
        sceneFileHash: string;
        viewport: { width: number; height: number; scale: number };
      };
      const nativePNG = await readFile(join(directory, "original-native.png"));
      if (
        scene.schema !== 1 ||
        scene.resources.length !== 3 ||
        scene.viewport.width !== 160 ||
        scene.viewport.height !== 80 ||
        scene.viewport.scale !== item.scale ||
        original.scenarioHash !== scenarioHash ||
        original.wrapperHash !== wrapperHash ||
        original.screenshotHash !== sha(nativePNG) ||
        original.sceneFileHash !== sha(sceneBytes) ||
        original.viewport.scale !== item.scale ||
        report.generator !== "astro-fyne" ||
        report.direction !== "fyne-to-astro" ||
        report.name !== name ||
        report.sceneHash !== sha(JSON.stringify(scene)) ||
        !report.rootId ||
        report.visualVerified !== false
      )
        throw new Error(
          `${item.name}: inverse scene/provenance/report differs`,
        );
      const imagePaths: Record<string, { src: string; hash: string }> =
        Object.create(null) as Record<string, { src: string; hash: string }>;
      const nodes = new Map<string, (typeof scene.roots)[number]>();
      const collect = (children: typeof scene.roots) => {
        for (const node of children) {
          nodes.set(node.id, node);
          collect(node.children);
        }
      };
      collect(scene.roots);
      for (const asset of scenario.assets) {
        const node = nodes.get(asset.id),
          resource = scene.resources.find(
            (resource) => resource.name === node?.resource,
          );
        if (
          !node ||
          node.kind !== "image" ||
          node.style.x !== asset.x ||
          node.style.y !== asset.y ||
          node.style.width !== 32 ||
          node.style.height !== 32 ||
          !resource ||
          resource.hash !== asset.hash ||
          resource.width !== 16 ||
          resource.height !== 16 ||
          sha(Buffer.from(resource.content, "base64")) !== asset.hash
        )
          throw new Error(
            `${item.name}: inverse image ${asset.id} discarded its original bytes or scaling box`,
          );
        imagePaths[asset.id] = {
          src: "/" + resource.path,
          hash: resource.hash,
        };
      }
      const context = await browser.newContext({
        viewport: { width: 160, height: 80 },
        deviceScaleFactor: item.scale,
        colorScheme: "light",
      });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        const responses = new Map<string, Response[]>();
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("response", (response) => {
          if (response.request().resourceType() === "image") {
            const found = responses.get(response.url()) ?? [];
            found.push(response);
            responses.set(response.url(), found);
          }
        });
        const response = await page.goto(
          new URL(`/image-enlargement-reverse/${item.name}/${name}`, base).href,
        );
        if (!response?.ok())
          throw new Error(`${item.name}: inverse page did not load`);
        await page.locator(`[id=${JSON.stringify(report.rootId)}]`).waitFor();
        const observed = await page.evaluate(
          async ({ assets, imagePaths }) => {
            for (const image of document.images) await image.decode();
            if (document.images.length !== 3)
              throw new Error("Inverse page must retain three real images");
            return assets.map((asset) => {
              const image = document.getElementById(asset.id);
              if (!(image instanceof HTMLImageElement))
                throw new Error(`Missing inverse image ${asset.id}`);
              const box = image.getBoundingClientRect(),
                css = getComputedStyle(image);
              if (
                !image.complete ||
                image.naturalWidth !== 16 ||
                image.naturalHeight !== 16 ||
                image.getAttribute("src") !== imagePaths[asset.id]!.src ||
                image.currentSrc !==
                  new URL(imagePaths[asset.id]!.src, location.href).href ||
                image.srcset ||
                image.hasAttribute("sizes") ||
                box.x !== asset.x ||
                box.y !== asset.y ||
                box.width !== 32 ||
                box.height !== 32 ||
                css.objectFit !== "fill" ||
                css.objectPosition !== "50% 50%" ||
                css.imageRendering !== "auto" ||
                css.transform !== "none" ||
                css.filter !== "none" ||
                css.opacity !== "1" ||
                css.visibility !== "visible"
              )
                throw new Error(
                  `Inverse image ${asset.id} uses different geometry, resource or paint`,
                );
              return {
                id: asset.id,
                currentSrc: image.currentSrc,
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                imageRendering: css.imageRendering,
              };
            });
          },
          { assets: scenario.assets, imagePaths },
        );
        for (const image of observed) {
          const found = responses.get(image.currentSrc);
          if (
            !found ||
            found.length !== 1 ||
            !found[0]!.ok() ||
            found[0]!.request().redirectedFrom() ||
            found[0]!.headers()["content-type"]?.split(";")[0]?.trim() !==
              "image/png" ||
            sha(await found[0]!.body()) !== imagePaths[image.id]!.hash
          )
            throw new Error(
              `${image.id}: inverse resource response differs from native bytes`,
            );
        }
        if (errors.length) throw new Error(errors.join("\n"));
        const png = await page.screenshot({
          fullPage: false,
          animations: "disabled",
          caret: "hide",
          scale: "device",
        });
        if (
          png.readUInt32BE(16) !== 160 * item.scale ||
          png.readUInt32BE(20) !== 80 * item.scale
        )
          throw new Error("Inverse physical PNG dimensions differ");
        await writeFile(join(directory, "inverse-web.png"), png);
        await writeFile(
          join(directory, "inverse-web.json"),
          JSON.stringify(
            {
              schema: 1,
              scenarioHash,
              wrapperHash,
              sceneHash: report.sceneHash,
              case: item.name,
              viewport: scene.viewport,
              originalNativeScreenshotHash: original.screenshotHash,
              screenshotHash: sha(png),
              browserVersion: browser.version(),
              images: observed,
              visualVerified: false,
            },
            null,
            2,
          ) + "\n",
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
