// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// One schema 2 page per source is resized through the existing native corpus.
// Reference rectangles are only an oracle; they are never emitted into the page.
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  sceneJSONFields,
  sceneJSONRecord,
  validateSceneDocument,
} from "../src/reverse.ts";

if (process.argv.length !== 4)
  throw new Error("Usage: bun capture/responsive-scene.ts BASE_URL ARTIFACTS");
const base = new URL(process.argv[2]!);
if (!["http:", "https:"].includes(base.protocol))
  throw new Error("Preview must use HTTP or HTTPS");
const out = resolve(process.argv[3]!);
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const browser = await chromium.launch();
try {
  for (const preset of ["flex", "bitmap"] as const) {
    const name = preset === "flex" ? "SceneFlex" : "SceneBitmap";
    const directory = join(out, "bidirectional", preset);
    const scene = validateSceneDocument(
      JSON.parse(await readFile(join(directory, "scene.json"), "utf8")),
    );
    if (scene.schema !== 2 || scene.layout !== "flex")
      throw new Error(`${preset}: missing responsive declarations`);
    const sceneHash = hash(JSON.stringify(scene));
    const report = JSON.parse(
      await readFile(join(directory, `${name}.reverse.report.json`), "utf8"),
    );
    const origin = sceneJSONRecord(
      JSON.parse(await readFile(join(directory, "source.json"), "utf8")),
      "origin",
    );
    sceneJSONFields(origin, ["schema", "sourceHash"], "origin");
    if (
      origin.schema !== 1 ||
      typeof origin.sourceHash !== "string" ||
      !/^[a-f\d]{64}$/.test(origin.sourceHash) ||
      report.generator !== "astro-fyne" ||
      report.direction !== "fyne-to-astro" ||
      report.name !== name ||
      report.sceneHash !== sceneHash ||
      report.rootId !== scene.roots[0]!.id
    )
      throw new Error(
        `${preset}: generated scene/report/source identity differs`,
      );
    const ids: string[] = [];
    const collect = (nodes: typeof scene.roots) => {
      for (const node of nodes) {
        ids.push(node.id);
        collect(node.children);
      }
    };
    collect(scene.roots);
    const scenarioBytes = await readFile(
      new URL(`../responsive-${preset}-scenario.json`, import.meta.url),
    );
    const scenarioHash = hash(scenarioBytes);
    const scenario = JSON.parse(scenarioBytes.toString("utf8")) as {
      schema: number;
      cases: { name: string; width: number; height: number; scale: number }[];
      ids: string[];
    };
    if (
      scenario.schema !== 1 ||
      !scenario.cases.length ||
      new Set(scenario.cases.map((item) => item.name)).size !==
        scenario.cases.length ||
      JSON.stringify([...ids].sort()) !==
        JSON.stringify([...scenario.ids].sort())
    )
      throw new Error(`${preset}: source/scenario node inventory differs`);
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    let page: Awaited<ReturnType<typeof browser.newPage>> | undefined;
    let scale = 0;
    const errors: string[] = [];
    try {
      for (const item of scenario.cases) {
        if (
          !/^[A-Za-z\d_-]+$/.test(item.name) ||
          ![1, 2].includes(item.scale) ||
          !Number.isSafeInteger(item.width) ||
          !Number.isSafeInteger(item.height) ||
          item.width <= 0 ||
          item.height <= 0
        )
          throw new Error(`${preset}: invalid viewport case`);
        const caseOut = join(out, `responsive-${preset}`, item.name);
        const frame = JSON.parse(
          await readFile(join(caseOut, "native-geometry.json"), "utf8"),
        ) as {
          schema: number;
          sourceHash: string;
          scenarioHash: string;
          case: string;
          viewport: { width: number; height: number; scale: number };
          screenshotHash: string;
          nodes: Record<
            string,
            {
              parent: string | null;
              x: number;
              y: number;
              width: number;
              height: number;
            }
          >;
        };
        if (
          frame.schema !== 1 ||
          frame.sourceHash !== origin.sourceHash ||
          frame.scenarioHash !== scenarioHash ||
          frame.case !== item.name ||
          JSON.stringify(frame.viewport) !==
            JSON.stringify({
              width: item.width,
              height: item.height,
              scale: item.scale,
            }) ||
          frame.screenshotHash !==
            hash(await readFile(join(caseOut, "native.png"))) ||
          JSON.stringify(Object.keys(frame.nodes).sort()) !==
            JSON.stringify([...ids].sort())
        )
          throw new Error(
            `${preset}/${item.name}: native geometry/PNG belongs to another frame`,
          );
        if (!context || scale !== item.scale) {
          await context?.close();
          context = await browser.newContext({
            viewport: { width: item.width, height: item.height },
            deviceScaleFactor: item.scale,
            colorScheme: "light",
          });
          scale = item.scale;
          page = await context.newPage();
          page.on("pageerror", (error) => errors.push(error.message));
          const response = await page.goto(
            new URL(`/scene-responsive/${preset}/${name}`, base).href,
          );
          if (!response?.ok())
            throw new Error(`${preset}: generated page did not load`);
        } else
          await page!.setViewportSize({
            width: item.width,
            height: item.height,
          });
        await page!.evaluate(async () => {
          await document.fonts.ready;
          for (const image of document.querySelectorAll("img")) {
            await image.decode();
            if (
              !image.complete ||
              image.naturalWidth <= 0 ||
              image.naturalHeight <= 0
            )
              throw new Error("Native bitmap did not decode");
          }
          await new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          );
        });
        const bounds = await page!.evaluate(
          (ids) =>
            ids.map((id) => {
              const node = document.getElementById(id);
              if (!node) throw new Error(`Missing native scene node ${id}`);
              const r = node.getBoundingClientRect();
              return { id, x: r.x, y: r.y, width: r.width, height: r.height };
            }),
          ids,
        );
        const absolute = (
          id: string,
          seen = new Set<string>(),
        ): { x: number; y: number; width: number; height: number } => {
          if (seen.has(id) || !frame.nodes[id])
            throw new Error("Invalid native parent hierarchy");
          seen.add(id);
          const node = frame.nodes[id]!;
          const parent =
            node.parent === null ? { x: 0, y: 0 } : absolute(node.parent, seen);
          return {
            x: parent.x + node.x,
            y: parent.y + node.y,
            width: node.width,
            height: node.height,
          };
        };
        let maximumDelta = 0;
        for (const actual of bounds) {
          const expected = absolute(actual.id);
          for (const key of ["x", "y", "width", "height"] as const) {
            const delta = Math.abs(actual[key] - expected[key]);
            if (!Number.isFinite(delta) || delta > 1 / 64)
              throw new Error(
                `${preset}/${item.name}: ${actual.id}.${key} differs by ${delta}`,
              );
            maximumDelta = Math.max(maximumDelta, delta);
          }
        }
        await page!.screenshot({
          path: join(caseOut, "responsive-scene-web.png"),
          animations: "disabled",
        });
        if (errors.length) throw new Error(errors.join("\n"));
        await writeFile(
          join(caseOut, "responsive-scene-web-geometry.json"),
          JSON.stringify(
            {
              schema: 1,
              sceneHash,
              sourceHash: origin.sourceHash,
              scenarioHash,
              viewport: frame.viewport,
              bounds,
              geometryTolerance: 1 / 64,
              maximumDelta,
              geometryAccepted: true,
            },
            null,
            2,
          ) + "\n",
        );
      }
    } finally {
      await context?.close();
    }
  }
} finally {
  await browser.close();
}
