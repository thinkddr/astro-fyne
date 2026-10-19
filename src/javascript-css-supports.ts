// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// A bounded browser capability contract, checked against the real Chromium
// oracle in CI. Unknown probes must not silently select a different CSS branch.
export const cssSupportsProfile: readonly (readonly [string, boolean])[] = [
  ["display:block", true],
  ["display:none", true],
  ["display:flex", true],
  ["display:inline-flex", true],
  ["display:grid", true],
  ["display:astro-fyne-invalid", false],
  ["color:red", true],
  ["color:astro-fyne-invalid", false],
  ["-webkit-hyphens:none", true],
  ["margin-trim:inline", false],
  ["-moz-orient:inline", false],
];
const probes = new Map(cssSupportsProfile);
const lower = (text: string) =>
  text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** Evaluate the parsed CSS Supports grammar, including nested boolean groups. */
export function evaluateCSSSupports(
  node: any,
  generate: (node: any) => string,
  decode: (name: string) => string,
): boolean {
  const fail = (detail: string): never => {
    throw new Error(
      `CSS @supports ${detail} requires a native feature-query adapter`,
    );
  };
  function term(item: any): boolean {
    if (item.type === "Condition") return condition(item);
    if (item.type !== "SupportsDeclaration")
      return fail(`query ${generate(item)}`);
    const declaration = item.declaration;
    if (declaration.important) return false;
    const key = `${lower(decode(declaration.property))}:${lower(generate(declaration.value))}`;
    const supported = probes.get(key);
    if (supported === undefined) return fail(`declaration (${key})`);
    return supported;
  }
  function condition(item: any): boolean {
    if (item.kind !== "supports" || !Array.isArray(item.children))
      return fail("condition syntax");
    const children = item.children;
    if (
      children[0]?.type === "Identifier" &&
      lower(children[0].name) === "not"
    ) {
      if (children.length !== 2) return fail("negation syntax");
      return !term(children[1]);
    }
    if (!children.length || children.length % 2 !== 1)
      return fail("boolean syntax");
    const values: boolean[] = [];
    let operator: string | undefined;
    for (let i = 0; i < children.length; i++) {
      if (i % 2 === 0) {
        // Check every probe, even when a preceding operand decides the result.
        values.push(term(children[i]));
      } else {
        const next = children[i];
        const name = next.type === "Identifier" ? lower(next.name) : "";
        if (!["and", "or"].includes(name) || (operator && operator !== name))
          return fail("boolean operator syntax");
        operator = name;
      }
    }
    return operator === "or" ? values.some(Boolean) : values.every(Boolean);
  }
  return condition(node);
}
