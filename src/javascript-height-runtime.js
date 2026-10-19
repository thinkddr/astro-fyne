// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createValidatedMotionSampler } from "./motion-sample.js";
import { validateJavascriptZeroHeight } from "./javascript-data.ts";

const containerTags = new Set([
  "div",
  "main",
  "section",
  "article",
  "aside",
  "header",
  "footer",
]);
const defaults = {
  "animation-name": "none",
  "animation-duration": 0,
  "animation-delay": 0,
  "animation-iteration-count": 1,
  "animation-direction": "normal",
  "animation-fill-mode": "none",
  "animation-timing-function": {
    kind: "cubic-bezier",
    points: [0.25, 0.1, 0.25, 1],
  },
  "animation-play-state": "running",
};
const zero = [
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-width",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
];
function fail(detail, at = "runtime") {
  throw new Error(`CSS height animation at ${at}: ${detail}`);
}
function pixel(value, required, at) {
  let number;
  if (typeof value === "number") number = value;
  else if (
    typeof value === "string" &&
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:px)?$/.test(value)
  ) {
    number = Number(value.replace(/px$/, ""));
    if (
      number === 0 &&
      !/^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?(?:px)?$/.test(value)
    )
      fail("nonzero height underflows native pixels", at);
    if (!value.endsWith("px") && number !== 0)
      fail("height/decorations require explicit finite pixels", at);
  } else if (value === undefined && !required) return 0;
  else fail("height/decorations require explicit finite pixels", at);
  if (
    !Number.isFinite(number) ||
    number < 0 ||
    number > 1_000_000 ||
    !Number.isFinite(Math.fround(number)) ||
    (number > 0 && Math.fround(number) === 0)
  )
    fail(
      "height requires nonnegative native pixels within 1000000px; positive underflow is unsupported",
      at,
    );
  return number;
}
function box(node, values, at, requireHeight) {
  if (Object.values(node.listeners).some((list) => list.length))
    fail(
      "animated block panels require a container event adapter; listeners are unsupported",
      at,
    );
  if (
    !containerTags.has(node.localName) ||
    (values.display !== undefined && values.display !== "block") ||
    values.width !== undefined ||
    values["flex-direction"] !== undefined
  )
    fail(
      "only auto-width block containers in one column flow are supported",
      at,
    );
  for (const name of zero)
    if (values[name] !== undefined && pixel(values[name], false, at) !== 0)
      fail("animated flow requires zero padding, borders, margins and gap", at);
  if (requireHeight || values.height !== undefined)
    pixel(values.height, true, at);
}

