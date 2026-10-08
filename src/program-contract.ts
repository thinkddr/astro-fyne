// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { inspectBitmap } from "./resources.ts";
import { inspectFont, validateFontFaces } from "./fonts.ts";
import type { Node, Program } from "./ir.ts";

const binding = /^[A-Za-z_$][\w$]*$/;
const reserved = new Set(
  "await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield eval arguments".split(
    " ",
  ),
);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Program requires records");
  return value as Record<string, unknown>;
}
function fields(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) {
  if (
    required.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some(
      (k) => !required.includes(k) && !optional.includes(k),
    )
  )
    throw new Error("Unknown or missing portable program fields");
}
function name(value: unknown): string {
  if (
    typeof value !== "string" ||
    !binding.test(value) ||
    reserved.has(value) ||
    value.startsWith("_afy")
  )
    throw new Error(
      "Portable binding requires a supported identifier outside the reserved _afy namespace",
    );
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.includes("\0"))
    throw new Error("Program identifier must be a nonempty string");
  if (Buffer.from(value, "utf8").toString("utf8") !== value)
    throw new Error(
      "Portable program strings require paired Unicode surrogates",
    );
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Program requires arrays");
  return value;
}

/** Close the IR vocabulary before generating either language from an archive. */
export function validatePortableProgram(value: unknown): Program {
  const p = object(value);
  fields(
    p,
    ["entry", "components", "sources", "actions"],
    ["hasStyles", "resources", "fonts"],
  );
  if (p.hasStyles !== undefined && typeof p.hasStyles !== "boolean")
    throw new Error("Invalid program CSS declaration");
  if (p.hasStyles)
    throw new Error(
      "Portable program export needs retained CSS source; measured styles cannot replace that source",
    );
  const actions = new Set(array(p.actions).map(text));
  if (actions.size !== (p.actions as unknown[]).length)
    throw new Error("Duplicate program actions");
  const components = array(p.components).map(object),
    names = new Set(components.map((c) => name(c.name)));
  if (names.size !== components.length || !names.has(text(p.entry)))
    throw new Error("Missing entry or duplicate program components");
  for (const item of array(p.sources)) {
    const s = object(item);
    fields(s, ["path", "hash"]);
    text(s.path);
    if (typeof s.hash !== "string" || !/^[a-f0-9]{64}$/.test(s.hash))
      throw new Error("Invalid program source digest");
  }
  const assetNames = new Set<string>();
  const bytes = (resource: Record<string, unknown>): Buffer => {
    const n = name(resource.name);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(n) || assetNames.has(n))
      throw new Error("Invalid or duplicate program resource name");
    assetNames.add(n);
    text(resource.path);
    if (
      typeof resource.content !== "string" ||
      resource.content.length > 28 * 1024 * 1024
    )
      throw new Error("Invalid program resource content");
    const data = Buffer.from(resource.content, "base64");
    if (
      data.toString("base64") !== resource.content ||
      createHash("sha256").update(data).digest("hex") !== resource.hash
    )
      throw new Error(
        "Program resource bytes differ from their SHA-256 digest",
      );
    return data;
  };
  const resourceNames = new Set<string>();
  for (const input of p.resources === undefined ? [] : array(p.resources)) {
    const r = object(input);
    fields(r, [
      "name",
      "path",
      "hash",
      "mediaType",
      "content",
      "width",
      "height",
      "srcs",
    ]);
    const actual = inspectBitmap(bytes(r), text(r.mediaType));
    resourceNames.add(r.name as string);
    if (
      actual.width !== r.width ||
      actual.height !== r.height ||
      !array(r.srcs).length
    )
      throw new Error("Program bitmap dimensions or sources are invalid");
    for (const src of array(r.srcs)) text(src);
  }
  const fonts = p.fonts === undefined ? [] : array(p.fonts).map(object);
  for (const face of fonts) {
    fields(face, [
      "name",
      "path",
      "hash",
      "content",
      "family",
      "weight",
      "style",
      "webSrc",
    ]);
    inspectFont(
      bytes(face),
      face as unknown as { weight: 400 | 700; style: "normal" | "italic" },
    );
  }
  if (fonts.length)
    validateFontFaces(
      fonts.map(({ family, weight, style, path, webSrc }) => ({
        family,
        weight,
        style,
        source: path,
        webSrc,
      })),
    );
  let count = 0;
  const edges = new Map<string, Set<string>>();
  const expr = (
    input: unknown,
    scope: Set<string>,
    current: Set<string>,
    depth = 0,
  ): void => {
    if (++count > 100000 || depth > 100)
      throw new Error("Program exceeds its expression/depth limit");
    const e = object(input);
    switch (e.kind) {
      case "literal":
        fields(e, ["kind", "value"]);
        if (
          (e.value !== null &&
            !["string", "boolean", "number"].includes(typeof e.value)) ||
          (typeof e.value === "number" && !Number.isFinite(e.value))
        )
          throw new Error("Invalid program literal");
        if (
          typeof e.value === "string" &&
          Buffer.from(e.value, "utf8").toString("utf8") !== e.value
        )
          throw new Error(
            "Portable program literals require paired Unicode surrogates",
          );
        return;
      case "undefined":
        fields(e, ["kind"]);
        return;
      case "name":
        fields(e, ["kind", "name"]);
        if (!scope.has(name(e.name)))
          throw new Error("Unknown program lexical binding");
        return;
      case "current":
        fields(e, ["kind", "name"]);
        if (!current.has(name(e.name)))
          throw new Error("Pending state is available only inside its updater");
        return;
      case "get":
        fields(e, ["kind", "object", "key"]);
        expr(e.object, scope, current, depth + 1);
        expr(e.key, scope, current, depth + 1);
        return;
      case "chain":
        fields(e, ["kind", "object", "accesses"]);
        expr(e.object, scope, current, depth + 1);
        if (!array(e.accesses).length) throw new Error("Empty program chain");
        for (const input of array(e.accesses)) {
          const a = object(input);
          fields(a, ["optional", "key"]);
          if (typeof a.optional !== "boolean")
            throw new Error("Invalid optional access");
          expr(a.key, scope, current, depth + 1);
        }
        return;
      case "unary":
        fields(e, ["kind", "op", "value"]);
        if (!["!", "+", "-"].includes(String(e.op)))
          throw new Error("Unsupported program unary operator");
        expr(e.value, scope, current, depth + 1);
        return;
      case "binary":
        fields(e, ["kind", "op", "left", "right"]);
        if (
          ![
            "+",
            "-",
            "*",
            "/",
            "%",
            "===",
            "!==",
            "<",
            "<=",
            ">",
            ">=",
            "&&",
            "||",
            "??",
          ].includes(String(e.op))
        )
          throw new Error("Unsupported program operator");
        expr(e.left, scope, current, depth + 1);
        expr(e.right, scope, current, depth + 1);
        return;
      case "conditional":
        fields(e, ["kind", "test", "yes", "no"]);
        for (const key of ["test", "yes", "no"])
          expr(e[key], scope, current, depth + 1);
        return;
      case "array":
        fields(e, ["kind", "items"]);
        for (const item of array(e.items))
          expr(item, scope, current, depth + 1);
        return;
      case "template":
        fields(e, ["kind", "parts"]);
        for (const item of array(e.parts))
          expr(item, scope, current, depth + 1);
        return;
      case "object": {
        fields(e, ["kind", "entries"], ["order"]);
        const entries = object(e.entries),
          keys = Object.keys(entries);
        if (keys.includes("__proto__"))
          throw new Error("Prototype-mutating literals are unsupported");
        if (e.order !== undefined) {
          const order = array(e.order);
          if (
            order.length !== keys.length ||
            new Set(order).size !== keys.length ||
            order.some(
              (k) => typeof k !== "string" || !Object.hasOwn(entries, k),
            )
          )
            throw new Error("Invalid program object evaluation order");
        }
        for (const item of Object.values(entries))
          expr(item, scope, current, depth + 1);
        return;
      }
      case "call":
        fields(e, ["kind", "name", "args"]);
        if (
          !["String", "Number", "Boolean"].includes(String(e.name)) &&
          !actions.has(text(e.name))
        )
          throw new Error("Program call requires a declared action");
        if (
          ["String", "Number", "Boolean"].includes(String(e.name)) &&
          array(e.args).length !== 1
        )
          throw new Error("Scalar conversion requires one argument");
        for (const arg of array(e.args)) expr(arg, scope, current, depth + 1);
        return;
      default:
        throw new Error("Unsupported portable expression kind");
    }
  };
  for (const c of components) {
    fields(
      c,
      ["name", "props", "states", "constants", "initializers", "body"],
      ["propsObject"],
    );
    const componentName = name(c.name),
      scope = new Set<string>();
    edges.set(componentName, new Set());
    const add = (n: unknown) => {
      const value = name(n);
      if (scope.has(value))
        throw new Error("Duplicate program lexical binding");
      scope.add(value);
      return value;
    };
    for (const prop of array(c.props)) add(prop);
    if (c.propsObject !== undefined) add(c.propsObject);
    const states = new Map<string, Record<string, unknown>>(),
      constants = new Map<string, Record<string, unknown>>();
    for (const input of array(c.states)) {
      const s = object(input);
      fields(s, ["name", "setter", "initial"]);
      states.set(add(s.name), s);
      name(s.setter);
    }
    for (const input of array(c.constants)) {
      const s = object(input);
      fields(s, ["name", "value"]);
      constants.set(add(s.name), s);
    }
    const lexical = new Set(array(c.props).map(name));
    if (c.propsObject !== undefined) lexical.add(name(c.propsObject));
    const initialized = new Set<string>();
    for (const input of array(c.initializers)) {
      const i = object(input);
      fields(i, ["kind", "name"]);
      const n = name(i.name),
        s =
          i.kind === "state"
            ? states.get(n)
            : i.kind === "constant"
              ? constants.get(n)
              : undefined;
      if (!s || initialized.has(n))
        throw new Error("Invalid program initializer order");
      expr(i.kind === "state" ? s.initial : s.value, lexical, new Set());
      initialized.add(n);
      lexical.add(n);
    }
    if (initialized.size !== states.size + constants.size)
      throw new Error("Program initializer is missing");
    const nodes = (inputs: unknown, bindings: Set<string>, depth = 0): void => {
      if (depth > 100) throw new Error("Program exceeds its tree depth limit");
      for (const input of array(inputs)) {
        if (++count > 100000)
          throw new Error("Program exceeds its value limit");
        const n = object(input);
        if (n.identity !== undefined) text(n.identity);
        if (n.kind === "text") {
          fields(n, ["kind", "value"], ["identity"]);
          expr(n.value, bindings, new Set());
        } else if (n.kind === "conditional") {
          fields(n, ["kind", "test", "yes", "no"], ["shortCircuit"]);
          if (
            n.shortCircuit !== undefined &&
            typeof n.shortCircuit !== "boolean"
          )
            throw new Error("Invalid short circuit");
          expr(n.test, bindings, new Set());
          nodes(n.yes, bindings, depth + 1);
          nodes(n.no, bindings, depth + 1);
        } else if (n.kind === "each") {
          fields(
            n,
            ["kind", "id", "items", "item", "children"],
            ["index", "key"],
          );
          text(n.id);
          expr(n.items, bindings, new Set());
          const local = new Set(bindings);
          local.add(name(n.item));
          if (n.index !== undefined) local.add(name(n.index));
          if (n.key !== undefined) expr(n.key, local, new Set());
          nodes(n.children, local, depth + 1);
        } else if (n.kind === "component") {
          fields(n, ["kind", "id", "name", "props", "children"], ["identity"]);
          text(n.id);
          if (!names.has(text(n.name)))
            throw new Error("Program component or adapter is unavailable");
          edges.get(componentName)!.add(n.name as string);
          for (const val of Object.values(object(n.props)))
            expr(val, bindings, new Set());
          if (array(n.children).length)
            throw new Error("Program component slots are unsupported");
        } else if (n.kind === "element") {
          fields(
            n,
            ["kind", "id", "tag", "attrs", "events", "children"],
            ["identity", "imageResource"],
          );
          text(n.id);
          text(n.tag);
          if (
            n.imageResource !== undefined &&
            !resourceNames.has(text(n.imageResource))
          )
            throw new Error("Program bitmap binding is unavailable");
          for (const val of Object.values(object(n.attrs)))
            expr(val, bindings, new Set());
          for (const [event, input] of Object.entries(object(n.events))) {
            if (!["onClick", "onInput", "onChange"].includes(event))
              throw new Error("Unsupported program event");
            const h = object(input);
            fields(h, ["steps"], ["parameter"]);
            const local = new Set(bindings);
            if (h.parameter !== undefined) local.add(name(h.parameter));
            for (const input of array(h.steps)) {
              const s = object(input);
              fields(s, ["kind", "name", "args"], ["updater"]);
              if (s.updater !== undefined && s.updater !== true)
                throw new Error("Invalid updater metadata");
              if (s.kind === "set") {
                if (!states.has(text(s.name)) || array(s.args).length !== 1)
                  throw new Error("Unknown program state setter");
              } else if (
                s.kind !== "call" ||
                !actions.has(text(s.name)) ||
                s.updater !== undefined
              )
                throw new Error("Unknown program event action");
              for (const arg of array(s.args))
                expr(
                  arg,
                  local,
                  s.updater ? new Set([s.name as string]) : new Set(),
                );
            }
          }
          nodes(n.children, bindings, depth + 1);
        } else throw new Error("Unsupported portable node kind");
      }
    };
    nodes(c.body, scope);
  }
  const visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (n: string) => {
    if (visiting.has(n)) throw new Error("Recursive portable component graph");
    if (done.has(n)) return;
    visiting.add(n);
    for (const next of edges.get(n)!) visit(next);
    visiting.delete(n);
    done.add(n);
  };
  for (const n of names) visit(n);
  if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024 * 1024)
    throw new Error("Portable program JSON exceeds 64MiB");
  return value as Program;
}

