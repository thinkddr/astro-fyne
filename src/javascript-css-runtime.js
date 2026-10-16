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
// HTML defines these value comparisons independently of an attribute's effect.
const htmlInsensitiveAttributes = new Set([
  "accept",
  "accept-charset",
  "align",
  "alink",
  "axis",
  "bgcolor",
  "charset",
  "checked",
  "clear",
  "codetype",
  "color",
  "compact",
  "declare",
  "defer",
  "dir",
  "direction",
  "disabled",
  "enctype",
  "face",
  "frame",
  "hreflang",
  "http-equiv",
  "lang",
  "language",
  "link",
  "media",
  "method",
  "multiple",
  "nohref",
  "noresize",
  "noshade",
  "nowrap",
  "readonly",
  "rel",
  "rev",
  "rules",
  "scope",
  "scrolling",
  "selected",
  "shape",
  "target",
  "text",
  "type",
  "valign",
  "valuetype",
  "vlink",
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
            name === "*" || asciiLower(node.localName) === asciiLower(name)
          );
        if (kind === "IdSelector") return node.attrs.id === name;
        if (kind === "ClassSelector")
          return (node.attrs.class ?? "").split(/[\t\n\f\r ]+/).includes(name);
        if (kind === "attribute") {
          let actual = node.getAttribute(name),
            expected = value;
          if (actual === null) return false;
          if (!operator) return true;
          if (
            flags === "i" ||
            (!flags && htmlInsensitiveAttributes.has(asciiLower(name)))
          ) {
            actual = asciiLower(actual);
            expected = asciiLower(expected);
          }
          if (operator === "=") return actual === expected;
          if (operator === "~=")
            return (
              !!expected &&
              !/[\t\n\f\r ]/.test(expected) &&
              actual.split(/[\t\n\f\r ]+/).includes(expected)
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
              asciiLower(node.attrs.type ?? "") === "checkbox" &&
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
  const cssSpace = (value) => /[\t\n\f\r ]/.test(value ?? "");
  const nameCharacter = (value) =>
    !!value && (/[a-z0-9_-]/i.test(value) || value.charCodeAt(0) >= 0x80);
  const asciiLower = (value) => value.replace(/[A-Z]/g, (c) => c.toLowerCase());
  function commentEnd(value, at) {
    const end = value.indexOf("*/", at + 2);
    if (end < 0) throw new Error("Invalid CSS comment");
    return end + 2;
  }
  function ignoredEnd(value, at) {
    while (at < value.length) {
      if (cssSpace(value[at])) at++;
      else if (value.slice(at, at + 2) === "/*") at = commentEnd(value, at);
      else break;
    }
    return at;
  }
  function escape(value, at) {
    let end = at + 1,
      hex = "";
    if (end === value.length || /[\n\r\f]/.test(value[end]))
      throw new Error("Invalid CSS identifier escape");
    while (hex.length < 6 && /[\da-f]/i.test(value[end] ?? ""))
      hex += value[end++];
    if (hex) {
      if (value[end] === "\r" && value[end + 1] === "\n") end += 2;
      else if (cssSpace(value[end])) end++;
      const code = parseInt(hex, 16);
      return {
        end,
        text: String.fromCodePoint(
          !code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
            ? 0xfffd
            : code,
        ),
      };
    }
    const code = value.codePointAt(end);
    return {
      end: end + (code > 0xffff ? 2 : 1),
      text: String.fromCodePoint(code),
    };
  }
  function nameAt(value, at) {
    let end = at,
      name = "",
      escaped = false;
    while (end < value.length) {
      if (nameCharacter(value[end])) name += value[end++];
      else if (value[end] === "\\") {
        const part = escape(value, end);
        name += part.text;
        end = part.end;
        escaped = true;
      } else break;
    }
    return end > at ? { end, name, escaped } : null;
  }
  function identifier(value) {
    if (typeof value !== "string") return null;
    const token = nameAt(value, ignoredEnd(value, 0));
    return token && ignoredEnd(value, token.end) === value.length
      ? token
      : null;
  }
  function keyword(value) {
    const token = identifier(value);
    if (!token) return null;
    const name = asciiLower(token.name);
    return ["inherit", "unset", "initial", "revert", "revert-layer"].includes(
      name,
    )
      ? name
      : null;
  }
  function stringEnd(value, at) {
    const quote = value[at++];
    while (at < value.length) {
      if (value[at] === quote) return at + 1;
      if (value[at] === "\\") {
        if (value[at + 1] === "\r" && value[at + 2] === "\n") at += 3;
        else if (/[\n\r\f]/.test(value[at + 1] ?? "")) at += 2;
        else at = escape(value, at).end;
      } else {
        if (/[\n\r\f]/.test(value[at])) throw new Error("Invalid CSS string");
        at++;
      }
    }
    throw new Error("Invalid CSS string");
  }
  function substitutionBoundary(value, reference, replacement) {
    const { at, end, name } = reference,
      before = value[at - 1],
      after = value[end];
    if (
      (at > 0 && !cssSpace(before) && before !== "(" && before !== ",") ||
      (end < value.length && !cssSpace(after) && after !== ")" && after !== ",")
    )
      throw new Error(
        `CSS token adjacency around var(${name}) requires a native token-stream adapter`,
      );
    if (typeof replacement !== "string") return;
    for (let index = 0; index < replacement.length;) {
      if (replacement[index] === '"' || replacement[index] === "'")
        index = stringEnd(replacement, index);
      else if (replacement[index] === "\\")
        index = escape(replacement, index).end;
      else if (replacement.slice(index, index + 2) === "/*")
        throw new Error(
          `CSS comments in the replacement for var(${name}) require a native token-stream adapter`,
        );
      else index++;
    }
  }
  function nextVariable(value, start) {
    for (let at = start; at < value.length;) {
      if (value.slice(at, at + 2) === "/*") {
        at = commentEnd(value, at);
        continue;
      }
      if (value[at] === '"' || value[at] === "'") {
        at = stringEnd(value, at);
        continue;
      }
      if (value[at] === "#" || value[at] === "@") {
        at = nameAt(value, at + 1)?.end ?? at + 1;
        continue;
      }
      const token = nameAt(value, at);
      if (!token) {
        at++;
        continue;
      }
      const open = token.end;
      if (value[open] !== "(" || asciiLower(token.name) !== "var") {
        at = open;
        continue;
      }
      if (token.escaped)
        throw new Error(
          "Escaped CSS variable functions require a native token adapter",
        );
      let end = open + 1,
        comma = -1;
      const closing = [")"];
      while (end < value.length && closing.length) {
        if (value.slice(end, end + 2) === "/*") {
          end = commentEnd(value, end);
          continue;
        }
        if (value[end] === '"' || value[end] === "'") {
          end = stringEnd(value, end);
          continue;
        }
        if (value[end] === "\\") {
          end = escape(value, end).end;
          continue;
        }
        const character = value[end];
        if (character === "(" || character === "[" || character === "{")
          closing.push(character === "(" ? ")" : character === "[" ? "]" : "}");
        else if (character === ")" || character === "]" || character === "}") {
          if (closing.pop() !== character)
            throw new Error("Invalid CSS variable function");
        } else if (character === "," && closing.length === 1 && comma < 0)
          comma = end;
        end++;
      }
      if (closing.length) throw new Error("Invalid CSS variable function");
      const argument = identifier(
        value.slice(open + 1, comma < 0 ? end - 1 : comma),
      );
      if (
        !argument ||
        argument.escaped ||
        !argument.name.startsWith("--") ||
        argument.name === "--"
      )
        throw new Error(
          "CSS var first argument requires an unescaped custom-property name; other syntax needs a native token adapter",
        );
      return {
        at,
        end,
        name: argument.name,
        fallback:
          comma < 0
            ? undefined
            : value
                .slice(comma + 1, end - 1)
                .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ""),
      };
    }
    return null;
  }
  function variable(value, lookup, invalidContext = () => false) {
    if (typeof value !== "string") return value;
    let output = "",
      start = 0;
    while (true) {
      const reference = nextVariable(value, start);
      if (!reference) return output + value.slice(start);
      const { at, end, name, fallback } = reference;
      output += value.slice(start, at);
      let replacement = lookup(name);
      if (invalidContext()) return undefined;
      if (replacement === undefined && fallback !== undefined)
        replacement = variable(fallback, lookup, invalidContext);
      if (replacement === undefined) return undefined;
      substitutionBoundary(value, reference, replacement);
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
    const variables = {},
      computedVariables = { ...parent.variables };
    for (const [name, item] of Object.entries(winners)) {
      if (!name.startsWith("--")) continue;
      if (name.includes("\\"))
        throw new Error(
          "Escaped CSS custom-property names require a native token adapter",
        );
      const direct = keyword(item.value);
      delete computedVariables[name];
      if (direct === "inherit" || direct === "unset")
        computedVariables[name] = parent.variables[name];
      else if (direct === "initial") computedVariables[name] = undefined;
      else if (direct === "revert" || direct === "revert-layer")
        throw new Error(
          `CSS custom property ${direct} requires a native cascade-origin adapter`,
        );
      else variables[name] = item.value;
    }
    const active = [],
      cyclic = new Set();
    function resolveVariable(name) {
      if (Object.hasOwn(computedVariables, name))
        return computedVariables[name];
      const repeat = active.indexOf(name);
      if (repeat >= 0) {
        for (const member of active.slice(repeat)) cyclic.add(member);
        return undefined;
      }
      if (!Object.hasOwn(variables, name)) return undefined;
      if (active.length >= 32)
        throw new Error(
          "CSS variable resolution exceeds the supported depth of 32",
        );
      active.push(name);
      let resolved;
      try {
        resolved = variable(variables[name], resolveVariable, () =>
          cyclic.has(name),
        );
      } finally {
        active.pop();
      }
      if (cyclic.has(name)) resolved = undefined;
      else if (keyword(resolved))
        throw new Error(
          "CSS-wide keywords produced by custom-property substitution require a native property-replacement adapter",
        );
      computedVariables[name] = resolved;
      return resolved;
    }
    for (const name of Object.keys(variables)) resolveVariable(name);
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
      const value = variable(item.value, (name) => computedVariables[name]);
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
