// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { isDeepStrictEqual } from "node:util";
import {
  sceneJSONFields,
  sceneJSONRecord,
  validateSceneDocument,
  type SceneNode,
} from "./reverse.ts";

export interface ReverseBehaviorTrace {
  schema: 1;
  events: { action: string; value?: string }[];
  finalValue: string;
  disabled: { edit: boolean; save: boolean };
}

/** Exactly one supported real-control fixture, not a general Go behavior model. */
export function reverseControlScenario(value: unknown) {
  const scene = validateSceneDocument(value);
  const ids = new Map<string, SceneNode>();
  const collect = (nodes: SceneNode[]) => {
    for (const node of nodes) {
      ids.set(node.id, node);
      collect(node.children);
    }
  };
  collect(scene.roots);
  const edit = ids.get("edit");
  const save = ids.get("save");
  if (
    edit?.kind !== "input" ||
    save?.kind !== "button" ||
    edit.disabled ||
    save.disabled ||
    edit.events?.input !== "input" ||
    edit.events?.change !== "commit" ||
    edit.events?.submit ||
    save.events?.tap !== "tap" ||
    scene.requiredActions.join(",") !== "commit,input,tap"
  )
    throw new Error(
      "Reverse control scenario requires enabled edit/input and save/button with input, commit and tap bindings",
    );
  const initialValue = edit.value ?? "";
  const expected: ReverseBehaviorTrace = {
    schema: 1,
    events: [
      { action: "input", value: initialValue + "x" },
      { action: "commit", value: initialValue + "x" },
      { action: "tap" },
      { action: "input", value: initialValue + "xy" },
      { action: "commit", value: initialValue + "xy" },
    ],
    finalValue: initialValue + "xy",
    disabled: { edit: false, save: false },
  };
  return { initialValue, expected };
}

export function validateReverseBehaviorTrace(
  value: unknown,
): ReverseBehaviorTrace {
  const trace = sceneJSONRecord(value, "reverseTrace");
  sceneJSONFields(
    trace,
    ["schema", "events", "finalValue", "disabled"],
    "reverseTrace",
  );
  if (trace.schema !== 1 || !Array.isArray(trace.events))
    throw new Error("Reverse behavior trace requires schema 1 and events");
  const events = trace.events.map((value, index) => {
    const event = sceneJSONRecord(value, `reverseTrace.events[${index}]`);
    sceneJSONFields(
      event,
      ["action", "value"],
      `reverseTrace.events[${index}]`,
    );
    if (!["input", "commit", "tap"].includes(event.action as string))
      throw new Error(`Reverse behavior event ${index} has an unknown action`);
    if (event.action === "tap") {
      if (Object.hasOwn(event, "value"))
        throw new Error("Reverse tap must not invent a value argument");
      return { action: "tap" };
    }
    if (typeof event.value !== "string")
      throw new Error(
        `Reverse behavior event ${index} requires a string value`,
      );
    return { action: event.action as string, value: event.value };
  });
  const disabled = sceneJSONRecord(trace.disabled, "reverseTrace.disabled");
  sceneJSONFields(disabled, ["edit", "save"], "reverseTrace.disabled");
  if (
    typeof trace.finalValue !== "string" ||
    typeof disabled.edit !== "boolean" ||
    typeof disabled.save !== "boolean"
  )
    throw new Error(
      "Reverse behavior final value and disabled state are required",
    );
  return {
    schema: 1,
    events,
    finalValue: trace.finalValue,
    disabled: { edit: disabled.edit, save: disabled.save },
  };
}

export function assertReverseBehaviorTrace(value: unknown, scene: unknown) {
  const trace = validateReverseBehaviorTrace(value);
  const { expected } = reverseControlScenario(scene);
  if (!isDeepStrictEqual(trace, expected))
    throw new Error(
      `Reverse control behavior does not match the declared scenario\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(trace)}`,
    );
  return trace;
}

export function compareReverseBehaviorTraces(
  browser: unknown,
  native: unknown,
  scene: unknown,
) {
  const web = assertReverseBehaviorTrace(browser, scene);
  const go = assertReverseBehaviorTrace(native, scene);
  if (!isDeepStrictEqual(web, go))
    throw new Error("Browser and native reverse control traces differ");
  return {
    schema: 1,
    exact: true,
    events: web.events.length,
    finalValue: web.finalValue,
  };
}
