// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  createCSSFontFamilyResolver,
  parseCSSFontFamily,
  validateCSSFontNamespace,
  type CSSFontFaceRequest,
} from "./font-family-css.ts";

const digest = "1".repeat(64),
  otherDigest = "2".repeat(64),
  face = (
    family: string,
    weight = 400,
    style = "normal",
    hash = digest,
  ): CSSFontFaceRequest => ({ family, weight, style, hash });

test("shared CSS font namespaces reject full-fold collisions across every native slot", () => {
  for (const [left, right] of [
    ["Straße", "STRASSE"],
    ["İ", "i\u0307"],
    ["ﬀ", "ff"],
  ])
    for (const weight of [400, 700])
      for (const style of ["normal", "italic"])
        for (const hash of [digest, otherDigest])
          expect(() =>
            validateCSSFontNamespace([
              face(left!, 400, "normal"),
              face(right!, weight, style, hash),
            ]),
          ).toThrow("share a CSS full-fold name");
  expect(() =>
    validateCSSFontNamespace([face("Straße"), face("STRASSE")].reverse()),
  ).toThrow("share a CSS full-fold name");
});

test("shared CSS font namespaces allow equal native aliases but bind each slot hash", () => {
  const faces = [
    face("Source"),
    face("SOURCE"),
    face("source", 700, "italic", otherDigest),
    face("Σ"),
    face("ς"),
    face("ß"),
    face("ẞ"),
    face("ſ"),
    face("S"),
    face("K"),
    face("k"),
  ];
  expect(() => validateCSSFontNamespace(faces)).not.toThrow();
  expect(() => validateCSSFontNamespace([])).not.toThrow();
  expect(() =>
    validateCSSFontNamespace(Array.from({ length: 20 }, () => face("Source"))),
  ).not.toThrow();
  expect(() =>
    validateCSSFontNamespace([
      face("Source"),
      face("SOURCE", 400, "normal", otherDigest),
    ]),
  ).toThrow("conflicting resource hashes");
  expect(() =>
    validateCSSFontNamespace([
      face("Noto Sans"),
      face("Noto  Sans", 400, "normal", otherDigest),
    ]),
  ).not.toThrow();
});

test("shared CSS font namespaces validate Unicode descriptors without normalization", () => {
  expect(() =>
    validateCSSFontNamespace([
      face("é"),
      face("e\u0301", 400, "normal", otherDigest),
      face("I"),
      face("ı", 400, "normal", otherDigest),
      face("𐐀".repeat(80)),
    ]),
  ).not.toThrow();
  for (const invalid of [
    face("𐐀".repeat(81)),
    face("A\ud800"),
    face("Source", 500),
    face("Source", 400, "oblique"),
    face("Source", 400, "Normal"),
    face("Source", 400, "normal", "A".repeat(64)),
    face("Source", 400, "normal", "1".repeat(63)),
    face(42 as unknown as string),
    null as unknown as CSSFontFaceRequest,
  ])
    expect(() => validateCSSFontNamespace([invalid])).toThrow();
  expect(() =>
    validateCSSFontNamespace(null as unknown as CSSFontFaceRequest[]),
  ).toThrow();
});

test("single CSS font parsing collapses only unquoted CSS ASCII whitespace", () => {
  expect(parseCSSFontFamily(" \tNoto\r\n\f  Sans \n")).toEqual({
    family: "Noto Sans",
    generic: false,
    quoted: false,
  });
  for (const raw of [' \t"Noto  Sans"\r', "'Noto  Sans'"])
    expect(parseCSSFontFamily(raw)).toEqual({
      family: "Noto  Sans",
      generic: false,
      quoted: true,
    });
  expect(parseCSSFontFamily("Noto _Face -Face --Face").family).toBe(
    "Noto _Face -Face --Face",
  );
  expect(parseCSSFontFamily("'Noto 123'").family).toBe("Noto 123");
  expect(parseCSSFontFamily("ſerif").generic).toBe(false);
  expect(parseCSSFontFamily("caption").generic).toBe(false);
  expect(parseCSSFontFamily("menu").generic).toBe(false);
});

