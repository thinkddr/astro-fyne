// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";

const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);

test("CharacterData clears only null and otherwise converts accepted values to DOM strings", () => {
  const { document, root, snapshot } = createDocument();
  const text = document.createTextNode("seed");
  root.appendChild(text);
  const uid = text.uid;
  for (const [value, expected] of [
    [null, ""],
    [undefined, "undefined"],
    [42, "42"],
  ]) {
    text.data = value;
    expect(text.data).toBe(expected);
    expect(text.textContent).toBe(expected);
    expect(root.textContent).toBe(expected);
    expect(root.firstChild).toBe(text);
    expect(text.uid).toBe(uid);
    expect(snapshot()[0].text).toBe(expected);
  }
  const before = snapshot();
  expect(() => {
    text.data = Symbol("rejected");
  }).toThrow(TypeError);
  expect(text.data).toBe("42");
  expect(root.firstChild).toBe(text);
  expect(snapshot()).toEqual(before);
  expect(document.createTextNode(null).data).toBe("null");
});

test("CharacterData changes textarea defaults without replacing edited live values", () => {
  const { document, root, snapshot } = createDocument();
  const pristine = document.createElement("textarea"),
    dirty = document.createElement("textarea");
  const first = document.createTextNode("seed"),
    second = document.createTextNode("seed");
  pristine.appendChild(first);
  dirty.appendChild(second);
  root.appendChild(pristine);
  root.appendChild(dirty);
  dirty.value = "edited";
  for (const [value, expected] of [
    [null, ""],
    [undefined, "undefined"],
    [42, "42"],
  ]) {
    first.data = value;
    second.data = value;
    expect(pristine.defaultValue).toBe(expected);
    expect(pristine.value).toBe(expected);
    expect(dirty.defaultValue).toBe(expected);
    expect(dirty.value).toBe("edited");
    expect(pristine.firstChild).toBe(first);
    expect(dirty.firstChild).toBe(second);
  }
  const before = snapshot();
  for (const text of [first, second])
    expect(() => {
      text.data = Symbol("rejected");
    }).toThrow(TypeError);
  expect(snapshot()).toEqual(before);
  expect(pristine.value).toBe("42");
  expect(dirty.defaultValue).toBe("42");
  expect(dirty.value).toBe("edited");
});
