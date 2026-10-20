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

test("single CSS families decode simple and one-to-six-digit escapes", () => {
  for (const [raw, family] of [
    [String.raw`Noto\ Sans`, "Noto Sans"],
    [String.raw`Noto\20 Sans`, "Noto Sans"],
    [String.raw`Noto\_Sans`, "Noto_Sans"],
    [String.raw`Noto\-Sans`, "Noto-Sans"],
    [String.raw`\000053ource`, "Source"],
    [String.raw`Stra\df e`, "Straße"],
    [String.raw`\41 B`, "AB"],
    [String.raw`\41  B`, "A B"],
    [String.raw`\000041B`, "AB"],
    [String.raw`\0000410`, "A0"],
    [String.raw`\41B`, "Л"],
    [String.raw`\10400 Face`, "𐐀Face"],
    [String.raw`\10400  Face`, "𐐀 Face"],
    [String.raw`"Noto\20 Sans"`, "Noto Sans"],
  ])
    expect(parseCSSFontFamily(raw!).family).toBe(family!);
});

test("CSS hex escapes consume exactly one whitespace unit including CRLF", () => {
  for (const terminator of [" ", "\t", "\n", "\r", "\f", "\r\n"]) {
    expect(parseCSSFontFamily("\\41" + terminator + "B").family).toBe("AB");
    expect(parseCSSFontFamily("\\41" + terminator + " B").family).toBe("A B");
    expect(parseCSSFontFamily('"\\41' + terminator + 'B"').family).toBe("AB");
  }
  expect(parseCSSFontFamily("\\41\r\n\tB").family).toBe("A B");
});

test("escaped identifier spaces keep token boundaries and reserved-word meaning", () => {
  for (const raw of [
    String.raw`serif\ Something`,
    String.raw`serif\20 Something`,
  ])
    expect(parseCSSFontFamily(raw)).toEqual({
      family: "serif Something",
      generic: false,
      quoted: false,
    });
  expect(parseCSSFontFamily(String.raw`default\ Something`).family).toBe(
    "default Something",
  );
  expect(parseCSSFontFamily(String.raw`Noto\  Sans`).family).toBe("Noto  Sans");
  expect(parseCSSFontFamily(String.raw`Noto \31 23`).family).toBe("Noto 123");
  expect(parseCSSFontFamily(String.raw`Noto -\31`).family).toBe("Noto -1");
  for (const raw of [
    "serif Something",
    "default Something",
    "Noto 123",
    "Noto -1",
  ])
    expect(() => parseCSSFontFamily(raw)).toThrow();
  expect(parseCSSFontFamily(String.raw`\73 erif`).generic).toBe(true);
  expect(parseCSSFontFamily(String.raw`\17f erif`).generic).toBe(false);
});

test("quoted CSS families remove continuations and keep their public result shape", () => {
  for (const newline of ["\n", "\r", "\f", "\r\n"])
    for (const quote of ['"', "'"])
      expect(
        parseCSSFontFamily(quote + "No\\" + newline + "to" + quote),
      ).toEqual({
        family: "Noto",
        generic: false,
        quoted: true,
      });
  expect(parseCSSFontFamily(String.raw`"Noto\20  Sans"`)).toEqual({
    family: "Noto  Sans",
    generic: false,
    quoted: true,
  });
  expect(parseCSSFontFamily(String.raw`\4e oto`)).toEqual({
    family: "Noto",
    generic: false,
    quoted: false,
  });
});

test("font resolvers serialize escaped known and unknown names before native lookup", () => {
  const resolve = createCSSFontFamilyResolver([
    "Straße",
    "Noto Sans",
    "Noto 123",
    "é",
    "İ",
    "ﬀ",
  ]);
  const simple = "\\Straße";
  expect([...simple].map((character) => character.codePointAt(0))).toEqual([
    92, 83, 116, 114, 97, 223, 101,
  ]);
  for (const raw of [simple, String.raw`Stra\df e`, String.raw`"Stra\df e"`])
    expect(resolve(raw)).toBe('"Straße"');
  expect(resolve('"Stra\\\r\nße"')).toBe('"Straße"');
  expect(resolve(String.raw`Noto\ Sans`)).toBe('"Noto Sans"');
  expect(resolve(String.raw`Noto \31 23`)).toBe('"Noto 123"');
  expect(resolve(String.raw`Unknown\20 Family`)).toBe('"Unknown Family"');
  expect(resolve(String.raw`"Unknown\20 Family"`)).toBe('"Unknown Family"');
  expect(resolve(String.raw`e\301`)).toBe(JSON.stringify("e\u0301"));
  expect(resolve(String.raw`\e9`)).toBe('"é"');
  for (const raw of [
    String.raw`\53 TRASSE`,
    String.raw`"str\61 sse"`,
    String.raw`i\307`,
    String.raw`\66 f`,
  ])
    expect(() => resolve(raw)).toThrow("full-fold-only");
  for (const raw of ["Straße", " 'Straße' ", "Unknown   Family"])
    expect(resolve(raw)).toBe(raw);
});

