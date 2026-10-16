// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";

const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);

function setup() {
  const api = createDocument();
  const host = api.document.createElement("div");
  const input = api.document.createElement("input");
  input.id = "field";
  input.defaultValue = "initial";
  input.value = "edited";
  const text = api.document.createTextNode("caption");
  api.root.appendChild(host);
  host.appendChild(input);
  host.appendChild(text);
  return { ...api, host, input, text };
}

test("foreign, detached and Text-parent removals throw NotFoundError before mutation", () => {
  for (const operation of ["foreign", "detached", "text-parent"]) {
    const { document, host, input, text, snapshot } = setup();
    const before = snapshot();
    const uid = input.uid;
    let error: unknown;
    try {
      if (operation === "foreign")
        document.createElement("div").removeChild(input);
      else if (operation === "detached")
        host.removeChild(document.createElement("span"));
      else text.removeChild(input);
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("NotFoundError");
    expect(input.parentNode).toBe(host);
    expect(host.childNodes).toEqual([input, text]);
    expect(text.childNodes).toEqual([]);
    expect(input.uid).toBe(uid);
    expect(input.value).toBe("edited");
    expect(input.defaultValue).toBe("initial");
    expect(document.getElementById("field")).toBe(input);
    expect(snapshot()).toEqual(before);
  }
});

test("valid removal returns the original edited input and allows reattachment", () => {
  const { document, host, input, text, snapshot } = setup();
  const before = snapshot();
  const removed = host.removeChild(input);
  expect(removed).toBe(input);
  expect(input.parentNode).toBe(null);
  expect(host.childNodes).toEqual([text]);
  expect(document.getElementById("field")).toBe(null);
  expect(host.insertBefore(removed, text)).toBe(input);
  expect(host.childNodes).toEqual([input, text]);
  expect(input.parentNode).toBe(host);
  expect(input.value).toBe("edited");
  expect(input.defaultValue).toBe("initial");
  expect(snapshot()).toEqual(before);
});
