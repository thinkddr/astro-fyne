// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createHash } from "node:crypto";
import { inspectFont } from "./fonts.ts";
import { simpleFontFamilyKey, validFontResourceFamily } from "./font-family.ts";
import {
  validateJavascriptArchive,
  type JavascriptArchive,
} from "./javascript.ts";
import { validJavascriptText } from "./javascript-data.ts";
import { parseJSONSource } from "./json-source.ts";
import { validateProgramArchive } from "./program.ts";
import { validateSceneFlex } from "./scene-layout.ts";
import {
  sceneColorRGBA,
  validateSceneDocument,
  type SceneSourceStyle,
} from "./reverse.ts";
import { validateMotion, type MotionSpec } from "./motion.ts";

import type {
  CatalogueResource,
  CatalogueStylesheet,
  CatalogueFontFace,
  CatalogueTheme,
  CatalogueLayout,
  CatalogueComponent,
  CatalogueIsland,
  CatalogueSpec,
} from "./catalogue-types.ts";
export type {
  CatalogueResource,
  CatalogueStylesheet,
  CatalogueFontFace,
  CatalogueTheme,
  CatalogueLayout,
  CatalogueComponent,
  CatalogueIsland,
  CatalogueSpec,
} from "./catalogue-types.ts";

export const catalogueHash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const maxDocumentBytes = 128 * 1024 * 1024;
const float32Maximum = 3.4028234663852886e38;
function fail(message: string): never {
  throw new Error(`Catalogue: ${message}`);
}

function parseJSON(source: string): unknown {
  return parseJSONSource(source, fail, maxDocumentBytes);
}

/** Snapshot plain data before asynchronous archive validation can yield. */
function ownJSON(value: unknown): unknown {
  const active = new Set<object>();
  let count = 0;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 256 || ++count > 1000000)
      fail("JSON depth/value limit exceeded");
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "string") {
      validJavascriptText(value);
      return;
    }
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (!value || typeof value !== "object" || active.has(value))
      fail("catalogue metadata requires finite plain JSON data");
    const array = Array.isArray(value);
    if (
      (array
        ? Object.getPrototypeOf(value) !== Array.prototype
        : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) ||
      Object.getOwnPropertySymbols(value).length
    )
      fail("catalogue objects require plain JSON data");
    active.add(value);
    const names = Object.getOwnPropertyNames(value);
    if (array && (value.length > 1000000 || names.length !== value.length + 1))
      fail("sparse or custom arrays are not portable JSON");
    for (const name of array
      ? Array.from({ length: value.length }, (_, i) => String(i))
      : names) {
      validJavascriptText(name);
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor))
        fail("getters and hidden metadata are not portable JSON");
      visit(descriptor.value, depth + 1);
    }
    active.delete(value);
  };
  visit(value, 0);
  const source = JSON.stringify(value);
  if (Buffer.byteLength(source) > maxDocumentBytes)
    fail("document exceeds 128MiB");
  return JSON.parse(source);
}

