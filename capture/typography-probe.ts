// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { chromium } from "playwright";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectTypography,
  readTypographyProbe,
  typographyHash,
} from "./typography.ts";

function argumentsFrom(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index],
      value = argv[index + 1];
    if (
      !flag ||
      !["--url", "--out"].includes(flag) ||
      !value ||
      value.startsWith("--") ||
      values.has(flag)
    )
      throw new Error("Usage: typography-probe.ts --url URL --out DIR");
    values.set(flag, value);
  }
  const url = values.get("--url"),
    out = values.get("--out");
  if (!url || !out || !["http:", "https:"].includes(new URL(url).protocol))
    throw new Error(
      "Typography capture requires an HTTP(S) fixture and output directory",
    );
  return { url, out: resolve(out) };
}

const args = argumentsFrom(process.argv.slice(2));
const { probe, identity, font } = await readTypographyProbe(
  fileURLToPath(new URL("../typography-probe.json", import.meta.url)),
);
const require = createRequire(import.meta.url);
const playwrightVersion = (
  JSON.parse(
    await readFile(require.resolve("playwright/package.json"), "utf8"),
  ) as { version: string }
).version;
const browser = await chromium.launch({ headless: true });
try {
  const environment = {
    browserVersion: browser.version(),
    playwrightVersion,
    platform: process.platform,
    architecture: process.arch,
    headless: true,
    requestedLaunchArgs: [],
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    runnerImage: process.env.ImageVersion ?? null,
  };
  const cases = [];
  for (const scale of probe.scales) {
    const context = await browser.newContext({
      viewport: probe.viewport,
      deviceScaleFactor: scale,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage(),
        errors: string[] = [],
        servedFonts: Promise<Uint8Array>[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const fontURL = new URL(probe.font.webSrc, args.url).href;
      page.on("response", (response) => {
        if (response.url() !== fontURL) return;
        if (!response.ok())
          errors.push(`Typography font response returned ${response.status()}`);
        servedFonts.push(response.body());
      });
      const response = await page.goto(args.url);
      if (!response?.ok())
        throw new Error(`Typography fixture returned ${response?.status()}`);
      await page.evaluate(async (probe) => {
        for (const sample of probe.samples) {
          const descriptor = `${probe.font.style} ${probe.font.weight} ${sample.fontSize ?? probe.font.size}px "${probe.font.family}"`;
          const loaded = await document.fonts.load(descriptor, sample.text);
          if (
            loaded.length !== 1 ||
            loaded[0]!.status !== "loaded" ||
            !document.fonts.check(descriptor, sample.text)
          )
            throw new Error(`Typography font did not load for ${sample.id}`);
        }
        await document.fonts.ready;
      }, probe);
      if (!servedFonts.length)
        throw new Error(
          "Chromium did not request the declared typography font",
        );
      for (const bytes of await Promise.all(servedFonts))
        if (typographyHash(bytes) !== identity.fontHash)
          throw new Error(
            "Font bytes served to Chromium differ from the shared probe font",
          );
      const evidence = await collectTypography(page, probe, identity, scale);
      if (errors.length) throw new Error(errors.join("\n"));
      const directory = resolve(args.out, `scale-${scale}`);
      await mkdir(directory, { recursive: true });
      const png = await page.screenshot({
        path: resolve(directory, "web.png"),
        animations: "disabled",
        caret: "initial",
        scale: "device",
      });
      if (errors.length) throw new Error(errors.join("\n"));
      const width = png.readUInt32BE(16),
        height = png.readUInt32BE(20);
      if (
        width !== probe.viewport.width * scale ||
        height !== probe.viewport.height * scale
      )
        throw new Error(
          "Typography screenshot dimensions do not match the declared device scale",
        );
      const record = {
        ...evidence,
        environment,
        font: {
          family: font.family,
          weight: font.weight,
          style: font.style,
          hash: font.hash,
          servedHash: font.hash,
          webSrc: font.webSrc,
        },
        screenshot: {
          path: `scale-${scale}/web.png`,
          hash: typographyHash(png),
          width,
          height,
        },
      };
      await writeFile(
        resolve(directory, "web-text.json"),
        JSON.stringify(record, null, 2) + "\n",
      );
      cases.push(record);
    } finally {
      await context.close();
    }
  }
  await writeFile(
    resolve(args.out, "browser-text.json"),
    JSON.stringify(
      {
        schema: 1,
        diagnosticOnly: true,
        pixelPerfectVerified: false,
        ...identity,
        environment,
        cases,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
