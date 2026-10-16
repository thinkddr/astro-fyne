// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import type { Browser } from "playwright";
import { createHash } from "node:crypto";
import { open, readFile, readlink, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

function fail(message: string): never {
  throw new Error(`Typography browser provenance: ${message}`);
}

export function browserPID(processes: { type: string; id: number }[]): number {
  if (!Array.isArray(processes)) fail("missing CDP process list");
  const matches = processes.filter((entry) => entry?.type === "browser");
  const pid = matches[0]?.id;
  if (matches.length !== 1 || !Number.isSafeInteger(pid) || !pid || pid < 1)
    fail("CDP must identify exactly one browser PID");
  return pid;
}

export function parseKernelArguments(bytes: Uint8Array): string[] {
  if (!bytes.length || bytes[bytes.length - 1] !== 0)
    fail("kernel command line is not NUL terminated");
  const arguments_ = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .slice(0, -1)
    .split("\0");
  if (!arguments_[0] || !isAbsolute(arguments_[0]))
    fail("kernel argv[0] must identify an absolute executable");
  return arguments_;
}

export function elfArchitecture(header: Uint8Array): "x64" | "arm64" {
  if (
    header.length < 20 ||
    header[0] !== 0x7f ||
    header[1] !== 0x45 ||
    header[2] !== 0x4c ||
    header[3] !== 0x46 ||
    header[4] !== 2 ||
    header[5] !== 1
  )
    fail("expected a 64-bit little-endian ELF browser");
  const machine = header[18]! | (header[19]! << 8);
  if (machine === 62) return "x64";
  if (machine === 183) return "arm64";
  return fail(`unsupported ELF machine ${machine}`);
}

export function provenanceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function executable(pid: number) {
  const path = `/proc/${pid}/exe`;
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(20);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length) fail("truncated browser ELF header");
    const digest = createHash("sha256");
    for await (const bytes of handle.createReadStream({
      start: 0,
      autoClose: false,
    }))
      digest.update(bytes);
    return {
      path: await realpath(path),
      procLinkTarget: await readlink(path),
      hash: digest.digest("hex"),
      architecture: elfArchitecture(header),
    };
  } finally {
    await handle.close();
  }
}

export async function collectBrowserProvenance(browser: Browser) {
  if (process.platform !== "linux") fail("this observer requires Linux procfs");
  const session = await browser.newBrowserCDPSession();
  try {
    const version = await session.send("Browser.getVersion");
    const command = await session.send("Browser.getBrowserCommandLine");
    const processes = await session.send("SystemInfo.getProcessInfo");
    const pid = browserPID(processes.processInfo);
    const kernelArguments = parseKernelArguments(
      await readFile(`/proc/${pid}/cmdline`),
    );
    const binary = await executable(pid);
    if ((await realpath(kernelArguments[0]!)) !== binary.path)
      fail("kernel argv[0] and actual process executable differ");
    if (
      !Array.isArray(command.arguments) ||
      !command.arguments.length ||
      command.arguments.some((argument) => typeof argument !== "string")
    )
      fail("missing actual CDP browser command line");
    for (const field of [
      "protocolVersion",
      "product",
      "revision",
      "userAgent",
      "jsVersion",
    ] as const)
      if (typeof version[field] !== "string" || !version[field])
        fail(`missing CDP browser version field ${field}`);
    const observation = {
      schema: 1,
      diagnosticOnly: true,
      pixelPerfectVerified: false,
      observer: "linux-procfs-and-browser-cdp",
      collectorHash: createHash("sha256")
        .update(await readFile(fileURLToPath(import.meta.url)))
        .digest("hex"),
      browserPID: pid,
      executable: binary,
      version,
      commandLine: {
        kernel: kernelArguments,
        cdp: command.arguments,
        orderAndValuesEqual:
          JSON.stringify(kernelArguments) === JSON.stringify(command.arguments),
      },
      fontPolicy: {
        observed: false,
        reason:
          "The collected public CDP methods do not expose effective SkFont/scaler/mask policy",
        rendererPreferences: null,
        typefaceBackend: null,
        scalerContext: null,
        maskFormat: null,
        gamma: null,
        contrast: null,
        pixelGeometry: null,
      },
    };
    return { observation, hash: provenanceHash(observation) };
  } finally {
    await session.detach();
  }
}

export async function verifyBrowserProvenance(
  browser: Browser,
  initial: Awaited<ReturnType<typeof collectBrowserProvenance>>,
) {
  const current = await collectBrowserProvenance(browser);
  if (current.hash !== initial.hash)
    fail("browser executable, command line or identity changed during capture");
  return current;
}
