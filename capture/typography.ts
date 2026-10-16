// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Page } from "playwright";
import { loadFonts, validateFontFaces } from "../src/fonts.ts";

export interface TypographyProbe {
  schema: 1;
  id: string;
  fixture: string;
  viewport: { width: number; height: number };
  scales: (1 | 2)[];
  font: {
    family: string;
    path: string;
    webSrc: string;
    weight: 400 | 700;
    style: "normal" | "italic";
    size: number;
    lineHeight: number;
  };
  foreground: string;
  background: string;
  samples: {
    id: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize?: number;
  }[];
}

export interface TypographyIdentity {
  sourceHash: string;
  probeHash: string;
  fixtureHash: string;
  fontHash: string;
}

export interface TypographyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TypographyRange {
  startUTF16: number;
  endUTF16: number;
  text: string;
  rects: TypographyRect[];
  bounds: TypographyRect;
}

const metricNames = [
  "width",
  "actualBoundingBoxLeft",
  "actualBoundingBoxRight",
  "actualBoundingBoxAscent",
  "actualBoundingBoxDescent",
  "fontBoundingBoxAscent",
  "fontBoundingBoxDescent",
  "emHeightAscent",
  "emHeightDescent",
  "hangingBaseline",
  "alphabeticBaseline",
  "ideographicBaseline",
] as const;
export type TypographyMetrics = Record<
  (typeof metricNames)[number],
  number | null
>;

export interface TypographySample {
  nodeID: string;
  kind: "probe";
  text: string;
  utf16Length: number;
  fontHash: string;
  fontSizePx: number;
  elementBox: TypographyRect;
  contentBox: TypographyRect;
  computed: Record<string, string>;
  backgrounds: {
    id: string;
    color: string;
    opacity: string;
    backgroundImage: string;
  }[];
  dom: {
    available: true;
    method: "dom-range";
    full: TypographyRange;
    graphemes: TypographyRange[];
    prefixes: TypographyRange[];
  };
  baseline: {
    method: "inline-marker";
    viewportY: number;
    contentOffsetY: number;
    markerBox: TypographyRect;
  };
  canvas: {
    method: "canvas-text-metrics";
    requested: Record<string, string>;
    applied: Record<string, string>;
    unsupportedSettings: string[];
    unmirroredCSS: string[];
    full: TypographyMetrics;
    prefixes: { endUTF16: number; text: string; metrics: TypographyMetrics }[];
  };
}

export interface TypographyCase extends TypographyIdentity {
  schema: 1;
  diagnosticOnly: true;
  pixelPerfectVerified: false;
  units: "css-px";
  coordinates: "viewport";
  case: string;
  viewport: { width: number; height: number; scale: 1 | 2 };
  visualViewportScale: number;
  browser: { userAgent: string; platform: string };
  samples: TypographySample[];
}

const computedProperties = [
  "color",
  "background-color",
  "opacity",
  "caret-color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-stretch",
  "line-height",
  "font-kerning",
  "font-variant",
  "font-variant-caps",
  "font-variant-ligatures",
  "font-feature-settings",
  "font-variation-settings",
  "font-optical-sizing",
  "font-synthesis",
  "font-size-adjust",
  "letter-spacing",
  "word-spacing",
  "text-rendering",
  "text-align",
  "text-transform",
  "text-indent",
  "text-shadow",
  "text-decoration",
  "white-space",
  "direction",
  "writing-mode",
  "transform",
  "filter",
  "mix-blend-mode",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "background-image",
  "-webkit-font-smoothing",
] as const;

