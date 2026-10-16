// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";

const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);

function setup() {
  const api = createDocument();
  const left = api.document.createElement("div");
  const right = api.document.createElement("div");
  left.id = "left";
  right.id = "right";
  api.root.appendChild(left);
  api.root.appendChild(right);
  const input = api.document.createElement("input");
  input.id = "field";
  input.defaultValue = "initial";
  input.value = "edited";
  const anchor = api.document.createElement("span");
  anchor.id = "anchor";
  anchor.textContent = "anchor";
  left.appendChild(input);
  left.appendChild(anchor);
  return { ...api, left, right, input, anchor };
}

test("an invalid reference leaves an attached edited input unchanged", () => {
  for (const attached of [false, true]) {
    const { document, left, right, input, anchor, snapshot } = setup();
    const reference = document.createElement("span");
    if (attached) left.appendChild(reference);
    const before = snapshot();
    const uid = input.uid;
    let error: unknown;
    try {
      right.insertBefore(input, reference);
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("NotFoundError");
    expect(input.parentNode).toBe(left);
    expect(input.uid).toBe(uid);
    expect(input.value).toBe("edited");
    expect(input.defaultValue).toBe("initial");
    expect(document.getElementById("field")).toBe(input);
    expect(left.childNodes).toEqual(
      attached ? [input, anchor, reference] : [input, anchor],
    );
    expect(right.childNodes).toEqual([]);
    expect(snapshot()).toEqual(before);
  }
});

test("a foreign self reference throws before returning or mutating", () => {
  const { left, right, input, anchor, snapshot } = setup();
  const before = snapshot();
  let error: unknown;
  try {
    right.insertBefore(input, input);
  } catch (failure) {
    error = failure;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).name).toBe("NotFoundError");
  expect(input.parentNode).toBe(left);
  expect(left.childNodes).toEqual([input, anchor]);
  expect(right.childNodes).toEqual([]);
  expect(snapshot()).toEqual(before);
});

test("valid moves preserve the live control and return its original object", () => {
  const { document, left, right, input, anchor } = setup();
  const uid = input.uid;
  expect(left.insertBefore(input, null)).toBe(input);
  expect(left.childNodes).toEqual([anchor, input]);
  expect(left.insertBefore(input, anchor)).toBe(input);
  expect(left.childNodes).toEqual([input, anchor]);
  expect(left.insertBefore(input, input)).toBe(input);
  expect(left.childNodes).toEqual([input, anchor]);
  expect(input.parentNode).toBe(left);
  expect(input.uid).toBe(uid);
  expect(input.value).toBe("edited");
  expect(input.defaultValue).toBe("initial");
  expect(document.getElementById("field")).toBe(input);
  expect(right.childNodes).toEqual([]);
});
