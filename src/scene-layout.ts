// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { sceneColorRGBA, sceneJSONFields, sceneJSONRecord } from "./reverse.ts";
import type { SceneDocument, SceneNode, SceneSourceStyle } from "./reverse.ts";

export interface SceneFlex {
  grow?: number;
  shrink?: number;
  basis?: number;
  minWidth?: number;
  minHeight?: number;
  widthPercent?: number;
  heightPercent?: number;
  widthSet?: boolean;
  heightSet?: boolean;
  justifyContent?: string;
  alignItems?: string;
  alignSelf?: string;
  boxSizing?: string;
  borderStyle?: string;
  appearance?: string;
  marginSet?: boolean;
}
const numeric = [
  "grow",
  "shrink",
  "basis",
  "minWidth",
  "minHeight",
  "widthPercent",
  "heightPercent",
] as const;
const booleans = ["widthSet", "heightSet", "marginSet"] as const;
const choices = {
  justifyContent: [
    "",
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
  ],
  alignItems: ["", "flex-start", "flex-end", "center", "stretch"],
  alignSelf: ["", "auto", "flex-start", "flex-end", "center", "stretch"],
  boxSizing: ["border-box"],
  borderStyle: ["", "solid"],
  appearance: ["", "none"],
} as const;

function fail(path: string, message: string): never {
  throw new Error(`Scene ${path}: ${message}`);
}

export function validateSceneFlex(value: unknown, path: string): SceneFlex {
  const source = sceneJSONRecord(value, path);
  sceneJSONFields(
    source,
    [...numeric, ...booleans, ...Object.keys(choices)],
    path,
  );
  const result: SceneFlex = {};
  for (const key of numeric) {
    if (source[key] === undefined) continue;
    const value = source[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      fail(`${path}.${key}`, "expected a finite nonnegative declaration");
    result[key] = value;
  }
  for (const key of booleans) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== "boolean")
      fail(`${path}.${key}`, "expected a boolean");
    result[key] = source[key];
  }
  for (const [key, allowed] of Object.entries(choices)) {
    if (source[key] === undefined) continue;
    if (
      typeof source[key] !== "string" ||
      !(allowed as readonly string[]).includes(source[key])
    )
      fail(`${path}.${key}`, "unsupported responsive declaration");
    (result as Record<string, unknown>)[key] = source[key];
  }
  return result;
}

