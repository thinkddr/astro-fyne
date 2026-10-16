// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";
import { prepareJavascriptDOM } from "./javascript-managed-dom.ts";
import type { JavascriptFrame } from "./javascript-types.ts";

const field = (): JavascriptFrame => ({
  uid: "field",
  tag: "input",
  attrs: { id: "field", type: "TeXt", value: "initial" },
  value: "edited",
  children: [],
});

test("frame preparation retains globally identified nodes without changing source state", () => {
  const input = field();
  const roots: JavascriptFrame[] = [
    { uid: "left", tag: "div", children: [] },
    { uid: "right", tag: "div", children: [input] },
  ];
  const before = structuredClone(roots);
  const previous = new Map([
    ["field", "input"],
    ["left", "div"],
    ["right", "div"],
  ]);
  const prepared = prepareJavascriptDOM(roots, previous);
  expect(prepared.size).toBe(3);
  expect(prepared.get("field")?.frame).toBe(input);
  expect(roots).toEqual(before);
  expect([...previous]).toEqual([
    ["field", "input"],
    ["left", "div"],
    ["right", "div"],
  ]);
});

test("a UID cannot appear under two parents or change element type", () => {
  expect(() =>
    prepareJavascriptDOM([
      { uid: "left", tag: "div", children: [field()] },
      { uid: "right", tag: "div", children: [field()] },
    ]),
  ).toThrow("duplicate UID");
  expect(() =>
    prepareJavascriptDOM([field()], new Map([["field", "textarea"]])),
  ).toThrow("changed its element type");
  const cycle: JavascriptFrame = { uid: "cycle", tag: "div", children: [] };
  cycle.children!.push(cycle);
  expect(() => prepareJavascriptDOM([cycle])).toThrow("duplicate UID");
});

test("an invalid later subtree fails preparation before any commit can start", () => {
  const invalidFrames: JavascriptFrame[] = [
    { uid: "bad", tag: "script", children: [] },
    { uid: "bad", tag: "div", attrs: { onclick: "execute()" }, children: [] },
    { uid: "bad", tag: "div", style: { width: Infinity }, children: [] },
    { uid: "bad", tag: "div", style: { position: "absolute" }, children: [] },
    { uid: "bad", tag: "input", attrs: { type: "password" }, children: [] },
    {
      uid: "bad",
      tag: "textarea",
      children: [{ uid: "rich", tag: "span", children: [] }],
    },
  ];
  for (const invalid of invalidFrames) {
    const input = field();
    expect(() => prepareJavascriptDOM([input, invalid])).toThrow();
    expect(input.value).toBe("edited");
    expect(input.attrs?.value).toBe("initial");
  }
});

test("style preparation distinguishes CSS pixels from unitless line-height and weight", () => {
  const prepared = prepareJavascriptDOM([
    {
      uid: "text",
      tag: "p",
      style: {
        fontSize: 14,
        lineHeight: 1.5,
        fontWeight: 400,
        paddingTop: 0,
        backgroundColor: "#11232b",
        fontFamily: "Noto Sans",
      },
      children: [{ uid: "caption", tag: "#text", text: "A & B" }],
    },
  ]);
  expect(prepared.get("text")?.styles).toEqual([
    ["font-size", "14px"],
    ["line-height", "1.5"],
    ["font-weight", "400"],
    ["padding-top", "0px"],
    ["background-color", "#11232b"],
    ["font-family", "Noto Sans"],
  ]);
  expect(prepared.get("caption")?.frame.text).toBe("A & B");
});

test("frame data requires explicit text, typed control state and supported event names", () => {
  for (const invalid of [
    { uid: "bad", tag: "#text" },
    { uid: "bad", tag: "#text", text: "text", attrs: { id: "hidden" } },
    { uid: "bad", tag: "input", value: 1 },
    { uid: "bad", tag: "button", disabled: "false" },
    { uid: "bad", tag: "input", events: ["keydownfalse"] },
    {
      uid: "bad",
      tag: "p",
      children: [{ uid: "text", tag: "#text", text: "\ud800" }],
    },
  ])
    expect(() =>
      prepareJavascriptDOM([invalid as unknown as JavascriptFrame]),
    ).toThrow();
  expect(() =>
    prepareJavascriptDOM([
      { ...field(), events: ["inputfalse", "changetrue"] },
    ]),
  ).not.toThrow();
});
