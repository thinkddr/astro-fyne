// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

const properties = [
  "name",
  "duration",
  "delay",
  "iteration-count",
  "direction",
  "fill-mode",
  "timing-function",
  "play-state",
];
const reserved = new Set([
  "none",
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
  "default",
]);
const names = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;
const easings: Record<string, number[] | null> = {
  linear: null,
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};
const defaults: Record<string, unknown> = {
  "animation-name": "none",
  "animation-duration": 0,
  "animation-delay": 0,
  "animation-iteration-count": 1,
  "animation-direction": "normal",
  "animation-fill-mode": "none",
  "animation-timing-function": { kind: "cubic-bezier", points: easings.ease },
  "animation-play-state": "running",
};
function fail(at: string, detail: string): never {
  throw new Error(`CSS height animation at ${at}: ${detail}`);
}
export function heightCSSParser(css: any) {
  return css.fork({
    atrule: {
      keyframes: {
        parse: {
          prelude(this: any) {
            return this.createSingleNodeList(this.Identifier());
          },
          block(this: any) {
            const before = this.parseRulePrelude;
            this.parseRulePrelude = false;
            try {
              return this.Block(false);
            } finally {
              this.parseRulePrelude = before;
            }
          },
        },
      },
    },
  });
}
function identifier(node: any, css: any, at: string) {
  if (node?.type !== "Identifier" || !names.test(node.name))
    fail(at, "names require an unescaped ASCII CSS identifier");
  return css.ident.decode(node.name);
}
function number(node: any, at: string, minimum: number, maximum: number) {
  const value = Number(node?.value);
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    fail(at, "numeric value exceeds the supported range");
  return value;
}
function easing(node: any, css: any, at: string): unknown {
  if (node?.type === "Identifier") {
    const name = identifier(node, css, at).toLowerCase();
    if (Object.hasOwn(easings, name))
      return easings[name]
        ? { kind: "cubic-bezier", points: easings[name] }
        : { kind: "linear" };
  }
  if (node?.type === "Function" && node.name.toLowerCase() === "cubic-bezier") {
    const children = node.children;
    if (
      children.length === 7 &&
      children.every((item: any, index: number) =>
        index % 2
          ? item.type === "Operator" && item.value === ","
          : item.type === "Number",
      )
    ) {
      const points = children
        .filter((_: unknown, index: number) => !(index % 2))
        .map((item: any) => number(item, at, 0, 1));
      return { kind: "cubic-bezier", points };
    }
  }
  return fail(
    at,
    "only linear, named CSS easing or non-overshooting cubic-bezier timing is supported",
  );
}
function time(node: any, at: string, minimum: number) {
  if (
    node?.type !== "Dimension" ||
    !["ms", "s"].includes(node.unit.toLowerCase())
  )
    fail(at, "animation timing requires explicit s or ms units");
  const value =
    number(node, at, -1e12, 1e12) *
    (node.unit.toLowerCase() === "s" ? 1000 : 1);
  if (value < minimum || Math.abs(value) > 1e12)
    fail(at, "animation time exceeds the finite timeline");
  return value;
}
function valueFor(name: string, node: any, css: any, at: string): unknown {
  if (name === "animation-duration") return time(node, at, 0);
  if (name === "animation-delay") return time(node, at, -1e12);
  if (name === "animation-iteration-count") {
    if (node?.type !== "Number")
      fail(at, "infinite repetition requires another timeline contract");
    return number(node, at, 0, 1e9);
  }
  if (name === "animation-timing-function") return easing(node, css, at);
  const value = identifier(node, css, at);
  if (name === "animation-name") {
    if (value.toLowerCase() === "none") return "none";
    if (reserved.has(value.toLowerCase()))
      fail(at, "CSS-wide animation names require another cascade profile");
    return value;
  }
  const allowed: Record<string, string[]> = {
    "animation-direction": [
      "normal",
      "reverse",
      "alternate",
      "alternate-reverse",
    ],
    "animation-fill-mode": ["none", "backwards", "forwards", "both"],
    "animation-play-state": ["running"],
  };
  const lower = value.toLowerCase();
  if (!allowed[name]?.includes(lower))
    fail(at, `${name} value requires another animation profile`);
  return lower;
}

