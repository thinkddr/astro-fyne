// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./cli.ts";
import { compile } from "./parser.ts";
import { emitGo } from "./emit.ts";
import { loadFonts } from "./fonts.ts";
import { emitWebScene, validateSceneDocument } from "./reverse.ts";
import type { SceneDocument, SceneNode, SceneStyle } from "./reverse.ts";
import { emitNativeScene } from "./scene-native.ts";
import { generateNativeScene } from "./scene-native-cli.ts";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "astro-fyne-scene-native-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const style: SceneStyle = {
  x: 0,
  y: 0,
  width: 320,
  height: 240,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  gap: 0,
  direction: "row",
  background: "#fff",
  color: "#000",
  borderColor: "transparent",
  borderWidth: 0,
  radius: 0,
  fontSize: 14,
  lineHeight: 20,
  fontWeight: 400,
  fontFamily: "Host",
  fontStyle: "normal",
  textAlign: "left",
  whiteSpace: "nowrap",
  display: "block",
  opacity: 1,
  measured: true,
};
function scene(): SceneDocument {
  return {
    schema: 1,
    viewport: { width: 320, height: 240, scale: 1 },
    roots: [
      { id: "root", kind: "container", style: { ...style }, children: [] },
    ],
    tokens: {},
    resources: [],
    requiredActions: [],
  };
}
function responsive(): SceneDocument {
  const result = scene();
  result.schema = 2;
  result.layout = "flex";
  const root = result.roots[0]!;
  root.sourceStyle = {
    ...style,
    measured: false,
    width: 0,
    display: "flex",
    flex: {
      widthSet: true,
      widthPercent: 100,
      heightSet: true,
      boxSizing: "border-box",
      alignItems: "stretch",
    },
  };
  const item: SceneNode = {
    id: "box",
    kind: "container",
    style: { ...style, width: 320, height: 240 },
    sourceStyle: {
      ...style,
      measured: false,
      width: 0,
      height: 0,
      display: "block",
      fontFamily: "",
      flex: {
        basis: 0,
        grow: 1,
        shrink: 0,
        minWidth: 0,
        minHeight: 0,
        boxSizing: "border-box",
      },
    },
    children: [],
  };
  root.children.push(item);
  return result;
}
const nativeOptions = { name: "Scene", packageName: "generated" };
function formatted(code: string): string {
  const result = spawnSync("gofmt", [], {
    input: code,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return result.stdout;
}

test("scene import binds input, commit, submit and tap without interpreting island code", () => {
  const document = scene();
  document.roots[0]!.children.push(
    {
      id: "field",
      kind: "input",
      value: "initial",
      placeholder: "hint",
      placeholderColor: "#0000007f",
      style: { ...style, width: 120, height: 32 },
      events: { input: "edit", change: "save", submit: "submit" },
      children: [],
    },
    {
      id: "button",
      kind: "button",
      text: "Save",
      style: { ...style, width: 96, height: 32 },
      events: { tap: "tap" },
      children: [],
    },
  );
  document.requiredActions = ["edit", "save", "submit", "tap"];
  const result = emitNativeScene(document, nativeOptions);
  const code = formatted(result.code);
  expect(code).toContain("view.ApplySceneLayout(");
  expect(code).toContain("LocalValue: true");
  for (const event of ["OnTap", "OnChange", "OnCommit", "OnSubmit"])
    expect(code).toContain(`${event}:`);
  expect(result.report.actions).toEqual(document.requiredActions);
  expect(result.report.visual.pixelPerfectVerified).toBe(false);
  document.roots[0]!.children[0]!.placeholderColor = "red";
  expect(() => emitNativeScene(document, nativeOptions)).toThrow("color");
  document.roots[0]!.children[0]!.placeholderColor = "#ffffff";
  expect(() => emitNativeScene(document, nativeOptions)).toThrow(
    "placeholder paint differs",
  );
});

test("one responsive scene emits native declarations and forward-compatible static Preact", async () => {
  const document = responsive();
  const native = emitNativeScene(document, nativeOptions);
  const code = formatted(native.code);
  expect(code).not.toContain("ApplySceneLayout");
  expect(code).toContain("WidthPercent: webui.FlexValue(100)");
  expect(code).toContain("Shrink: webui.FlexValue(0)");
  expect(native.report.layout).toBe("responsive-flex");
  const web = emitWebScene(document, { name: "Responsive" });
  const path = join(directory, "Responsive.tsx");
  await writeFile(path, web.preact);
  expect(web.preact).not.toContain('import "./Responsive.css"');
  expect(web.report.rootId).toBe("root");
  const program = await compile(path);
  const lowered = formatted(
    emitGo(program, { name: "RoundTrip", packageName: "generated" }),
  );
  expect(lowered).toContain("WidthPercent: webui.FlexValue(100)");
  expect(lowered).toContain("Shrink: webui.FlexValue(0)");
});

test("responsive metadata is versioned and validates declarations before generation", () => {
  const edits: ((scene: SceneDocument) => void)[] = [
    (s) => {
      s.schema = 1;
    },
    (s) => {
      delete s.layout;
    },
    (s) => {
      delete s.roots[0]!.sourceStyle;
    },
    (s) => {
      s.roots[0]!.sourceStyle!.flex.widthPercent = 50;
    },
    (s) => {
      s.roots[0]!.sourceStyle!.background = "#fff0";
    },
    (s) => {
      s.roots[0]!.sourceStyle!.radius = 2;
    },
    (s) => {
      s.roots[0]!.children[0]!.sourceStyle!.flex.minWidth = 1;
    },
    (s) => {
      s.roots[0]!.children[0]!.sourceStyle!.flex.basis = undefined;
    },
    (s) => {
      s.roots[0]!.children[0]!.sourceStyle!.flex.widthPercent = 100;
      s.roots[0]!.children[0]!.sourceStyle!.flex.widthSet = true;
    },
    (s) => {
      (
        s.roots[0]!.sourceStyle!.flex as unknown as Record<string, unknown>
      ).wrap = "wrap";
    },
  ];
  for (const edit of edits) {
    const document = responsive();
    edit(document);
    expect(() => emitWebScene(document, { name: "Scene" })).toThrow();
    expect(() => emitNativeScene(document, nativeOptions)).toThrow();
  }
  const opaque = responsive();
  opaque.roots[0]!.sourceStyle!.background = "#123";
  expect(validateSceneDocument(opaque).schema).toBe(2);
});

test("scene CLI preserves handwritten files and detects stale output in both aliases", async () => {
  const path = join(directory, "scene.json");
  await writeFile(path, JSON.stringify(scene()));
  const options = { scene: path, out: directory, name: "Scene" };
  await generateNativeScene(options);
  await main(["check", "--scene", path, "--out", directory, "--name", "Scene"]);
  const output = join(directory, "Scene.gen.go");
  await writeFile(output, "package handwritten\n");
  const report = await readFile(
    join(directory, "Scene.gen.report.json"),
    "utf8",
  );
  await expect(generateNativeScene(options)).rejects.toThrow(
    "not owned by the generator",
  );
  expect(await readFile(join(directory, "Scene.gen.report.json"), "utf8")).toBe(
    report,
  );
  await expect(
    main([
      "to-fyne",
      "--scene",
      path,
      "--out",
      directory,
      "--name",
      "Scene",
      "--check",
    ]),
  ).rejects.toThrow("out of date");
  const unsupported = scene();
  unsupported.roots[0]!.children.push({
    id: "multi",
    kind: "textarea",
    style: { ...style },
    children: [],
  });
  await writeFile(path, JSON.stringify(unsupported));
  await expect(generateNativeScene(options)).rejects.toThrow("textarea");
  expect(await readFile(output, "utf8")).toBe("package handwritten\n");
});

test("native scene font bindings are embedded and included in source identity", async () => {
  const root = new URL("../", import.meta.url).pathname;
  const fonts = await loadFonts(
    [
      {
        family: "Host",
        weight: 400,
        style: "normal",
        source: "example/public/fonts/NotoSans-Regular.ttf",
        webSrc: "/fonts/NotoSans-Regular.ttf",
      },
    ],
    root,
  );
  const withFonts = emitNativeScene(scene(), { ...nativeOptions, fonts });
  expect(withFonts.code).toContain("NewSceneBackend");
  expect(withFonts.code).toContain("#sha256=");
  expect(formatted(withFonts.code)).toContain(
    "theme.Fonts = map[fyne.TextStyle]fyne.Resource",
  );
  expect(withFonts.report.sourceHash).not.toBe(
    emitNativeScene(scene(), nativeOptions).report.sourceHash,
  );
  const invalid = structuredClone(fonts);
  invalid[0]!.hash = "a".repeat(64);
  expect(() =>
    emitNativeScene(scene(), { ...nativeOptions, fonts: invalid }),
  ).toThrow("digest");
});

test("native scene CLI rejects incomplete or mixed inputs without creating outputs", async () => {
  for (const args of [
    ["to-fyne", "--scene", "missing"],
    [
      "to-fyne",
      "--scene",
      "missing",
      "--out",
      "out",
      "--name",
      "Scene",
      "--config",
      "x",
    ],
    ["watch", "--scene", "missing"],
  ])
    await expect(main(args)).rejects.toThrow();
  expect(await readdir(directory)).toEqual([]);
  expect(() =>
    emitNativeScene(scene(), { name: "../x", packageName: "generated" }),
  ).toThrow("identifier");
  expect(() =>
    emitNativeScene(scene(), { name: "Scene", packageName: "var" }),
  ).toThrow("keyword");
});