export async function parseCatalogue(source: string): Promise<CatalogueSpec> {
  return validateCatalogue(parseJSON(source));
}
function fields(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected a JSON object");
  const record = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => ![...required, ...optional].includes(key))
  )
    fail(`unknown or missing fields; expected ${required.join(", ")}`);
  return record;
}
function text(value: unknown, label: string, limit = 4096, empty = false) {
  if (typeof value !== "string") fail(`invalid ${label}`);
  validJavascriptText(value);
  if (
    (!empty && !value) ||
    Buffer.byteLength(value) > limit ||
    value.includes("\0")
  )
    fail(`invalid ${label}`);
  return value;
}
function id(value: unknown) {
  if (typeof value !== "string" || !idPattern.test(value)) fail("invalid ID");
  return value;
}
function list(value: unknown, label: string, maximum = 1024): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`invalid ${label}`);
  return value;
}
function unique<T>(items: T[], name: (item: T) => string, label: string) {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = name(item);
    if (map.has(key)) fail(`duplicate ${label}: ${key}`);
    map.set(key, item);
  }
  return map;
}
function references(
  value: unknown,
  table: Map<string, unknown>,
  label: string,
) {
  const entries = list(value, label).map((entry) => text(entry, label));
  if (new Set(entries).size !== entries.length) fail(`duplicate ${label}`);
  for (const entry of entries)
    if (!table.has(entry)) fail(`missing ${label}: ${entry}`);
  return entries;
}
export function catalogueBytes(content: unknown, limit: number, empty = false) {
  if (typeof content !== "string") fail("resource content must be base64");
  const bytes = Buffer.from(content, "base64");
  if (
    bytes.toString("base64") !== content ||
    bytes.length > limit ||
    (!empty && !bytes.length)
  )
    fail("invalid resource bytes");
  return bytes;
}
function boundBytes(
  value: Record<string, unknown>,
  limit: number,
  empty = false,
) {
  const bytes = catalogueBytes(value.content, limit, empty);
  if (
    typeof value.hash !== "string" ||
    !hashPattern.test(value.hash) ||
    catalogueHash(bytes) !== value.hash
  )
    fail("resource digest mismatch");
  return bytes;
}
function safeResourceName(value: unknown) {
  const name = text(value, "resource name");
  if (
    !/^[A-Za-z0-9_./-]+$/.test(name) ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail("resource name must be a safe relative path");
  return name;
}
function validateLayout(value: unknown) {
  const layout = fields(value, ["id", "style"]);
  id(layout.id);
  const numeric = [
    "x",
    "y",
    "width",
    "height",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "gap",
    "borderWidth",
    "radius",
    "fontSize",
    "lineHeight",
    "fontWeight",
    "opacity",
  ];
  const strings = [
    "direction",
    "background",
    "color",
    "borderColor",
    "fontFamily",
    "fontStyle",
    "textAlign",
    "whiteSpace",
    "display",
  ];
  const source = fields(layout.style, [
    ...numeric,
    ...strings,
    "measured",
    "flex",
  ]);
  if (source.measured !== false || !source.flex)
    fail("layouts require source Flexbox declarations");
  for (const name of numeric) {
    const value = source[name];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      Math.abs(value) > float32Maximum ||
      (!["x", "y"].includes(name) && value < 0)
    )
      fail("invalid layout number");
  }
  if (
    (source.opacity as number) > 1 ||
    !Number.isInteger(source.fontWeight) ||
    (source.fontWeight as number) > 1000
  )
    fail("unsupported opacity or font weight");
  for (const name of strings)
    text(source[name], "layout style", 1024 * 1024, true);
  for (const name of ["background", "color", "borderColor"])
    if (source[name]) sceneColorRGBA(source[name] as string);
  const choices: Record<string, string[]> = {
    direction: ["", "row", "column", "row-reverse", "column-reverse"],
    fontStyle: ["", "normal", "italic"],
    whiteSpace: ["", "normal", "nowrap"],
    textAlign: ["", "left", "right", "center", "start", "end"],
    display: ["", "block", "flex", "none"],
  };
  for (const [name, values] of Object.entries(choices))
    if (!values.includes(source[name] as string))
      fail("unsupported layout keyword");
  const flex = validateSceneFlex(source.flex, "catalogue layout");
  if (flex.boxSizing !== "border-box")
    fail("layouts require border-box sizing");
  for (const value of Object.values(flex))
    if (typeof value === "number" && Math.abs(value) > float32Maximum)
      fail("layout Flex numbers must fit native float32 geometry");
}