/** Lower one animation to ordered longhands before cascade selection. */
export function compileHeightAnimation(
  name: string,
  value: any,
  css: any,
  at: string,
): [string, unknown][] | undefined {
  if (name !== "animation" && !name.startsWith("animation-")) return;
  const children = value?.children;
  if (
    !Array.isArray(children) ||
    !children.length ||
    children.some(
      (node: any) => node.type === "Operator" || node.type === "Raw",
    )
  )
    fail(
      at,
      "animation lists and unresolved values require another animation profile",
    );
  if (name !== "animation") {
    if (
      !properties.some((property) => `animation-${property}` === name) ||
      children.length !== 1
    )
      fail(at, `${name} requires another animation profile`);
    return [[name, valueFor(name, children[0], css, at)]];
  }
  const result = { ...defaults },
    set = new Set<string>();
  function assign(key: string, node: any) {
    if (set.has(key)) fail(at, `duplicate ${key} in animation shorthand`);
    result[key] = valueFor(key, node, css, at);
    set.add(key);
  }
  for (const node of children) {
    if (node.type === "Dimension")
      assign(
        set.has("animation-duration")
          ? "animation-delay"
          : "animation-duration",
        node,
      );
    else if (node.type === "Number") assign("animation-iteration-count", node);
    else if (node.type === "Function")
      assign("animation-timing-function", node);
    else {
      const value = identifier(node, css, at).toLowerCase();
      const key =
        value === "infinite"
          ? "animation-iteration-count"
          : Object.hasOwn(easings, value) ||
              ["step-start", "step-end"].includes(value)
            ? "animation-timing-function"
            : ["normal", "reverse", "alternate", "alternate-reverse"].includes(
                  value,
                )
              ? "animation-direction"
              : ["none", "backwards", "forwards", "both"].includes(value)
                ? "animation-fill-mode"
                : ["running", "paused"].includes(value)
                  ? "animation-play-state"
                  : "animation-name";
      assign(set.has(key) ? "animation-name" : key, node);
    }
  }
  return Object.entries(result);
}

export function compileHeightKeyframes(node: any, css: any, at: string) {
  const prelude = node.prelude?.children;
  if (prelude?.length !== 1 || !node.block)
    fail(at, "@keyframes requires one name and a block");
  const name = identifier(prelude[0], css, at);
  if (reserved.has(name.toLowerCase())) fail(at, "reserved @keyframes name");
  const frames = new Map<number, number>();
  for (const rule of node.block.children) {
    if (rule.type === "Comment") continue;
    if (rule.type !== "Rule" || rule.prelude?.type !== "Raw")
      fail(at, "keyframe blocks require ordinary percentage selectors");
    const selectors = css.toPlainObject(
      css.parse(rule.prelude.value, { context: "value" }),
    ).children;
    if (!selectors.length || selectors.length % 2 === 0)
      fail(at, "invalid keyframe percentage selector");
    const offsets: number[] = [];
    for (const [index, item] of selectors.entries()) {
      if (index % 2) {
        if (item.type !== "Operator" || item.value !== ",")
          fail(at, "invalid keyframe selector list");
        continue;
      }
      if (item.type === "Percentage")
        offsets.push(number(item, at, 0, 100) / 100);
      else if (
        item.type === "Identifier" &&
        ["from", "to"].includes(item.name.toLowerCase())
      )
        offsets.push(item.name.toLowerCase() === "from" ? 0 : 1);
      else fail(at, "keyframe selectors require from, to or percentages");
    }
    let height: number | undefined;
    for (const declaration of rule.block.children) {
      if (declaration.type === "Comment") continue;
      if (
        declaration.type !== "Declaration" ||
        declaration.property.toLowerCase() !== "height" ||
        declaration.important
      )
        fail(
          at,
          "keyframes support only ordinary height declarations; interval easing and other properties require adapters",
        );
      const values = declaration.value?.children;
      if (
        values?.length !== 1 ||
        !(
          (values[0].type === "Dimension" &&
            values[0].unit.toLowerCase() === "px") ||
          (values[0].type === "Number" && Number(values[0].value) === 0)
        )
      )
        fail(at, "keyframe height requires explicit nonnegative pixels");
      height = number(values[0], at, 0, 1_000_000);
      if (
        (height > 0 && Math.fround(height) === 0) ||
        (height === 0 &&
          !/^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?$/.test(
            String(values[0].value),
          ))
      )
        fail(at, "positive height underflows native pixels");
    }
    if (height === undefined) fail(at, "every keyframe block requires height");
    for (const offset of offsets) frames.set(offset, height);
  }
  if (
    frames.size < 2 ||
    frames.size > 10000 ||
    !frames.has(0) ||
    !frames.has(1)
  )
    fail(
      at,
      "height tracks require explicit 0% and 100% endpoints within 10000 frames",
    );
  return {
    name,
    keyframes: [...frames]
      .sort(([a], [b]) => a - b)
      .map(([offset, value]) => ({ offset, value })),
    at,
  };
}
