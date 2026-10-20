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

const cssWhitespace = /[\t\n\f\r ]+/,
  cssOuterWhitespace = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g,
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
    "inherit",
    "initial",
    "unset",
    "revert",
    "revert-layer",
    "revert-rule",
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

function cssIdentifier(value: string): boolean {
  const scalars = [...value],
    start = (character: string | undefined) =>
      character !== undefined &&
      (/^[A-Za-z_]$/.test(character) || character.codePointAt(0)! >= 0x80);
  if (
    !start(scalars[0]) &&
    !(scalars[0] === "-" && (start(scalars[1]) || scalars[1] === "-"))
  )
    return false;
  return scalars.every(
    (character) => start(character) || /^[0-9-]$/.test(character),
  );
}

/** Parse one escape-free family; lists, comments and functions need an adapter. */
export function parseCSSFontFamily(raw: string): ParsedCSSFontFamily {
  return parseFamily(raw, false);
}

function parseFamily(raw: string, matching: boolean): ParsedCSSFontFamily {
  if (typeof raw !== "string") fail("require a string.");
  const decoded = (family: string) => {
    if (!matching) return checkedFamily(family);
    cssFontFamilyTextKey(family);
    return family;
  };
  const value = raw.replace(cssOuterWhitespace, "");
  if (!value || value.includes("\\"))
    fail("require one nonempty family without CSS escapes.");
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const family = value.slice(1, -1);
    if (value.length < 2 || value.at(-1) !== quote || family.includes(quote))
      fail("require one complete quoted family.");
    return { family: decoded(family), generic: false, quoted: true };
  }
  const identifiers = value.split(cssWhitespace),
    family = decoded(identifiers.join(" "));
  if (!identifiers.every(cssIdentifier))
    fail("require quoted text or unescaped CSS identifiers.");
  const reserved = identifiers.map(asciiKey);
  if (reserved.includes("default"))
    fail("the reserved default identifier must be quoted.");
  const generic = reserved.some((identifier) => keywords.has(identifier));
  if (generic && identifiers.length !== 1)
    fail("generic and CSS-wide keywords cannot form a named family.");
  return { family, generic, quoted: false };
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
      if (canonical !== undefined)
        fail("an unquoted keyword conflicts with a declared named alias.");
      return raw;
    }
    if (canonical === undefined) {
      checkedFamily(parsed.family);
      return raw;
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
    return exact ? raw : JSON.stringify(canonical);
  };
}
