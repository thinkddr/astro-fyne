// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

/** Browser-safe data transport shared by the compiler and generated islands. */
export interface ProgramValue {
  kind:
    | "action"
    | "null"
    | "undefined"
    | "boolean"
    | "string"
    | "number"
    | "reference"
    | "array"
    | "object";
  id?: number;
  value?: string | boolean;
  items?: ProgramValue[];
  entries?: { key: string; value: ProgramValue }[];
}

function unicode(value: string) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new Error("Portable data requires paired Unicode surrogates");
    } else if (c >= 0xdc00 && c <= 0xdfff)
      throw new Error("Portable data requires paired Unicode surrogates");
  }
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Portable value must be a record");
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    throw new Error("Unknown or missing portable value fields");
}

export function decodeProgramData(
  props: unknown,
  state: unknown,
  actions: Record<string, (...args: any[]) => unknown> = {},
) {
  const refs = new Map<number, unknown>();
  let count = 0,
    bytes = 0;
  const string = (value: unknown): string => {
    if (typeof value !== "string")
      throw new Error("Portable string is missing");
    unicode(value);
    bytes += new TextEncoder().encode(value).length;
    if (bytes > 16 * 1024 * 1024)
      throw new Error("Portable data exceeds 16MiB");
    return value;
  };
  const decode = (
    input: unknown,
    depth = 0,
    topProps = false,
    actionKey?: string,
  ): unknown => {
    if (++count > 100000 || depth > 100)
      throw new Error("Portable data exceeds its depth/value limit");
    const value = record(input),
      kind = value.kind;
    if (kind === "action") {
      keys(value, ["kind", "value"]);
      const name = string(value.value);
      if (name !== actionKey)
        throw new Error(
          "Named callback tags belong only to their top-level prop binding",
        );
      if (!Object.hasOwn(actions, name) || typeof actions[name] !== "function")
        throw new Error(`Portable callback requires named action ${name}`);
      return actions[name];
    }
    if (kind === "null" || kind === "undefined") {
      keys(value, ["kind"]);
      return kind === "null" ? null : undefined;
    }
    if (kind === "boolean") {
      keys(value, ["kind", "value"]);
      if (typeof value.value !== "boolean")
        throw new Error("Invalid portable Boolean");
      return value.value;
    }
    if (kind === "string") {
      keys(value, ["kind", "value"]);
      return string(value.value);
    }
    if (kind === "number") {
      keys(value, ["kind", "value"]);
      const text = string(value.value);
      if (
        !["NaN", "Infinity", "-Infinity"].includes(text) &&
        (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/.test(text) ||
          !Number.isFinite(Number(text)))
      )
        throw new Error("Invalid portable number");
      return Number(text);
    }
    if (kind === "reference") {
      keys(value, ["kind", "id"]);
      if (!Number.isSafeInteger(value.id) || !refs.has(value.id as number))
        throw new Error("Unresolved portable reference");
      return refs.get(value.id as number);
    }
    if (kind !== "array" && kind !== "object")
      throw new Error("Unsupported portable value kind");
    keys(value, ["kind", "id"], [kind === "array" ? "items" : "entries"]);
    const id = value.id as number;
    if (!Number.isSafeInteger(id) || id <= 0 || refs.has(id))
      throw new Error("Invalid or duplicate portable identity");
    if (kind === "array") {
      const items = value.items ?? [];
      if (!Array.isArray(items)) throw new Error("Invalid portable array");
      const out: unknown[] = [];
      refs.set(id, out);
      for (const item of items) out.push(decode(item, depth + 1));
      return out;
    }
    const entries = value.entries ?? [];
    if (!Array.isArray(entries)) throw new Error("Invalid portable object");
    const out: Record<string, unknown> = {};
    refs.set(id, out);
    for (const item of entries) {
      const entry = record(item);
      keys(entry, ["key", "value"]);
      const name = string(entry.key);
      if (Object.hasOwn(out, name))
        throw new Error("Duplicate portable property");
      Object.defineProperty(out, name, {
        value: decode(
          entry.value,
          depth + 1,
          false,
          topProps ? name : undefined,
        ),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return out;
  };
  const decodedProps = record(decode(props, 0, true)),
    decodedState = record(decode(state));
  for (const [key, value] of Object.entries(decodedState))
    if (key.endsWith("/@key-kind") && value !== 115 && value !== 110)
      throw new Error("Invalid portable list key kind");
  return { props: decodedProps, state: decodedState };
}

export function encodeProgramData(
  props: Record<string, unknown>,
  state: Record<string, unknown>,
  actions: readonly string[] = [],
) {
  const refs = new WeakMap<object, number>();
  let next = 0,
    count = 0,
    bytes = 0;
  const checkString = (value: string) => {
    unicode(value);
    bytes += new TextEncoder().encode(value).length;
    if (bytes > 16 * 1024 * 1024)
      throw new Error("Portable data exceeds 16MiB");
    return value;
  };
  const encode = (
    value: unknown,
    depth = 0,
    bindActions = false,
  ): ProgramValue => {
    if (++count > 100000 || depth > 100)
      throw new Error("Portable data exceeds its depth/value limit");
    if (value === null) return { kind: "null" };
    if (value === undefined) return { kind: "undefined" };
    if (typeof value === "boolean") return { kind: "boolean", value };
    if (typeof value === "string")
      return { kind: "string", value: checkString(value) };
    if (typeof value === "number")
      return {
        kind: "number",
        value: checkString(Object.is(value, -0) ? "-0" : String(value)),
      };
    if (typeof value !== "object")
      throw new Error("A function or host value requires a portable adapter");
    const prior = refs.get(value);
    if (prior) return { kind: "reference", id: prior };
    if (Object.getOwnPropertySymbols(value).length)
      throw new Error("Symbol properties require a portable adapter");
    const id = ++next;
    refs.set(value, id);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        descriptors.length?.writable !== true
      )
        throw new Error("Nonstandard arrays require a portable adapter");
      if (
        Object.keys(descriptors).some(
          (key) =>
            key !== "length" &&
            (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length),
        )
      )
        throw new Error("Custom array properties require a portable adapter");
      const items: ProgramValue[] = [];
      for (let i = 0; i < value.length; i++) {
        const entry = descriptors[String(i)];
        if (
          !entry ||
          !("value" in entry) ||
          !entry.enumerable ||
          !entry.writable ||
          !entry.configurable
        )
          throw new Error(
            "Sparse arrays and accessors require a portable adapter",
          );
        items.push(encode(entry.value, depth + 1));
      }
      return { kind: "array", id, items };
    }
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error("Host objects require a portable adapter");
    const entries: { key: string; value: ProgramValue }[] = [];
    for (const key of Object.keys(descriptors).sort()) {
      const entry = descriptors[key]!;
      if (!entry.enumerable || !entry.writable || !entry.configurable)
        throw new Error(
          "Nonstandard property descriptors require a portable adapter",
        );
      if (!("value" in entry))
        throw new Error("Accessors require a portable adapter");
      if (
        bindActions &&
        actions.includes(key) &&
        typeof entry.value === "function"
      ) {
        if (++count > 100000)
          throw new Error("Portable data exceeds its depth/value limit");
        entries.push({
          key: checkString(key),
          value: { kind: "action", value: checkString(key) },
        });
        continue;
      }
      entries.push({
        key: checkString(key),
        value: encode(entry.value, depth + 1),
      });
    }
    return { kind: "object", id, entries };
  };
  return { props: encode(props, 0, true), state: encode(state) };
}
