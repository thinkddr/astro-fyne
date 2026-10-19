// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  catalogueBytes,
  catalogueHash,
  parseCatalogue,
  validateCatalogue,
  withCatalogueIslandState,
  type CatalogueSpec,
} from "./catalogue.ts";
import type { JavascriptArchive } from "./javascript-types.ts";
import { createProgramArchive } from "./program.ts";
import type { SceneSourceStyle } from "./reverse.ts";

function fixture(): CatalogueSpec {
  return {
    schema: 1,
    kind: "astro-fyne-catalogue",
    name: "Components",
    resources: [],
    stylesheets: [],
    fontFaces: [],
    themes: [],
    layouts: [],
    components: [],
    islands: [],
  };
}

function sourceStyle(): SceneSourceStyle {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 80,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    gap: 0,
    direction: "row",
    background: "",
    color: "",
    borderColor: "",
    borderWidth: 0,
    radius: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 400,
    fontFamily: "",
    fontStyle: "normal",
    textAlign: "left",
    whiteSpace: "normal",
    display: "flex",
    opacity: 1,
    measured: false,
    flex: {
      widthSet: true,
      widthPercent: 100,
      heightSet: true,
      boxSizing: "border-box",
      alignItems: "stretch",
    },
  };
}

function javascriptFixture(): CatalogueSpec {
  const spec = fixture(),
    css = "\ufeff/* source */\r\nbutton { color: #123456; }\r\n";
  const code =
    "function(host,archive){return {flush:function(){},finishReplay:function(){},dispose:function(){},snapshot:function(){return []},dispatch:function(){return true},replay:function(){},export:function(){return archive}}}";
  const archive: JavascriptArchive = {
    schema: 1,
    kind: "astro-fyne-javascript",
    code,
    codeHash: catalogueHash(code),
    sources: [
      { path: "Counter.tsx", hash: catalogueHash(code) },
      { path: "../styles/main.css", hash: catalogueHash(css) },
    ],
    stylesheets: [
      { path: "../styles/main.css", hash: catalogueHash(css), text: css },
    ],
    props: {},
    actions: ["changed"],
    events: [],
    journal: [],
  };
  const payload = "\n " + JSON.stringify(archive) + "\r\n";
  spec.stylesheets.push({
    id: "main",
    path: "../styles/main.css",
    hash: catalogueHash(css),
    content: Buffer.from(css).toString("base64"),
  });
  spec.components.push({
    id: "Counter",
    kind: "javascript",
    payload,
    hash: catalogueHash(payload),
    stylesheets: ["main"],
    fontFaces: [],
    actions: ["changed"],
  });
  spec.islands.push(
    { id: "left", component: "Counter", key: "same-key" },
    { id: "right", component: "Counter", key: "same-key" },
  );
  return spec;
}

function replacePayload(spec: CatalogueSpec, archive: unknown): string {
  const payload =
    typeof archive === "string" ? archive : JSON.stringify(archive);
  spec.components[0]!.payload = payload;
  spec.components[0]!.hash = catalogueHash(payload);
  return payload;
}

test("catalogue snapshots retain exact resources, parent CSS paths and layout presence", async () => {
  const spec = fixture(),
    css = Buffer.from("\ufeff/* exact */\r\n:root { --Accent: #123456; }\r\n"),
    data = Buffer.from([0, 255, 3, 1]);
  spec.stylesheets.push({
    id: "source",
    path: "../styles/tokens.css",
    content: css.toString("base64"),
    hash: catalogueHash(css),
  });
  spec.resources.push({
    name: "data/bytes.bin",
    mediaType: "application/octet-stream",
    content: data.toString("base64"),
    hash: catalogueHash(data),
    license: "Apache-2.0",
  });
  spec.layouts.push({ id: "row", style: sourceStyle() });
  const pending = validateCatalogue(spec);
  spec.stylesheets[0]!.content = "";
  spec.layouts[0]!.style.flex.widthPercent = 25;
  const owned = await pending,
    restored = await parseCatalogue(JSON.stringify(owned));
  expect(catalogueBytes(restored.stylesheets[0]!.content, 1000, true)).toEqual(
    css,
  );
  expect(restored.stylesheets[0]!.path).toBe("../styles/tokens.css");
  expect(catalogueBytes(restored.resources[0]!.content, 1000)).toEqual(data);
  expect(restored.layouts[0]!.style.flex.widthPercent).toBe(100);
  restored.layouts[0]!.style.flex.widthPercent = 50;
  expect(owned.layouts[0]!.style.flex.widthPercent).toBe(100);
});

