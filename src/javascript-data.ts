// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

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
