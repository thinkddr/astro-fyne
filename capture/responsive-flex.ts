// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// CI-only oracle. These rectangles are never supplied to the native runtime.
import { chromium, type Page } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface FlexCase {
  name: string;
  width: number;
  height: number;
  scale: number;
}
interface Scenario {
  schema: 1;
  cases: FlexCase[];
  ids: string[];
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Flex scenario requires objects");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  )
    throw new Error(`Flex scenario requires exactly ${keys.join(", ")}`);
  return record;
}

function scenarioFrom(value: unknown): Scenario {
  const scenario = object(value, ["schema", "cases", "ids"]);
  if (
    scenario.schema !== 1 ||
    !Array.isArray(scenario.cases) ||
    !scenario.cases.length ||
    !Array.isArray(scenario.ids) ||
    !scenario.ids.length
  )
    throw new Error("Flex scenario requires schema 1 and nonempty cases/IDs");
  const cases = scenario.cases.map((value: unknown) => {
    const item = object(value, ["name", "width", "height", "scale"]);
    if (
      typeof item.name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.name) ||
      ![item.width, item.height].every(
        (dimension) =>
          typeof dimension === "number" &&
          Number.isSafeInteger(dimension) &&
          dimension > 0 &&
          dimension <= 16384,
      ) ||
      (item.scale !== 1 && item.scale !== 2)
    )
      throw new Error(
        "Flex case requires a safe name, dimensions and scale 1/2",
      );
    return item as unknown as FlexCase;
  });
  const ids = scenario.ids.map((value: unknown) => {
    if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9-]*$/.test(value))
      throw new Error("Flex IDs must be explicit DOM identifiers");
    return value;
  });
  if (
    new Set(ids).size !== ids.length ||
    new Set(cases.map((item) => item.name)).size !== cases.length ||
    ids[0] !== "responsive-flex"
  )
    throw new Error(
      "Flex IDs/case names must be unique with the declared root",
    );
  return { schema: 1, cases, ids };
}

function argumentsFrom(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !flag ||
      !["--url", "--out", "--source-hash"].includes(flag) ||
      !value ||
      value.startsWith("--") ||
      values.has(flag)
    )
      throw new Error(
        "Usage: responsive-flex.ts --url URL --out DIR --source-hash SHA256",
      );
    values.set(flag, value);
  }
  const url = values.get("--url"),
    out = values.get("--out"),
    sourceHash = values.get("--source-hash");
  if (!url || !out || !sourceHash || !/^[a-f0-9]{64}$/.test(sourceHash))
    throw new Error(
      "URL, output directory and analyzed source SHA-256 are required",
    );
  if (!["http:", "https:"].includes(new URL(url).protocol))
    throw new Error("Flex oracle requires an HTTP/HTTPS page");
  return { url, out: resolve(out), sourceHash };
}

const args = argumentsFrom(process.argv.slice(2));
const scenarioBytes = await readFile(
  new URL("../responsive-flex-scenario.json", import.meta.url),
);
const scenario = scenarioFrom(JSON.parse(scenarioBytes.toString("utf8")));
const scenarioHash = createHash("sha256").update(scenarioBytes).digest("hex");
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
let page: Page | undefined;
let scale = 0;

try {
  for (const item of scenario.cases) {
    if (!page || scale !== item.scale) {
      if (page) await page.context().close();
      scale = item.scale;
      page = await browser.newPage({
        viewport: { width: item.width, height: item.height },
        deviceScaleFactor: item.scale,
      });
      page.on("pageerror", (error) => errors.push(error.message));
      const response = await page.goto(args.url);
      if (!response?.ok())
        throw new Error(`Flex page returned ${response?.status()}`);
      await page.waitForFunction(
        () =>
          document.getElementById("responsive-flex") !== null &&
          document.querySelectorAll("astro-island[ssr]").length === 0,
      );
      await page.evaluate(() => document.fonts.ready);
    } else {
      await page.setViewportSize({ width: item.width, height: item.height });
    }
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    const nodes = await page.evaluate(
      ({ ids, sourceHash, viewport }) => {
        if (
          document.documentElement.dataset.responsiveFlexSourceHash !==
          sourceHash
        )
          throw new Error("Flex page was built from another source revision");
        if (
          innerWidth !== viewport.width ||
          innerHeight !== viewport.height ||
          devicePixelRatio !== viewport.scale ||
          document.documentElement.scrollWidth !== innerWidth ||
          document.documentElement.scrollHeight !== innerHeight
        )
          throw new Error(
            "Flex page viewport/scale/overflow differs from scenario",
          );
        const root = document.getElementById(ids[0]!);
        if (!root) throw new Error("Flex root is absent");
        const elements = [root, ...root.querySelectorAll("*")];
        if (
          elements.length !== ids.length ||
          elements.some((element) => !ids.includes(element.id)) ||
          root.textContent?.trim()
        )
          throw new Error(
            "Flex corpus must contain exactly its empty rectangles",
          );
        return Object.fromEntries(
          ids.map((id) => {
            const matches = document.querySelectorAll(`[id="${id}"]`);
            const element = matches[0];
            if (matches.length !== 1 || !element || element.tagName !== "DIV")
              throw new Error(`Flex ID ${id} must identify one rectangle`);
            const style = getComputedStyle(element);
            if (
              style.transform !== "none" ||
              style.boxShadow !== "none" ||
              style.backgroundImage !== "none" ||
              style.opacity !== "1" ||
              style.borderTopWidth !== "0px" ||
              style.borderRightWidth !== "0px" ||
              style.borderBottomWidth !== "0px" ||
              style.borderLeftWidth !== "0px" ||
              style.borderTopLeftRadius !== "0px" ||
              style.borderTopRightRadius !== "0px" ||
              style.borderBottomLeftRadius !== "0px" ||
              style.borderBottomRightRadius !== "0px"
            )
              throw new Error(`Flex ID ${id} has effects outside this corpus`);
            const bounds = element.getBoundingClientRect();
            const parent = id === ids[0] ? null : element.parentElement;
            if (parent && !ids.includes(parent.id))
              throw new Error(`Flex ID ${id} has an unexpected parent`);
            const origin = parent?.getBoundingClientRect();
            const rect = {
              parent: parent?.id ?? null,
              x: bounds.x - (origin?.x ?? 0),
              y: bounds.y - (origin?.y ?? 0),
              width: bounds.width,
              height: bounds.height,
            };
            if (
              ![rect.x, rect.y, rect.width, rect.height].every(
                Number.isFinite,
              ) ||
              rect.width < 0 ||
              rect.height < 0
            )
              throw new Error(`Flex ID ${id} has invalid geometry`);
            return [id, rect];
          }),
        );
      },
      {
        ids: scenario.ids,
        sourceHash: args.sourceHash,
        viewport: { width: item.width, height: item.height, scale: item.scale },
      },
    );
    if (errors.length) throw new Error(errors.join("\n"));
    const out = resolve(args.out, item.name);
    await mkdir(out, { recursive: true });
    const screenshot = await page.screenshot({
      path: resolve(out, "web.png"),
      scale: "device",
    });
    const capture = {
      schema: 1,
      sourceHash: args.sourceHash,
      scenarioHash,
      case: item.name,
      viewport: { width: item.width, height: item.height, scale: item.scale },
      screenshotHash: createHash("sha256").update(screenshot).digest("hex"),
      nodes,
    };
    await writeFile(
      resolve(out, "geometry.json"),
      JSON.stringify(capture, null, 2) + "\n",
    );
  }
} finally {
  await browser.close();
}
