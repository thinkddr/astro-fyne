// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createHash } from "node:crypto";
import { emitGo, sourceHash } from "./emit.ts";
import type { Program } from "./ir.ts";
import {
  validatePortableProgram,
  validateProgramSlots,
} from "./program-contract.ts";
import {
  decodeProgramData,
  encodeProgramData,
  type ProgramValue,
} from "./program-values.ts";

export interface ProgramArchive {
  schema: 1;
  kind: "astro-fyne-program";
  sourceHash: string;
  programHash: string;
  program: string;
  props: ProgramValue;
  state: ProgramValue;
}

export function createProgramArchive(
  program: Program,
  props: Record<string, unknown> = {},
  state: Record<string, unknown> = {},
): ProgramArchive {
  validatePortableProgram(program);
  const text = JSON.stringify(program);
  return {
    schema: 1,
    kind: "astro-fyne-program",
    sourceHash: sourceHash(program),
    programHash: createHash("sha256").update(text).digest("hex"),
    program: text,
    ...encodeProgramData(props, state, program.actions),
  };
}

/** Validate the entire archive and both code-generation contracts before writes. */
export function validateProgramArchive(value: unknown): {
  archive: ProgramArchive;
  program: Program;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Program archive must be a JSON record");
  const a = value as ProgramArchive;
  const fields = [
    "schema",
    "kind",
    "sourceHash",
    "programHash",
    "program",
    "props",
    "state",
  ];
  if (
    Object.keys(a).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(a, key)) ||
    a.schema !== 1 ||
    a.kind !== "astro-fyne-program" ||
    typeof a.program !== "string" ||
    Buffer.byteLength(a.program) > 64 * 1024 * 1024
  )
    throw new Error("Unknown or missing program archive fields");
  if (
    typeof a.programHash !== "string" ||
    createHash("sha256").update(a.program).digest("hex") !== a.programHash
  )
    throw new Error("Program archive digest mismatch");
  let program: Program;
  try {
    program = validatePortableProgram(JSON.parse(a.program));
  } catch (error) {
    throw new Error(
      `Invalid portable program: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (sourceHash(program) !== a.sourceHash)
    throw new Error("Program archive source digest mismatch");
  if (JSON.stringify(program) !== a.program)
    throw new Error(
      "Program archive requires the canonical JSON emitted by astro-fyne",
    );
  const actions = Object.fromEntries(
    program.actions.map((name) => [
      name,
      () => {
        throw new Error("Validation must never invoke actions");
      },
    ]),
  );
  const data = decodeProgramData(a.props, a.state, actions);
  validateProgramSlots(program, data.state);
  for (const key of Object.keys(data.props))
    if (key.startsWith("_afy"))
      throw new Error("Portable props use the reserved _afy namespace");
  // Reuse the native emitter's tags, attributes, styles and resource checks.
  emitGo(program, { name: "ProgramValidation", packageName: "generated" });
  return { archive: a, program };
}
