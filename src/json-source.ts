// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { validJavascriptText } from "./javascript-data.ts";

/** Check raw keys before JSON.parse can discard duplicates or escaped aliases. */
export function parseJSONSource(
  source: string,
  fail: (message: string) => never,
  maxDocumentBytes = 128 * 1024 * 1024,
  sizeMessage = "JSON requires valid text within 128MiB",
): unknown {
  if (
    typeof source !== "string" ||
    !source ||
    Buffer.byteLength(source) > maxDocumentBytes
  )
    fail(sizeMessage);
  validJavascriptText(source);
  let at = 0,
    count = 0;
  const whitespace = () => {
    while (at < source.length && /[\t\n\r ]/.test(source[at]!)) at++;
  };
  const string = (): string => {
    if (source[at] !== '"') fail("expected a JSON string");
    const start = at++;
    while (at < source.length) {
      const char = source[at++]!;
      if (char === '"') {
        try {
          return validJavascriptText(
            JSON.parse(source.slice(start, at)) as string,
          );
        } catch {
          fail("invalid JSON string or Unicode surrogate");
        }
      }
      if (char === "\\") at++;
    }
    fail("unterminated JSON string");
  };
  const visit = (depth: number): void => {
    if (depth > 256 || ++count > 1000000)
      fail("JSON depth/value limit exceeded");
    whitespace();
    const char = source[at];
    if (char === '"') {
      string();
      return;
    }
    if (char === "{" || char === "[") {
      const object = char === "{",
        end = object ? "}" : "]",
        keys = new Set<string>();
      at++;
      whitespace();
      if (source[at] === end) {
        at++;
        return;
      }
      for (;;) {
        if (object) {
          const key = string();
          if (keys.has(key))
            fail(`duplicate JSON field ${JSON.stringify(key)}`);
          keys.add(key);
          whitespace();
          if (source[at++] !== ":") fail("expected a JSON colon");
        }
        visit(depth + 1);
        whitespace();
        if (source[at] === end) {
          at++;
          return;
        }
        if (source[at++] !== ",") fail("expected a JSON separator");
        whitespace();
      }
    }
    const token =
      /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        source.slice(at),
      );
    if (!token) fail("invalid JSON value");
    at += token[0].length;
  };
  visit(0);
  whitespace();
  if (at !== source.length) fail("expected one JSON document");
  try {
    return JSON.parse(source);
  } catch {
    fail("invalid JSON");
  }
}
