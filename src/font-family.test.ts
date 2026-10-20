// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FONT_FAMILY_UNICODE_VERSION,
  cssFontFamilyKey,
  simpleFontFamilyKey,
  validFontResourceFamily,
} from "./font-family.ts";

const directory = resolve(import.meta.dir, "../third_party/unicode17");
const pins = {
  "CaseFolding.txt":
    "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183",
  "UnicodeData.txt":
    "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c",
  "LICENSE.txt":
    "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96",
};

async function source(name: keyof typeof pins): Promise<string> {
  const bytes = await readFile(resolve(directory, name));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(pins[name]);
  return bytes.toString("utf8");
}

function categories(text: string): Uint8Array {
  const flags = new Uint8Array(0x110000);
  let pending: { scalar: number; category: string } | undefined;
  for (const line of text.trimEnd().split("\n")) {
    const fields = line.split(";"),
      scalar = Number.parseInt(fields[0]!, 16),
      category = fields[2]!;
    if (fields[1]!.endsWith(", First>")) {
      if (pending) throw new Error("Unclosed Unicode range");
      pending = { scalar, category };
      continue;
    }
    let start = scalar;
    if (fields[1]!.endsWith(", Last>")) {
      if (!pending || pending.category !== category)
        throw new Error("Mismatched Unicode range");
      start = pending.scalar;
      pending = undefined;
    } else if (pending) throw new Error("Missing Unicode range end");
    const flag = category.startsWith("L")
      ? 1
      : category.startsWith("M")
        ? 2
        : category === "Nd"
          ? 4
          : 0;
    flags.fill(flag, start, scalar + 1);
  }
  if (pending) throw new Error("Unclosed Unicode range");
  return flags;
}

test("Unicode17 family aliases preserve letters marks decimal digits and scalar limits", () => {
  expect(FONT_FAMILY_UNICODE_VERSION).toBe("17.0.0");
  for (const family of [
    "Host",
    "Σans",
    "日本語",
    "A\u0301_١-Host",
    "A  B",
    "serif",
    "\u{11db0}",
    "\u{1e6c0}",
    "\u{10400}".repeat(80),
    "A" + "\u0301".repeat(79),
  ])
    expect(validFontResourceFamily(family)).toBe(true);
  for (const family of [
    "",
    " Host",
    "Host ",
    "_Host",
    "-Host",
    "١Host",
    "\u0301Host",
    "Host, serif",
    '"Host"',
    "Host\\Alias",
    "A\tB",
    "A\u00a0B",
    "A\u2028B",
    "A\u200dB",
    "A²",
    "Ⅷ",
    "AⅧ",
    "A\u0000B",
    "A\ufeffB",
    "A\ufffdB",
    "A😀",
    "\u{10400}".repeat(81),
    "A" + "\u0301".repeat(80),
    "\ud800",
    "A\udfffB",
  ])
    expect(validFontResourceFamily(family)).toBe(false);
});

test("simple family keys cover Go folding and all three intrinsic-casing counterexamples", () => {
  for (const [left, right] of [
    ["Host", "HOST"],
    ["Σ", "σ"],
    ["Σ", "ς"],
    ["S", "ſ"],
    ["K", "K"],
    ["µ", "Μ"],
    ["A\u0345", "Aι"],
    ["ß", "ẞ"],
    ["\u0390", "\u1fd3"],
    ["\u03b0", "\u1fe3"],
    ["\ufb05", "\ufb06"],
    ["\u{10400}", "\u{10428}"],
  ])
    expect(simpleFontFamilyKey(left!)).toBe(simpleFontFamilyKey(right!));
  for (const [left, right] of [
    ["I", "ı"],
    ["İ", "i"],
    ["İ", "i\u0307"],
    ["ß", "ss"],
    ["Straße", "STRASSE"],
    ["é", "e\u0301"],
    ["ﬀ", "ff"],
  ])
    expect(simpleFontFamilyKey(left!)).not.toBe(simpleFontFamilyKey(right!));
  expect(simpleFontFamilyKey("Host")).toBe("host");
  expect(simpleFontFamilyKey("ß")).toBe("ß");
});

