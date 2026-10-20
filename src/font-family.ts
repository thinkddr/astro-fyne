// SPDX-License-Identifier: Apache-2.0
import { fontFamilyDataJSON } from "./font-family-data.ts";

type Range = readonly [number, number];
type Pair = readonly [number, number];
type FoldRun = readonly [number, number, number, number];
type FamilyData = {
  version: string;
  common: { runs: FoldRun[]; singles: Pair[] };
  simpleOverrides: Pair[];
  fullOverrides: [number, number[]][];
  categories: Record<"L" | "M" | "Nd", Range[]>;
};

const data = JSON.parse(fontFamilyDataJSON) as FamilyData;
export const FONT_FAMILY_UNICODE_VERSION = "17.0.0";
if (data.version !== FONT_FAMILY_UNICODE_VERSION)
  throw new Error("Font family Unicode data version differs.");
const simple = new Map(data.simpleOverrides),
  full = new Map(data.fullOverrides);

function contains(ranges: readonly Range[], scalar: number): boolean {
  let low = 0,
    high = ranges.length;
  while (low < high) {
    const mid = (low + high) >>> 1,
      [start, end] = ranges[mid]!;
    if (scalar < start) high = mid;
    else if (scalar > end) low = mid + 1;
    else return true;
  }
  return false;
}

function commonFold(scalar: number): number {
  let low = 0,
    high = data.common.singles.length;
  while (low < high) {
    const mid = (low + high) >>> 1,
      [source, target] = data.common.singles[mid]!;
    if (scalar < source) high = mid;
    else if (scalar > source) low = mid + 1;
    else return target;
  }
  low = 0;
  high = data.common.runs.length;
  while (low < high) {
    const mid = (low + high) >>> 1,
      [start, end, stride, delta] = data.common.runs[mid]!;
    if (scalar < start) high = mid;
    else if (scalar > end) low = mid + 1;
    else return (scalar - start) % stride === 0 ? scalar + delta : scalar;
  }
  return scalar;
}

/** Validate the Unicode17 alias grammar used by native font requirements. */
export function validFontResourceFamily(value: string): boolean {
  if (
    typeof value !== "string" ||
    !value ||
    value[0] === " " ||
    value[value.length - 1] === " "
  )
    return false;
  let count = 0;
  for (const character of value) {
    const scalar = character.codePointAt(0)!;
    if (++count > 80 || (scalar >= 0xd800 && scalar <= 0xdfff)) return false;
    const letter = contains(data.categories.L, scalar);
    if (count === 1) {
      if (!letter) return false;
    } else if (
      !letter &&
      !contains(data.categories.M, scalar) &&
      !contains(data.categories.Nd, scalar) &&
      scalar !== 0x20 &&
      scalar !== 0x5f &&
      scalar !== 0x2d
    )
      return false;
  }
  return true;
}

function checkedFamily(value: string): string {
  if (!validFontResourceFamily(value))
    throw new Error(
      "Font family requires 1..80 Unicode17 scalars with a leading letter and valid alias characters.",
    );
  return value;
}

/** Return a C+S key for Go simple-fold equality, without normalization. */
export function simpleFontFamilyKey(value: string): string {
  let result = "";
  for (const character of checkedFamily(value)) {
    const scalar = character.codePointAt(0)!;
    result += String.fromCodePoint(simple.get(scalar) ?? commonFold(scalar));
  }
  return result;
}

/** Return a C+F key for CSS default caseless family matching. */
export function cssFontFamilyKey(value: string): string {
  let result = "";
  for (const character of checkedFamily(value)) {
    const scalar = character.codePointAt(0)!,
      mapped = full.get(scalar);
    result += mapped
      ? String.fromCodePoint(...mapped)
      : String.fromCodePoint(commonFold(scalar));
  }
  return result;
}
