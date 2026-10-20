// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import type {
  JavascriptAnimationState,
  JavascriptFrame,
} from "./javascript-types.ts";

export const fontResourceFactoryHeader = "/* astro-fyne font resources:1 */\n";

export function validateJavascriptBrowserResources(archive: {
  code: string;
}): void {
  if (archive.code.startsWith(fontResourceFactoryHeader))
    throw new Error(
      "JavaScript font resource factories require a browser resource adapter",
    );
}

/** Zero sizing is admitted only where native flow has the same empty box. */
export function validateJavascriptZeroHeight(frame: JavascriptFrame): void {
  const style = frame.style ?? {},
    value = style.height;
  let height: number | undefined;
  if (typeof value === "number") height = value;
  else if (typeof value === "string") {
    const text = value.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, "");
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:px)?$/.test(text)) {
      const parsed = Number(text.replace(/px$/, ""));
      if (
        parsed === 0 &&
        !/^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?(?:px)?$/.test(text)
      )
        throw new Error("CSS nonzero height underflows native pixels");
      if (text.endsWith("px") || parsed === 0) height = parsed;
    }
  }
  if (height !== undefined && height > 0 && Math.fround(height) === 0)
    throw new Error("CSS positive height underflows native pixels");
  if (height !== 0) return;
  if (!frame.css)
    throw new Error(
      "CSS zero height requires the stylesheet cascade adapter; inline-only zero sizing is unsupported",
    );
  const dimensions: Record<string, number> = {};
  for (const name of ["fontSize", "lineHeight", "borderRadius"]) {
    const value = style[name];
    if (value === undefined || value === "") continue;
    const text = String(value).replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, ""),
      dimension = Number(text.replace(/px$/, ""));
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:px)?$/.test(text) ||
      !Number.isFinite(dimension) ||
      dimension < 0 ||
      (typeof value === "number" &&
        name !== "lineHeight" &&
        dimension > 3.4028234663852886e38) ||
      (typeof value === "string" && !text.endsWith("px") && dimension !== 0)
    )
      throw new Error(`CSS ${name} requires finite nonnegative pixels`);
    if (
      dimension === 0 &&
      !/^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?(?:px)?$/.test(text)
    )
      throw new Error(`CSS nonzero ${name} underflows native pixels`);
    if (dimension === 0)
      throw new Error(`CSS zero ${name} requires presence-aware native sizing`);
    const native = Math.fround(dimension);
    if (!Number.isFinite(native) || native === 0)
      throw new Error(`CSS ${name} is outside positive native pixels`);
    dimensions[name] = native;
  }
  if (typeof style.lineHeight === "number") {
    const lineHeight = Math.fround(
      dimensions.lineHeight! * (dimensions.fontSize ?? 14),
    );
    if (!Number.isFinite(lineHeight) || lineHeight === 0)
      throw new Error(
        "CSS lineHeight multiplier is outside positive native pixels",
      );
  }
  const zero = (value: unknown) =>
    value === undefined ||
    value === "" ||
    (typeof value === "number"
      ? value === 0
      : typeof value === "string" &&
        /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?(?:px)?$/.test(
          value.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, ""),
        ));
  if (
    !new Set([
      "div",
      "main",
      "section",
      "article",
      "aside",
      "header",
      "footer",
    ]).has(frame.tag) ||
    (frame.children?.length ?? 0) !== 0 ||
    (frame.text ?? "") !== "" ||
    (style.display !== undefined &&
      style.display !== "" &&
      style.display !== "block") ||
    (style.width !== undefined && style.width !== "") ||
    (style.flexDirection !== undefined && style.flexDirection !== "") ||
    [
      "padding",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderWidth",
      "borderRadius",
      "margin",
      "gap",
    ].some((name) => !zero(style[name]))
  )
    throw new Error(
      "CSS zero height requires an empty undecorated auto-width block leaf",
    );
}

export function validateJavascriptAnimationState(
  value: unknown,
): JavascriptAnimationState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("JavaScript animation state requires an object");
  const state = value as Record<string, unknown>;
  if (
    Object.keys(state).length !== 3 ||
    state.schema !== 1 ||
    typeof state.timeMs !== "number" ||
    !Number.isFinite(state.timeMs) ||
    state.timeMs < 0 ||
    state.timeMs > 1e12 ||
    !["running", "paused", "finished"].includes(state.playState as string)
  )
    throw new Error("Invalid JavaScript animation state");
  return {
    schema: 1,
    timeMs: state.timeMs,
    playState: state.playState as JavascriptAnimationState["playState"],
  };
}

export function validJavascriptText(text: string): string {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new Error("Isolated UTF-16 surrogates require a data adapter");
    } else if (unit >= 0xdc00 && unit <= 0xdfff)
      throw new Error("Isolated UTF-16 surrogates require a data adapter");
  }
  return text;
}
export function javascriptUTF8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 128) bytes++;
    else if (unit < 2048) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** The host boundary transfers ordinary finite JSON values, never methods/getters. */
export function javascriptHostJSON(value: unknown): string {
  const active = new Set<object>();
  let count = 0;
  function check(value: unknown, depth: number): void {
    if (depth > 100 || ++count > 100000)
      throw new Error("Host data exceeds its depth/value limit");
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "string") {
      validJavascriptText(value);
      return;
    }
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      !Object.is(value, -0)
    )
      return;
    if (typeof value !== "object" || active.has(value))
      throw new Error(
        "Host bindings require finite JSON data without functions, cycles or undefined",
      );
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype
    )
      throw new Error("Host objects require a data adapter");
    if (Object.getOwnPropertySymbols(value).length)
      throw new Error("Host symbols require a data adapter");
    active.add(value);
    const keys = Object.getOwnPropertyNames(value);
    if (Array.isArray(value)) {
      if (keys.length !== value.length + 1)
        throw new Error("Sparse/custom host arrays require a data adapter");
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          throw new Error("Host array accessors require a data adapter");
        check(descriptor.value, depth + 1);
      }
    } else
      for (const key of keys) {
        validJavascriptText(key);
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable || !("value" in descriptor))
          throw new Error(
            "Host getters/nonenumerable data require a data adapter",
          );
        check(descriptor.value, depth + 1);
      }
    active.delete(value);
  }
  check(value, 0);
  const result = JSON.stringify(value);
  if (javascriptUTF8Bytes(result) > 1024 * 1024)
    throw new Error("Host data exceeds 1MiB");
  return result;
}