// Mirror the native source-layout contract, rather than trusting the reference
// rectangles as evidence of portable responsive semantics.
export function validateResponsiveScene(document: SceneDocument): void {
  if (document.roots.length !== 1)
    fail("$.roots", "responsive layout requires one root");
  const check = (node: SceneNode, parent?: SceneSourceStyle) => {
    const s = node.sourceStyle!;
    const f = s.flex;
    const path = `node ${JSON.stringify(node.id)}.sourceStyle`;
    if (f.boxSizing !== "border-box" || s.x !== 0 || s.y !== 0)
      fail(
        path,
        "responsive declarations require border-box sizing without position offsets",
      );
    if (
      !["", "block", "flex"].includes(s.display) ||
      !["", "row", "column"].includes(s.direction)
    )
      fail(path, "unsupported responsive display or direction");
    if (
      (s.borderWidth && (f.borderStyle !== "solid" || !s.borderColor)) ||
      !Number.isInteger(s.borderWidth) ||
      !Number.isInteger(s.borderWidth * document.viewport.scale)
    )
      fail(
        path,
        "responsive borders require integral CSS and device pixels with solid paint",
      );
    if (
      (f.minWidth !== undefined && f.minWidth !== 0) ||
      (f.minHeight !== undefined && f.minHeight !== 0)
    )
      fail(path, "only explicit zero minima are supported");
    if ((s.width && !f.widthSet) || (s.height && !f.heightSet))
      fail(path, "pixel dimensions require presence metadata");
    for (const axis of ["width", "height"] as const) {
      const percent = f[`${axis}Percent`];
      if (
        percent !== undefined &&
        (percent !== 100 || !f[`${axis}Set`] || s[axis] !== 0)
      )
        fail(
          path,
          "percentage dimensions require explicit 100% without a simultaneous pixel dimension",
        );
    }
    if (!parent) {
      if (
        node.kind !== "container" ||
        s.display !== "flex" ||
        f.widthPercent !== 100 ||
        !f.heightSet ||
        s.height <= 0 ||
        f.heightPercent !== undefined
      )
        fail(
          path,
          "root requires a flex container with width:100% and definite pixel height",
        );
      if (sceneColorRGBA(s.background)[3] !== 255)
        fail(path, "responsive root requires an opaque background");
      if (
        s.radius !== 0 ||
        s.borderWidth !== 0 ||
        s.height < document.viewport.height
      )
        fail(
          path,
          "responsive root must guarantee opaque square borderless viewport coverage",
        );
    } else {
      if (f.basis === undefined || f.minWidth !== 0 || f.minHeight !== 0)
        fail(path, "each item requires a pixel basis and explicit zero minima");
      const row = parent.direction !== "column";
      if (row ? f.widthPercent !== undefined : f.heightPercent !== undefined)
        fail(
          path,
          "percentage dimensions are supported only on the cross axis",
        );
      const alignment =
        !f.alignSelf || f.alignSelf === "auto"
          ? parent.flex.alignItems || "stretch"
          : f.alignSelf;
      if (
        (node.kind !== "container" || node.children.length) &&
        !(row ? f.heightSet : f.widthSet) &&
        alignment !== "stretch"
      )
        fail(path, "nonempty items require a definite cross size or stretch");
    }
    if (node.kind === "container") {
      if (
        node.text ||
        node.value ||
        node.placeholder ||
        (node.events && Object.keys(node.events).length) ||
        (node.children.length && s.display !== "flex")
      )
        fail(
          path,
          "containers require declarative flex children without text or events",
        );
    } else {
      if (!f.marginSet || node.kind === "textarea")
        fail(
          path,
          "supported leaves require margin:0; multiline editors are unsupported",
        );
      if (node.kind === "image") {
        if (
          s.display !== "block" ||
          !f.widthSet ||
          !f.heightSet ||
          s.width <= 0 ||
          s.height <= 0 ||
          f.widthPercent !== undefined ||
          f.heightPercent !== undefined ||
          s.borderWidth ||
          s.radius ||
          s.paddingTop ||
          s.paddingRight ||
          s.paddingBottom ||
          s.paddingLeft
        )
          fail(
            path,
            "bitmap leaves require explicit positive pixel dimensions without decoration",
          );
      } else if (
        !s.fontFamily ||
        ![400, 700].includes(s.fontWeight) ||
        !["normal", "italic"].includes(s.fontStyle) ||
        s.fontSize <= 0 ||
        s.lineHeight <= 0 ||
        s.whiteSpace !== "nowrap" ||
        !["left", "center", "right"].includes(s.textAlign)
      )
        fail(path, "text leaves require explicit single-line typography");
      if (
        ["button", "input"].includes(node.kind) &&
        (f.appearance !== "none" || f.borderStyle !== "solid")
      )
        fail(
          path,
          "controls require appearance:none and explicit solid borders",
        );
      if (!["button", "input"].includes(node.kind) && f.appearance)
        fail(path, "appearance belongs to controls");
    }
    for (const child of node.children) check(child, s);
  };
  check(document.roots[0]!);
}

/** Exact source CSS; omitted dimensions remain auto, including explicit zero. */
export function sourceStyleCSS(
  s: SceneSourceStyle,
): Record<string, string | number> {
  const f = s.flex;
  const css: Record<string, string | number> = {
    display: s.display || "block",
    flexDirection: s.direction || "row",
    boxSizing: "border-box",
    paddingTop: s.paddingTop,
    paddingRight: s.paddingRight,
    paddingBottom: s.paddingBottom,
    paddingLeft: s.paddingLeft,
    gap: s.gap,
    backgroundColor: s.background,
    color: s.color,
    borderColor: s.borderColor,
    borderWidth: s.borderWidth,
    borderRadius: s.radius,
  };
  if (f.widthSet)
    css.width = f.widthPercent !== undefined ? `${f.widthPercent}%` : s.width;
  if (f.heightSet)
    css.height =
      f.heightPercent !== undefined ? `${f.heightPercent}%` : s.height;
  for (const [key, name] of [
    ["grow", "flexGrow"],
    ["shrink", "flexShrink"],
    ["basis", "flexBasis"],
    ["minWidth", "minWidth"],
    ["minHeight", "minHeight"],
  ] as const)
    if (f[key] !== undefined) css[name] = f[key]!;
  for (const key of [
    "justifyContent",
    "alignItems",
    "alignSelf",
    "borderStyle",
    "appearance",
  ] as const)
    if (f[key]) css[key] = f[key]!;
  if (f.marginSet) css.margin = 0;
  if (s.fontFamily)
    Object.assign(css, {
      fontFamily: s.fontFamily,
      fontWeight: s.fontWeight,
      fontStyle: s.fontStyle,
      fontSize: s.fontSize,
      lineHeight: `${s.lineHeight}px`,
      textAlign: s.textAlign,
      whiteSpace: s.whiteSpace,
    });
  return css;
}
