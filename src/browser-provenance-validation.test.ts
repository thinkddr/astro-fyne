// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { provenanceHash } from "../capture/browser-provenance.ts";
import { validateBrowserProvenance } from "../capture/browser-provenance-validation.ts";
import { compareTypography } from "../capture/compare-typography.ts";
import {
  readTypographyProbe,
  typographyHash,
  type TypographyIdentity,
} from "../capture/typography.ts";

// Synthetic protocol records test evidence rejection, not browser or pixel fidelity.
function fixture(
  identity: TypographyIdentity = {
    sourceHash: "a".repeat(64),
    probeHash: "b".repeat(64),
    fixtureHash: "c".repeat(64),
    fontHash: "d".repeat(64),
  },
) {
  const bindings = {
    identity,
    collectorHash: typographyHash("collector source"),
    captureHash: typographyHash("capture source"),
    viewport: { width: 512, height: 256 },
    scales: [1, 2],
  };
  const observation = {
    schema: 1,
    diagnosticOnly: true,
    pixelPerfectVerified: false,
    observer: "linux-procfs-and-browser-cdp",
    collectorHash: bindings.collectorHash,
    browserPID: 123,
    executable: {
      path: "/opt/chromium/headless_shell",
      procLinkTarget: "/opt/chromium/headless_shell",
      hash: "e".repeat(64),
      architecture: "arm64",
    },
    version: {
      protocolVersion: "1.3",
      product: "HeadlessChrome/153.0.8010.12",
      revision: "revision",
      userAgent: "Chromium diagnostic fixture",
      jsVersion: "15.3",
    },
    commandLine: {
      kernel: [
        "/opt/chromium/headless_shell",
        "--headless",
        "--profile=/tmp/a b",
      ],
      cdp: null as string[] | null,
      cdpUnavailableReason: "enable-automation-not-set" as string | null,
      orderAndValuesEqual: null as boolean | null,
    },
    fontPolicy: {
      observed: false,
      reason: "Effective renderer font policy is not publicly observed",
      rendererPreferences: null,
      typefaceBackend: null,
      scalerContext: null,
      maskFormat: null,
      gamma: null,
      contrast: null,
      pixelGeometry: null,
    },
  };
  const hash = provenanceHash(observation);
  const environment = {
    browserProvenanceHash: hash,
    browserVersion: "153.0.8010.12",
    platform: "linux",
    architecture: "arm64",
  };
  const cases = bindings.scales.map((scale) => ({
    schema: 1,
    diagnosticOnly: true,
    pixelPerfectVerified: false,
    ...identity,
    case: `scale-${scale}`,
    viewport: { ...bindings.viewport, scale },
    environment,
    screenshot: {
      path: `scale-${scale}/web.png`,
      hash: String(scale).repeat(64),
      width: bindings.viewport.width * scale,
      height: bindings.viewport.height * scale,
    },
  }));
  const browser = {
    schema: 1,
    diagnosticOnly: true,
    pixelPerfectVerified: false,
    ...identity,
    environment,
    cases,
  };
  const sidecar = {
    schema: 1,
    diagnosticOnly: true,
    pixelPerfectVerified: false,
    ...identity,
    captureHash: bindings.captureHash,
    provenanceHash: hash,
    observation,
    finalProvenanceHash: hash,
    frames: cases.map((record) => ({
      scale: record.viewport.scale,
      screenshot: structuredClone(record.screenshot),
    })),
  };
  return { bindings, browser, sidecar };
}

function validate(value: ReturnType<typeof fixture>) {
  return validateBrowserProvenance(
    value.sidecar,
    value.browser,
    value.bindings,
  );
}

function reseal(value: ReturnType<typeof fixture>) {
  const hash = provenanceHash(value.sidecar.observation);
  value.sidecar.provenanceHash = value.sidecar.finalProvenanceHash = hash;
  value.browser.environment.browserProvenanceHash = hash;
}

