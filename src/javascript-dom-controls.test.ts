// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";

const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);

test("input and textarea value setters map null to an empty string", () => {
  const { document } = createDocument();
  for (const tag of ["input", "textarea"]) {
    const field = document.createElement(tag);
    field.value = "before";
    field.value = null;
    expect(field.value).toBe("");
  }

  const checkbox = document.createElement("input");
  checkbox.setAttribute("type", "checkbox");
  checkbox.value = null;
  expect(checkbox.value).toBe("");
  expect(checkbox.getAttribute("value")).toBe("");
  expect(checkbox.defaultValue).toBe("");
});

test("null remains a DOM string for attributes, defaults and button values", () => {
  const { document } = createDocument();
  const field = document.createElement("input");
  field.defaultValue = null;
  expect(field.defaultValue).toBe("null");
  expect(field.value).toBe("null");
  field.setAttribute("data-value", null);
  expect(field.getAttribute("data-value")).toBe("null");

  const button = document.createElement("button");
  button.value = null;
  expect(button.value).toBe("null");
  expect(button.getAttribute("value")).toBe("null");
});

test("text to checkbox and back preserves values and resets the dirty value flag", () => {
  const { document } = createDocument();
  const field = document.createElement("input");
  field.value = "draft";
  field.setAttribute("type", "checkbox");
  expect(field.value).toBe("draft");
  expect(field.getAttribute("value")).toBe("draft");

  field.value = "checkbox-default";
  field.setAttribute("type", "text");
  expect(field.value).toBe("checkbox-default");
  field.setAttribute("value", "new-default");
  expect(field.value).toBe("new-default");
  expect(field.defaultValue).toBe("new-default");

  const empty = document.createElement("input");
  empty.setAttribute("type", "checkbox");
  expect(empty.getAttribute("value")).toBe(null);
  expect(empty.value).toBe("on");
});

test("removing checkbox type restores a sanitized text value from its attribute", () => {
  const { document } = createDocument();
  const field = document.createElement("input");
  field.setAttribute("type", "checkbox");
  field.value = "a\r\nb\rc\nd";
  field.removeAttribute("type");
  expect(field.value).toBe("abcd");
  expect(field.defaultValue).toBe("a\r\nb\rc\nd");

  field.setAttribute("value", "replacement");
  expect(field.value).toBe("replacement");
});

test("HTML attribute names are ASCII case insensitive without overwriting a dirty text value", () => {
  const { document } = createDocument();
  const field = document.createElement("InPuT");
  expect(field.localName).toBe("input");
  field.setAttribute("VaLuE", "a\r\nb");
  expect(field.hasAttribute("VALUE")).toBe(true);
  expect(field.getAttribute("value")).toBe("a\r\nb");
  expect(field.defaultValue).toBe("a\r\nb");
  expect(field.value).toBe("ab");

  field.value = "edited";
  field.setAttribute("VALUE", "new-default");
  expect(field.defaultValue).toBe("new-default");
  expect(field.value).toBe("edited");
  field.removeAttribute("vAlUe");
  expect(field.getAttribute("VALUE")).toBe(null);
  expect(field.defaultValue).toBe("");
  expect(field.value).toBe("edited");

  const pristine = document.createElement("input");
  pristine.setAttribute("VALUE", "initial");
  pristine.removeAttribute("value");
  expect(pristine.value).toBe("");
});

test("disabled reflects attribute presence and blocks programmatic clicks", () => {
  const { document, root } = createDocument();
  const button = document.createElement("BUTTON");
  root.appendChild(button);
  let calls = 0;
  button.addEventListener("click", () => calls++);

  button.setAttribute("DiSaBlEd", "false");
  expect(button.disabled).toBe(true);
  expect(button.hasAttribute("DISABLED")).toBe(true);
  button.click();
  expect(calls).toBe(0);

  button.disabled = false;
  expect(button.hasAttribute("disabled")).toBe(false);
  button.click();
  expect(calls).toBe(1);

  button.disabled = true;
  expect(button.getAttribute("disabled")).toBe("");
  button.click();
  expect(calls).toBe(1);
  button.removeAttribute("DISABLED");
  expect(button.disabled).toBe(false);
  button.click();
  expect(calls).toBe(2);
});