test("raw catalogue parsing rejects duplicate, escaped, cased and malformed fields", async () => {
  const source = JSON.stringify(fixture());
  const invalid = [
    source.replace('"name":"Components"', '"name":"Components","name":"Other"'),
    source.replace(
      '"name":"Components"',
      String.raw`"name":"Components","n\u0061me":"Other"`,
    ),
    source.replace('"name":"Components"', '"name":"Components","Name":"Other"'),
    source.replace('"resources":[]', '"resources":null'),
    source.replace('"resources":[]', '"Resources":[]'),
    source.replace('"resources":[]', '"resources":[],"extra":true'),
    source.replace('"name":"Components"', String.raw`"name":"\ud800"`),
    source + "{}",
    source.slice(0, -1) + ",}",
    source.replace(
      '"themes":[]',
      '"themes":[{"id":"light","tokens":{"--x":"a","--x":"b"},"fontFaces":[]}]',
    ),
  ];
  for (const raw of invalid)
    await expect(parseCatalogue(raw)).rejects.toThrow();
  expect(await parseCatalogue(source)).toEqual(fixture());
  const spec = javascriptFixture();
  replacePayload(
    spec,
    spec.components[0]!.payload.replace('"props":{}', '"props":{},"props":{}'),
  );
  await expect(parseCatalogue(JSON.stringify(spec))).rejects.toThrow(
    "duplicate JSON field",
  );
});

test("object validation rejects side effects and nonportable JSON values", async () => {
  let reads = 0;
  const accessor = fixture();
  Object.defineProperty(accessor, "name", {
    enumerable: true,
    get() {
      reads++;
      return "Unexpected";
    },
  });
  await expect(validateCatalogue(accessor)).rejects.toThrow("getters");
  expect(reads).toBe(0);
  const inputs: unknown[] = [
    { ...fixture(), resources: new Array(1) },
    { ...fixture(), motions: undefined },
    { ...fixture(), name: "\ud800" },
    { ...fixture(), extra: NaN },
    Object.assign(Object.create({ inherited: true }), fixture()),
  ];
  const customArray: unknown[] = [];
  Object.setPrototypeOf(customArray, {
    toJSON() {
      reads++;
      return [];
    },
  });
  inputs.push({ ...fixture(), resources: customArray });
  const cyclic: any = fixture();
  cyclic.extra = cyclic;
  inputs.push(cyclic);
  const hidden = fixture();
  Object.defineProperty(hidden, "hidden", { value: true });
  inputs.push(hidden);
  for (const input of inputs)
    await expect(validateCatalogue(input)).rejects.toThrow();
  expect(reads).toBe(0);
});