test("CSS family keys use full default folding without normalization or Turkic tailoring", () => {
  for (const [left, right] of [
    ["Straße", "STRASSE"],
    ["İ", "i\u0307"],
    ["ﬀ", "ff"],
    ["\ufb05", "st"],
    ["\u0390", "ι\u0308\u0301"],
    ["Σ", "ς"],
  ])
    expect(cssFontFamilyKey(left!)).toBe(cssFontFamilyKey(right!));
  for (const [left, right] of [
    ["I", "ı"],
    ["İ", "i"],
    ["é", "e\u0301"],
    ["A  B", "A B"],
  ])
    expect(cssFontFamilyKey(left!)).not.toBe(cssFontFamilyKey(right!));
  expect(cssFontFamilyKey("Straße")).toBe("strasse");
  expect(cssFontFamilyKey("İ")).toBe("i\u0307");
  expect(cssFontFamilyKey("ﬃ".repeat(80))).toBe("ffi".repeat(80));
});

test("font family key APIs reject malformed input without coercion or surrogate repair", () => {
  for (const invalid of [
    null,
    undefined,
    123,
    {},
    ["Host"],
    "",
    "Host ",
    "1Host",
    "A\ud800B",
    "A\udc00B",
    "A".repeat(81),
  ]) {
    expect(validFontResourceFamily(invalid as string)).toBe(false);
    for (const key of [simpleFontFamilyKey, cssFontFamilyKey])
      expect(() => key(invalid as string)).toThrow("Font family requires");
  }
});

test("Unicode17 family grammar matches every normative code point independently", async () => {
  const flags = categories(await source("UnicodeData.txt"));
  let checks = 0;
  for (let scalar = 0; scalar <= 0x10ffff; scalar++) {
    const character = String.fromCodePoint(scalar),
      leading = (flags[scalar]! & 1) !== 0,
      continuation = flags[scalar] !== 0 || [0x20, 0x5f, 0x2d].includes(scalar);
    if (validFontResourceFamily(character + "A") !== leading)
      throw new Error(
        `Leading family category differs at U+${scalar.toString(16)}`,
      );
    if (validFontResourceFamily("A" + character + "A") !== continuation)
      throw new Error(
        `Family continuation differs at U+${scalar.toString(16)}`,
      );
    checks += 2;
  }
  expect(checks).toBe(0x110000 * 2);
}, 120_000);

test("family keys match pinned C S and F data for every admitted scalar independently", async () => {
  const flags = categories(await source("UnicodeData.txt")),
    simple = new Map<number, string>(),
    full = new Map<number, string>();
  for (const line of (await source("CaseFolding.txt")).split("\n")) {
    const fields = line.split("#", 1)[0]!.trim().split(";");
    if (fields.length < 3) continue;
    const scalar = Number.parseInt(fields[0]!, 16),
      status = fields[1]!.trim(),
      mapped = String.fromCodePoint(
        ...fields[2]!
          .trim()
          .split(/\s+/)
          .map((value) => Number.parseInt(value, 16)),
      );
    if (status === "C" || status === "S") simple.set(scalar, mapped);
    if (status === "C" || status === "F") full.set(scalar, mapped);
  }
  expect(simple.size).toBe(1512);
  expect(full.size).toBe(1585);
  let checked = 0;
  for (let scalar = 0; scalar <= 0x10ffff; scalar++) {
    if (flags[scalar] === 0 && ![0x20, 0x5f, 0x2d].includes(scalar)) continue;
    const character = String.fromCodePoint(scalar),
      family = "A" + character + "A";
    if (
      simpleFontFamilyKey(family) !==
      "a" + (simple.get(scalar) ?? character) + "a"
    )
      throw new Error(`Simple family key differs at U+${scalar.toString(16)}`);
    if (
      cssFontFamilyKey(family) !==
      "a" + (full.get(scalar) ?? character) + "a"
    )
      throw new Error(`CSS family key differs at U+${scalar.toString(16)}`);
    checked++;
  }
  expect(checked).toBe(145672 + 2543 + 770 + 3);
}, 120_000);

test("Unicode17 font data retains licensed source pins and exact generated provenance", async () => {
  await source("LICENSE.txt");
  const provenance = JSON.parse(
    await readFile(resolve(directory, "provenance.json"), "utf8"),
  );
  expect(provenance.unicodeVersion).toBe(FONT_FAMILY_UNICODE_VERSION);
  expect(provenance.dataLicense).toBe("Unicode-3.0");
  expect(provenance.policy).toEqual({
    simple: ["C", "S"],
    css: ["C", "F"],
    turkicMappings: false,
    normalization: false,
    categories: ["L", "M", "Nd"],
  });
  for (const row of [
    ...provenance.sources,
    provenance.generator,
    provenance.output,
  ]) {
    const path =
      "url" in row
        ? resolve(directory, row.file)
        : resolve(import.meta.dir, "..", row.file);
    const bytes = await readFile(path);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(row.sha256);
    if ("bytes" in row) expect(bytes.length).toBe(row.bytes);
  }
});