export function createHeightAnimations() {
  const definitions = new Map(),
    bindings = new Map(),
    observed = new Map();
  let root,
    current = new Map(),
    baseline,
    initiallyInactive = false,
    timeMs = 0,
    playState = "running",
    endTimeMs = 0;
  function begin(supplied) {
    root = supplied;
    current = new Map();
    observed.clear();
  }
  function apply(node, values, winners) {
    if (definitions.size)
      for (const key of zero)
        if (
          values[key] !== undefined &&
          /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?(?:px)?$/.test(
            String(values[key]),
          )
        ) {
          if (/^margin-/.test(key)) delete values[key];
          else values[key] = "0px";
        }
    const observedEntry = { node, values, baseHeight: values.height };
    observed.set(node.uid, observedEntry);
    const name = values["animation-name"] ?? "none";
    if (name === "none") return;
    if (initiallyInactive)
      fail("changing animation target selection requires remounting");
    const definition = definitions.get(name);
    if (!definition)
      fail(`animation ${JSON.stringify(name)} has no supported @keyframes`);
    const animation = { ...defaults };
    for (const key of Object.keys(defaults))
      if (values[key] !== undefined) animation[key] = values[key];
    const at = definition.at,
      duration = animation["animation-duration"],
      delay = animation["animation-delay"],
      iterations = animation["animation-iteration-count"],
      easing = animation["animation-timing-function"];
    if (
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > 1e12 ||
      !Number.isFinite(delay) ||
      Math.abs(delay) > 1e12 ||
      !Number.isFinite(iterations) ||
      iterations < 0 ||
      iterations > 1e9 ||
      duration * iterations > 1e12 ||
      Math.abs(delay + duration * iterations) > 1e12
    )
      fail(
        "timing must be a finite single animation from a source stylesheet",
        at,
      );
    if (
      !["normal", "reverse", "alternate", "alternate-reverse"].includes(
        animation["animation-direction"],
      ) ||
      !["none", "backwards", "forwards", "both"].includes(
        animation["animation-fill-mode"],
      ) ||
      animation["animation-play-state"] !== "running" ||
      !easing ||
      !["linear", "cubic-bezier"].includes(easing.kind)
    )
      fail(
        "animation declarations require the bounded source timing profile",
        at,
      );
    if (node.childNodes.length || node.parentNode?.parentNode !== root)
      fail(
        "animated targets must be empty leaf panels directly inside the sole root",
        at,
      );
    const base = pixel(values.height, true, at),
      suppressed = !!winners.height?.rank[0],
      timing = {
        durationMs: duration,
        delayMs: delay,
        iterations,
        direction: animation["animation-direction"],
        fill: animation["animation-fill-mode"],
        easing,
      },
      signature = JSON.stringify([
        node.uid,
        node.localName,
        node.parentNode.uid,
        base,
        suppressed,
        name,
        timing,
        definition.keyframes,
      ]);
    if (base === 0 || definition.keyframes.some((frame) => frame.value === 0))
      validateJavascriptZeroHeight({
        tag: node.localName,
        css: true,
        style: {
          ...Object.fromEntries(
            Object.entries(values).map(([name, value]) => [
              name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
              value,
            ]),
          ),
          height: 0,
        },
        children: node.childNodes,
        uid: node.uid,
      });
    observedEntry.maximumHeight = suppressed
      ? base
      : Math.max(base, ...definition.keyframes.map((frame) => frame.value));
    current.set(node.uid, signature);
    let binding = bindings.get(node.uid);
    if (!binding || binding.signature !== signature) {
      const clip = {
        schema: 1,
        id: `css-height/${node.uid}`,
        tracks: [
          {
            id: "height",
            target: `node/${node.uid}`,
            property: "height",
            keyframes: definition.keyframes,
          },
        ],
        timing,
      };
      binding = { signature, sample: createValidatedMotionSampler(clip) };
      if (baseline)
        fail(
          "changing animation targets, timing or base height requires remounting",
          at,
        );
      bindings.set(node.uid, binding);
    }
    endTimeMs = Math.max(endTimeMs, Math.max(0, delay + duration * iterations));
    const sample = binding.sample(timeMs);
    if (sample.active && !suppressed)
      values.height = `${sample.values[0].value}px`;
  }
  function end() {
    if (!current.size && !baseline) {
      initiallyInactive = true;
      return;
    }
    const elements = root.childNodes.filter((node) => node.nodeType === 1);
    if (elements.length !== 1 || root.childNodes.length !== 1)
      fail("animated content requires one block-flow root");
    const parent = elements[0],
      parentValues = observed.get(parent.uid)?.values;
    if (!parentValues) fail("missing animation root style");
    box(parent, parentValues, "runtime", false);
    for (let ancestor = root; ancestor; ancestor = ancestor.parentNode) {
      if (Object.values(ancestor.listeners).some((list) => list.length))
        fail(
          "source listeners on synthetic host ancestors require a container event adapter",
        );
      const values = observed.get(ancestor.uid)?.values ?? {};
      for (const [name, value] of Object.entries(values)) {
        if (
          [
            "color",
            "font-family",
            "font-size",
            "font-style",
            "font-weight",
            "line-height",
            "text-align",
            "white-space",
          ].includes(name)
        )
          continue;
        if (zero.includes(name) && pixel(value, false, "runtime") === 0)
          continue;
        if (name === "display" && value === "block") continue;
        if (
          name.startsWith("animation-") &&
          (values["animation-name"] ?? "none") === "none"
        )
          continue;
        fail(
          "source styles on synthetic host ancestors require a host layout/paint adapter",
        );
      }
    }
    const context = [];
    let maximumFlowHeight = 0;
    for (const child of parent.childNodes) {
      const entry = observed.get(child.uid);
      if (!entry || child.nodeType !== 1 || child.childNodes.length)
        fail(
          "animated flow siblings require empty block panels with explicit height",
        );
      box(child, entry.values, "runtime", true);
      maximumFlowHeight +=
        entry.maximumHeight ?? pixel(entry.baseHeight, true, "runtime");
      if (maximumFlowHeight > 1_000_000)
        fail("aggregate animated flow must remain within 1000000px");
      context.push([
        child.uid,
        child.localName,
        entry.values.width,
        entry.baseHeight,
        entry.values.display,
        zero.map((key) => entry.values[key] ?? 0),
      ]);
    }
    const next = JSON.stringify([
      [...current],
      parent.uid,
      parent.localName,
      parentValues.width,
      parentValues.height,
      context,
    ]);
    if (baseline && baseline !== next)
      fail(
        "changing animation target selection or its flow context requires remounting",
      );
    baseline = next;
  }
  function state() {
    return { schema: 1, timeMs, playState };
  }
  function setState(next) {
    if (
      !next ||
      next.schema !== 1 ||
      typeof next.timeMs !== "number" ||
      !Number.isFinite(next.timeMs) ||
      next.timeMs < 0 ||
      next.timeMs > 1e12 ||
      !["running", "paused", "finished"].includes(next.playState)
    )
      fail("invalid animation clock state");
    if (next.playState === "finished" && next.timeMs < endTimeMs)
      fail("finished animation state precedes its compiled end time");
    timeMs = next.timeMs;
    playState = next.playState;
  }
  return {
    install(definition) {
      definitions.set(definition.name, definition);
    },
    begin,
    apply,
    end,
    state,
    setState,
    advance(next) {
      if (!Number.isFinite(next) || next < timeMs || next > 1e12)
        fail("logical animation time must advance monotonically within 1e12ms");
      timeMs = next;
      if (playState === "running" && timeMs >= endTimeMs)
        playState = "finished";
    },
    pause() {
      if (playState === "running") playState = "paused";
    },
    play() {
      if (playState === "paused") playState = "running";
    },
  };
}