test("single CSS font parsing diagnoses unsupported syntax instead of stripping it", () => {
  for (const raw of [
    "",
    " \t\n",
    "Noto, serif",
    '"Noto", serif',
    '"Noto" Sans',
    "Noto 'Sans'",
    '"Noto',
    "'Noto\"",
    "Noto\\ Sans",
    '"Noto\\20 Sans"',
    "Noto/*comment*/Sans",
    "var(--font)",
    "generic(fangsong)",
    "Noto 123",
    "Noto -1",
    "Noto -",
    "Noto\u00a0Sans",
    "\u00a0Noto",
    "Noto\u00a0",
    "Noto\u000bSans",
    '"Noto\tSans"',
    '" Noto"',
    '"Noto "',
    "Noto Serif",
    "Noto inherit",
    "default",
    "DeFaUlT",
    "Noto default",
    "A\udfff",
    "𐐀".repeat(81),
  ])
    expect(() => parseCSSFontFamily(raw)).toThrow();
  expect(() => parseCSSFontFamily(42 as unknown as string)).toThrow();
  expect(parseCSSFontFamily("𐐀".repeat(80)).family).toBe("𐐀".repeat(80));
});

test("CSS matching spellings can exceed native alias length and leading-letter rules", () => {
  const canonical = "ΐ".repeat(80),
    dotted = "İ".repeat(80);
  const resolve = createCSSFontFamilyResolver(["Ι", canonical, dotted]);
  expect(resolve("\u0345")).toBe('"Ι"');
  expect(resolve('"\u0345"')).toBe('"Ι"');
  for (const raw of [
    "\u0345\u0308\u0301".repeat(80),
    "ι\u0308\u0301".repeat(80),
  ]) {
    expect([...raw].length).toBe(240);
    expect(() => resolve(raw)).toThrow("full-fold-only");
    expect(() => resolve(JSON.stringify(raw))).toThrow("full-fold-only");
    expect(() => parseCSSFontFamily(raw)).toThrow();
  }
  expect(() => resolve("i\u0307".repeat(80))).toThrow("full-fold-only");
  expect(
    createCSSFontFamilyResolver(["Ι".repeat(80)])("\u0345".repeat(80)),
  ).toBe(JSON.stringify("Ι".repeat(80)));
  expect(resolve(canonical)).toBe(canonical);
  expect(() => createCSSFontFamilyResolver(["\u0345"])).toThrow();
  expect(() =>
    createCSSFontFamilyResolver(["ι\u0308\u0301".repeat(80)]),
  ).toThrow();
});

test("broader CSS matching keeps unknown resource limits and exact combining order", () => {
  const canonical = "ΐ".repeat(80),
    resolve = createCSSFontFamilyResolver([canonical, "é", "I"]);
  for (const raw of [
    "\u0345",
    "A".repeat(81),
    "ι\u0301\u0308".repeat(80),
    "\u0345\u0308\u0301".repeat(81),
    "\ud800",
    '"A\udfff"',
  ])
    expect(() => resolve(raw)).toThrow();
  expect(resolve("e\u0301")).toBe("e\u0301");
  expect(resolve("ı")).toBe("ı");
  expect(() => createCSSFontFamilyResolver([])("\u0345")).toThrow();
});

test("CSS font resolvers preserve exact canonical CSS and quote full-fold aliases", () => {
  const resolve = createCSSFontFamilyResolver([
    "Straße",
    "İ",
    "Noto Sans",
    "Noto  Sans",
    "Σ",
    "ſ",
    "K",
    "ﬅ",
  ]);
  for (const raw of ["Straße", ' "Straße" ', "'Straße'", " \tNoto Sans\r"])
    expect(resolve(raw)).toBe(raw);
  for (const [raw, canonical] of [
    ["STRAẞE", "Straße"],
    ['"straße"', "Straße"],
    ["Noto   Sans", "Noto Sans"],
    ["Noto\tSans", "Noto Sans"],
    ["ς", "Σ"],
    ["S", "ſ"],
    ["k", "K"],
    ["ﬆ", "ﬅ"],
  ])
    expect(resolve(raw!)).toBe(JSON.stringify(canonical));
  expect(resolve('"Noto  Sans"')).toBe('"Noto  Sans"');
});