test("retained provenance accepts actual arguments or only the known CDP refusal", () => {
  const unavailable = fixture();
  expect(validate(unavailable).hash).toBe(unavailable.sidecar.provenanceHash);
  unavailable.sidecar.observation.commandLine.kernel.push(
    "--enable-automation",
  );
  reseal(unavailable);
  expect(validate(unavailable).hash).toBe(unavailable.sidecar.provenanceHash);
  const available = fixture(),
    command = available.sidecar.observation.commandLine;
  command.cdp = [...command.kernel];
  command.cdpUnavailableReason = null;
  command.orderAndValuesEqual = true;
  reseal(available);
  expect(validate(available).executable.architecture).toBe("arm64");
  command.cdp.push("--enable-automation");
  command.orderAndValuesEqual = false;
  reseal(available);
  expect(validate(available).browserPID).toBe(123);
});

test("missing sidecar, hashes or bindings cannot be replaced by matching absence", () => {
  const value = fixture();
  expect(() =>
    validateBrowserProvenance(undefined, value.browser, value.bindings),
  ).toThrow("sidecar must be an object");
  for (const field of [
    "provenanceHash",
    "finalProvenanceHash",
    "captureHash",
    "fontHash",
    "observation",
    "frames",
  ]) {
    const missing = fixture();
    Reflect.deleteProperty(missing.sidecar, field);
    expect(() => validate(missing)).toThrow();
  }
  const missingBoth = fixture();
  Reflect.deleteProperty(
    missingBoth.browser.environment,
    "browserProvenanceHash",
  );
  expect(() => validate(missingBoth)).toThrow("aggregate observation binding");
});

test("tampering an executable or argument byte invalidates its observation digest", () => {
  for (const edit of [
    (value: ReturnType<typeof fixture>) => {
      value.sidecar.observation.executable.hash = "f".repeat(64);
    },
    (value: ReturnType<typeof fixture>) => {
      value.sidecar.observation.commandLine.kernel[1] =
        "--font-render-hinting=none";
    },
  ]) {
    const value = fixture();
    edit(value);
    expect(() => validate(value)).toThrow("observation hash differs");
  }
  const changedFinal = fixture();
  changedFinal.sidecar.finalProvenanceHash = "f".repeat(64);
  expect(() => validate(changedFinal)).toThrow("final observation hash");
});

test("a self-consistent older observation cannot replace the current frame binding", () => {
  const previous = fixture();
  previous.sidecar.observation.browserPID += 1;
  reseal(previous);
  const current = fixture();
  expect(() =>
    validateBrowserProvenance(
      previous.sidecar,
      current.browser,
      current.bindings,
    ),
  ).toThrow("aggregate observation binding");
  const changedSource = fixture();
  changedSource.sidecar.fixtureHash = "f".repeat(64);
  expect(() => validate(changedSource)).toThrow("fixtureHash differs");
  const changedFont = fixture();
  changedFont.sidecar.fontHash = "f".repeat(64);
  expect(() => validate(changedFont)).toThrow("fontHash differs");
});

test("rehashed observations still require kernel PID, ELF identity and unobserved policy", () => {
  const edits: ((value: ReturnType<typeof fixture>) => void)[] = [
    (value) => {
      value.sidecar.observation.browserPID = 0;
    },
    (value) => {
      value.sidecar.observation.browserPID = 1.5;
    },
    (value) => {
      Reflect.deleteProperty(value.sidecar.observation.executable, "hash");
    },
    (value) => {
      value.sidecar.observation.executable.architecture = "unknown";
    },
    (value) => {
      value.sidecar.observation.executable.procLinkTarget = "/opt/other";
    },
    (value) => {
      value.sidecar.observation.commandLine.kernel = [];
    },
    (value) => {
      value.sidecar.observation.commandLine.kernel[0] = "headless_shell";
    },
    (value) => {
      value.sidecar.observation.commandLine.cdpUnavailableReason = "timeout";
    },
    (value) => {
      value.sidecar.observation.commandLine.orderAndValuesEqual = false;
    },
    (value) => {
      value.sidecar.observation.fontPolicy.observed = true;
    },
    (value) => {
      Reflect.set(value.sidecar.observation.fontPolicy, "gamma", 1);
    },
    (value) => {
      Reflect.deleteProperty(
        value.sidecar.observation.fontPolicy,
        "maskFormat",
      );
    },
    (value) => {
      value.sidecar.observation.version.product = "HeadlessChrome/152.0";
    },
  ];
  for (const edit of edits) {
    const value = fixture();
    edit(value);
    reseal(value);
    expect(() => validate(value)).toThrow();
  }
});

