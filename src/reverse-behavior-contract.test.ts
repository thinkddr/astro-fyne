// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
import {
  assertReverseBehaviorTrace,
  compareReverseBehaviorTraces,
  reverseControlScenario,
  validateReverseBehaviorTrace,
  type ReverseBehaviorTrace,
} from "./reverse-behavior-contract.ts";
import type { SceneDocument, SceneStyle } from "./reverse.ts";

function scene(): SceneDocument {
  const style: SceneStyle = {
    x: 0,
    y: 0,
    width: 140,
    height: 30,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    gap: 0,
    direction: "column",
    background: "#ffffff",
    color: "#11232b",
    borderColor: "#000000",
    borderWidth: 0,
    radius: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 400,
    fontFamily: "sans-serif",
    fontStyle: "normal",
    textAlign: "left",
    whiteSpace: "normal",
    display: "block",
    opacity: 1,
    measured: true,
  };
  return {
    schema: 1,
    viewport: { width: 320, height: 240, scale: 1 },
    tokens: {},
    resources: [],
    roots: [
      {
        id: "edit",
        kind: "input",
        value: "",
        style,
        children: [],
        events: { input: "input", change: "commit" },
      },
      {
        id: "save",
        kind: "button",
        text: "Save",
        style: { ...style, y: 40 },
        children: [],
        events: { tap: "tap" },
      },
    ],
    requiredActions: ["input", "tap", "commit"],
  };
}
function trace(): ReverseBehaviorTrace {
  return {
    schema: 1,
    events: [
      { action: "input", value: "x" },
      { action: "commit", value: "x" },
      { action: "tap" },
      { action: "input", value: "xy" },
      { action: "commit", value: "xy" },
    ],
    finalValue: "xy",
    disabled: { edit: false, save: false },
  };
}

test("reverse control comparison checks the declared real-input scenario", () => {
  expect(reverseControlScenario(scene()).expected).toEqual(trace());
  const differentlyOrderedJSON = {
    disabled: { save: false, edit: false },
    finalValue: "xy",
    schema: 1,
    events: trace().events.map((event) =>
      event.value === undefined
        ? { action: event.action }
        : { value: event.value, action: event.action },
    ),
  };
  expect(
    compareReverseBehaviorTraces(trace(), differentlyOrderedJSON, scene()),
  ).toEqual({ schema: 1, exact: true, events: 5, finalValue: "xy" });
  const existing = scene();
  existing.roots[0]!.value = "Draft";
  const expected = reverseControlScenario(existing).expected;
  expect(expected.finalValue).toBe("Draftxy");
  expect(expected.events[0]).toEqual({ action: "input", value: "Draftx" });
});

test("matching wrong traces cannot pass the reverse differential gate", () => {
  const wrong = trace();
  wrong.events.splice(1, 1);
  expect(() => compareReverseBehaviorTraces(wrong, wrong, scene())).toThrow(
    "declared scenario",
  );
  const duplicateCommit = trace();
  duplicateCommit.events.splice(2, 0, { action: "commit", value: "x" });
  expect(() => assertReverseBehaviorTrace(duplicateCommit, scene())).toThrow(
    "declared scenario",
  );
  const reordered = trace();
  [reordered.events[0], reordered.events[1]] = [
    reordered.events[1]!,
    reordered.events[0]!,
  ];
  expect(() => assertReverseBehaviorTrace(reordered, scene())).toThrow(
    "declared scenario",
  );
  expect(() =>
    assertReverseBehaviorTrace({ ...trace(), finalValue: "xywrong" }, scene()),
  ).toThrow("declared scenario");
  expect(() =>
    assertReverseBehaviorTrace(
      { ...trace(), disabled: { edit: true, save: false } },
      scene(),
    ),
  ).toThrow("declared scenario");
});

test("reverse trace rejects unknown fields, invented arguments and missing state", () => {
  for (const value of [
    { ...trace(), schema: 2 },
    { ...trace(), extra: true },
    { ...trace(), events: [{ action: "tap", value: "invented" }] },
    { ...trace(), events: [{ action: "tap", value: undefined }] },
    { ...trace(), events: [{ action: "input", value: 2 }] },
    { ...trace(), events: [{ action: "unexpected", value: "x" }] },
    { ...trace(), events: [{ action: "input", value: "x", extra: true }] },
    { ...trace(), disabled: { edit: false } },
    { ...trace(), disabled: { edit: false, save: false, extra: true } },
    { ...trace(), finalValue: undefined },
  ])
    expect(() => validateReverseBehaviorTrace(value)).toThrow();
});

test("reverse scenario requires the initial enabled semantic native controls", () => {
  const disabled = scene();
  disabled.roots[0]!.disabled = true;
  expect(() => reverseControlScenario(disabled)).toThrow("enabled edit/input");
  const submitted = scene();
  submitted.roots[0]!.events!.submit = "tap";
  expect(() => reverseControlScenario(submitted)).toThrow("bindings");
  const differentId = scene();
  differentId.roots[0]!.id = "other";
  expect(() => reverseControlScenario(differentId)).toThrow(
    "enabled edit/input",
  );
});