export function typographyHash(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function object(value: unknown, description: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${description} must be an object`);
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
    throw new Error(
      `Typography object requires ${required.join(", ")} without unknown fields`,
    );
}
function finite(value: unknown, description: string, positive = false): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (positive && value <= 0)
  )
    throw new Error(
      `${description} must be a finite${positive ? " positive" : ""} number`,
    );
  return value;
}
function relativePath(value: unknown, extension: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    !/^[A-Za-z0-9_./-]+$/.test(value) ||
    !value.endsWith(extension) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(
      `Typography paths must be explicit relative ${extension} files`,
    );
  return value;
}

export function validateTypographyProbe(value: unknown): TypographyProbe {
  const probe = object(value, "Typography probe");
  keys(probe, [
    "schema",
    "id",
    "fixture",
    "viewport",
    "scales",
    "font",
    "foreground",
    "background",
    "samples",
  ]);
  const viewport = object(probe.viewport, "Typography viewport"),
    font = object(probe.font, "Typography font");
  keys(viewport, ["width", "height"]);
  keys(font, [
    "family",
    "path",
    "webSrc",
    "weight",
    "style",
    "size",
    "lineHeight",
  ]);
  if (
    probe.schema !== 1 ||
    typeof probe.id !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(probe.id) ||
    viewport.width !== 512 ||
    viewport.height !== 256 ||
    JSON.stringify(probe.scales) !== "[1,2]" ||
    typeof probe.foreground !== "string" ||
    !/^#[a-f0-9]{6}$/i.test(probe.foreground) ||
    typeof probe.background !== "string" ||
    !/^#[a-f0-9]{6}$/i.test(probe.background) ||
    !Array.isArray(probe.samples) ||
    !probe.samples.length ||
    probe.samples.length > 32
  )
    throw new Error(
      "Typography probe requires schema 1, viewport 512x256, scales [1,2], opaque RGB colors and explicit samples",
    );
  relativePath(probe.fixture, ".astro");
  relativePath(font.path, ".ttf");
  validateFontFaces([
    {
      family: font.family,
      weight: font.weight,
      style: font.style,
      source: font.path,
      webSrc: font.webSrc,
    },
  ]);
  finite(font.size, "Font size", true);
  finite(font.lineHeight, "Line height", true);
  const ids = new Set([probe.id]);
  for (const value of probe.samples) {
    const sample = object(value, "Typography sample");
    keys(sample, ["id", "text", "x", "y", "width", "height"], ["fontSize"]);
    if (
      typeof sample.id !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(sample.id) ||
      ids.has(sample.id) ||
      typeof sample.text !== "string" ||
      !sample.text ||
      sample.text.length > 256 ||
      sample.text.trim() !== sample.text ||
      /[\u0000-\u001f\u007f]| {2}/.test(sample.text)
    )
      throw new Error(
        "Typography samples require unique IDs and short single-line text without collapsed whitespace",
      );
    ids.add(sample.id);
    const x = finite(sample.x, "Sample x"),
      y = finite(sample.y, "Sample y"),
      width = finite(sample.width, "Sample width", true),
      height = finite(sample.height, "Sample height", true);
    if (x < 0 || y < 0 || x + width > 512 || y + height > 256)
      throw new Error(`Typography sample ${sample.id} must fit the viewport`);
    if (sample.fontSize !== undefined)
      finite(sample.fontSize, "Sample font size", true);
  }
  return probe as unknown as TypographyProbe;
}

export async function readTypographyProbe(path: string) {
  const bytes = await readFile(path),
    probe = validateTypographyProbe(JSON.parse(bytes.toString("utf8"))),
    root = dirname(path);
  const fonts = await loadFonts(
    [
      {
        family: probe.font.family,
        weight: probe.font.weight,
        style: probe.font.style,
        source: probe.font.path,
        webSrc: probe.font.webSrc,
      },
    ],
    root,
  );
  const font = fonts[0];
  if (!font) throw new Error("Typography probe requires one explicit font");
  const probeHash = typographyHash(bytes),
    fixtureHash = typographyHash(await readFile(resolve(root, probe.fixture))),
    fontHash = font.hash;
  const identity: TypographyIdentity = {
    sourceHash: typographyHash(
      JSON.stringify([probeHash, fixtureHash, fontHash]),
    ),
    probeHash,
    fixtureHash,
    fontHash,
  };
  return { probe, identity, font };
}

/** Measures actual probe Text nodes; never substitutes mirrors for control text. */
export async function collectTypography(
  page: Page,
  probe: TypographyProbe,
  identity: TypographyIdentity,
  scale: 1 | 2,
): Promise<TypographyCase> {
  validateTypographyProbe(probe);
  if (
    !probe.scales.includes(scale) ||
    Object.keys(identity).length !== 4 ||
    ["sourceHash", "probeHash", "fixtureHash", "fontHash"].some(
      (name) => !Object.hasOwn(identity, name),
    ) ||
    Object.values(identity).some(
      (value) => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value),
    ) ||
    identity.sourceHash !==
      typographyHash(
        JSON.stringify([
          identity.probeHash,
          identity.fixtureHash,
          identity.fontHash,
        ]),
      )
  )
    throw new Error(
      "Typography collection requires the declared scale and source/font digests",
    );
  return page.evaluate(
    async ({
      probe,
      identity,
      scale,
      properties,
      metricsNames,
    }): Promise<TypographyCase> => {
      await document.fonts.ready;
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
      const html = document.documentElement;
      if (document.compatMode !== "CSS1Compat")
        throw new Error("Typography evidence requires standards mode");
      for (const [name, value] of Object.entries(identity))
        if (
          html.dataset[
            `typography${name[0]!.toUpperCase()}${name.slice(1)}`
          ] !== value
        )
          throw new Error(`Typography page does not match ${name}`);
      if (
        innerWidth !== probe.viewport.width ||
        innerHeight !== probe.viewport.height ||
        devicePixelRatio !== scale ||
        !visualViewport ||
        visualViewport.scale !== 1 ||
        scrollX ||
        scrollY ||
        html.scrollWidth !== innerWidth ||
        html.scrollHeight !== innerHeight
      )
        throw new Error(
          "Typography viewport, zoom or overflow differs from the declared profile",
        );
      const root = document.getElementById(probe.id);
      if (
        !(root instanceof HTMLElement) ||
        root.children.length !== probe.samples.length
      )
        throw new Error("Typography root or sample inventory is invalid");
      const rgb = (hex: string) =>
        `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
      if (getComputedStyle(root).backgroundColor !== rgb(probe.background))
        throw new Error(
          "Typography root must retain the declared opaque background",
        );
      const rect = (value: DOMRect): TypographyRect => {
        const result = {
          x: value.x,
          y: value.y,
          width: value.width,
          height: value.height,
        };
        if (
          !Object.values(result).every(Number.isFinite) ||
          result.width < 0 ||
          result.height < 0
        )
          throw new Error(
            "Typography geometry must be finite with nonnegative dimensions",
          );
        return result;
      };
      const samples: TypographySample[] = [];
      for (const sample of probe.samples) {
        const matches = document.querySelectorAll(`#${CSS.escape(sample.id)}`),
          element = matches[0];
        if (
          matches.length !== 1 ||
          !(element instanceof HTMLElement) ||
          element.parentElement !== root ||
          element.children.length !== 2
        )
          throw new Error(
            `Typography ID ${sample.id} is missing, duplicated or has unexpected children`,
          );
        const textSpan = element.querySelector("[data-typography-text]"),
          marker = element.querySelector("[data-typography-baseline]");
        if (
          !(textSpan instanceof HTMLSpanElement) ||
          !(marker instanceof HTMLSpanElement) ||
          textSpan.parentElement !== element ||
          marker.parentElement !== element ||
          marker.childNodes.length ||
          textSpan.childNodes.length !== 1 ||
          !(textSpan.firstChild instanceof Text) ||
          textSpan.textContent !== sample.text
        )
          throw new Error(
            `Typography ID ${sample.id} must contain its actual Text node and empty baseline marker`,
          );
        const css = getComputedStyle(textSpan),
          elementCSS = getComputedStyle(element),
          fontSize = sample.fontSize ?? probe.font.size;
        const computed: Record<string, string> = Object.fromEntries(
          properties.map((name) => [name, css.getPropertyValue(name)]),
        );
        if (
          css.fontFamily.replace(/^(["'])(.*)\1$/, "$2") !==
            probe.font.family ||
          css.fontSize !== `${fontSize}px` ||
          css.fontWeight !== String(probe.font.weight) ||
          css.fontStyle !== probe.font.style ||
          css.lineHeight !== `${probe.font.lineHeight}px` ||
          css.whiteSpace !== "nowrap" ||
          css.direction !== "ltr" ||
          css.writingMode !== "horizontal-tb" ||
          css.textTransform !== "none" ||
          css.color !== rgb(probe.foreground) ||
          css.letterSpacing !== "normal" ||
          (css.wordSpacing !== "0px" && css.wordSpacing !== "normal")
        )
          throw new Error(
            `Typography ID ${sample.id} differs from its declared font/text contract`,
          );
        const elementBox = rect(element.getBoundingClientRect());
        if (
          elementBox.x !== sample.x ||
          elementBox.y !== sample.y ||
          elementBox.width !== sample.width ||
          elementBox.height !== sample.height ||
          elementCSS.paddingTop !== "0px" ||
          elementCSS.paddingRight !== "0px" ||
          elementCSS.paddingBottom !== "0px" ||
          elementCSS.paddingLeft !== "0px" ||
          elementCSS.borderTopWidth !== "0px" ||
          elementCSS.borderRightWidth !== "0px" ||
          elementCSS.borderBottomWidth !== "0px" ||
          elementCSS.borderLeftWidth !== "0px"
        )
          throw new Error(
            `Typography ID ${sample.id} moved or changed its declared box`,
          );
        const markerCSS = getComputedStyle(marker),
          markerBox = rect(marker.getBoundingClientRect());
        if (
          markerCSS.display !== "inline-block" ||
          markerCSS.verticalAlign !== "baseline" ||
          markerBox.width ||
          markerBox.height ||
          [
            markerCSS.marginTop,
            markerCSS.marginRight,
            markerCSS.marginBottom,
            markerCSS.marginLeft,
            markerCSS.paddingTop,
            markerCSS.paddingRight,
            markerCSS.paddingBottom,
            markerCSS.paddingLeft,
            markerCSS.borderTopWidth,
            markerCSS.borderRightWidth,
            markerCSS.borderBottomWidth,
            markerCSS.borderLeftWidth,
          ].some((value) => value !== "0px")
        )
          throw new Error(
            `Typography ID ${sample.id} has an invalid baseline marker`,
          );
        const text = textSpan.firstChild as Text;
        // Range boxes describe selection advances and font metrics, not ink.
        const observation = (start: number, end: number): TypographyRange => {
          const range = document.createRange();
          range.setStart(text, start);
          range.setEnd(text, end);
          const rects = Array.from(range.getClientRects(), rect),
            bounds = rect(range.getBoundingClientRect());
          if (
            !rects.length ||
            rects.some(
              (value) =>
                value.y !== rects[0]!.y || value.height !== rects[0]!.height,
            )
          )
            throw new Error(
              `Typography ID ${sample.id} wraps or has unavailable range geometry`,
            );
          return {
            startUTF16: start,
            endUTF16: end,
            text: sample.text.slice(start, end),
            rects,
            bounds,
          };
        };
        const segments = Array.from(
          new Intl.Segmenter("en", { granularity: "grapheme" }).segment(
            sample.text,
          ),
        );
        const graphemes = segments.map((segment) =>
          observation(segment.index, segment.index + segment.segment.length),
        );
        const prefixes = segments.map((segment) =>
          observation(0, segment.index + segment.segment.length),
        );
        // Canvas prefixes reshape independently; they are not contextual glyph advances.
        const full = observation(0, sample.text.length);
        const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D text metrics are unavailable");
        ctx.font = `${probe.font.style} ${probe.font.weight} ${fontSize}px "${probe.font.family}"`;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.direction = "ltr";
        const applied: Record<string, string> = {
          font: ctx.font,
          textAlign: ctx.textAlign,
          textBaseline: ctx.textBaseline,
          direction: ctx.direction,
        };
        const requested: Record<string, string> = {
          font: `${probe.font.style} ${probe.font.weight} ${fontSize}px "${probe.font.family}"`,
          textAlign: "left",
          textBaseline: "alphabetic",
          direction: "ltr",
        };
        const context = ctx as unknown as Record<string, unknown>,
          unsupportedSettings: string[] = [];
        for (const [name, value] of Object.entries({
          fontKerning: css.fontKerning,
          fontStretch: css.fontStretch,
          fontVariantCaps: css.fontVariantCaps,
          letterSpacing:
            css.letterSpacing === "normal" ? "0px" : css.letterSpacing,
          wordSpacing: css.wordSpacing === "normal" ? "0px" : css.wordSpacing,
          textRendering: css.textRendering,
        })) {
          requested[name] = value;
          if (!(name in ctx)) {
            unsupportedSettings.push(name);
            continue;
          }
          context[name] = value;
          if (typeof context[name] !== "string")
            throw new Error(`Invalid Canvas setting ${name}`);
          applied[name] = context[name] as string;
        }
        const measure = (text: string): TypographyMetrics => {
          const value = ctx.measureText(text) as unknown as Record<
              string,
              unknown
            >,
            result = {} as TypographyMetrics;
          for (const name of metricsNames) {
            const metric = value[name];
            if (metric === undefined) result[name] = null;
            else if (typeof metric !== "number" || !Number.isFinite(metric))
              throw new Error(`Nonfinite Canvas metric ${name}`);
            else result[name] = metric;
          }
          if (result.width === null || result.width < 0)
            throw new Error("Canvas advance width is unavailable or invalid");
          return result;
        };
        const backgrounds: TypographySample["backgrounds"] = [];
        for (
          let ancestor: HTMLElement | null = textSpan;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          const style = getComputedStyle(ancestor);
          backgrounds.push({
            id: ancestor.id || ancestor.tagName.toLowerCase(),
            color: style.backgroundColor,
            opacity: style.opacity,
            backgroundImage: style.backgroundImage,
          });
          if (
            style.opacity !== "1" ||
            style.backgroundImage !== "none" ||
            style.transform !== "none" ||
            style.filter !== "none" ||
            style.mixBlendMode !== "normal"
          )
            throw new Error(
              `Typography ID ${sample.id} has an unsupported compositing ancestor`,
            );
        }
        const baselineY = markerBox.y + markerBox.height;
        if (!Number.isFinite(baselineY))
          throw new Error("Typography baseline must be finite");
        samples.push({
          nodeID: sample.id,
          kind: "probe",
          text: sample.text,
          utf16Length: sample.text.length,
          fontHash: identity.fontHash,
          fontSizePx: fontSize,
          elementBox,
          contentBox: { ...elementBox },
          computed,
          backgrounds,
          dom: {
            available: true,
            method: "dom-range",
            full,
            graphemes,
            prefixes,
          },
          baseline: {
            method: "inline-marker",
            viewportY: baselineY,
            contentOffsetY: baselineY - elementBox.y,
            markerBox,
          },
          canvas: {
            method: "canvas-text-metrics",
            requested,
            applied,
            unsupportedSettings,
            unmirroredCSS: [
              "font-feature-settings",
              "font-variant-ligatures",
              "font-variation-settings",
              "font-optical-sizing",
              "font-synthesis",
              "font-size-adjust",
            ],
            full: measure(sample.text),
            prefixes: prefixes.map((prefix) => ({
              endUTF16: prefix.endUTF16,
              text: prefix.text,
              metrics: measure(prefix.text),
            })),
          },
        });
      }
      return {
        schema: 1,
        diagnosticOnly: true,
        pixelPerfectVerified: false,
        ...identity,
        units: "css-px",
        coordinates: "viewport",
        case: `scale-${scale}`,
        viewport: { ...probe.viewport, scale },
        visualViewportScale: visualViewport.scale,
        browser: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
        },
        samples,
      };
    },
    {
      probe,
      identity,
      scale,
      properties: computedProperties,
      metricsNames: metricNames,
    },
  );
}
