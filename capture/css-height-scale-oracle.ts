// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  collectBrowserProvenance,
  verifyBrowserProvenance,
} from "./browser-provenance.ts";
import {
  observeCSSHeightCases,
  type HeightProbeContext,
  type ProbeCase,
} from "./css-height-quantization.ts";

const chromiumSourceCommit = "971a7443b0c9b0a9b2860529b33331b76077ec62";
const times = [0, 250, 480, 499.9999, 500, 500.0001, 520, 750, 1000];
const cases: ProbeCase[] = [
  ...["20.499998", "20.4999999", "20.5", "20.5000001", "20.500002"].map(
    (height, index) => ({
      id: `static-half-pixel-${index}`,
      height,
      times: [0],
    }),
  ),
  ...["20.0156249", "20.015625", "20.0156251"].map((height, index) => ({
    id: `static-sixty-fourth-${index}`,
    height,
    times: [0],
  })),
  ...["20.0078124", "20.0078125", "20.0078126"].map((height, index) => ({
    id: `static-one-hundred-twenty-eighth-${index}`,
    height,
    times: [0],
  })),
  ...["0.000001", "0.0078125", "0.015624", "0.015625"].map((height, index) => ({
    id: `static-small-positive-${index}`,
    height,
    times: [0],
  })),
  {
    id: "linear-half-pixel-crossing",
    height: "20.49",
    animation: { from: "20.49", to: "20.51", easing: "linear" },
    times,
  },
  {
    id: "linear-decimal-endpoints",
    height: "20.01",
    animation: { from: "20.01", to: "20.02", easing: "linear" },
    times: [0, 250, 500, 750, 1000],
  },
  {
    id: "bezier-half-pixel-crossing",
    height: "20.49",
    animation: {
      from: "20.49",
      to: "20.51",
      easing: "cubic-bezier(.42,0,.58,1)",
    },
    times,
  },
  {
    id: "bezier-asymmetric-half-pixel-crossing",
    height: "20.49",
    animation: {
      from: "20.49",
      to: "20.51",
      easing: "cubic-bezier(.25,.1,.25,1)",
    },
    times: [0, 250, 333, 499.9999, 500, 500.0001, 750, 1000],
  },
  {
    id: "bezier-wide-range",
    height: "20",
    animation: { from: "20", to: "100", easing: "ease" },
    times: [0, 250, 333, 499.9999, 500, 500.0001, 750, 1000],
  },
  {
    id: "linear-small-positive-crossing",
    height: "0.000001",
    animation: { from: "0.000001", to: "0.03125", easing: "linear" },
    times,
  },
];

const contexts: HeightProbeContext[] = [
  {
    id: "native-baseline",
    options: {
      viewport: null,
      colorScheme: "light",
      reducedMotion: "no-preference",
    },
  },
  ...[1, 2].map((deviceScaleFactor) => ({
    id: `dpr${deviceScaleFactor}`,
    options: {
      viewport: { width: 320, height: 240 },
      deviceScaleFactor,
      colorScheme: "light" as const,
      reducedMotion: "no-preference" as const,
    },
  })),
];

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function json(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

/** Separate process scale from the emulated scale exposed to a page. */
export async function captureCSSHeightScaleOracle(out: string): Promise<void> {
  const directory = join(out, "css-height-scale-oracle");
  await mkdir(directory, { recursive: true });
  const profiles = [
    { id: "default-process", launch: { headless: true } },
    {
      id: "forced-process-dsf2",
      launch: { headless: true, args: ["--force-device-scale-factor=2"] },
    },
  ];
  const processes = [];
  let executable: { hash: string; architecture: string } | undefined;
  for (const profile of profiles) {
    const processDirectory = join(directory, profile.id);
    await mkdir(processDirectory, { recursive: true });
    await json(join(processDirectory, "launch.json"), profile.launch);
    const browser = await chromium.launch(profile.launch);
    try {
      const before = await collectBrowserProvenance(browser);
      await json(
        join(processDirectory, "browser-provenance.before.json"),
        before,
      );
      assert.equal(
        before.observation.version.revision.replace(/^@/, ""),
        chromiumSourceCommit,
        "Scale oracle requires the pinned Chromium revision",
      );
      const scaleArguments = before.observation.commandLine.kernel.filter(
        (argument) => argument.startsWith("--force-device-scale-factor="),
      );
      assert.deepEqual(scaleArguments, profile.launch.args ?? []);
      const currentExecutable = {
        hash: before.observation.executable.hash,
        architecture: before.observation.executable.architecture,
      };
      if (executable) assert.deepEqual(currentExecutable, executable);
      else executable = currentExecutable;

      const { sources, observations } = await observeCSSHeightCases(
        browser,
        processDirectory,
        cases,
        contexts,
      );
      await json(join(processDirectory, "observations.json"), {
        schema: 1,
        kind: "astro-fyne-css-height-process-scale-observations",
        diagnostic: true,
        process: profile.id,
        launch: profile.launch,
        contexts,
        sources,
        observations,
      });
      const after = await verifyBrowserProvenance(browser, before);
      await json(
        join(processDirectory, "browser-provenance.after.json"),
        after,
      );
      processes.push({
        id: profile.id,
        launch: profile.launch,
        contexts,
        observations: `${profile.id}/observations.json`,
        observationSha256: hash(
          await readFile(join(processDirectory, "observations.json")),
        ),
        browserProvenanceBefore: {
          file: `${profile.id}/browser-provenance.before.json`,
          sha256: hash(
            await readFile(
              join(processDirectory, "browser-provenance.before.json"),
            ),
          ),
          observationHash: before.hash,
        },
        browserProvenanceAfter: {
          file: `${profile.id}/browser-provenance.after.json`,
          sha256: hash(
            await readFile(
              join(processDirectory, "browser-provenance.after.json"),
            ),
          ),
          observationHash: after.hash,
        },
        sourceCaseCount: sources.length,
        observationCount: observations.length,
        sampleCount: observations.reduce(
          (sum, item) => sum + item.samples.length,
          0,
        ),
      });
    } finally {
      await browser.close();
    }
  }
  await json(join(directory, "observations.json"), {
    schema: 1,
    kind: "astro-fyne-css-height-scale-oracle",
    diagnostic: true,
    verified: false,
    pixelPerfectVerified: false,
    universalCSSVerified: false,
    quantizerSelected: false,
    internalLayoutZoomObserved: false,
    chromiumSourceCommit,
    probeSources: await Promise.all(
      ["css-height-scale-oracle.ts", "css-height-quantization.ts"].map(
        async (file) => {
          const bytes = await readFile(new URL(file, import.meta.url));
          return {
            file: `capture/${file}`,
            bytes: bytes.byteLength,
            sha256: hash(bytes),
          };
        },
      ),
    ),
    processes,
    limitations: [
      "The baseline disables Playwright viewport emulation; supplied process flags and public page measurements are retained separately.",
      "Requested deviceScaleFactor, observed devicePixelRatio and internal layout zoom are different quantities. Internal LayoutZoomFactor is not exposed by this observer.",
      "Positive authored heights below a layout unit may resolve to zero. These browser-only observations do not add presence-aware native zero sizing or certify converter admission.",
      "Full geometry, animation timing and screenshots are measurements, without a native comparison, a guessed quantizer or a paint snapping rule.",
    ],
  });
}
