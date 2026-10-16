// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";
const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);

test("checkbox preactivation, cancellation and local defaults preserve DOM semantics", () => {
  const { document, root, dispatch } = createDocument();
  const field = document.createElement("input");
  field.setAttribute("type", "checkbox");
  field.defaultChecked = true;
  root.appendChild(field);
  const events: any[] = [];
  for (const type of ["click", "input", "change"])
    field.addEventListener(
      type,
      (event: any) =>
        events.push([
          event.type,
          event.currentTarget.checked,
          event.currentTarget.value,
        ]),
      false,
    );
  dispatch({ node: field.uid, type: "click" });
  expect(events).toEqual([
    ["click", false, "on"],
    ["input", false, "on"],
    ["change", false, "on"],
  ]);
  field.defaultChecked = true;
  expect(field.checked).toBe(false);
  events.length = 0;
  field.addEventListener(
    "click",
    (event: any) => event.preventDefault(),
    false,
  );
  expect(dispatch({ node: field.uid, type: "click" })).toBe(true);
  expect(field.checked).toBe(false);
  expect(events).toEqual([["click", true, "on"]]);
});

test("a checkbox disabled or detached during click still completes its activation events", () => {
  const { document, root, dispatch } = createDocument();
  const field = document.createElement("input");
  field.setAttribute("type", "checkbox");
  root.appendChild(field);
  const events: string[] = [];
  field.addEventListener(
    "click",
    () => {
      field.disabled = true;
      field.remove();
    },
    false,
  );
  for (const type of ["input", "change"])
    field.addEventListener(type, () => events.push(type), false);
  dispatch({ node: field.uid, type: "click" });
  expect(field.checked).toBe(true);
  expect(events).toEqual(["input", "change"]);
});
