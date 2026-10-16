// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";

const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);

test("textContent rejects symbols before detaching an edited input or changing text", () => {
  const { document, root, snapshot } = createDocument();
  const input = document.createElement("input");
  input.defaultValue = "initial";
  input.value = "edited";
  const text = document.createTextNode("caption");
  root.appendChild(input);
  root.appendChild(text);
  const before = snapshot();
  for (const target of [root, text]) {
    expect(() => {
      target.textContent = Symbol("rejected");
    }).toThrow(TypeError);
    expect(snapshot()).toEqual(before);
    expect(root.childNodes).toEqual([input, text]);
    expect(input.parentNode).toBe(root);
    expect(text.parentNode).toBe(root);
    expect(text.data).toBe("caption");
    expect(input.getAttribute("value")).toBe("initial");
    expect(input.defaultValue).toBe("initial");
    expect(input.value).toBe("edited");
  }
});

test("textContent clears null and undefined while retaining Text identity and textarea dirty values", () => {
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
    [undefined, ""],
    [42, "42"],
  ]) {
    first.textContent = value;
    second.textContent = value;
    expect(first.data).toBe(expected);
    expect(second.data).toBe(expected);
    expect(pristine.defaultValue).toBe(expected);
    expect(pristine.value).toBe(expected);
    expect(dirty.defaultValue).toBe(expected);
    expect(dirty.value).toBe("edited");
    expect(pristine.firstChild).toBe(first);
    expect(dirty.firstChild).toBe(second);
  }
  const before = snapshot();
  for (const target of [pristine, dirty, first, second]) {
    expect(() => {
      target.textContent = Symbol("rejected");
    }).toThrow(TypeError);
    expect(snapshot()).toEqual(before);
    expect(pristine.firstChild).toBe(first);
    expect(dirty.firstChild).toBe(second);
    expect(pristine.value).toBe("42");
    expect(dirty.defaultValue).toBe("42");
    expect(dirty.value).toBe("edited");
  }
  expect(document.createTextNode(null).data).toBe("null");
});

test("accepted Element textContent replacement detaches old children and creates text", () => {
  const { document, root } = createDocument();
  const input = document.createElement("input");
  input.defaultValue = "initial";
  input.value = "edited";
  root.appendChild(input);
  root.textContent = 42;
  expect(input.parentNode).toBe(null);
  expect(input.value).toBe("edited");
  expect(root.childNodes).toHaveLength(1);
  expect(root.firstChild.nodeType).toBe(3);
  expect(root.firstChild.data).toBe("42");
  for (const value of [null, undefined]) {
    root.textContent = value;
    expect(root.childNodes).toEqual([]);
    expect(root.textContent).toBe("");
    root.textContent = "restored";
  }
});
