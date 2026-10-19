// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

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
export interface SceneFlex {
  grow?: number;
  shrink?: number;
  basis?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
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
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  order?: number;
}

import type { MotionSpec } from "./motion.ts";

export interface CatalogueResource {
  name: string;
  mediaType: string;
  hash: string;
  content: string;
  license: string;
}
export interface CatalogueStylesheet {
  id: string;
  path: string;
  hash: string;
  content: string;
}
export interface CatalogueFontFace {
  id: string;
  family: string;
  weight: 400 | 700;
  style: "normal" | "italic";
  resource: string;
  hash: string;
}
export interface CatalogueTheme {
  id: string;
  tokens: Record<string, string>;
  fontFaces: string[];
}
export interface CatalogueLayout {
  id: string;
  style: SceneSourceStyle;
}
export interface CatalogueComponent {
  id: string;
  kind: "scene" | "program" | "javascript";
  payload: string;
  hash: string;
  theme?: string;
  layout?: string;
  stylesheets: string[];
  fontFaces: string[];
  actions: string[];
}
export interface CatalogueIsland {
  id: string;
  component: string;
  key: string;
  statePayload?: string;
  stateHash?: string;
}
export interface CatalogueSpec {
  schema: 1;
  kind: "astro-fyne-catalogue";
  name: string;
  resources: CatalogueResource[];
  stylesheets: CatalogueStylesheet[];
  fontFaces: CatalogueFontFace[];
  themes: CatalogueTheme[];
  layouts: CatalogueLayout[];
  components: CatalogueComponent[];
  islands: CatalogueIsland[];
  motions?: MotionSpec[];
}
