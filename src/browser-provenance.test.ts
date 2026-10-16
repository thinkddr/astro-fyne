// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
import {
  browserPID,
  elfArchitecture,
  parseKernelArguments,
  provenanceHash,
} from "../capture/browser-provenance.ts";

test("browser PID is unambiguous and integral", () => {
  expect(
    browserPID([
      { type: "renderer", id: 9 },
      { type: "browser", id: 42 },
    ]),
  ).toBe(42);
  for (const list of [
    [],
    [{ type: "browser", id: 0 }],
    [{ type: "browser", id: 1.5 }],
    [
      { type: "browser", id: 1 },
      { type: "browser", id: 2 },
    ],
  ])
    expect(() => browserPID(list)).toThrow();
});

test("kernel command line retains argument boundaries without shell parsing", () => {
  const encode = (value: string) => new TextEncoder().encode(value);
  expect(
    parseKernelArguments(
      encode("/tmp/chrome\0--user-data-dir=/tmp/a b\0about:blank\0"),
    ),
  ).toEqual(["/tmp/chrome", "--user-data-dir=/tmp/a b", "about:blank"]);
  expect(() => parseKernelArguments(encode("/tmp/chrome\0arg"))).toThrow();
  expect(() => parseKernelArguments(encode("chrome\0"))).toThrow();
  expect(() => parseKernelArguments(Uint8Array.from([0xff, 0]))).toThrow();
});

test("architecture comes from ELF bytes rather than frozen user agent", () => {
  const header = new Uint8Array(20);
  header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  header[18] = 183;
  expect(elfArchitecture(header)).toBe("arm64");
  header[18] = 62;
  expect(elfArchitecture(header)).toBe("x64");
  header[5] = 2;
  expect(() => elfArchitecture(header)).toThrow();
  expect(() => elfArchitecture(new Uint8Array(19))).toThrow();
});

test("binary and generated-argument changes alter provenance identity", () => {
  const before = {
    binary: "a".repeat(64),
    arguments: ["/tmp/browser", "--headless"],
  };
  expect(provenanceHash(before)).toBe(provenanceHash({ ...before }));
  expect(provenanceHash({ ...before, binary: "b".repeat(64) })).not.toBe(
    provenanceHash(before),
  );
  expect(
    provenanceHash({
      ...before,
      arguments: [...before.arguments, "--font-render-hinting=none"],
    }),
  ).not.toBe(provenanceHash(before));
});