test("layout and theme contracts enforce native float, token and override bounds", async () => {
  const valid = fixture();
  valid.layouts.push({ id: "row", style: sourceStyle() });
  valid.themes.push({
    id: "light",
    fontFaces: [],
    tokens: {
      "--Accent": "",
      "--color-primary": "rgba(10 20 30 / 50%)",
      "--fyne-size-padding": "1e2px",
    },
  });
  expect(
    (await validateCatalogue(valid)).themes[0]!.tokens["--fyne-size-padding"],
  ).toBe("1e2px");
  for (const change of [
    (s: any) => delete s.layouts[0].style.flex.boxSizing,
    (s: any) => (s.layouts[0].style.flex.boxSizing = "content-box"),
    (s: any) => (s.layouts[0].style.flex.widthPercent = 3.5e38),
    (s: any) => (s.layouts[0].style.flex.grow = null),
    (s: any) => (s.layouts[0].style.flex.order = 2 ** 31),
    (s: any) => (s.layouts[0].style.fontWeight = 400.5),
    (s: any) => (s.layouts[0].style.extra = true),
    (s: any) =>
      (s.themes[0].tokens = Object.fromEntries(
        Array.from({ length: 1025 }, (_, i) => [`--token${i}`, "x"]),
      )),
    (s: any) => (s.themes[0].tokens["--" + "x".repeat(255)] = "x"),
    (s: any) => (s.themes[0].tokens["--fyne-size-padding"] = "3.5e38px"),
    (s: any) => (s.themes[0].tokens["--fyne-size-padding"] = "-1px"),
    (s: any) => (s.themes[0].tokens["--fyne-size-"] = "0"),
    (s: any) => (s.themes[0].tokens["--fyne-color-"] = "#000"),
    (s: any) => (s.themes[0].tokens["--color-primary"] = "rgb(1,2 / 3)"),
    (s: any) => (s.themes[0].tokens["--color-primary"] = "black"),
  ]) {
    const changed = structuredClone(valid);
    change(changed);
    await expect(validateCatalogue(changed)).rejects.toThrow();
  }
});

test("font bytes bind actual static face metadata and unique theme slots", async () => {
  const spec = fixture(),
    bytes = await readFile(
      new URL("../example/public/fonts/NotoSans-Regular.ttf", import.meta.url),
    );
  const license = await readFile(
    new URL("../example/public/fonts/LICENSE-NotoSans.txt", import.meta.url),
    "utf8",
  );
  spec.resources.push({
    name: "fonts/NotoSans-Regular.ttf",
    mediaType: "font/ttf",
    content: bytes.toString("base64"),
    hash: catalogueHash(bytes),
    license,
  });
  spec.fontFaces.push({
    id: "regular",
    family: "AstroNoto",
    weight: 400,
    style: "normal",
    resource: spec.resources[0]!.name,
    hash: catalogueHash(bytes),
  });
  spec.themes.push({ id: "light", tokens: {}, fontFaces: ["regular"] });
  expect((await parseCatalogue(JSON.stringify(spec))).fontFaces[0]!.hash).toBe(
    catalogueHash(bytes),
  );
  for (const change of [
    (s: any) => (s.fontFaces[0].weight = 700),
    (s: any) => (s.resources[0].license = " "),
    (s: any) => {
      const data = Buffer.from(bytes);
      data[0] = data[0]! ^ 255;
      s.resources[0].content = data.toString("base64");
      s.resources[0].hash = catalogueHash(data);
      s.fontFaces[0].hash = catalogueHash(data);
    },
    (s: any) => {
      s.fontFaces.push({
        ...s.fontFaces[0],
        id: "alias",
        family: "OtherFamily",
      });
      s.themes[0].fontFaces.push("alias");
    },
  ]) {
    const changed = structuredClone(spec);
    change(changed);
    await expect(validateCatalogue(changed)).rejects.toThrow();
  }
});

