// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { inspectBitmap } from "./resources.ts";
import {
  sourceStyleCSS,
  validateResponsiveScene,
  validateSceneFlex,
} from "./scene-layout.ts";
import type { SceneFlex } from "./scene-layout.ts";

const geometry = [
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
] as const;
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
] as const;
export type SceneStyle = Record<(typeof geometry)[number], number> &
  Record<(typeof strings)[number], string> & { measured: boolean };
export type SceneSourceStyle = Omit<SceneStyle, "measured"> & {
  measured: false;
  flex: SceneFlex;
};
export interface SceneNode {
  id: string;
  kind: "container" | "text" | "button" | "input" | "textarea" | "image";
  text?: string;
  value?: string;
  placeholder?: string;
  placeholderColor?: string;
  disabled?: boolean;
  accessibleLabel?: string;
  labelFor?: string;
  href?: string;
  style: SceneStyle;
  events?: { tap?: string; input?: string; change?: string; submit?: string };
  children: SceneNode[];
  resource?: string;
  sourceStyle?: SceneSourceStyle;
}
export interface SceneResource {
  name: string;
  path: string;
  hash: string;
  mediaType: "image/png" | "image/jpeg";
  content: string;
  width: number;
  height: number;
}
export interface SceneDocument {
  schema: 1 | 2;
  layout?: "flex";
  viewport: { width: number; height: number; scale: number };
  roots: SceneNode[];
  tokens: Record<string, string>;
  resources: SceneResource[];
  requiredActions: string[];
}
export interface WebSceneOptions {
  name: string;
  /** Explicit client module exporting an actions object; Go callback code is never inferred. */
  actionsModule?: string;
  componentImport?: string;
}
export interface WebSceneAsset {
  path: string;
  content: Uint8Array;
  hash: string;
  mediaType: "image/png" | "image/jpeg";
}
export interface WebSceneOutput {
  astro: string;
  preact: string;
  css: string;
  assets: WebSceneAsset[];
  report: {
    generator: "astro-fyne";
    schema: 1;
    direction: "fyne-to-astro";
    name: string;
    sceneHash: string;
    viewport: SceneDocument["viewport"];
    nodeCount: number;
    rootId: string;
    requiredActions: string[];
    resources: Omit<SceneResource, "content">[];
    visualVerified: false;
    warnings: string[];
  };
}

