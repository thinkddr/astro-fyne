// SPDX-License-Identifier: Apache-2.0
import {
  FONT_FAMILY_UNICODE_VERSION,
  cssFontFamilyKey,
  simpleFontFamilyKey,
  validFontResourceFamily,
} from "../src/font-family.ts";

export type UnicodeFamilyReference = {
  schema: number;
  unicodeVersion: string;
  goVersion: string;
  scalars: number;
  nativeGrammarChecks: number;
  rawEqualFoldChecks: number;
  nativeDuplicateChecks: number;
  nativeOrbitAdmissionChecks: number;
  ranges: { start: number; end: number; flags: number }[];
  rawSimpleOrbits: number[][];
  admittedSimpleOrbits: number[][];
  rejectedSimpleOrbits: number[][];
  examples: { left: string; right: string; equal: boolean }[];
};

function requireReference(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error("Unicode font reference: " + message);
}

export function checkUnicodeFontFamilies(
  reference: UnicodeFamilyReference,
  unicodeData: string,
  caseFolding: string,
) {
  requireReference(reference.schema === 1, "schema");
  requireReference(
    reference.unicodeVersion === FONT_FAMILY_UNICODE_VERSION &&
      reference.scalars === 0x110000 - 0x800 &&
      reference.nativeGrammarChecks === 2_224_128 &&
      reference.rawEqualFoldChecks === 6084 &&
      reference.nativeDuplicateChecks === 5916 &&
      reference.nativeOrbitAdmissionChecks === 2994,
    "versions or native counts",
  );
  const flags = new Uint8Array(0x110000),
    nativeFlags = new Uint8Array(0x110000),
    simple = new Map<number, string>(),
    full = new Map<number, string>();
  let pending: { scalar: number; category: string } | undefined;
  for (const line of unicodeData.trimEnd().split("\n")) {
    const fields = line.split(";"),
      scalar = Number.parseInt(fields[0]!, 16),
      category = fields[2]!;
    requireReference(Number.isInteger(scalar), "UnicodeData scalar");
    if (fields[1]!.endsWith(", First>")) {
      requireReference(!pending, "nested category range");
      pending = { scalar, category };
      continue;
    }
    let start = scalar;
    if (fields[1]!.endsWith(", Last>")) {
      requireReference(pending?.category === category, "category range end");
      start = pending!.scalar;
      pending = undefined;
    } else requireReference(!pending, "unclosed category range");
    const flag = category.startsWith("L")
      ? 1
      : category.startsWith("M")
        ? 2
        : category === "Nd"
          ? 4
          : 0;
    flags.fill(flag, start, scalar + 1);
  }
  requireReference(!pending, "unclosed final category range");
  let previous = -1;
  for (const range of reference.ranges) {
    requireReference(
      Number.isInteger(range.start) &&
        Number.isInteger(range.end) &&
        range.start > previous &&
        range.start <= range.end &&
        range.end <= 0x10ffff &&
        [1, 2, 4].includes(range.flags),
      "native category ranges",
    );
    nativeFlags.fill(range.flags, range.start, range.end + 1);
    previous = range.end;
  }
  for (const line of caseFolding.split("\n")) {
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
  requireReference(simple.size === 1512 && full.size === 1585, "fold counts");

  const normativeClasses = new Map<number, Set<number>>();
  for (const [scalar, value] of simple) {
    const target = value.codePointAt(0)!;
    requireReference([...value].length === 1, "non-simple C/S mapping");
    const members = normativeClasses.get(target) ?? new Set<number>();
    members.add(scalar);
    members.add(target);
    normativeClasses.set(target, members);
  }
  const normativeOrbits = [...normativeClasses.values()]
    .map((members) => [...members].sort((a, b) => a - b))
    .sort((a, b) => a[0]! - b[0]!);
  requireReference(
    JSON.stringify(reference.rawSimpleOrbits) ===
      JSON.stringify(normativeOrbits),
    "Go SimpleFold classes differ from normative C/S classes",
  );
  const admitted = normativeOrbits.filter((orbit) => {
      const statuses = orbit.map((scalar) => flags[scalar] !== 0);
      requireReference(
        statuses.every((value) => value === statuses[0]),
        "mixed orbit admission",
      );
      return statuses[0];
    }),
    rejected = normativeOrbits.filter((orbit) => flags[orbit[0]!] === 0);
  requireReference(
    admitted.length === 1440 &&
      rejected.length === 42 &&
      JSON.stringify(reference.admittedSimpleOrbits) ===
        JSON.stringify(admitted) &&
      JSON.stringify(reference.rejectedSimpleOrbits) ===
        JSON.stringify(rejected),
    "native admitted/rejected orbits",
  );
  const goClasses = new Map<number, number>();
  for (const orbit of admitted)
    for (const scalar of orbit) goClasses.set(scalar, orbit[0]!);
  const keysByClass = new Map<number, string>(),
    classesByKey = new Map<string, number>(),
    errors: string[] = [];
  let mismatchCount = 0,
    grammarChecks = 0,
    simpleChecks = 0,
    fullChecks = 0;
  function mismatch(message: string) {
    mismatchCount++;
    if (errors.length < 20) errors.push(message);
  }
  for (let scalar = 0; scalar <= 0x10ffff; scalar++) {
    const label = "U+" + scalar.toString(16),
      character = String.fromCodePoint(scalar),
      leading = (nativeFlags[scalar]! & 1) !== 0,
      continuation =
        nativeFlags[scalar] !== 0 || [0x20, 0x5f, 0x2d].includes(scalar);
    if (flags[scalar] !== nativeFlags[scalar])
      mismatch(label + " Go/normative categories");
    if (validFontResourceFamily(character + "A") !== leading)
      mismatch(label + " leading grammar");
    if (validFontResourceFamily("A" + character + "A") !== continuation)
      mismatch(label + " continuation grammar");
    grammarChecks += 2;
    if (!continuation) continue;
    try {
      const family = "A" + character + "A",
        simpleKey = simpleFontFamilyKey(family),
        fullKey = cssFontFamilyKey(family),
        group = goClasses.get(scalar) ?? scalar;
      if (simpleKey !== "a" + (simple.get(scalar) ?? character) + "a")
        mismatch(label + " normative simple key");
      if (fullKey !== "a" + (full.get(scalar) ?? character) + "a")
        mismatch(label + " normative CSS key");
      const oldKey = keysByClass.get(group),
        oldClass = classesByKey.get(simpleKey);
      if (oldKey !== undefined && oldKey !== simpleKey)
        mismatch(label + " missed Go alias");
      if (oldClass !== undefined && oldClass !== group)
        mismatch(label + " false Go alias merge");
      keysByClass.set(group, simpleKey);
      classesByKey.set(simpleKey, group);
    } catch (error) {
      mismatch(label + " key error: " + String(error));
    }
    simpleChecks++;
    fullChecks++;
  }
  requireReference(
    grammarChecks === 0x110000 * 2 &&
      simpleChecks === 148988 &&
      fullChecks === 148988,
    "incomplete scalar comparison",
  );
  for (const example of reference.examples) {
    if (
      !validFontResourceFamily(example.left) ||
      !validFontResourceFamily(example.right)
    )
      mismatch("invalid Go comparison example");
    else if (
      (simpleFontFamilyKey(example.left) ===
        simpleFontFamilyKey(example.right)) !==
      example.equal
    )
      mismatch("Go example differs: " + example.left);
  }
  const cssExamples = [
    { left: "Straße", right: "STRASSE", equal: true },
    { left: "İ", right: "i\u0307", equal: true },
    { left: "ﬀ", right: "ff", equal: true },
    { left: "\ufb05", right: "st", equal: true },
    { left: "I", right: "ı", equal: false },
    { left: "é", right: "e\u0301", equal: false },
  ];
  for (const example of cssExamples)
    if (
      (cssFontFamilyKey(example.left) === cssFontFamilyKey(example.right)) !==
      example.equal
    )
      mismatch("CSS example differs: " + example.left);
  return {
    schema: 1,
    accepted: mismatchCount === 0,
    unicodeVersion: FONT_FAMILY_UNICODE_VERSION,
    goVersion: reference.goVersion,
    codePoints: 0x110000,
    unicodeScalars: reference.scalars,
    grammarChecks,
    simpleChecks,
    fullChecks,
    rawOrbits: normativeOrbits.length,
    admittedOrbits: admitted.length,
    rejectedOrbits: rejected.length,
    simpleEquivalenceCheckedBothDirections: true,
    simpleDistinctClasses: keysByClass.size,
    goExamples: reference.examples,
    cssExamples,
    mismatchCount,
    errors,
    individualNativeScalarOutcomesRetained: false,
    renderingChecked: false,
    pixelPerfectVerified: false,
    fallbackFreeRenderingVerified: false,
  };
}