test("all component kinds preserve their payloads and diagnose false source contracts", async () => {
  const spec = javascriptFixture();
  const program = createProgramArchive({
    entry: "Empty",
    components: [
      {
        name: "Empty",
        props: [],
        states: [],
        constants: [],
        initializers: [],
        body: [],
      },
    ],
    sources: [],
    actions: [],
  });
  const source = sourceStyle(),
    { flex: _flex, ...style } = source;
  const scene = {
    schema: 1,
    viewport: { width: 100, height: 80, scale: 1 },
    roots: [
      {
        id: "root",
        kind: "container",
        style: { ...style, width: 100, measured: true },
        children: [],
      },
    ],
    tokens: {},
    resources: [],
    requiredActions: [],
  };
  for (const [kind, archive] of [
    ["program", program],
    ["scene", scene],
  ] as const) {
    const payload = JSON.stringify(archive);
    spec.components.push({
      id: kind === "program" ? "Program" : "Scene",
      kind,
      payload,
      hash: catalogueHash(payload),
      stylesheets: [],
      fontFaces: [],
      actions: [],
    });
  }
  const validated = await parseCatalogue(JSON.stringify(spec));
  expect(validated.components.map((item) => item.payload)).toEqual(
    spec.components.map((item) => item.payload),
  );
  for (const change of [
    (s: any) => (s.components[0].hash = "0".repeat(64)),
    (s: any) => (s.components[0].actions = ["x".repeat(4097)]),
    (s: any) => (s.components[0].stylesheets = []),
    (s: any) => (s.components[0].theme = "missing"),
    (s: any) => (s.components[0].layout = ""),
    (s: any) => (s.components[1].stylesheets = ["main"]),
    (s: any) => {
      const bytes = Buffer.from("changed");
      s.stylesheets[0].content = bytes.toString("base64");
      s.stylesheets[0].hash = catalogueHash(bytes);
    },
    (s: any) => (s.stylesheets[0].content += "\n"),
  ]) {
    const changed = structuredClone(spec);
    change(changed);
    await expect(validateCatalogue(changed)).rejects.toThrow();
  }
});

test("island checkpoints own independent props/history and retain immutable component contracts", async () => {
  const original = javascriptFixture(),
    archive = JSON.parse(original.components[0]!.payload) as JavascriptArchive;
  archive.props = { title: "Left instance" };
  archive.events.push({ node: "increment", type: "click" });
  const payload = "\n" + JSON.stringify(archive) + "\r\n";
  const checkpoint = await withCatalogueIslandState(original, "left", payload),
    restored = await parseCatalogue(JSON.stringify(checkpoint));
  expect(original.islands[0]!.statePayload).toBeUndefined();
  expect(restored.components[0]!.payload).toBe(original.components[0]!.payload);
  expect(restored.islands[0]!.statePayload).toBe(payload);
  expect(restored.islands[0]!.stateHash).toBe(catalogueHash(payload));
  expect(restored.islands[1]!.statePayload).toBeUndefined();
  expect(JSON.parse(restored.islands[0]!.statePayload!).props).toEqual({
    title: "Left instance",
  });
  for (const change of [
    (a: JavascriptArchive) => {
      a.code += " ";
      a.codeHash = catalogueHash(a.code);
    },
    (a: JavascriptArchive) => (a.sources[0]!.hash = "0".repeat(64)),
    (a: JavascriptArchive) => (a.actions = []),
    (a: JavascriptArchive) => {
      const sheet = a.stylesheets![0]!;
      sheet.text += " ";
      sheet.hash = catalogueHash(sheet.text);
      a.sources[1]!.hash = sheet.hash;
    },
  ]) {
    const changed = structuredClone(archive);
    change(changed);
    await expect(
      withCatalogueIslandState(original, "left", JSON.stringify(changed)),
    ).rejects.toThrow("cannot replace");
  }
  for (const change of [
    (s: any) => delete s.islands[0].stateHash,
    (s: any) => (s.islands[0].stateHash = "0".repeat(64)),
    (s: any) => {
      s.islands[0].statePayload = "";
      s.islands[0].stateHash = catalogueHash("");
    },
  ]) {
    const changed = structuredClone(checkpoint);
    change(changed);
    await expect(validateCatalogue(changed)).rejects.toThrow();
  }
  await expect(
    withCatalogueIslandState(original, "absent", payload),
  ).rejects.toThrow("unknown island");
});
