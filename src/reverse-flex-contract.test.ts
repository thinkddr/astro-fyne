// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateReverseFlexScenario } from "../capture/reverse-flex-contract.ts";

const original = JSON.parse(
  await readFile(
    new URL("../reverse-flex-scenario.json", import.meta.url),
    "utf8",
  ),
);
test("reverse-flex oracle requires six distinct cases, repeated widths and actual DPR2", () => {
  expect(validateReverseFlexScenario(original).cases).toHaveLength(6);
  for (const edit of [
    (s: typeof original) => {
      s.cases[1].name = s.cases[0].name;
    },
    (s: typeof original) => {
      s.cases[5].scale = 1;
    },
    (s: typeof original) => {
      s.cases.splice(3, 1);
    },
    (s: typeof original) => {
      s.cases[3].width = 512;
    },
    (s: typeof original) => {
      s.cases.reverse();
    },
    (s: typeof original) => {
      s.ids.push(s.ids[0]);
    },
    (s: typeof original) => {
      s.expectedPointerActions.reverse();
    },
  ]) {
    const changed = structuredClone(original);
    edit(changed);
    expect(() => validateReverseFlexScenario(changed)).toThrow();
  }
});