function themeColor(value: string): void {
  const color = value.trim();
  if (
    color === "transparent" ||
    /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)
  )
    return;
  const match = /^rgba?\((.*)\)$/.exec(color);
  if (!match) fail("theme colors require computed rgb/rgba or hexadecimal");
  const body = match[1]!,
    comma = body.includes(",");
  if (comma && body.includes("/"))
    fail("theme color mixes comma and slash syntax");
  let channels: string[],
    alpha = "1";
  if (comma) {
    const parts = body.split(",");
    if (parts.length !== 3 && parts.length !== 4)
      fail("invalid theme color channels");
    channels = parts.slice(0, 3);
    if (parts.length === 4) alpha = parts[3]!;
  } else {
    const parts = body.split("/");
    if (parts.length > 2) fail("invalid theme color alpha");
    channels = parts[0]!.trim().split(/\s+/);
    if (parts.length === 2) alpha = parts[1]!;
    if (channels.length !== 3) fail("invalid theme color channels");
  }
  for (const [index, channel] of [...channels, alpha].entries()) {
    const token = channel.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(token))
      fail("invalid theme color channel");
    const percentage = token.endsWith("%"),
      number = Number(percentage ? token.slice(0, -1) : token);
    const limit = percentage ? 100 : index === 3 ? 1 : 255;
    if (!Number.isFinite(number) || number < 0 || number > limit)
      fail("theme color channel is out of range");
  }
}

function themeSize(value: string): void {
  const token = value.trim();
  if (token === "0") return;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?px$/.test(token))
    fail("theme sizes require nonnegative CSS pixels");
  const number = Number(token.slice(0, -2));
  if (!Number.isFinite(number) || number < 0 || number > float32Maximum)
    fail("theme size must fit native float32 geometry");
}

