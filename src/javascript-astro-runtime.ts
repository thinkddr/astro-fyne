// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { isValidElement } from "preact";
import { javascriptHostJSON } from "./javascript-data.ts";

/** Astro renders functions/iterables and some scalars differently from JSX. */
export function astroChild(
  value: any,
  depth = 0,
  budget = { remaining: 100000 },
): any {
  if (++depth > 100 || --budget.remaining < 0)
    throw new Error("Astro children exceed the native depth/value limit");
  if (isValidElement(value) || typeof value === "string") return value;
  if (value == null || value === false) return null;
  if (Array.isArray(value))
    return value.map((item) => astroChild(item, depth, budget));
  if (typeof value === "function") return astroChild(value(), depth, budget);
  if (typeof value === "object") {
    if (
      value instanceof Promise ||
      typeof value.then === "function" ||
      Symbol.asyncIterator in value
    )
      throw new Error(
        "Async Astro rendering requires an SSR/event-loop adapter",
      );
    if (
      ArrayBuffer.isView(value) ||
      value[Symbol.for("astro:html-string")] ||
      value[Symbol.for("astro:slot-string")]
    )
      throw new Error(
        "Raw Astro HTML/bytes require a native rich-text adapter",
      );
    if (Symbol.iterator in value) {
      const result = [];
      for (const item of value) result.push(astroChild(item, depth, budget));
      return result;
    }
  }
  const text = String(value);
  if (typeof value === "object" && /[<&]/.test(text))
    throw new Error(
      "Object Astro HTML rendering requires a native HTML adapter",
    );
  return text;
}

export function astroContext(
  props: Record<string, any>,
  slots: Record<string, () => any>,
) {
  return new Proxy(
    {
      props,
      slots: {
        has(name: string) {
          return Object.hasOwn(slots, name);
        },
        render() {
          throw new Error(
            "Astro.slots.render requires an async HTML adapter; use <slot> for native content",
          );
        },
      },
    },
    {
      get(target, name, receiver) {
        if (typeof name === "symbol" || name in target)
          return Reflect.get(target, name, receiver);
        throw new Error(
          `Astro.${String(name)} requires an explicit SSR/platform adapter`,
        );
      },
    },
  );
}

const documents = new WeakMap<object, Set<string>>();
export function astroScript(key: string, run: () => void) {
  let scripts = documents.get(document);
  if (!scripts) documents.set(document, (scripts = new Set()));
  if (scripts.has(key)) return;
  scripts.add(key);
  run();
}

/** Ordinary HTML attributes stringify booleans; boolean attributes do not. */
export function astroAttributes(
  values: Record<string, any>,
  component: boolean,
  hydrated = false,
) {
  const result: Record<string, any> = {};
  for (const name of Object.keys(values)) {
    if (
      name.startsWith("_afyAstro") ||
      name.includes(":") ||
      (!component && /^on/i.test(name)) ||
      (!component && ["key", "ref", "children"].includes(name))
    )
      throw new Error(
        `Astro attribute ${name} requires an explicit native directive/event adapter`,
      );
    const value = values[name];
    if (!component && name === "style" && value != null) {
      if (typeof value !== "object" || Array.isArray(value))
        throw new Error(
          "Astro inline styles require a supported CSS object with explicit pixel units",
        );
      for (const key of Object.keys(value))
        if (
          typeof value[key] === "number" &&
          value[key] !== 0 &&
          !["fontWeight", "lineHeight"].includes(key)
        )
          throw new Error(
            "Astro numeric CSS dimensions require explicit pixel units",
          );
    }
    if (component || name === "style" || name === "disabled" || value == null) {
      Object.defineProperty(result, name, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else {
      if (typeof value === "function")
        throw new Error(
          "Functions cannot be serialized as Astro HTML attributes",
        );
      Object.defineProperty(result, name, {
        value: String(value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  if (hydrated) return JSON.parse(javascriptHostJSON(result));
  return result;
}