test("escaped generic and CSS-wide keywords cannot become named aliases", () => {
  const empty = createCSSFontFamilyResolver([]);
  for (const [raw, keyword] of [
    [String.raw`\73 erif`, "serif"],
    [String.raw`S\65 RIF`, "serif"],
    [String.raw`sans\2d serif`, "sans-serif"],
    [String.raw`\73 ystem-ui`, "system-ui"],
  ]) {
    expect(empty(raw!)).toBe(keyword!);
    expect(() => createCSSFontFamilyResolver([keyword!])(raw!)).toThrow(
      "unquoted keyword conflicts",
    );
  }
  for (const [raw, keyword] of [
    [String.raw`\69 nherit`, "inherit"],
    [String.raw`in\69 tial`, "initial"],
    [String.raw`un\73 et`, "unset"],
    [String.raw`re\76 ert`, "revert"],
    [String.raw`revert\2d layer`, "revert-layer"],
    [String.raw`revert\2d rule`, "revert-rule"],
  ]) {
    expect(parseCSSFontFamily(raw!).generic).toBe(true);
    expect(() => empty(raw!)).toThrow("escaped CSS-wide keywords");
    expect(empty(" \t" + keyword + "\n")).toBe(" \t" + keyword + "\n");
  }
  expect(
    createCSSFontFamilyResolver(["inherit"])(String.raw`"\69 nherit"`),
  ).toBe('"inherit"');
  expect(() => parseCSSFontFamily(String.raw`\64 efault`)).toThrow("default");
});

test("escaped CSS family names retain decoded scalar limits and combining order", () => {
  expect(parseCSSFontFamily(String.raw`\10400 `.repeat(80)).family).toBe(
    "𐐀".repeat(80),
  );
  expect(() => parseCSSFontFamily(String.raw`\10400 `.repeat(81))).toThrow();
  const canonical = "ΐ".repeat(80),
    leading = "Ι".repeat(80),
    resolve = createCSSFontFamilyResolver([canonical, "Ι", leading, "𐐀Source"]),
    expanded = String.raw`\345 \308 \301 `.repeat(80);
  expect(() => resolve(expanded)).toThrow("full-fold-only");
  expect(resolve(String.raw`\345`)).toBe('"Ι"');
  expect(resolve(String.raw`\345 `.repeat(80))).toBe(JSON.stringify(leading));
  expect(resolve(String.raw`\10400 Source`)).toBe('"𐐀Source"');
  expect(resolve(String.raw`\10400 source`)).toBe('"𐐀Source"');
  expect(() => resolve(String.raw`\10428 Source`)).toThrow("changed astral");
  expect(() => parseCSSFontFamily(expanded)).toThrow();
  expect(() => resolve(expanded + String.raw`\345`)).toThrow();
  expect(() => resolve(String.raw`\345 \301 \308 `.repeat(80))).toThrow();
  expect(() => createCSSFontFamilyResolver([])(String.raw`\345`)).toThrow();
  expect(() =>
    createCSSFontFamilyResolver([])(String.raw`\41 `.repeat(81)),
  ).toThrow();
});

test("CSS family escapes diagnose malformed input and unsupported decoded names", () => {
  const invalid = [
    "Noto\\",
    '"Noto\\',
    '"Noto',
    "Noto/*x*/Sans",
    String.raw`Noto\,Sans`,
    String.raw`"Noto\22 Sans"`,
    String.raw`Noto\\Sans`,
    String.raw`\0`,
    String.raw`\d800`,
    String.raw`\dfff`,
    String.raw`\110000`,
    String.raw`\31 Noto`,
    "A\ud800",
    "A\\\udfff",
    '"A\ud800"',
    String.raw`"Noto"\20 Sans`,
    String.raw`var(\4e oto)`,
    "'Noto', serif",
  ];
  for (const newline of ["\n", "\r", "\f", "\r\n"])
    invalid.push("Noto\\" + newline + "Sans", '"Noto' + newline + 'Sans"');
  for (const raw of invalid) expect(() => parseCSSFontFamily(raw)).toThrow();
});