test("CSS font resolvers keep unknown names distinct and snapshot canonical input", () => {
  const families = ["é", "I", "Straße", "𐐀".repeat(80)],
    resolve = createCSSFontFamilyResolver(families);
  families.fill("Changed");
  families.push("STRAẞE");
  expect(resolve("STRAẞE")).toBe('"Straße"');
  for (const raw of [
    "e\u0301",
    "ı",
    "Unknown   Family",
    "'Unknown Family'",
    "Changed",
  ])
    expect(resolve(raw)).toBe(raw);
  expect(resolve("𐐀".repeat(80))).toBe("𐐀".repeat(80));
  const empty = createCSSFontFamilyResolver([]);
  expect(empty("Noto Sans")).toBe("Noto Sans");
  expect(empty("serif")).toBe("serif");
  expect(() => empty("Noto, serif")).toThrow();
  expect(() => empty("𐐀".repeat(81))).toThrow();
});

test("font alias conversion diagnoses full-only and changed-astral rewrites", () => {
  for (const [canonical, authored] of [
    ["Straße", "STRASSE"],
    ["İ", "i\u0307"],
    ["ﬀ", "ff"],
    ["ΐ".repeat(80), "\u0345\u0308\u0301".repeat(80)],
  ]) {
    const resolve = createCSSFontFamilyResolver([canonical!]);
    expect(() => resolve(authored!)).toThrow("full-fold-only");
    expect(() => resolve(JSON.stringify(authored))).toThrow("full-fold-only");
    expect(resolve(canonical!)).toBe(canonical!);
  }
  const canonical = "𐐀Source𐐀",
    resolve = createCSSFontFamilyResolver([canonical]);
  for (const authored of ["𐐨Source𐐀", "𐐀Source𐐨", "𐐨source𐐨"])
    expect(() => resolve(authored)).toThrow("changed astral");
  expect(resolve(canonical)).toBe(canonical);
  expect(resolve("𐐀source𐐀")).toBe(JSON.stringify(canonical));
  expect(resolve(JSON.stringify(canonical))).toBe(JSON.stringify(canonical));
  expect(createCSSFontFamilyResolver([])("𐐨source𐐨")).toBe("𐐨source𐐨");
});

test("CSS font resolvers reject ambiguous and noncanonical declarations", () => {
  for (const families of [
    ["Straße", "STRASSE"],
    ["İ", "i\u0307"],
    ["Σ", "ς"],
    ["Source", "SOURCE"],
    ["ﬅ", "ﬆ"],
    ["A\ud800"],
    ["𐐀".repeat(81)],
    Array.from({ length: 17 }, (_, index) => "Family" + index),
  ])
    expect(() => createCSSFontFamilyResolver(families)).toThrow();
  expect(() => createCSSFontFamilyResolver(["Source", "Source"])).not.toThrow();
  expect(() =>
    createCSSFontFamilyResolver(null as unknown as string[]),
  ).toThrow();
});

test("unquoted CSS keywords never resolve to declared quoted family aliases", () => {
  const reserved = [
    "serif",
    "sans-serif",
    "system-ui",
    "ui-rounded",
    "emoji",
    "fangsong",
    "inherit",
    "initial",
    "unset",
    "revert",
    "revert-layer",
    "revert-rule",
  ];
  for (const keyword of reserved) {
    const empty = createCSSFontFamilyResolver([]),
      declared = createCSSFontFamilyResolver([keyword]);
    expect(parseCSSFontFamily(keyword)).toEqual({
      family: keyword,
      generic: true,
      quoted: false,
    });
    expect(empty(" \t" + keyword + "\n")).toBe(" \t" + keyword + "\n");
    expect(() => declared(keyword)).toThrow("unquoted keyword conflicts");
    expect(declared(JSON.stringify(keyword))).toBe(JSON.stringify(keyword));
  }
  expect(() => createCSSFontFamilyResolver(["Serif"])("SeRiF")).toThrow();
  expect(createCSSFontFamilyResolver(["serif"])("ſerif")).toBe('"serif"');
  expect(() => createCSSFontFamilyResolver(["ſerif"])("serif")).toThrow();
  expect(createCSSFontFamilyResolver(["menu"])("MENU")).toBe('"menu"');
  expect(createCSSFontFamilyResolver(["default"])('"default"')).toBe(
    '"default"',
  );
});
