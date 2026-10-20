// SPDX-License-Identifier: Apache-2.0
import {
  cssFontFamilyKey,
  cssFontFamilyTextKey,
  simpleFontFamilyKey,
  simpleFontFamilyTextKey,
  validFontResourceFamily,
} from "./font-family.ts";

export interface CSSFontFaceRequest {
  family: string;
  weight: number;
  style: string;
  hash: string;
}

export interface ParsedCSSFontFamily {
  family: string;
  /** An unquoted generic or CSS-wide keyword, rather than a named alias. */
  generic: boolean;
  quoted: boolean;
}

const cssWhitespace = /[\t\n\f\r ]/,
  cssOuterWhitespace = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g,
  cssWideKeywords = new Set([
    "inherit",
    "initial",
    "unset",
    "revert",
    "revert-layer",
    "revert-rule",
  ]),
  keywords = new Set([
    "serif",
    "sans-serif",
    "cursive",
    "fantasy",
    "monospace",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "emoji",
    "math",
    "fangsong",
    ...cssWideKeywords,
  ]);

function asciiKey(value: string): string {
  return value.replace(/[A-Z]/g, (letter) =>
    String.fromCharCode(letter.charCodeAt(0) + 32),
  );
}

function fail(message: string): never {
  throw new Error("CSS font family: " + message);
}

function checkedFamily(family: string): string {
  if (!validFontResourceFamily(family))
    fail("require a valid Unicode17 resource alias within 80 scalars.");
  return family;
}

interface ScannedCSSFontFamily extends ParsedCSSFontFamily {
  escaped: boolean;
  keyword?: string;
}

/** Parse one family; lists, comments and functions need an adapter. */
export function parseCSSFontFamily(raw: string): ParsedCSSFontFamily {
  const { family, generic, quoted } = parseFamily(raw, false);
  return { family, generic, quoted };
}

function parseFamily(raw: string, matching: boolean): ScannedCSSFontFamily {
  if (typeof raw !== "string") fail("require a string.");
  const source = [...raw];
  if (source.some((item) => /^[\ud800-\udfff]$/.test(item)))
    fail("require well-formed Unicode text.");
  let index = 0,
    escaped = false;
  const space = (item: string | undefined) =>
      item !== undefined && cssWhitespace.test(item),
    newline = (item: string | undefined) =>
      item === "\n" || item === "\r" || item === "\f",
    start = (item: string | undefined) =>
      item !== undefined &&
      (/^[A-Za-z_]$/.test(item) || item.codePointAt(0)! >= 0x80),
    skipSpace = () => {
      while (space(source[index])) index++;
    },
    escape = (quoted: boolean) => {
      escaped = true;
      const first = source[++index];
      if (first === undefined) fail("require a complete CSS escape.");
      if (newline(first)) {
        if (!quoted) fail("an identifier cannot escape a newline.");
        index++;
        if (first === "\r" && source[index] === "\n") index++;
        return "";
      }
      if (/^[0-9A-Fa-f]$/.test(first)) {
        let hex = "";
        while (hex.length < 6 && /^[0-9A-Fa-f]$/.test(source[index] ?? ""))
          hex += source[index++];
        if (space(source[index])) {
          const last = source[index++];
          if (last === "\r" && source[index] === "\n") index++;
        }
        const scalar = Number.parseInt(hex, 16);
        return String.fromCodePoint(
          scalar === 0 ||
            scalar > 0x10ffff ||
            (scalar >= 0xd800 && scalar <= 0xdfff)
            ? 0xfffd
            : scalar,
        );
      }
      index++;
      return first;
    };
  const decoded = (family: string) => {
    if (!matching) return checkedFamily(family);
    cssFontFamilyTextKey(family);
    return family;
  };
  skipSpace();
  const quote = source[index];
  if (quote === '"' || quote === "'") {
    index++;
    let family = "";
    while (index < source.length && source[index] !== quote) {
      if (newline(source[index]))
        fail("a quoted family cannot contain a newline.");
      family += source[index] === "\\" ? escape(true) : source[index++]!;
    }
    if (source[index++] !== quote) fail("require one complete quoted family.");
    skipSpace();
    if (index !== source.length) fail("require one complete quoted family.");
    return { family: decoded(family), generic: false, quoted: true, escaped };
  }
  const identifiers: string[] = [];
  while (index < source.length) {
    const first = source[index];
    if (
      !start(first) &&
      first !== "\\" &&
      !(
        first === "-" &&
        (start(source[index + 1]) ||
          source[index + 1] === "-" ||
          source[index + 1] === "\\")
      )
    )
      fail("require a quoted family or CSS identifiers.");
    let identifier = "";
    while (index < source.length) {
      const item = source[index]!;
      if (item === "\\") identifier += escape(false);
      else if (start(item) || /^[0-9-]$/.test(item)) {
        identifier += item;
        index++;
      } else break;
    }
    identifiers.push(identifier);
    if (index < source.length && !space(source[index]))
      fail("lists, comments and functions need an adapter.");
    skipSpace();
  }
  const family = decoded(identifiers.join(" "));
  const reserved = identifiers.map(asciiKey);
  if (reserved.includes("default"))
    fail("the reserved default identifier must be quoted.");
  const generic = reserved.some((identifier) => keywords.has(identifier));
  if (generic && identifiers.length !== 1)
    fail("generic and CSS-wide keywords cannot form a named family.");
  return {
    family,
    generic,
    quoted: false,
    escaped,
    keyword: generic ? reserved[0] : undefined,
  };
}