/** Validate portable declarations before any output or native factory runs. */
export async function validateCatalogue(
  value: unknown,
): Promise<CatalogueSpec> {
  value = ownJSON(value);
  const root = fields(
    value,
    [
      "schema",
      "kind",
      "name",
      "resources",
      "stylesheets",
      "fontFaces",
      "themes",
      "layouts",
      "components",
      "islands",
    ],
    ["motions"],
  );
  if (root.schema !== 1 || root.kind !== "astro-fyne-catalogue")
    fail("unknown schema");
  id(root.name);
  const resources = list(root.resources, "resources");
  for (const item of resources) {
    const resource = fields(item, [
      "name",
      "mediaType",
      "hash",
      "content",
      "license",
    ]);
    safeResourceName(resource.name);
    if (
      ![
        "font/ttf",
        "image/png",
        "image/jpeg",
        "text/css",
        "application/octet-stream",
      ].includes(resource.mediaType as string)
    )
      fail("unsupported resource media type");
    if (!text(resource.license, "resource license", 1024 * 1024).trim())
      fail("resource license is empty");
    boundBytes(resource, 20 * 1024 * 1024);
  }
  const resourceMap = unique(
    resources as CatalogueResource[],
    (item) => item.name,
    "resource",
  );
  const sheets = list(root.stylesheets, "stylesheets");
  for (const item of sheets) {
    const sheet = fields(item, ["id", "path", "hash", "content"]);
    id(sheet.id);
    text(sheet.path, "stylesheet source path");
    const bytes = boundBytes(sheet, 16 * 1024 * 1024, true);
    try {
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      fail("stylesheet source requires UTF-8");
    }
  }
  const sheetMap = unique(
    sheets as CatalogueStylesheet[],
    (item) => item.id,
    "stylesheet",
  );
  const fonts = list(root.fontFaces, "font faces", 16);
  const families = new Map<string, string>();
  const faceKeys = new Set<string>();
  for (const item of fonts) {
    const face = fields(item, [
      "id",
      "family",
      "weight",
      "style",
      "resource",
      "hash",
    ]);
    id(face.id);
    if (
      typeof face.family !== "string" ||
      !validFontResourceFamily(face.family) ||
      ![400, 700].includes(face.weight as number) ||
      !["normal", "italic"].includes(face.style as string)
    )
      fail("font faces require an explicit static family/weight/style");
    const resource = resourceMap.get(text(face.resource, "font resource"));
    if (
      !resource ||
      resource.mediaType !== "font/ttf" ||
      resource.hash !== face.hash
    )
      fail("missing or mismatched font resource");
    const family = simpleFontFamilyKey(face.family),
      key = `${family}:${face.weight}:${face.style}`;
    if (
      faceKeys.has(key) ||
      (families.has(family) && families.get(family) !== face.family)
    )
      fail("duplicate or inconsistently named font face");
    faceKeys.add(key);
    families.set(family, face.family);
    inspectFont(
      catalogueBytes(resource.content, 20 * 1024 * 1024),
      face as unknown as CatalogueFontFace,
    );
  }
  const fontMap = unique(
    fonts as CatalogueFontFace[],
    (item) => item.id,
    "font face",
  );
  const themes = list(root.themes, "themes");
  for (const item of themes) {
    const theme = fields(item, ["id", "tokens", "fontFaces"]);
    id(theme.id);
    if (
      !theme.tokens ||
      typeof theme.tokens !== "object" ||
      Array.isArray(theme.tokens)
    )
      fail("theme tokens must be an object");
    if (Object.keys(theme.tokens).length > 1024)
      fail("theme tokens exceed 1024 entries");
    for (const [name, token] of Object.entries(theme.tokens)) {
      text(name, "theme token name", 256);
      if (
        !name.startsWith("--") ||
        name.length < 3 ||
        /[\t\n\f\r \0]/.test(name)
      )
        fail("invalid custom-property name");
      text(token, "theme token", 1024 * 1024, true);
      if (
        name.startsWith("--fyne-color-") ||
        [
          "--color-background",
          "--color-primary",
          "--color-text",
          "--color-border",
        ].includes(name)
      )
        themeColor(token as string);
      if (name === "--fyne-color-" || name === "--fyne-size-")
        fail("theme override name is empty");
      if (name.startsWith("--fyne-size-")) themeSize(token as string);
    }
    const slots = new Set<string>();
    for (const reference of references(
      theme.fontFaces,
      fontMap,
      "theme font face",
    )) {
      const face = fontMap.get(reference)!;
      const key = `${face.weight}:${face.style}`;
      if (slots.has(key)) fail("duplicate theme font slot");
      slots.add(key);
    }
  }
  const themeMap = unique(
    themes as CatalogueTheme[],
    (item) => item.id,
    "theme",
  );
  const layouts = list(root.layouts, "layouts");
  layouts.forEach(validateLayout);
  const layoutMap = unique(
    layouts as CatalogueLayout[],
    (item) => item.id,
    "layout",
  );
  const components = list(root.components, "components");
  const javascript = new Map<string, JavascriptArchive>();
  for (const item of components) {
    const component = fields(
      item,
      ["id", "kind", "payload", "hash", "stylesheets", "fontFaces", "actions"],
      ["theme", "layout"],
    );
    id(component.id);
    const payload = text(
      component.payload,
      "component payload",
      64 * 1024 * 1024,
    );
    if (
      !hashPattern.test(component.hash as string) ||
      catalogueHash(payload) !== component.hash
    )
      fail("component payload digest mismatch");
    const document = parseJSON(payload);
    let actions: string[];
    const css = references(
      component.stylesheets,
      sheetMap,
      "component stylesheet",
    );
    if (component.kind === "javascript") {
      const archive = await validateJavascriptArchive(document);
      javascript.set(component.id as string, archive);
      actions = archive.actions;
      if (css.length !== (archive.stylesheets?.length ?? 0))
        fail("compiled and retained stylesheet inventories differ");
      for (const source of archive.stylesheets ?? []) {
        const matches = css
          .map((name) => sheetMap.get(name)!)
          .filter(
            (sheet) =>
              sheet.path === source.path &&
              sheet.hash === source.hash &&
              catalogueBytes(sheet.content, 16 * 1024 * 1024, true).equals(
                Buffer.from(source.text),
              ),
          );
        if (matches.length !== 1)
          fail("compiled and retained stylesheet bytes differ");
      }
    } else if (component.kind === "program") {
      const raw = fields(document, [
        "schema",
        "kind",
        "sourceHash",
        "programHash",
        "program",
        "props",
        "state",
      ]);
      if (typeof raw.program === "string") parseJSON(raw.program);
      actions = validateProgramArchive(document).program.actions;
      if (css.length)
        fail("declarative programs require their compiled style contract");
    } else if (component.kind === "scene") {
      actions = validateSceneDocument(document).requiredActions;
      if (css.length)
        fail("scenes cannot infer a live stylesheet from retained source");
    } else fail("unknown component kind");
    const declared = list(component.actions, "component actions").map(
      (action) => text(action, "action"),
    );
    if (
      new Set(declared).size !== declared.length ||
      JSON.stringify([...declared].sort()) !==
        JSON.stringify([...actions].sort())
    )
      fail("component action contract differs from its payload");
    references(component.fontFaces, fontMap, "component font face");
    for (const [field, table] of [
      ["theme", themeMap],
      ["layout", layoutMap],
    ] as const)
      if (
        component[field] !== undefined &&
        !table.has(text(component[field], field))
      )
        fail(`missing component ${field}`);
  }
  const componentMap = unique(
    components as CatalogueComponent[],
    (item) => item.id,
    "component",
  );
  const islands = list(root.islands, "islands");
  for (const item of islands) {
    const island = fields(
      item,
      ["id", "component", "key"],
      ["statePayload", "stateHash"],
    );
    id(island.id);
    text(island.key, "island key", 1024);
    if (!componentMap.has(text(island.component, "island component")))
      fail("missing island component");
    const hasPayload = Object.hasOwn(island, "statePayload"),
      hasHash = Object.hasOwn(island, "stateHash");
    if (hasPayload !== hasHash)
      fail("island state payload and hash must be present together");
    if (hasPayload) {
      const payload = text(
        island.statePayload,
        "island state payload",
        64 * 1024 * 1024,
      );
      if (
        typeof island.stateHash !== "string" ||
        !hashPattern.test(island.stateHash) ||
        catalogueHash(payload) !== island.stateHash
      )
        fail("island state payload digest mismatch");
      const prototype = javascript.get(island.component as string);
      if (!prototype) fail("island checkpoints require a JavaScript component");
      const state = await validateJavascriptArchive(parseJSON(payload));
      const sources = (archive: JavascriptArchive) =>
        archive.sources.map(({ path, hash }) => [path, hash]);
      const styles = (archive: JavascriptArchive) =>
        (archive.stylesheets ?? []).map(({ path, hash, text }) => [
          path,
          hash,
          text,
        ]);
      if (
        state.schema !== prototype.schema ||
        state.code !== prototype.code ||
        state.codeHash !== prototype.codeHash ||
        JSON.stringify(sources(state)) !== JSON.stringify(sources(prototype)) ||
        JSON.stringify(styles(state)) !== JSON.stringify(styles(prototype)) ||
        JSON.stringify(state.actions) !== JSON.stringify(prototype.actions)
      )
        fail(
          "island state cannot replace component code, sources, CSS or action contracts",
        );
    }
  }
  unique(islands as CatalogueIsland[], (item) => item.id, "island");
  if (root.motions !== undefined) {
    const motions = list(root.motions, "motions", 128).map(validateMotion);
    unique(motions, (motion) => motion.id, "motion");
  }
  return structuredClone(value) as CatalogueSpec;
}

/** Record one immutable island checkpoint without changing its component. */
export async function withCatalogueIslandState(
  value: unknown,
  islandId: string,
  payload: string,
): Promise<CatalogueSpec> {
  const spec = await validateCatalogue(value),
    island = spec.islands.find((item) => item.id === islandId);
  if (!island) fail(`unknown island ${islandId}`);
  island.statePayload = payload;
  island.stateHash = catalogueHash(payload);
  return validateCatalogue(spec);
}