/** State addresses follow component/list namespaces, never arbitrary host data. */
export function validateProgramSlots(
  program: Program,
  state: Record<string, unknown>,
): void {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns: RegExp[] = [];
  const components = new Map(
    program.components.map((component) => [component.name, component]),
  );
  let count = 0;
  const add = (path: string) => {
    if (++count > 100000)
      throw new Error("Program state namespaces exceed their limit");
    patterns.push(new RegExp("^" + path + "$"));
  };
  const walk = (name: string, prefix: string, depth: number) => {
    if (depth > 100)
      throw new Error("Program state namespaces exceed their depth limit");
    const component = components.get(name)!;
    for (const state of component.states)
      add(prefix + "/" + escape(name) + "/" + escape(state.name));
    nodes(component.body, prefix, depth);
  };
  const nodes = (values: Node[], prefix: string, depth: number): void => {
    if (depth > 100 || ++count > 100000)
      throw new Error("Program state namespaces exceed their limit");
    for (const node of values) {
      if (node.kind === "component")
        walk(
          node.name,
          prefix + "/" + escape(node.identity ?? node.id),
          depth + 1,
        );
      else if (node.kind === "each") {
        const site = prefix + "/" + escape(node.id);
        if (node.key) add(site + "/@key-kind");
        nodes(
          node.children,
          site + "/" + (node.key ? "[sn][0-9a-f]*" : "i(?:0|[1-9]\\d*)"),
          depth + 1,
        );
      } else if (node.kind === "conditional") {
        nodes(node.yes, prefix, depth + 1);
        nodes(node.no, prefix, depth + 1);
      } else if (node.kind === "element")
        nodes(node.children, prefix, depth + 1);
    }
  };
  walk(program.entry, "", 0);
  for (const key of Object.keys(state))
    if (!patterns.some((pattern) => pattern.test(key)))
      throw new Error(`Unknown declared state address: ${key}`);
}
