// SPDX-License-Identifier: Apache-2.0
// Compare generated web pages against actual native frames, without feeding
// browser measurements back into the responsive native layout.
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateSceneDocument } from "../src/reverse.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i];
  const value = process.argv[i + 1];
  if (
    !flag ||
    !["--base-url", "--out", "--preset"].includes(flag) ||
    !value ||
    value.startsWith("--") ||
    args.has(flag)
  )
    throw new Error(`Invalid argument: ${flag}`);
  args.set(flag, value);
}
if (!args.has("--base-url") || !args.has("--out"))
  throw new Error("Required: --base-url URL --out DIRECTORY");
const baseURL = new URL(args.get("--base-url")!);
if (!["http:", "https:"].includes(baseURL.protocol))
  throw new Error("The preview must use HTTP or HTTPS");
const out = resolve(args.get("--out")!);
const presets = {
  flex: {
    scenario: "responsive-flex-scenario.json",
    route: "flex-reverse",
    name: "FlexReverse",
  },
  bitmap: {
    scenario: "responsive-bitmap-scenario.json",
    route: "bitmap-reverse",
    name: "BitmapReverse",
  },
} as const;
const requestedPreset = args.get("--preset") ?? "flex";
if (requestedPreset !== "flex" && requestedPreset !== "bitmap")
  throw new Error("--preset must be flex or bitmap");
const preset = presets[requestedPreset];
const scenarioBytes = await readFile(
  new URL(`../${preset.scenario}`, import.meta.url),
);
const scenarioHash = createHash("sha256").update(scenarioBytes).digest("hex");
const scenario = JSON.parse(scenarioBytes.toString("utf8")) as {
  schema: number;
  cases: { name: string; width: number; height: number; scale: number }[];
};
if (scenario.schema !== 1 || !scenario.cases?.length)
  throw new Error(`Missing responsive ${requestedPreset} cases`);
const browser = await chromium.launch();
try {
  for (const item of scenario.cases) {
    if (!/^[a-zA-Z0-9_-]+$/.test(item.name))
      throw new Error("Unsafe scenario name");
    const directory = join(out, item.name);
    const nativeFrame = JSON.parse(
      await readFile(join(directory, "native-geometry.json"), "utf8"),
    ) as {
      schema: number;
      sourceHash: string;
      scenarioHash: string;
      case: string;
      viewport: { width: number; height: number; scale: number };
      screenshotHash: string;
    };
    const nativePngHash = createHash("sha256")
      .update(await readFile(join(directory, "native.png")))
      .digest("hex");
    if (
      nativeFrame.schema !== 1 ||
      typeof nativeFrame.sourceHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(nativeFrame.sourceHash) ||
      nativeFrame.scenarioHash !== scenarioHash ||
      nativeFrame.case !== item.name ||
      nativeFrame.viewport?.width !== item.width ||
      nativeFrame.viewport?.height !== item.height ||
      nativeFrame.viewport?.scale !== item.scale ||
      nativeFrame.screenshotHash !== nativePngHash
    )
      throw new Error(
        `${item.name}: native source/scenario/PNG frame mismatch`,
      );
    const scene = validateSceneDocument(
      JSON.parse(await readFile(join(directory, "scene.json"), "utf8")),
    );
    if (
      scene.viewport.width !== item.width ||
      scene.viewport.height !== item.height ||
      scene.viewport.scale !== item.scale
    )
      throw new Error(`${item.name}: native scene viewport mismatch`);
    const report = JSON.parse(
      await readFile(
        join(directory, `${preset.name}.reverse.report.json`),
        "utf8",
      ),
    ) as {
      rootId: string;
      generator: string;
      schema: number;
      direction: string;
      sceneHash: string;
      name: string;
    };
    const sceneHash = createHash("sha256")
      .update(JSON.stringify(scene))
      .digest("hex");
    if (
      report.generator !== "astro-fyne" ||
      report.schema !== 1 ||
      report.direction !== "fyne-to-astro" ||
      report.name !== preset.name ||
      report.sceneHash !== sceneHash ||
      typeof report.rootId !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(report.rootId)
    )
      throw new Error(
        `${item.name}: inverse report does not match native scene`,
      );
    const context = await browser.newContext({
      viewport: { width: item.width, height: item.height },
      deviceScaleFactor: item.scale,
      colorScheme: "light",
    });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const response = await page.goto(
        new URL(`/${preset.route}/${item.name}/${preset.name}`, baseURL).href,
      );
      if (!response?.ok()) throw new Error(`${item.name}: preview failed`);
      await page.locator(`[id="${report.rootId}"]`).waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (const image of document.querySelectorAll("img")) {
          const bounds = image.getBoundingClientRect();
          const css = getComputedStyle(image);
          if (
            bounds.width <= 0 ||
            bounds.height <= 0 ||
            css.visibility !== "visible" ||
            css.display === "none"
          )
            continue;
          // A loading or broken image must fail before a screenshot can be
          // interpreted as native bitmap parity, including cached resources.
          await image.decode();
          if (
            !image.complete ||
            image.naturalWidth <= 0 ||
            image.naturalHeight <= 0
          )
            throw new Error("A visible inverse bitmap did not decode");
        }
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      });
      const bounds = await page.evaluate((rootID) => {
        const root = document.getElementById(rootID);
        if (!root) throw new Error("Generated root is absent");
        return Array.from(root.querySelectorAll<HTMLElement>(".af-node")).map(
          (node) => {
            const rectangle = node.getBoundingClientRect();
            return {
              id: node.id,
              x: rectangle.x,
              y: rectangle.y,
              width: rectangle.width,
              height: rectangle.height,
            };
          },
        );
      }, report.rootId);
      const expected: typeof bounds = [];
      function flatten(
        nodes: typeof scene.roots,
        parentX: number,
        parentY: number,
      ) {
        for (const node of nodes) {
          const x = parentX + node.style.x;
          const y = parentY + node.style.y;
          expected.push({
            id: node.id,
            x,
            y,
            width: node.style.width,
            height: node.style.height,
          });
          flatten(node.children, x, y);
        }
      }
      flatten(scene.roots, 0, 0);
      if (bounds.length !== expected.length)
        throw new Error(`${item.name}: inverse node count differs`);
      let maximumDelta = 0;
      const actual = new Map(bounds.map((node) => [node.id, node]));
      if (actual.size !== bounds.length)
        throw new Error(`${item.name}: duplicate inverse IDs`);
      for (const node of expected) {
        const rendered = actual.get(node.id);
        if (!rendered) throw new Error(`${item.name}: missing ${node.id}`);
        for (const field of ["x", "y", "width", "height"] as const) {
          const delta = Math.abs(rendered[field] - node[field]);
          if (!Number.isFinite(delta) || delta > 1 / 64)
            throw new Error(
              `${item.name}: ${node.id}.${field} differs by ${delta}`,
            );
          maximumDelta = Math.max(maximumDelta, delta);
        }
      }
      await page.screenshot({
        path: join(directory, "reverse-web.png"),
        animations: "disabled",
      });
      if (errors.length) throw new Error(errors.join("\n"));
      await writeFile(
        join(directory, "reverse-web-geometry.json"),
        JSON.stringify(
          {
            preset: requestedPreset,
            sourceHash: nativeFrame.sourceHash,
            scenarioHash,
            viewport: scene.viewport,
            sceneHash,
            bounds,
            geometryTolerance: 1 / 64,
            maximumDelta,
            geometryAccepted: true,
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
