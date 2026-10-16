// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import assert from "node:assert/strict";

export const reverseFlexCases = [
  { name: "01-224", width: 224, height: 2400, scale: 1 },
  { name: "02-368", width: 368, height: 2400, scale: 1 },
  { name: "03-512", width: 512, height: 2400, scale: 1 },
  { name: "04-368", width: 368, height: 2400, scale: 1 },
  { name: "05-224", width: 224, height: 2400, scale: 1 },
  { name: "06-224-scale2", width: 224, height: 2400, scale: 2 },
] as const;

export function validateReverseFlexScenario(value: unknown) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  const scenario = value as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(scenario).sort(),
    [
      "schema",
      "height",
      "cases",
      "ids",
      "buttons",
      "expectedPointerActions",
      "expectedFocusOrder",
    ].sort(),
  );
  assert.equal(scenario.schema, 1);
  assert.equal(scenario.height, 2400);
  assert.deepEqual(
    scenario.cases,
    reverseFlexCases,
    "Reverse-flex viewport sequence differs",
  );
  const ids = scenario.ids;
  assert.ok(
    Array.isArray(ids) &&
      ids.length > 50 &&
      ids.every((id) => typeof id === "string" && /^[a-z][a-z0-9-]*$/.test(id)),
  );
  assert.equal(ids[0], "reverse-flex");
  assert.equal(
    new Set(ids).size,
    ids.length,
    "Duplicate reverse-flex node IDs",
  );
  assert.deepEqual(scenario.buttons, ["action-a", "action-b", "action-c"]);
  assert.deepEqual(scenario.expectedPointerActions, [
    "action-c",
    "action-b",
    "action-a",
  ]);
  assert.deepEqual(scenario.expectedFocusOrder, [
    "action-a",
    "action-b",
    "action-c",
  ]);
  return {
    ...scenario,
    cases: [...reverseFlexCases],
    ids: ids as string[],
    buttons: ["action-a", "action-b", "action-c"],
    expectedPointerActions: ["action-c", "action-b", "action-a"],
    expectedFocusOrder: ["action-a", "action-b", "action-c"],
  };
}
