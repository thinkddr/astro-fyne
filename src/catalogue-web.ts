// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import type { CatalogueSpec } from "./catalogue-types.ts";
import type { JavascriptArchive } from "./javascript-types.ts";
import { validateJavascriptAnimationState } from "./javascript-data.ts";

export interface CatalogueJavascriptHandle {
  exportJavascript(): JavascriptArchive;
}

const maxCatalogueBytes = 128 * 1024 * 1024;
const maxPayloadBytes = 64 * 1024 * 1024;

function fail(message: string): never {
  throw new Error(`Catalogue export: ${message}`);
}

function boundedText(value: string, limit: number): void {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit < 128) bytes++;
    else if (unit < 2048) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        fail("isolated Unicode surrogates are not portable");
      bytes += 4;
    } else {
      if (unit >= 0xdc00 && unit <= 0xdfff)
        fail("isolated Unicode surrogates are not portable");
      bytes += 3;
    }
    if (bytes > limit) fail(`JSON exceeds ${limit / 1024 / 1024}MiB`);
  }
}

function snapshot(value: unknown): string {
  const active = new Set<object>();
  let count = 0;
  function visit(value: unknown, depth: number): void {
    if (depth > 256 || ++count > 1000000)
      fail("snapshot exceeds the JSON depth/value limit");
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "string") {
      boundedText(value, maxPayloadBytes);
      return;
    }
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      !Object.is(value, -0)
    )
      return;
    if (!value || typeof value !== "object" || active.has(value))
      fail("snapshots require ordinary finite JSON data");
    const array = Array.isArray(value),
      prototype = Object.getPrototypeOf(value);
    if (
      (array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(value).length
    )
      fail("snapshots require plain JSON objects and arrays");
    const names = Object.getOwnPropertyNames(value);
    if (array && (value.length > 1000000 || names.length !== value.length + 1))
      fail("sparse or custom arrays are not portable");
    active.add(value);
    for (const name of array
      ? Array.from({ length: value.length }, (_, index) => String(index))
      : names) {
      boundedText(name, maxPayloadBytes);
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor))
        fail("getters and hidden snapshot data are not portable");
      visit(descriptor.value, depth + 1);
    }
    active.delete(value);
  }
  visit(value, 0);
  const source = JSON.stringify(value);
  boundedText(source, maxPayloadBytes);
  return source;
}

function record(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("JavaScript archives require an object");
  const result = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(result, key)) ||
    Object.keys(result).some((key) => ![...required, ...optional].includes(key))
  )
    fail("unknown or missing JavaScript archive fields");
  return result;
}

function unchangedRecords(
  value: unknown,
  prototype: unknown,
  keys: string[],
): boolean {
  if (!Array.isArray(value) || !Array.isArray(prototype)) return false;
  if (value.length !== prototype.length) return false;
  return value.every((item, index) => {
    const source = record(item, keys),
      original = prototype[index] as Record<string, unknown>;
    return keys.every(
      (key) => typeof source[key] === "string" && source[key] === original[key],
    );
  });
}

function validateCheckpoint(value: unknown, prototype: JavascriptArchive) {
  const archive = record(
    value,
    [
      "schema",
      "kind",
      "code",
      "codeHash",
      "sources",
      "props",
      "actions",
      "events",
      "journal",
    ],
    ["stylesheets", "frame", "animation"],
  );
  if (
    ![1, 2].includes(archive.schema as number) ||
    archive.schema !== prototype.schema ||
    archive.kind !== "astro-fyne-javascript" ||
    !archive.props ||
    typeof archive.props !== "object" ||
    Array.isArray(archive.props) ||
    !Array.isArray(archive.events) ||
    !Array.isArray(archive.journal) ||
    (archive.stylesheets !== undefined &&
      !Array.isArray(archive.stylesheets)) ||
    (archive.frame !== undefined && !Array.isArray(archive.frame))
  )
    fail("a checkpoint requires a complete JavaScript archive");
  if (archive.schema === 2) validateJavascriptAnimationState(archive.animation);
  else if (Object.hasOwn(archive, "animation"))
    fail("schema 1 forbids animation state");
  if (
    archive.code !== prototype.code ||
    archive.codeHash !== prototype.codeHash ||
    !unchangedRecords(archive.sources, prototype.sources, ["path", "hash"]) ||
    !unchangedRecords(archive.stylesheets ?? [], prototype.stylesheets ?? [], [
      "path",
      "hash",
      "text",
    ]) ||
    !Array.isArray(archive.actions) ||
    archive.actions.length !== prototype.actions.length ||
    !archive.actions.every((name, index) => name === prototype.actions[index])
  )
    fail("checkpoints cannot replace component code, sources, CSS or actions");
}

async function digest(source: string): Promise<string> {
  if (!globalThis.crypto?.subtle)
    fail("SHA-256 requires Web Crypto in a secure browser context");
  const bytes = new TextEncoder().encode(source),
    hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** The compiler validates the baseline; mounted handles validate live runtime state. */
export function createCatalogueExporter(validatedSource: string) {
  if (typeof validatedSource !== "string" || !validatedSource)
    fail("a validated catalogue source is required");
  boundedText(validatedSource, maxCatalogueBytes);
  const baseline = JSON.parse(validatedSource) as CatalogueSpec;
  if (
    !baseline ||
    baseline.schema !== 1 ||
    baseline.kind !== "astro-fyne-catalogue" ||
    !Array.isArray(baseline.components) ||
    !Array.isArray(baseline.islands)
  )
    fail("a validated catalogue source is required");
  const components = new Map(
      baseline.components.map((item) => [item.id, item]),
    ),
    islands = new Map(baseline.islands.map((item) => [item.id, item]));

  return async function capture(
    checkpoints: ReadonlyMap<string, CatalogueJavascriptHandle>,
  ): Promise<CatalogueSpec> {
    const selected = Array.from(checkpoints.entries());
    for (const [id, handle] of selected) {
      const island = islands.get(id),
        component = island ? components.get(island.component) : undefined;
      if (!island || !component) fail(`unknown island ${JSON.stringify(id)}`);
      if (component.kind !== "javascript")
        fail(`island ${JSON.stringify(id)} requires a JavaScript component`);
      if (!handle || typeof handle.exportJavascript !== "function")
        fail(`island ${JSON.stringify(id)} requires a mounted export handle`);
    }
    const captured = selected.map(([id, handle]) => {
      const payload = snapshot(handle.exportJavascript()),
        archive: unknown = JSON.parse(payload),
        component = components.get(islands.get(id)!.component)!;
      validateCheckpoint(
        archive,
        JSON.parse(component.payload) as JavascriptArchive,
      );
      return { id, payload };
    });
    const output = JSON.parse(validatedSource) as CatalogueSpec;
    for (const { id, payload } of captured) {
      const island = output.islands.find((item) => item.id === id)!;
      island.statePayload = payload;
      island.stateHash = "0".repeat(64);
    }
    boundedText(JSON.stringify(output), maxCatalogueBytes);
    const hashes = await Promise.all(
      captured.map(({ payload }) => digest(payload)),
    );
    for (const [index, { id }] of captured.entries())
      output.islands.find((item) => item.id === id)!.stateHash = hashes[index]!;
    return output;
  };
}
