// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { provenanceHash } from "./browser-provenance.ts";
import type { TypographyIdentity } from "./typography.ts";

type RecordValue = Record<string, any>;

export interface BrowserProvenanceBindings {
  identity: TypographyIdentity;
  collectorHash: string;
  captureHash: string;
  viewport: { width: number; height: number };
  scales: readonly number[];
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Typography browser provenance: ${message}`);
}

function record(value: unknown, label: string): RecordValue {
  requireValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as RecordValue;
}

function same(actual: unknown, expected: unknown, label: string) {
  requireValue(isDeepStrictEqual(actual, expected), `${label} differs`);
}

function text(value: unknown, label: string): asserts value is string {
  requireValue(
    typeof value === "string" && value.length > 0 && !value.includes("\0"),
    `${label} must be a nonempty string without NUL`,
  );
}

function hash(value: unknown, label: string): asserts value is string {
  requireValue(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    `${label} must be a SHA-256 digest`,
  );
}

function identity(value: unknown, expected: TypographyIdentity, label: string) {
  const item = record(value, label);
  requireValue(
    item.schema === 1 &&
      item.diagnosticOnly === true &&
      item.pixelPerfectVerified === false,
    `${label} must remain an uncertified diagnostic`,
  );
  for (const key of [
    "sourceHash",
    "probeHash",
    "fixtureHash",
    "fontHash",
  ] as const) {
    hash(item[key], `${label} ${key}`);
    same(item[key], expected[key], `${label} ${key}`);
  }
  return item;
}

function arguments_(value: unknown, label: string) {
  requireValue(
    Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (argument) => typeof argument === "string" && !argument.includes("\0"),
      ),
    `${label} must preserve actual argument boundaries`,
  );
  requireValue(posix.isAbsolute(value[0]), `${label} argv[0] must be absolute`);
  return value as string[];
}

export function validateBrowserProvenance(
  value: unknown,
  browserValue: unknown,
  expected: BrowserProvenanceBindings,
) {
  hash(expected.collectorHash, "expected collector source hash");
  hash(expected.captureHash, "expected capture source hash");
  const sidecar = identity(value, expected.identity, "sidecar"),
    browser = identity(browserValue, expected.identity, "aggregate capture"),
    observation = record(sidecar.observation, "observation");
  requireValue(
    observation.schema === 1 &&
      observation.diagnosticOnly === true &&
      observation.pixelPerfectVerified === false &&
      observation.observer === "linux-procfs-and-browser-cdp",
    "observation must preserve the Linux procfs/CDP diagnostic contract",
  );
  hash(sidecar.provenanceHash, "observation hash");
  same(provenanceHash(observation), sidecar.provenanceHash, "observation hash");
  same(
    sidecar.finalProvenanceHash,
    sidecar.provenanceHash,
    "final observation hash",
  );
  same(
    observation.collectorHash,
    expected.collectorHash,
    "collector source hash",
  );
  same(sidecar.captureHash, expected.captureHash, "capture source hash");
  requireValue(
    Number.isSafeInteger(observation.browserPID) && observation.browserPID > 0,
    "browser PID must be a positive safe integer",
  );
  const executable = record(observation.executable, "executable");
  for (const field of ["path", "procLinkTarget"] as const) {
    text(executable[field], `executable ${field}`);
    requireValue(
      posix.isAbsolute(executable[field]),
      `executable ${field} must be absolute`,
    );
  }
  same(
    executable.procLinkTarget,
    executable.path,
    "resolved process executable",
  );
  hash(executable.hash, "executable hash");
  requireValue(
    executable.architecture === "x64" || executable.architecture === "arm64",
    "executable architecture must come from a supported ELF machine",
  );
  const command = record(observation.commandLine, "command line"),
    kernel = arguments_(command.kernel, "kernel command line");
  if (command.cdp === null) {
    same(
      command.cdpUnavailableReason,
      "enable-automation-not-set",
      "CDP refusal reason",
    );
    same(
      command.orderAndValuesEqual,
      null,
      "unavailable CDP argument comparison",
    );
  } else {
    const cdp = arguments_(command.cdp, "CDP command line");
    same(command.cdpUnavailableReason, null, "available CDP refusal reason");
    same(
      command.orderAndValuesEqual,
      JSON.stringify(kernel) === JSON.stringify(cdp),
      "kernel/CDP argument comparison",
    );
  }
  const version = record(observation.version, "CDP version");
  for (const field of [
    "protocolVersion",
    "product",
    "revision",
    "userAgent",
    "jsVersion",
  ])
    text(version[field], `CDP version ${field}`);
  const policy = record(observation.fontPolicy, "font policy");
  requireValue(policy.observed === false, "font policy must remain unobserved");
  text(policy.reason, "unobserved font policy reason");
  for (const field of [
    "rendererPreferences",
    "typefaceBackend",
    "scalerContext",
    "maskFormat",
    "gamma",
    "contrast",
    "pixelGeometry",
  ])
    same(policy[field], null, `unobserved font policy ${field}`);
  const environment = record(browser.environment, "aggregate environment");
  same(
    environment.browserProvenanceHash,
    sidecar.provenanceHash,
    "aggregate observation binding",
  );
  same(environment.platform, "linux", "observer platform");
  same(
    environment.architecture,
    executable.architecture,
    "observer/ELF architecture",
  );
  requireValue(
    typeof environment.browserVersion === "string" &&
      version.product.endsWith(`/${environment.browserVersion}`),
    "CDP product and captured browser version differ",
  );
  requireValue(
    Array.isArray(sidecar.frames) &&
      sidecar.frames.length === expected.scales.length &&
      Array.isArray(browser.cases) &&
      browser.cases.length === expected.scales.length,
    "sidecar and aggregate must retain every declared scale",
  );
  const seen = new Set<number>();
  for (const value of sidecar.frames) {
    const frame = record(value, "sidecar frame"),
      scale = frame.scale;
    requireValue(
      expected.scales.includes(scale) && !seen.has(scale),
      "unknown or duplicated sidecar scale",
    );
    seen.add(scale);
    const matches = browser.cases.filter(
      (item: unknown) =>
        record(item, "aggregate frame").viewport?.scale === scale,
    );
    requireValue(
      matches.length === 1,
      "aggregate must identify exactly one frame per scale",
    );
    const captured = identity(
        matches[0],
        expected.identity,
        `scale-${scale} capture`,
      ),
      screenshot = record(frame.screenshot, `scale-${scale} screenshot`);
    same(captured.case, `scale-${scale}`, "captured frame ID");
    same(
      captured.viewport,
      { ...expected.viewport, scale },
      "captured frame viewport",
    );
    same(captured.environment, environment, "per-frame environment binding");
    same(screenshot.path, `scale-${scale}/web.png`, "screenshot artifact path");
    hash(screenshot.hash, "screenshot hash");
    same(screenshot.width, expected.viewport.width * scale, "screenshot width");
    same(
      screenshot.height,
      expected.viewport.height * scale,
      "screenshot height",
    );
    same(captured.screenshot, screenshot, "sidecar screenshot binding");
  }
  return {
    hash: sidecar.provenanceHash as string,
    collectorHash: observation.collectorHash as string,
    captureHash: sidecar.captureHash as string,
    browserPID: observation.browserPID as number,
    executable: {
      path: executable.path as string,
      hash: executable.hash as string,
      architecture: executable.architecture as "x64" | "arm64",
    },
  };
}
