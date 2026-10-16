// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";

const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);

function setup() {
  const api = createDocument();
  const host = api.document.createElement("div");
  host.id = "host";
  api.root.appendChild(host);
  const input = api.document.createElement("input");
  input.id = "field";
  input.defaultValue = "initial";
  input.value = "edited";
  const text = api.document.createTextNode("caption");
  host.appendChild(input);
  host.appendChild(text);
  return { ...api, host, input, text };
}

test("a text parent rejects an attached edited input before detaching it", () => {
  const { document, host, input, text, snapshot } = setup();
  const before = snapshot();
  const uid = input.uid;
  let error: unknown;
  try {
    text.appendChild(input);
  } catch (failure) {
    error = failure;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).name).toBe("HierarchyRequestError");
  expect(input.parentNode).toBe(host);
  expect(input.uid).toBe(uid);
  expect(input.value).toBe("edited");
  expect(input.defaultValue).toBe("initial");
  expect(document.getElementById("field")).toBe(input);
  expect(text.childNodes).toEqual([]);
  expect(host.childNodes).toEqual([input, text]);
  expect(snapshot()).toEqual(before);
});

test("a text parent fails before foreign-reference and self-reference handling", () => {
  const { document, host, input, text, snapshot } = setup();
  const before = snapshot();
  for (const [child, reference] of [
    [input, document.createElement("span")],
    [text, text],
  ]) {
    let error: unknown;
    try {
      text.insertBefore(child, reference);
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("HierarchyRequestError");
    expect(input.parentNode).toBe(host);
    expect(text.parentNode).toBe(host);
    expect(input.value).toBe("edited");
    expect(text.childNodes).toEqual([]);
    expect(snapshot()).toEqual(before);
  }
});

test("an element still accepts text insertion and retains the edited input", () => {
  const { document, host, input, text } = setup();
  const uid = input.uid;
  expect(host.insertBefore(text, input)).toBe(text);
  expect(host.childNodes).toEqual([text, input]);
  expect(text.parentNode).toBe(host);
  expect(text.childNodes).toEqual([]);
  expect(input.uid).toBe(uid);
  expect(input.value).toBe("edited");
  expect(input.defaultValue).toBe("initial");
  expect(document.getElementById("field")).toBe(input);
});
