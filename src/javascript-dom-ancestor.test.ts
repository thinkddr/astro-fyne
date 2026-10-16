// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";

const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);

function setup() {
  const api = createDocument();
  const outer = api.document.createElement("div");
  const inner = api.document.createElement("div");
  const right = api.document.createElement("div");
  const input = api.document.createElement("input");
  input.id = "field";
  input.defaultValue = "initial";
  input.value = "edited";
  api.root.appendChild(outer);
  api.root.appendChild(right);
  outer.appendChild(inner);
  inner.appendChild(input);
  return { ...api, outer, inner, right, input };
}

function caught(operation: () => void) {
  let error: unknown;
  try {
    operation();
  } catch (failure) {
    error = failure;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).name).toBe("HierarchyRequestError");
}

test("ancestor validation precedes a foreign reference without changing the edited input", () => {
  const { document, root, outer, inner, right, input, snapshot } = setup();
  const before = snapshot();
  caught(() => inner.insertBefore(outer, document.createElement("span")));
  expect(root.childNodes).toEqual([outer, right]);
  expect(outer.parentNode).toBe(root);
  expect(outer.childNodes).toEqual([inner]);
  expect(inner.parentNode).toBe(outer);
  expect(inner.childNodes).toEqual([input]);
  expect(document.getElementById("field")).toBe(input);
  expect(input.value).toBe("edited");
  expect(input.defaultValue).toBe("initial");
  expect(snapshot()).toEqual(before);
});

test("self and ancestor insertion reject before detachment or a self-reference shortcut", () => {
  for (const operation of [
    "self",
    "ancestor",
    "self-reference",
    "detached-self",
  ]) {
    const { document, root, outer, inner, right, input, snapshot } = setup();
    const before = snapshot();
    const detached = document.createElement("div");
    caught(() => {
      if (operation === "self") outer.appendChild(outer);
      else if (operation === "ancestor") inner.appendChild(outer);
      else if (operation === "self-reference") outer.insertBefore(outer, outer);
      else detached.appendChild(detached);
    });
    // Assert shallow links before any recursive lookup or snapshot on a failed baseline.
    expect(root.childNodes).toEqual([outer, right]);
    expect(outer.parentNode).toBe(root);
    expect(outer.childNodes).toEqual([inner]);
    expect(inner.parentNode).toBe(outer);
    expect(inner.childNodes).toEqual([input]);
    expect(input.parentNode).toBe(inner);
    expect(detached.parentNode).toBe(null);
    expect(detached.childNodes).toEqual([]);
    expect(input.value).toBe("edited");
    expect(input.defaultValue).toBe("initial");
    expect(document.getElementById("field")).toBe(input);
    expect(snapshot()).toEqual(before);
  }
});

test("valid moves between and within parents retain input identity, dirty value and default", () => {
  const { document, inner, right, input } = setup();
  const anchor = document.createElement("span");
  right.appendChild(anchor);
  const uid = input.uid;
  expect(right.insertBefore(input, anchor)).toBe(input);
  expect(inner.childNodes).toEqual([]);
  expect(right.childNodes).toEqual([input, anchor]);
  expect(right.appendChild(input)).toBe(input);
  expect(right.childNodes).toEqual([anchor, input]);
  expect(right.insertBefore(input, input)).toBe(input);
  expect(right.childNodes).toEqual([anchor, input]);
  expect(inner.appendChild(input)).toBe(input);
  expect(inner.childNodes).toEqual([input]);
  expect(right.childNodes).toEqual([anchor]);
  expect(input.parentNode).toBe(inner);
  expect(document.getElementById("field")).toBe(input);
  expect(input.uid).toBe(uid);
  expect(input.value).toBe("edited");
  expect(input.defaultValue).toBe("initial");
  expect(input.getAttribute("value")).toBe("initial");
});
