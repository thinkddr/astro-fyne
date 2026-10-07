// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createHash } from "node:crypto";
import { inspectFont, validateFontFaces } from "./fonts.ts";
import type { FontResource } from "./ir.ts";
import { sceneColorRGBA, validateSceneDocument } from "./reverse.ts";
import type { SceneNode, SceneStyle, SceneSourceStyle } from "./reverse.ts";

const quote = (value: string) => JSON.stringify(value);
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const keywords = new Set(
  "break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var".split(
    " ",
  ),
);
const styleNames: Record<keyof SceneStyle, string> = {
  x: "X",
  y: "Y",
  width: "Width",
  height: "Height",
  paddingTop: "PaddingTop",
  paddingRight: "PaddingRight",
  paddingBottom: "PaddingBottom",
  paddingLeft: "PaddingLeft",
  gap: "Gap",
  direction: "Direction",
  background: "Background",
  color: "Color",
  borderColor: "BorderColor",
  borderWidth: "BorderWidth",
  radius: "Radius",
  fontSize: "FontSize",
  lineHeight: "LineHeight",
  fontWeight: "FontWeight",
  fontFamily: "FontFamily",
  fontStyle: "FontStyle",
  textAlign: "TextAlign",
  whiteSpace: "WhiteSpace",
  display: "Display",
  opacity: "Opacity",
  measured: "Measured",
};
const flexNames = {
  grow: "Grow",
  shrink: "Shrink",
  basis: "Basis",
  minWidth: "MinWidth",
  minHeight: "MinHeight",
  widthPercent: "WidthPercent",
  heightPercent: "HeightPercent",
  widthSet: "WidthSet",
  heightSet: "HeightSet",
  justifyContent: "JustifyContent",
  alignItems: "AlignItems",
  alignSelf: "AlignSelf",
  boxSizing: "BoxSizing",
  borderStyle: "BorderStyle",
  appearance: "Appearance",
  marginSet: "MarginSet",
} as const;

function styleGo(style: SceneStyle | SceneSourceStyle): string {
  const values = Object.entries(styleNames).map(([key, field]) => {
    const value = style[key as keyof SceneStyle];
    return `${field}:${typeof value === "string" ? quote(value) : value}`;
  });
  if ("flex" in style)
    values.push(
      `Flex:&webui.FlexStyle{${Object.entries(style.flex)
        .map(([key, value]) => {
          const field = flexNames[key as keyof typeof flexNames];
          return `${field}:${typeof value === "number" ? `webui.FlexValue(${value})` : typeof value === "string" ? quote(value) : value}`;
        })
        .join(",")}}`,
    );
  return `webui.Style{${values.join(",")}}`;
}

export interface NativeSceneOptions {
  name: string;
  packageName: string;
  fonts?: FontResource[];
}

/** Rebuild a portable scene as interactive Fyne objects, never by reading its
 * generated island's hydration code or translating Go/JS function bodies. */