test("attribute conversion failures leave controls unchanged", () => {
  const { document } = createDocument();
  const field = document.createElement("input");
  field.setAttribute("value", "retained");
  expect(() => field.setAttribute("value", Symbol("invalid"))).toThrow(
    TypeError,
  );
  expect(() => field.setAttribute("bad name", "ignored")).toThrow(
    "Invalid HTML attribute name",
  );
  const converted: string[] = [];
  expect(() =>
    field.setAttribute("bad name", {
      toString() {
        converted.push("value");
        throw new Error("value conversion failed");
      },
    }),
  ).toThrow("value conversion failed");
  expect(converted).toEqual(["value"]);
  expect(field.value).toBe("retained");
  expect(field.defaultValue).toBe("retained");
  expect(field.hasAttribute("bad name")).toBe(false);
});

test("ID lookup uses document tree order and excludes detached nodes and empty IDs", () => {
  const { document, root } = createDocument();
  expect(document.getElementById("")).toBe(null);
  document.body.id = "outside-root";
  expect(document.getElementById("outside-root")).toBe(document.body);
  const first = document.createElement("p"),
    second = document.createElement("p");
  first.id = second.id = "duplicate";
  root.appendChild(first);
  root.appendChild(second);
  expect(document.getElementById({ toString: () => "duplicate" })).toBe(first);
  root.removeChild(first);
  expect(document.getElementById("duplicate")).toBe(second);
  root.removeChild(second);
  expect(document.getElementById("duplicate")).toBe(null);
});

test("native snapshots use each control's observable live value", () => {
  const { document, root, snapshot } = createDocument();
  const field = document.createElement("input");
  field.setAttribute("value", "initial");
  field.value = "edited";
  const checkbox = document.createElement("input");
  checkbox.setAttribute("type", "checkbox");
  checkbox.value = "checked-value";
  const button = document.createElement("button");
  button.setAttribute("value", "submit-value");
  const textarea = document.createElement("textarea");
  textarea.value = "two\nlines";
  for (const control of [field, checkbox, button, textarea])
    root.appendChild(control);
  expect(snapshot().map((frame: any) => frame.value)).toEqual([
    "edited",
    "checked-value",
    "submit-value",
    "two\nlines",
  ]);
});

test("unsupported input modes fail explicitly without changing a supported control", () => {
  const { document } = createDocument();
  const field = document.createElement("input");
  field.value = "retained";
  expect(() => field.setAttribute("type", "number")).toThrow(
    "native control adapter",
  );
  expect(field.getAttribute("type")).toBe(null);
  expect(field.value).toBe("retained");
});

test("a pristine textarea follows direct text mutations and normalizes only its API value", () => {
  const { document } = createDocument();
  const textarea = document.createElement("textarea");
  const first = document.createTextNode("a\r\nb");
  const last = document.createTextNode("\rc\nd");
  textarea.appendChild(first);
  textarea.appendChild(last);
  expect(textarea.defaultValue).toBe("a\r\nb\rc\nd");
  expect(textarea.value).toBe("a\nb\nc\nd");

  first.data = "changed\r";
  expect(textarea.defaultValue).toBe("changed\r\rc\nd");
  expect(textarea.value).toBe("changed\n\nc\nd");
  textarea.removeChild(last);
  expect(textarea.value).toBe("changed\n");
  textarea.textContent = "replaced\r\ntext";
  expect(textarea.defaultValue).toBe("replaced\r\ntext");
  expect(textarea.value).toBe("replaced\ntext");
});

test("textarea defaults replace children while preserving a dirty live value", () => {
  const { document, root, snapshot } = createDocument();
  const textarea = document.createElement("textarea");
  root.appendChild(textarea);
  textarea.defaultValue = null;
  expect(textarea.textContent).toBe("null");
  expect(textarea.getAttribute("value")).toBe(null);
  expect(textarea.value).toBe("null");

  textarea.value = "edited\r\nvalue\rend";
  textarea.defaultValue = "new\r\ndefault";
  textarea.firstChild.data = "mutated default";
  textarea.setAttribute("value", "ignored attribute");
  expect(textarea.defaultValue).toBe("mutated default");
  expect(textarea.value).toBe("edited\nvalue\nend");
  expect(snapshot()[0].value).toBe("edited\nvalue\nend");
});

test("textarea defaults use child text instead of nested descendant text", () => {
  const { document } = createDocument();
  const textarea = document.createElement("textarea");
  textarea.appendChild(document.createTextNode("direct"));
  const nested = document.createElement("span");
  nested.textContent = "nested";
  textarea.appendChild(nested);
  expect(textarea.textContent).toBe("directnested");
  expect(textarea.defaultValue).toBe("direct");
  expect(textarea.value).toBe("direct");
});
