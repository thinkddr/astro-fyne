// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

const inherited = new Set([
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "text-align",
  "white-space",
]);
const controlDefaults = new Set([
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
]);
const camel = (name) =>
  name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const kebab = (name) =>
  name.startsWith("--")
    ? name
    : name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());

/** Source rules remain in the archived program, not in a browser dependency. */
export function createCSSCascade() {
  const rules = [],
    layers = [];
  let active = false;
  function install(packet) {
    active = true;
    for (const item of packet) {
      if (item.layers)
        for (const layer of item.layers) {
          if (!layers.includes(layer)) layers.push(layer);
        }
      else rules.push(item);
    }
    if (rules.length > 100000)
      throw new Error("CSS cascade exceeds its rule limit");
  }
  function previous(node) {
    const siblings =
      node.parentNode?.childNodes.filter((n) => n.nodeType === 1) ?? [];
    return siblings[siblings.indexOf(node) - 1] ?? null;
  }
  function matches(selector, node, index = selector.parts.length - 1) {
    if (!node || node.nodeType !== 1) return false;
    const part = selector.parts[index];
    if (
      !part.tests.every((test) => {
        const [kind, name, operator, value, flags] = test;
        if (kind === "TypeSelector")
          return (
            name === "*" || node.localName.toLowerCase() === name.toLowerCase()
          );
        if (kind === "IdSelector") return node.attrs.id === name;
        if (kind === "ClassSelector")
          return (node.attrs.class ?? "").split(/\s+/).includes(name);
        if (kind === "attribute") {
          let actual = node.getAttribute(name),
            expected = value;
          if (actual === null) return false;
          if (!operator) return true;
          if (flags === "i") {
            actual = actual.replace(/[A-Z]/g, (c) => c.toLowerCase());
            expected = expected.replace(/[A-Z]/g, (c) => c.toLowerCase());
          }
          if (operator === "=") return actual === expected;
          if (operator === "~=")
            return (
              !!expected &&
              !/\s/.test(expected) &&
              actual.split(/\s+/).includes(expected)
            );
          if (operator === "|=")
            return actual === expected || actual.startsWith(expected + "-");
          if (operator === "^=")
            return !!expected && actual.startsWith(expected);
          if (operator === "$=") return !!expected && actual.endsWith(expected);
          if (operator === "*=") return !!expected && actual.includes(expected);
          throw new Error("CSS attribute operator requires an adapter");
        }
        if (["is", "where", "not"].includes(kind)) {
          const hit = name.some((item) => matches(item, node));
          return kind === "not" ? !hit : hit;
        }
        if (kind === "pseudo") {
          if (name === "root") return node.localName === "html";
          if (name === "checked")
            return (
              node.localName === "input" &&
              node.attrs.type === "checkbox" &&
              node._checked
            );
          if (name === "disabled" || name === "enabled")
            return (
              ["input", "button", "textarea"].includes(node.localName) &&
              !!node.disabled === (name === "disabled")
            );
          if (name === "empty")
            return !node.childNodes.some(
              (n) => n.nodeType === 1 || n.data?.length,
            );
          if (name === "first-child") return !previous(node);
          if (name === "last-child")
            return (
              node ===
              node.parentNode?.childNodes.filter((n) => n.nodeType === 1).at(-1)
            );
        }
        return false;
      })
    )
      return false;
    if (!index) return true;
    if (part.before === ">")
      return matches(selector, node.parentNode, index - 1);
    if (part.before === "+")
      return matches(selector, previous(node), index - 1);
    if (part.before === "~") {
      for (let p = previous(node); p; p = previous(p))
        if (matches(selector, p, index - 1)) return true;
      return false;
    }
    for (let p = node.parentNode; p; p = p.parentNode)
      if (matches(selector, p, index - 1)) return true;
    return false;
  }
  function variable(value, variables, seen = []) {
    if (typeof value !== "string") return value;
    let output = "",
      start = 0;
    while (true) {
      let at = -1,
        quoted = null;
      for (let i = start; i < value.length; i++) {
        if (value[i] === "\\") {
          i++;
          continue;
        }
        if (quoted) {
          if (value[i] === quoted) quoted = null;
        } else if (value[i] === '"' || value[i] === "'") quoted = value[i];
        else if (value.slice(i, i + 4) === "var(") {
          at = i;
          break;
        }
      }
      if (at < 0) return output + value.slice(start);
      output += value.slice(start, at);
      let end = at + 4,
        depth = 1,
        comma = -1;
      for (; end < value.length && depth; end++) {
        if (value[end] === "\\") {
          end++;
          continue;
        }
        if (quoted) {
          if (value[end] === quoted) quoted = null;
        } else if (value[end] === '"' || value[end] === "'")
          quoted = value[end];
        else if (value[end] === "(") depth++;
        else if (value[end] === ")") depth--;
        else if (value[end] === "," && depth === 1 && comma < 0) comma = end;
      }
      if (depth) throw new Error("Invalid CSS variable function");
      const name = value.slice(at + 4, comma < 0 ? end - 1 : comma).trim();
      let replacement =
        seen.includes(name) || seen.length > 32
          ? undefined
          : variable(variables[name], variables, [...seen, name]);
      if (replacement === undefined && comma >= 0)
        replacement = variable(
          value.slice(comma + 1, end - 1).trim(),
          variables,
          seen,
        );
      if (replacement === undefined) return undefined;
      output += replacement;
      start = end;
    }
  }
  function declarations(name, value) {
    if (name === "padding") {
      const parts =
        typeof value === "number" ? [value] : String(value).trim().split(/\s+/);
      if (!parts.length || parts.length > 4)
        throw new Error(
          "CSS padding requires one to four supported dimensions",
        );
      return ["top", "right", "bottom", "left"].map((side, i) => [
        "padding-" + side,
        parts[i] ?? parts[i === 2 ? 0 : 1] ?? parts[0],
      ]);
    }
    if (name === "background") {
      if (!/^#[\da-f]{3,8}$|^[a-z]+$|^(?:rgb|rgba)\(/i.test(String(value)))
        throw new Error("CSS background requires a native solid-color adapter");
      return [["background-color", value]];
    }
    return [[name, value]];
  }
  function compute(node, parent = { values: {}, variables: {} }) {
    const winners = Object.create(null);
    const put = (name, value, rank) => {
      const old = winners[name];
      if (
        !old ||
        rank.some(
          (item, i) =>
            item !== old.rank[i] &&
            rank.slice(0, i).every((x, j) => x === old.rank[j]) &&
            item > old.rank[i],
        )
      )
        winners[name] = { value, rank };
    };
    for (const [order, rule] of rules.entries()) {
      for (const selector of rule.selectors) {
        if (!matches(selector, node)) continue;
        for (const [declarationOrder, item] of rule.declarations.entries()) {
          const layer =
            rule.layer === null ? layers.length : layers.indexOf(rule.layer);
          const rank = [
            item.important ? 1 : 0,
            0,
            item.important ? -layer : layer,
            ...selector.specificity,
            order,
            declarationOrder,
          ];
          // Custom property substitution precedes shorthand expansion below.
          put(item.name, item.value, rank);
        }
      }
    }
    for (const [order, [key, value]] of Object.entries(node.style).entries()) {
      if (value !== "")
        put(kebab(key), value, [
          node._stylePriority?.[key] ? 1 : 0,
          1,
          0,
          0,
          0,
          0,
          order,
          0,
        ]);
    }
    const variables = { ...parent.variables };
    for (const [name, item] of Object.entries(winners))
      if (name.startsWith("--")) variables[name] = item.value;
    const computedVariables = {};
    for (const name of Object.keys(variables))
      computedVariables[name] = variable(variables[name], variables, [name]);
    const values = {};
    for (const [name, value] of Object.entries(parent.values))
      if (
        inherited.has(name) &&
        (!["button", "input", "textarea"].includes(node.localName) ||
          !controlDefaults.has(name))
      )
        values[name] = value;
    const expanded = Object.create(null);
    for (const [name, item] of Object.entries(winners)) {
      if (name.startsWith("--")) continue;
      const value = variable(item.value, computedVariables);
      if (value === undefined)
        throw new Error(
          `CSS variable in ${name} needs a valid value or fallback`,
        );
      for (const [property, result] of declarations(name, value)) {
        const old = expanded[property];
        if (
          !old ||
          item.rank.some(
            (n, i) =>
              n !== old.rank[i] &&
              item.rank.slice(0, i).every((v, j) => v === old.rank[j]) &&
              n > old.rank[i],
          )
        )
          expanded[property] = { value: result, rank: item.rank };
      }
    }
    for (const [name, item] of Object.entries(expanded)) {
      if (
        item.value === "inherit" ||
        (item.value === "unset" && inherited.has(name))
      ) {
        if (parent.values[name] === undefined)
          throw new Error(
            `CSS ${name} inheritance needs an initial-value adapter`,
          );
        values[name] = parent.values[name];
      } else if (
        ["initial", "unset", "revert", "revert-layer"].includes(item.value)
      )
        throw new Error(
          `CSS ${item.value} needs an initial-value/layer adapter`,
        );
      else values[name] = item.value;
    }
    const style = {};
    for (const [name, value] of Object.entries(values).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ))
      style[camel(name)] =
        name === "line-height" &&
        typeof value === "string" &&
        /^\d+(\.\d+)?$/.test(value)
          ? Number(value)
          : value;
    return { values, variables: computedVariables, style };
  }
  return {
    install,
    compute,
    get active() {
      return active;
    },
  };
}