test("available CDP arguments require a truthful comparison and explicit availability", () => {
  for (const edit of [
    (
      command: ReturnType<
        typeof fixture
      >["sidecar"]["observation"]["commandLine"],
    ) => {
      command.cdpUnavailableReason = "enable-automation-not-set";
    },
    (
      command: ReturnType<
        typeof fixture
      >["sidecar"]["observation"]["commandLine"],
    ) => {
      command.orderAndValuesEqual = false;
    },
    (
      command: ReturnType<
        typeof fixture
      >["sidecar"]["observation"]["commandLine"],
    ) => {
      command.cdp = [];
    },
  ]) {
    const value = fixture(),
      command = value.sidecar.observation.commandLine;
    command.cdp = [...command.kernel];
    command.cdpUnavailableReason = null;
    command.orderAndValuesEqual = true;
    edit(command);
    reseal(value);
    expect(() => validate(value)).toThrow();
  }
});

test("collector and capture hashes must match the current source bytes", () => {
  const collector = fixture();
  collector.sidecar.observation.collectorHash = "f".repeat(64);
  reseal(collector);
  expect(() => validate(collector)).toThrow("collector source hash");
  const capture = fixture();
  capture.sidecar.captureHash = "f".repeat(64);
  expect(() => validate(capture)).toThrow("capture source hash");
});

test("every screenshot and per-frame environment is bound without dropped or duplicate scales", () => {
  const edits: ((value: ReturnType<typeof fixture>) => void)[] = [
    (value) => {
      value.sidecar.frames.pop();
    },
    (value) => {
      value.sidecar.frames[1] = structuredClone(value.sidecar.frames[0]!);
    },
    (value) => {
      value.sidecar.frames[0]!.screenshot.hash = "f".repeat(64);
    },
    (value) => {
      value.sidecar.frames[0]!.screenshot.path = "scale-2/web.png";
    },
    (value) => {
      value.sidecar.frames[0]!.screenshot.width += 1;
    },
    (value) => {
      value.browser.cases[1] = structuredClone(value.browser.cases[0]!);
    },
    (value) => {
      value.browser.cases[0]!.environment = {
        ...value.browser.environment,
        browserProvenanceHash: "f".repeat(64),
      };
    },
    (value) => {
      value.browser.environment.architecture = "x64";
    },
  ];
  for (const edit of edits) {
    const value = fixture();
    edit(value);
    expect(() => validate(value)).toThrow();
  }
});

test("the actual comparator requires provenance before accepting retained native evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astro-fyne-provenance-"));
  try {
    const { identity } = await readTypographyProbe(
      fileURLToPath(new URL("../typography-probe.json", import.meta.url)),
    );
    const value = fixture(identity);
    value.bindings.collectorHash = typographyHash(
      await readFile(
        new URL("../capture/browser-provenance.ts", import.meta.url),
      ),
    );
    value.bindings.captureHash = typographyHash(
      await readFile(
        new URL("../capture/typography-probe.ts", import.meta.url),
      ),
    );
    value.sidecar.observation.collectorHash = value.bindings.collectorHash;
    value.sidecar.captureHash = value.bindings.captureHash;
    reseal(value);
    await writeFile(
      join(directory, "browser-text.json"),
      JSON.stringify(value.browser),
    );
    await expect(compareTypography(directory)).rejects.toThrow(
      "browser-provenance.json",
    );
    value.sidecar.frames[0]!.screenshot.hash = "f".repeat(64);
    await writeFile(
      join(directory, "browser-provenance.json"),
      JSON.stringify(value.sidecar),
    );
    await expect(compareTypography(directory)).rejects.toThrow(
      "sidecar screenshot binding",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