export function emitNativeScene(value: unknown, options: NativeSceneOptions) {
  const scene = validateSceneDocument(value);
  const { name, packageName } = options;
  if (
    !/^[A-Z][A-Za-z\d_]*$/.test(name) ||
    !/^[A-Za-z][A-Za-z\d_]*$/.test(packageName) ||
    keywords.has(packageName)
  )
    throw new Error(
      "Native scene name must be capitalized and package must be a Go identifier, not a keyword.",
    );
  const fonts = options.fonts ?? [];
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
  const sceneHash = digest(JSON.stringify(scene));
  const sourceHash = digest(
    JSON.stringify({
      sceneHash,
      fonts: fonts.map(({ content: _, ...face }) => face),
    }),
  );
  const embedded: string[] = [];
  const resources = new Map<string, string>();
  const resourceHashes = new Map<string, string>();
  const embed = (
    path: string,
    content: string,
    hash: string,
    symbol: string,
    resourceName = path,
  ) => {
    const bytes = Buffer.from(content, "base64");
    if (bytes.toString("base64") !== content || digest(bytes) !== hash)
      throw new Error(`${path}: resource digest does not match its bytes`);
    embedded.push(
      `var ${symbol}=fyne.NewStaticResource(${quote(resourceName)},[]byte("${bytes.toString("hex").replace(/../g, "\\x$&")}"))`,
    );
    if (resourceHashes.has(path) && resourceHashes.get(path) !== hash)
      throw new Error(`Duplicate native resource path: ${path}`);
    if (!resources.has(path)) resources.set(path, symbol);
    resourceHashes.set(path, hash);
  };
  const bitmaps = new Map<string, string>();
  scene.resources.forEach((resource, index) => {
    const symbol = `scene${name}Image${index}`;
    embed(resource.path, resource.content, resource.hash, symbol);
    bitmaps.set(resource.name, symbol);
  });
  fonts.forEach((face, index) => {
    inspectFont(Buffer.from(face.content, "base64"), face);
    embed(
      face.path,
      face.content,
      face.hash,
      `scene${name}Font${index}`,
      `${face.path}#sha256=${face.hash}`,
    );
  });
  const families = [...new Set(fonts.map((face) => face.family))];
  const themeFonts =
    families.length === 1
      ? `theme.Fonts=map[fyne.TextStyle]fyne.Resource{${fonts.map((face, index) => `{Bold:${face.weight === 700},Italic:${face.style === "italic"}}:scene${name}Font${index}`).join(",")}};`
      : "";
  const backend = fonts.length
    ? `func New${name}Backend() webui.FyneBackend {return webui.FyneBackend{Fonts:map[string]map[webui.Font]fyne.Resource{${families
        .map(
          (family) =>
            `${quote(family)}:{${fonts
              .map((face, index) =>
                face.family === family
                  ? `{Weight:${face.weight},Italic:${face.style === "italic"}}:scene${name}Font${index}`
                  : undefined,
              )
              .filter(Boolean)
              .join(",")}}`,
        )
        .join(",")}}}}`
    : "";
  let nodeCount = 0;
  const layouts: string[] = [];
  const fields: string[] = [];
  const nodeGo = (node: SceneNode): string => {
    nodeCount++;
    for (const s of [node.style, node.sourceStyle]) {
      if (!s) continue;
      for (const [key, value] of Object.entries(s))
        if (typeof value === "number" && !Number.isFinite(Math.fround(value)))
          throw new Error(`${node.id}: ${key} exceeds native float32 geometry`);
      if ("flex" in s)
        for (const [key, value] of Object.entries((s as SceneSourceStyle).flex))
          if (typeof value === "number" && !Number.isFinite(Math.fround(value)))
            throw new Error(
              `${node.id}: flex ${key} exceeds native float32 geometry`,
            );
    }
    if (node.kind === "textarea")
      throw new Error(
        `${node.id}: native scene import requires the shared multiline layout contract; textarea is unsupported`,
      );
    if (node.placeholderColor) {
      // The public editor paints placeholders at half the text color's alpha.
      // Exports from other editors cannot silently adopt that paint contract.
      const rgba = sceneColorRGBA(node.style.color);
      rgba[3] = Math.trunc(rgba[3] * 0.5);
      if (
        JSON.stringify(sceneColorRGBA(node.placeholderColor)) !==
        JSON.stringify(rgba)
      )
        throw new Error(
          `${node.id}: placeholder paint differs from the native half-alpha editor contract`,
        );
    }
    const members = [
      `ID:${quote(node.id)}`,
      `Kind:${quote(node.kind)}`,
      `Text:${quote(node.text ?? "")}`,
      `Placeholder:${quote(node.placeholder ?? "")}`,
      `Disabled:${!!node.disabled}`,
      `AccessibleLabel:${quote(node.accessibleLabel ?? "")}`,
      `LabelFor:${quote(node.labelFor ?? "")}`,
    ];
    if (node.kind === "input") {
      fields.push(`${quote(node.id)}:${quote(node.value ?? "")}`);
      members.push(`Value:values[${quote(node.id)}]`);
      members.push("LocalValue:true");
    } else if (
      node.value ||
      node.placeholder ||
      (node.disabled && node.kind !== "button")
    )
      throw new Error(
        `${node.id}: editor values, placeholders and disabled state must match the native control kind`,
      );
    if (node.kind === "image")
      members.push(`ImageResource:${bitmaps.get(node.resource!)}`);
    if (scene.schema === 2) members.push(`Style:${styleGo(node.sourceStyle!)}`);
    else layouts.push(`${quote(node.id)}:${styleGo(node.style)}`);
    for (const [event, action] of Object.entries(node.events ?? {})) {
      if (event === "tap")
        members.push(`OnTap:func(){actions[${quote(action)}]()}`);
      else
        members.push(
          `${{ input: "OnChange", change: "OnCommit", submit: "OnSubmit" }[event as "input" | "change" | "submit"]}:func(value string){values[${quote(node.id)}]=value;actions[${quote(action)}](value)}`,
        );
    }
    members.push(
      `Children:[]webui.Node{${node.children.map(nodeGo).join(",")}}`,
    );
    return `{${members.join(",")}}`;
  };
  const roots = scene.roots.map(nodeGo).join(",");
  if (!nodeCount)
    throw new Error("Native scene requires a nonempty object tree");
  const code = `// Code generated by astro-fyne. DO NOT EDIT.
// SPDX-License-Identifier: Apache-2.0
// Scene SHA-256: ${sceneHash}
package ${packageName}
import ("fyne.io/fyne/v2"; webui "github.com/thinkddr/astro-fyne/native")
const ${name}SourceHash=${quote(sourceHash)}
${embedded.join("\n")}
func New${name}Resources() map[string]fyne.Resource {return map[string]fyne.Resource{${[...resources].map(([path, symbol]) => `${quote(path)}:${symbol}`).join(",")}}}
${backend}
type ${name}Widget struct {*webui.View}
type ${name}Theme struct {*webui.CapturedTheme}
func New${name}Theme(base fyne.Theme)(*${name}Theme,error){theme,err:=webui.NewCapturedTheme(map[string]string{${Object.entries(
    scene.tokens,
  )
    .map(([key, value]) => `${quote(key)}:${quote(value)}`)
    .join(
      ",",
    )}},base);if err!=nil{return nil,err};${themeFonts}return &${name}Theme{CapturedTheme:theme},nil}
func New${name}(props webui.Scope,actions webui.Actions,backends ...webui.Backend)(*${name}Widget,error){
_ = props
if err:=webui.Require(actions,[]string{${scene.requiredActions.map(quote).join(",")}});err!=nil{return nil,err}
${fonts.length ? `if len(backends)==0{backends=[]webui.Backend{New${name}Backend()}}` : ""}
values:=map[string]string{${fields.join(",")}};_ = values
var generated *${name}Widget
view:=webui.NewViewForWidget(func(view *webui.View)fyne.Widget{generated=&${name}Widget{View:view};return generated},func()[]webui.Node{return []webui.Node{${roots}}},backends...)
view.SetAutoRefreshEvents(false)
if err:=view.Error();err!=nil{return nil,err}
${scene.schema === 1 ? `view.SetViewport(${scene.viewport.width},${scene.viewport.height});if err:=view.SetCaptureScale(${scene.viewport.scale});err!=nil{return nil,err};if err:=view.ApplySceneLayout(map[string]webui.Style{${layouts.join(",")}});err!=nil{return nil,err}` : `view.Resize(fyne.NewSize(${scene.viewport.width},${scene.viewport.height}))`}
if err:=view.Error();err!=nil{return nil,err}
return generated,nil
}
`;
  return {
    code,
    fonts,
    report: {
      generator: "astro-fyne" as const,
      schema: 1,
      direction: "scene-to-fyne" as const,
      name,
      sourceHash,
      sceneHash,
      nodeCount,
      layout: scene.schema === 2 ? "responsive-flex" : "fixed-scene",
      viewport: scene.viewport,
      actions: scene.requiredActions,
      resources: scene.resources.map(({ content: _, ...resource }) => resource),
      fonts: fonts.map(({ content: _, ...face }) => face),
      visual: { pixelPerfectVerified: false },
    },
  };
}