/** Validate a shared CSS namespace, allowing identical faces in separate apps. */
export function validateCSSFontNamespace(
  faces: readonly CSSFontFaceRequest[],
): void {
  if (!Array.isArray(faces)) fail("require a face array.");
  const snapshot = faces.slice().map((face) => {
      if (face === null || typeof face !== "object")
        fail("require face descriptors.");
      return {
        family: face.family,
        weight: face.weight,
        style: face.style,
        hash: face.hash,
      };
    }),
    namespace = new Map<
      string,
      { family: string; simple: string; slots: Map<string, string> }
    >();
  for (const face of snapshot) {
    checkedFamily(face.family);
    if (
      (face.weight !== 400 && face.weight !== 700) ||
      (face.style !== "normal" && face.style !== "italic") ||
      typeof face.hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(face.hash)
    )
      fail(
        "require weight 400/700, style normal/italic and lowercase SHA-256.",
      );
    const full = cssFontFamilyKey(face.family),
      simple = simpleFontFamilyKey(face.family),
      slot = face.weight + "/" + face.style,
      previous = namespace.get(full);
    if (previous && previous.simple !== simple)
      fail(
        `distinct native aliases ${JSON.stringify(previous.family)} and ${JSON.stringify(face.family)} share a CSS full-fold name.`,
      );
    if (previous?.slots.has(slot) && previous.slots.get(slot) !== face.hash)
      fail(
        "a shared family/weight/style slot has conflicting resource hashes.",
      );
    if (previous) previous.slots.set(slot, face.hash);
    else
      namespace.set(full, {
        family: face.family,
        simple,
        slots: new Map([[slot, face.hash]]),
      });
  }
}

/** Snapshot canonical aliases and preserve exact or unknown CSS values. */
export function createCSSFontFamilyResolver(
  families: readonly string[],
): (raw: string) => string {
  if (!Array.isArray(families) || families.length > 16)
    fail("require at most 16 canonical families.");
  const snapshot = families.slice(),
    bySimple = new Map<string, string>(),
    byFull = new Map<string, string>();
  for (const family of snapshot) {
    checkedFamily(family);
    const simple = simpleFontFamilyKey(family),
      full = cssFontFamilyKey(family),
      previousSimple = bySimple.get(simple),
      previousFull = byFull.get(full);
    if (previousSimple !== undefined && previousSimple !== family)
      fail("one native alias class requires one exact canonical spelling.");
    if (
      previousFull !== undefined &&
      simpleFontFamilyKey(previousFull) !== simple
    )
      fail("distinct native aliases share a CSS full-fold name.");
    bySimple.set(simple, family);
    byFull.set(full, family);
  }
  return (raw) => {
    const parsed = parseFamily(raw, true),
      canonical = byFull.get(cssFontFamilyTextKey(parsed.family));
    if (parsed.generic) {
      if (parsed.escaped && cssWideKeywords.has(parsed.keyword!))
        fail("escaped CSS-wide keywords need a cascade adapter.");
      if (canonical !== undefined)
        fail("an unquoted keyword conflicts with a declared named alias.");
      return parsed.escaped ? parsed.keyword! : raw;
    }
    if (canonical === undefined) {
      checkedFamily(parsed.family);
      return parsed.escaped ? JSON.stringify(parsed.family) : raw;
    }
    if (
      simpleFontFamilyTextKey(parsed.family) !==
      simpleFontFamilyTextKey(canonical)
    )
      fail("full-fold-only aliases need a browser font matching adapter.");
    const authoredScalars = [...parsed.family],
      canonicalScalars = [...canonical];
    if (
      authoredScalars.some(
        (character, index) =>
          character !== canonicalScalars[index] &&
          (character.codePointAt(0)! > 0xffff ||
            canonicalScalars[index]!.codePointAt(0)! > 0xffff),
      )
    )
      fail("changed astral aliases need a browser font matching adapter.");
    const exact =
      parsed.family === canonical &&
      (parsed.quoted || raw.replace(cssOuterWhitespace, "") === parsed.family);
    return exact && !parsed.escaped ? raw : JSON.stringify(canonical);
  };
}
