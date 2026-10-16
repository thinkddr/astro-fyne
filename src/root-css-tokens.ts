// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { Buffer } from "node:buffer";

/** Literal root declarations are retained, without evaluating a CSS cascade. */
export function resolvedRootToken(
  name: string,
  value: unknown,
  location: string,
): string {
  const fail = (): never => {
    throw new Error(
      `${location}: root CSS custom properties require nonempty resolved literal strings; substitution, CSS-wide keywords and priorities require a CSS adapter.`,
    );
  };
  if (
    !/^--[A-Za-z\d_-]+$/.test(name) ||
    typeof value !== "string" ||
    Buffer.from(value, "utf8").toString("utf8") !== value ||
    !value.trim() ||
    /^(?:inherit|initial|unset|revert|revert-layer)$/i.test(value.trim())
  )
    return fail();
  let quote = "";
  let parentheses = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (/[\\\u0000-\u001f<>;{}]/.test(character)) return fail();
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (
      character === "!" ||
      character === "[" ||
      character === "]" ||
      (character === "/" && value[index + 1] === "*")
    )
      return fail();
    if (/[-_A-Za-z\u0080-\uffff]/.test(character)) {
      let end = index + 1;
      while (
        end < value.length &&
        /[-_A-Za-z\d\u0080-\uffff]/.test(value[end]!)
      )
        end++;
      if (value[end] === "(") {
        // Only explicit RGB channel functions are in this declaration subset.
        if (!/^(?:rgb|rgba)$/i.test(value.slice(index, end))) return fail();
        parentheses++;
        end++;
      }
      index = end - 1;
    } else if (character === "(") return fail();
    else if (character === ")" && --parentheses < 0) return fail();
  }
  if (quote || parentheses) return fail();
  return value;
}