function fail(path: string, message: string): never {
  throw new Error(`Scene ${path}: ${message}`);
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(path, "expected an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    fail(path, "expected JSON data, not a class instance");
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  ))
    if (descriptor.get || descriptor.set)
      fail(`${path}.${key}`, "JSON fields cannot be accessors");
  return value as Record<string, unknown>;
}
function fields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${path}.${key}`, "unknown field");
}

// Shared JSON guards for validators of exported-scene conformance evidence.
export { record as sceneJSONRecord, fields as sceneJSONFields };
function text(
  value: unknown,
  path: string,
  nonempty = false,
  maximum = 1_000_000,
): string {
  if (typeof value !== "string" || (nonempty && !value.length))
    fail(path, nonempty ? "expected a nonempty string" : "expected a string");
  if (value.length > maximum || /\u0000/.test(value))
    fail(path, "string exceeds limits or contains NUL");
  return value;
}
function number(value: unknown, path: string, minimum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(path, "expected a finite number");
  if (minimum !== undefined && value < minimum)
    fail(path, `must be at least ${minimum}`);
  return value;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}
function action(value: unknown, path: string): string {
  const name = text(value, path, true);
  if (name.length > 256 || /[\u0000-\u001f\u007f]/.test(name))
    fail(path, "invalid action ID");
  return name;
}

// Restrict colors to the native solid-color grammar. Values enter CSS only after
// validation, never as arbitrary declarations, selectors, URLs or HTML.
function color(value: string, path: string): string {
  const normalized = value.toLowerCase().trim();
  if (["", "transparent", "black", "white"].includes(normalized))
    return normalized || "transparent";
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
    return value;
  const match = /^rgba?\(([\d.%+,\s/+-]+)\)$/i.exec(value);
  const channels = match?.[1]?.split(/[,\s/]+/).filter(Boolean);
  if (!channels || ![3, 4].includes(channels.length))
    fail(path, "unsupported native solid color");
  const rgba = [0, 0, 0, 255];
  for (const [index, channel] of channels.entries()) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(channel))
      fail(path, "invalid color channel");
    const maximum = channel.endsWith("%") ? 100 : index === 3 ? 1 : 255;
    const numeric = Number(channel.replace(/%$/, ""));
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > maximum)
      fail(path, "color channel outside native range");
    rgba[index] = Math.round((numeric / maximum) * 255);
  }
  // Public native ParseColor resolves channels to RGBA8 and accepts separators
  // that CSS does not. Emit the actual native color, never its ambiguous spelling.
  return rgba[3] === 255
    ? `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})`
    : `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]! / 255})`;
}

/** Resolve a validated solid scene color to native RGBA8 channels. */
export function sceneColorRGBA(
  value: string,
): [number, number, number, number] {
  const normalized = color(value, "color").toLowerCase().trim();
  if (normalized === "transparent") return [0, 0, 0, 0];
  if (normalized === "black") return [0, 0, 0, 255];
  if (normalized === "white") return [255, 255, 255, 255];
  if (normalized.startsWith("#")) {
    let hex = normalized.slice(1);
    if (hex.length <= 4)
      hex = [...hex].map((character) => character + character).join("");
    if (hex.length === 6) hex += "ff";
    return [0, 2, 4, 6].map((offset) =>
      parseInt(hex.slice(offset, offset + 2), 16),
    ) as [number, number, number, number];
  }
  const channels = normalized
    .slice(normalized.indexOf("(") + 1, -1)
    .split(",")
    .map(Number);
  return [
    channels[0]!,
    channels[1]!,
    channels[2]!,
    channels.length === 4 ? Math.round(channels[3]! * 255) : 255,
  ];
}
function style(value: unknown, path: string): SceneStyle {
  const source = record(value, path);
  fields(source, [...geometry, ...strings, "measured"], path);
  const result = {} as SceneStyle;
  for (const key of geometry)
    result[key] = number(
      source[key],
      `${path}.${key}`,
      ["x", "y"].includes(key) ? undefined : 0,
    );
  for (const key of strings) result[key] = text(source[key], `${path}.${key}`);
  if (source.measured !== true)
    fail(`${path}.measured`, "scene geometry must be resolved and measured");
  result.measured = true;
  if (result.opacity !== 1)
    fail(`${path}.opacity`, "native group-opacity composition is unsupported");
  if (result.fontWeight > 1000 || !Number.isInteger(result.fontWeight))
    fail(`${path}.fontWeight`, "expected integer 0..1000");
  const enums: Record<string, string[]> = {
    direction: ["", "row", "column"],
    fontStyle: ["", "normal", "italic"],
    textAlign: ["", "left", "start", "center", "right", "end"],
    whiteSpace: ["", "normal", "nowrap"],
    display: ["", "none", "block", "flex", "inline", "inline-block"],
  };
  for (const [key, allowed] of Object.entries(enums))
    if (!allowed.includes(result[key as keyof SceneStyle] as string))
      fail(`${path}.${key}`, "unsupported native style value");
  for (const key of ["background", "color", "borderColor"] as const)
    result[key] = color(result[key], `${path}.${key}`);
  if (
    result.fontFamily &&
    !/^(?:"[^"\\\r\n<>]*"|'[^'\\\r\n<>]*'|[A-Za-z][A-Za-z\d _-]*)(?:\s*,\s*(?:"[^"\\\r\n<>]*"|'[^'\\\r\n<>]*'|[A-Za-z][A-Za-z\d _-]*))*$/.test(
      result.fontFamily,
    )
  )
    fail(`${path}.fontFamily`, "unsupported or unsafe font-family list");
  return result;
}

/** Validate an actual exported scene; unknown fields and unsupported semantics fail closed. */
export function validateSceneDocument(value: unknown): SceneDocument {
  const source = record(value, "$");
  fields(
    source,
    [
      "schema",
      "viewport",
      "roots",
      "tokens",
      "resources",
      "requiredActions",
      "layout",
    ],
    "$",
  );
  if (source.schema !== 1 && source.schema !== 2)
    fail("$.schema", "expected schema 1 or 2");
  if (
    source.schema === 2 ? source.layout !== "flex" : source.layout !== undefined
  )
    fail("$.layout", "schema 2 requires layout:flex; schema 1 is frozen");
  const viewport = record(source.viewport, "$.viewport");
  fields(viewport, ["width", "height", "scale"], "$.viewport");
  const width = number(viewport.width, "$.viewport.width", Number.MIN_VALUE);
  const height = number(viewport.height, "$.viewport.height", Number.MIN_VALUE);
  const scale = number(viewport.scale, "$.viewport.scale");
  if (![1, 2].includes(scale))
    fail("$.viewport.scale", "supported capture scales are 1 and 2");
  const tokens = record(source.tokens, "$.tokens");
  for (const [name, token] of Object.entries(tokens)) {
    if (!/^--[A-Za-z\d_-]+$/.test(name))
      fail(`$.tokens.${name}`, "expected a CSS custom-property name");
    text(token, `$.tokens.${name}`);
  }
  const ids = new Map<string, SceneNode>();
  const references = new Set<string>();
  let count = 0;
  const nodes = (values: unknown[], path: string, depth: number): SceneNode[] =>
    values.map((value, index) => {
      const location = `${path}[${index}]`;
      if (depth > 128 || ++count > 100_000)
        fail(location, "scene tree exceeds limits");
      const node = record(value, location);
      fields(
        node,
        [
          "id",
          "kind",
          "text",
          "value",
          "placeholder",
          "placeholderColor",
          "disabled",
          "accessibleLabel",
          "labelFor",
          "href",
          "style",
          "events",
          "children",
          "resource",
          "sourceStyle",
        ],
        location,
      );
      const id = text(node.id, `${location}.id`, true);
      if (ids.has(id))
        fail(`${location}.id`, `duplicate ID ${JSON.stringify(id)}`);
      if (
        !["container", "text", "button", "input", "textarea", "image"].includes(
          node.kind as string,
        )
      )
        fail(`${location}.kind`, "unsupported native kind");
      const output = {
        id,
        kind: node.kind,
        style: style(node.style, `${location}.style`),
        children: [],
      } as SceneNode;
      if (source.schema === 2) {
        const declared = record(node.sourceStyle, `${location}.sourceStyle`);
        if (declared.measured !== false)
          fail(
            `${location}.sourceStyle.measured`,
            "source declarations cannot be measured",
          );
        const { flex, ...values } = declared;
        output.sourceStyle = {
          ...style({ ...values, measured: true }, `${location}.sourceStyle`),
          measured: false,
          flex: validateSceneFlex(flex, `${location}.sourceStyle.flex`),
        };
      } else if (node.sourceStyle !== undefined)
        fail(
          `${location}.sourceStyle`,
          "responsive declarations require schema 2",
        );
      ids.set(id, output);
      for (const key of [
        "text",
        "value",
        "placeholder",
        "placeholderColor",
        "accessibleLabel",
        "labelFor",
        "href",
        "resource",
      ] as const)
        if (node[key] !== undefined)
          output[key] = text(node[key], `${location}.${key}`);
      if (output.href)
        fail(
          `${location}.href`,
          "navigation requires an explicit native action, not an inferred link",
        );
      if (
        output.kind === "input" &&
        /[\r\n]/.test((output.value ?? "") + (output.placeholder ?? ""))
      )
        fail(
          location,
          "single-line controls cannot preserve CR/LF values or placeholders in HTML",
        );
      if (
        output.kind === "textarea" &&
        /\r/.test((output.value ?? "") + (output.placeholder ?? ""))
      )
        fail(
          location,
          "textarea CR normalization requires an explicit text contract",
        );
      if (output.placeholderColor !== undefined) {
        if (!["input", "textarea"].includes(output.kind))
          fail(
            `${location}.placeholderColor`,
            "placeholder color belongs to a text control",
          );
        output.placeholderColor = color(
          output.placeholderColor,
          `${location}.placeholderColor`,
        );
      }
      if (output.placeholder && !output.placeholderColor)
        fail(
          `${location}.placeholderColor`,
          "a visible native placeholder requires its exact color",
        );
      if (node.disabled !== undefined) {
        if (typeof node.disabled !== "boolean")
          fail(`${location}.disabled`, "expected a boolean");
        output.disabled = node.disabled;
      }
      if (node.events !== undefined) {
        const events = record(node.events, `${location}.events`);
        fields(
          events,
          ["tap", "input", "change", "submit"],
          `${location}.events`,
        );
        output.events = {};
        for (const key of ["tap", "input", "change", "submit"] as const) {
          if (events[key] === undefined) continue;
          const name = action(events[key], `${location}.events.${key}`);
          if (
            key === "tap"
              ? output.kind !== "button"
              : !["input", "textarea"].includes(output.kind)
          )
            fail(
              `${location}.events.${key}`,
              "event does not match this native kind",
            );
          if (key === "submit" && output.kind !== "input")
            fail(
              `${location}.events.${key}`,
              "multiline submit requires a separate keyboard contract",
            );
          output.events[key] = name;
          references.add(name);
        }
      }
      output.children = nodes(
        array(node.children, `${location}.children`),
        `${location}.children`,
        depth + 1,
      );
      if (output.kind !== "container" && output.children.length)
        fail(
          `${location}.children`,
          "only native containers can own child nodes",
        );
      if (output.kind === "container" && output.text && output.children.length)
        fail(
          location,
          "container text and children require an explicit paint-order contract",
        );
      if (["input", "textarea", "image"].includes(output.kind) && output.text)
        fail(
          `${location}.text`,
          "control and image overlay text requires an explicit native contract",
        );
      if (output.labelFor && output.kind !== "text")
        fail(`${location}.labelFor`, "only text nodes can label controls");
      if (output.kind === "image") {
        if (!output.resource)
          fail(`${location}.resource`, "image needs an embedded bitmap");
        if (
          output.style.borderWidth ||
          output.style.radius ||
          output.style.paddingTop ||
          output.style.paddingRight ||
          output.style.paddingBottom ||
          output.style.paddingLeft
        )
          fail(
            `${location}.style`,
            "image borders, radii and padding require a native image contract",
          );
      } else if (output.resource)
        fail(`${location}.resource`, "resource belongs to an image node");
      return output;
    });
  const roots = nodes(array(source.roots, "$.roots"), "$.roots", 0);
  for (const node of ids.values())
    if (
      node.labelFor &&
      !["input", "textarea"].includes(ids.get(node.labelFor)?.kind ?? "")
    )
      fail(
        `node ${JSON.stringify(node.id)}.labelFor`,
        "label target must be an existing input or textarea",
      );
  const resourceNames = new Set<string>();
  const paths = new Set<string>();
  const resources = array(source.resources, "$.resources").map(
    (value, index) => {
      const location = `$.resources[${index}]`;
      const resource = record(value, location);
      fields(
        resource,
        ["name", "path", "hash", "mediaType", "content", "width", "height"],
        location,
      );
      const name = text(resource.name, `${location}.name`, true);
      const path = text(resource.path, `${location}.path`, true);
      if (resourceNames.has(name) || paths.has(path))
        fail(location, "duplicate resource name or path");
      if (
        !/^[A-Za-z\d._-]+(?:\/[A-Za-z\d._-]+)*$/.test(path) ||
        path.split("/").some((part) => [".", ".."].includes(part))
      )
        fail(`${location}.path`, "expected a safe relative public asset path");
      const digest = text(resource.hash, `${location}.hash`);
      if (!/^[a-f\d]{64}$/.test(digest))
        fail(`${location}.hash`, "expected a lowercase SHA-256 digest");
      const content = text(
        resource.content,
        `${location}.content`,
        false,
        28_000_000,
      );
      if (content.length % 4 || !/^[A-Za-z\d+/]*={0,2}$/.test(content))
        fail(`${location}.content`, "expected canonical bounded base64");
      const bytes = Buffer.from(content, "base64");
      if (bytes.toString("base64") !== content)
        fail(`${location}.content`, "base64 is not canonical");
      if (createHash("sha256").update(bytes).digest("hex") !== digest)
        fail(`${location}.hash`, "resource bytes do not match their digest");
      const mediaType = text(resource.mediaType, `${location}.mediaType`);
      let metadata: ReturnType<typeof inspectBitmap>;
      try {
        metadata = inspectBitmap(bytes, mediaType);
      } catch (error) {
        fail(location, error instanceof Error ? error.message : String(error));
      }
      if (
        resource.width !== metadata.width ||
        resource.height !== metadata.height
      )
        fail(location, "bitmap dimensions do not match their bytes");
      if (
        !(mediaType === "image/png" ? /\.png$/i : /\.(?:jpg|jpeg)$/i).test(path)
      )
        fail(`${location}.path`, "extension does not match bitmap media type");
      resourceNames.add(name);
      paths.add(path);
      return {
        name,
        path,
        hash: digest,
        mediaType: metadata.mediaType,
        content,
        width: metadata.width,
        height: metadata.height,
      };
    },
  );
  for (const node of ids.values())
    if (node.resource && !resourceNames.has(node.resource))
      fail(
        `node ${JSON.stringify(node.id)}.resource`,
        "bitmap resource is missing",
      );
  const requiredActions = array(
    source.requiredActions,
    "$.requiredActions",
  ).map((value, index) => action(value, `$.requiredActions[${index}]`));
  if (new Set(requiredActions).size !== requiredActions.length)
    fail("$.requiredActions", "duplicate action IDs");
  if (
    requiredActions.length !== references.size ||
    requiredActions.some((name) => !references.has(name))
  )
    fail(
      "$.requiredActions",
      "must match exactly the actions referenced by node events",
    );
  const document: SceneDocument = {
    schema: source.schema,
    ...(source.schema === 2 ? { layout: "flex" as const } : {}),
    viewport: { width, height, scale },
    roots,
    tokens: { ...tokens } as Record<string, string>,
    resources,
    requiredActions: [...requiredActions].sort(),
  };
  if (document.schema === 2) validateResponsiveScene(document);
  return document;
}

const literal = (value: unknown) =>
  JSON.stringify(value)
    ?.replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029") ?? "undefined";
function modulePath(value: string, option: string): string {
  if (
    !value ||
    /[\u0000-\u001f<>\\]/.test(value) ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(value) ||
    value.startsWith("//")
  )
    throw new Error(
      `${option}: expected an explicit local or package module import`,
    );
  return literal(value);
}

function tokenValue(value: string, path: string): string {
  // Keep native custom-property values, but prohibit declaration/rule escapes.
  // These are stylesheet values, never interpreted JS or HTML.
  let quote = "";
  let parentheses = 0;
  for (const character of value) {
    if (/[\\\u0000-\u001f<>]/.test(character))
      fail(path, "unsafe CSS token value");
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (/[;{}]/.test(character))
      fail(path, "CSS token cannot escape its declaration");
    else if (character === "(") parentheses++;
    else if (character === ")" && --parentheses < 0)
      fail(path, "unbalanced CSS token");
  }
  if (quote || parentheses || /\/\*/.test(value))
    fail(path, "unbalanced or commented CSS token");
  return value;
}

/** Generate safe, editable web artifacts from a frozen native scene. */
export function emitWebScene(
  value: unknown,
  options: WebSceneOptions,
): WebSceneOutput {
  const document = validateSceneDocument(value);
  if (!/^[A-Z][A-Za-z\d_]*$/.test(options.name))
    throw new Error("name: expected a capitalized component identifier");
  const name = options.name;
  const componentImport = modulePath(
    options.componentImport ?? `./${name}.tsx`,
    "componentImport",
  );
  const actionsModule = options.actionsModule
    ? modulePath(options.actionsModule, "actionsModule")
    : undefined;
  if (document.requiredActions.length && !actionsModule)
    throw new Error(
      "actionsModule: Astro islands require an explicit client actions module; SSR functions cannot be serialized",
    );
  const scope = `af-${name}`;
  const tokens = Object.entries(document.tokens)
    .map(([key, value]) => `${key}:${tokenValue(value, `$.tokens.${key}`)};`)
    .join("");
  const sceneIDs = new Set<string>();
  let hasControls = false;
  const collect = (nodes: SceneNode[]) => {
    for (const node of nodes) {
      sceneIDs.add(node.id);
      if (["input", "textarea"].includes(node.kind)) hasControls = true;
      collect(node.children);
    }
  };
  collect(document.roots);
  let rootID = "fyne-root";
  for (let suffix = 1; sceneIDs.has(rootID); suffix++)
    rootID = `fyne-root-${suffix}`;
  const staticScene = !hasControls && !document.requiredActions.length;
  const responsive = document.schema === 2;
  if (responsive) rootID = document.roots[0]!.id;
  const rules: string[] = [
    `.${scope}{position:relative;box-sizing:border-box;width:${responsive ? "100%" : `${document.viewport.width}px`};height:${document.viewport.height}px;margin:0;padding:0;border:0;overflow:hidden;${tokens}}`,
    `.${scope} .af-node{box-sizing:border-box;position:${responsive ? "static" : "absolute"};margin:0;min-width:0;min-height:0;max-width:none;max-height:none;box-shadow:none;}`,
    `.${scope} button, .${scope} input, .${scope} textarea{appearance:none;}`,
    `.${scope} textarea{resize:none;}`,
    `.${scope} img{object-fit:fill;}`,
    `.${scope} :focus-visible{outline:2px solid currentColor;outline-offset:2px;}`,
  ];
  let nodeCount = 0;
  const resources = new Map(
    document.resources.map((resource) => [resource.name, resource]),
  );
  const render = (node: SceneNode, parentBorder: number): string => {
    const index = nodeCount++;
    const className = `${scope}-n${index}`;
    const s = node.style;
    if (!responsive)
      rules.push(
        `.${scope} .${className}{left:${s.x - parentBorder}px;top:${s.y - parentBorder}px;width:${s.width}px;height:${s.height}px;padding:${s.paddingTop}px ${s.paddingRight}px ${s.paddingBottom}px ${s.paddingLeft}px;gap:${s.gap}px;flex-direction:${s.direction || "column"};background:${color(s.background, "background")};color:${color(s.color, "color")};border:${s.borderWidth}px solid ${color(s.borderColor, "borderColor")};border-radius:${s.radius}px;font-size:${s.fontSize}px;line-height:${s.lineHeight}px;font-weight:${s.fontWeight || 400};font-family:${s.fontFamily || "inherit"};font-style:${s.fontStyle || "normal"};text-align:${s.textAlign || "left"};white-space:${s.whiteSpace || "normal"};display:${s.display || "block"};opacity:${s.opacity};}`,
      );
    const classes = `${node.id === rootID && responsive ? scope + " " : ""}af-node ${className}`;
    const sourceCSS = responsive
      ? sourceStyleCSS(node.sourceStyle!)
      : undefined;
    const inline = sourceCSS ? ` style={${literal(sourceCSS)}}` : "";
    const attrs = `id={${literal(node.id)}}${responsive && staticScene ? "" : ` class={${literal(classes)}}`}${inline}${node.accessibleLabel ? ` aria-label={${literal(node.accessibleLabel)}}` : ""}`;
    if (node.kind === "input" || node.kind === "textarea") {
      if (node.placeholderColor)
        rules.push(
          `.${scope} .${className}::placeholder{color:${color(node.placeholderColor, "placeholderColor")};opacity:1;font:inherit;line-height:inherit;}`,
        );
      return `<${name}Field id={${literal(node.id)}} className={${literal(classes)}}${inline} initial={${literal(node.value ?? "")}} placeholder={${literal(node.placeholder ?? "")}} label={${literal(node.accessibleLabel ?? node.placeholder ?? "")}} disabled={${!!node.disabled}} multiline={${node.kind === "textarea"}} input={${literal(node.events?.input)}} change={${literal(node.events?.change)}} submit={${literal(node.events?.submit)}} actions={boundActions} />`;
    }
    if (node.kind === "image")
      return `<img ${attrs} src={${literal("/" + resources.get(node.resource!)!.path)}} alt={${literal(node.accessibleLabel ?? "")}} />`;
    if (node.kind === "button")
      return `<button ${attrs} type="button" disabled={${!!node.disabled}}${node.events?.tap ? ` onClick={()=>boundActions[${literal(node.events.tap)}]!()}` : ""}>{${literal(node.text ?? "")}}</button>`;
    const tag = node.labelFor ? "label" : "div";
    return `<${tag} ${attrs}${node.labelFor ? ` htmlFor={${literal(node.labelFor)}}` : ""}>{${literal(node.text ?? "")}}${node.children.map((child) => render(child, s.borderWidth)).join("")}</${tag}>`;
  };
  const body = document.roots.map((node) => render(node, 0)).join("\n");
  const markup = responsive
    ? body
    : `<main id={${literal(rootID)}} class={${literal(scope)}}>${body}</main>`;
  const css = `/* Code generated by astro-fyne. DO NOT EDIT.\n * SPDX-License-Identifier: Apache-2.0\n * Geometry is a frozen scene; visual parity requires a comparison. */\n${rules.join("\n")}\n`;
  const load = actionsModule
    ? `useEffect(()=>{ if(actions) return; let active=true; import(${actionsModule}).then(module=>{const next=module.actions as ${name}Actions; require${name}Actions(next); if(active) setLoaded(next);}).catch(error=>{if(active) setFailure(error instanceof globalThis.Error?error.message:globalThis.String(error));}); return()=>{active=false;}; },[actions]);`
    : "";
  const header =
    "// Code generated by astro-fyne. DO NOT EDIT.\n// SPDX-License-Identifier: Apache-2.0\n";
  const preact = staticScene
    ? `${header}${responsive ? "" : `import ${literal(`./${name}.css`)};\n`}export function ${name}(){return ${markup};}\nexport default ${name};\n`
    : `${header}// Scene data is escaped; host action code remains explicit.\nimport {useEffect,useRef,useState} from "preact/hooks";\nimport type {JSX} from "preact";\nimport ${literal(`./${name}.css`)};\nexport type ${name}Actions=Record<string,((value?:string)=>unknown)|undefined>;\nexport interface ${name}Props {actions?:${name}Actions;}\nconst requiredActions=${literal(document.requiredActions)};\nexport function require${name}Actions(actions:${name}Actions):void { for(const id of requiredActions) {if(!actions||!globalThis.Object.prototype.hasOwnProperty.call(actions,id)||typeof actions[id]!=="function") throw new globalThis.Error("Missing native scene action: "+id);} }\nfunction ${name}Field({id,className,style,initial,placeholder,label,disabled,multiline,input,change,submit,actions}:{id:string;className:string;style?:JSX.CSSProperties;initial:string;placeholder:string;label:string;disabled:boolean;multiline:boolean;input?:string;change?:string;submit?:string;actions:${name}Actions}) {\n const [value,setValue]=useState(initial); const committed=useRef(initial); const dirty=useRef(false);const current=useRef(initial);\n const commit=(next:string)=>{if(disabled)return; const changed=dirty.current&&next!==committed.current; committed.current=next;dirty.current=false;if(changed&&change)actions[change]!(next);};\n const handlers={id,class:className,style,value,placeholder,disabled,"aria-label":label||undefined,name:id,onFocus:(event:JSX.TargetedFocusEvent<HTMLInputElement|HTMLTextAreaElement>)=>{committed.current=event.currentTarget.value;dirty.current=false;},onInput:(event:JSX.TargetedInputEvent<HTMLInputElement|HTMLTextAreaElement>)=>{if(disabled)return;const next=event.currentTarget.value;if(next===current.current)return;current.current=next;setValue(next);dirty.current=true;if(input)actions[input]!(next);},onBlur:(event:JSX.TargetedFocusEvent<HTMLInputElement|HTMLTextAreaElement>)=>commit(event.currentTarget.value),onKeyDown:(event:JSX.TargetedKeyboardEvent<HTMLInputElement|HTMLTextAreaElement>)=>{if(disabled||multiline||event.key!=="Enter"||event.isComposing)return;event.preventDefault();const field=event.currentTarget;const submitted=field.value;commit(submitted);if(submit&&field.disabled!==true&&field.isConnected!==false)actions[submit]!(submitted);}};\n return multiline?<textarea {...handlers}/>:<input type="text" {...handlers}/>;\n}\nexport function ${name}({actions}:${name}Props={}) {const [loaded,setLoaded]=useState<${name}Actions|undefined>(undefined);const [failure,setFailure]=useState("");${load}\n if(failure)throw new globalThis.Error(failure);const boundActions=actions??loaded${document.requiredActions.length ? "" : "??{}"};if(!boundActions)return null;require${name}Actions(boundActions);\n return ${markup};\n}\nexport default ${name};\n`;
  const astro = `---\n${header}import ${name} from ${componentImport};\n${responsive ? `import ${literal(`./${name}.css`)};\n` : ""}---\n<!doctype html>\n<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/><title>${name}</title></head><body><${name} client:only="preact" /></body></html>\n<style is:global>html,body{margin:0;padding:0;overflow:hidden;}</style>\n`;
  return {
    astro,
    preact,
    css,
    assets: document.resources.map((resource) => ({
      path: resource.path,
      content: Buffer.from(resource.content, "base64"),
      hash: resource.hash,
      mediaType: resource.mediaType,
    })),
    report: {
      generator: "astro-fyne",
      schema: 1,
      direction: "fyne-to-astro",
      name,
      sceneHash: createHash("sha256")
        .update(JSON.stringify(document))
        .digest("hex"),
      viewport: document.viewport,
      nodeCount,
      rootId: rootID,
      requiredActions: document.requiredActions,
      resources: document.resources.map(
        ({ content: _, ...resource }) => resource,
      ),
      visualVerified: false,
      warnings: [
        responsive
          ? "Responsive Flexbox declarations are preserved; values and named callback boundaries describe the exported state."
          : "This is a frozen laid-out scene, not a translation of arbitrary Go source or callback code.",
        "Font-family assertions require matching browser font resources; pixel equality has not been verified.",
      ],
    },
  };
}
