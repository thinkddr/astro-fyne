// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { generate, main } from "./cli.ts";
import { prepareSourceCatalogue } from "./source-catalogue.ts";
import { catalogueHash, type CatalogueSpec } from "./catalogue.ts";
import { generateCatalogue, prepareCatalogue } from "./catalogue-cli.ts";
import { generateJavascript, prepareJavascript } from "./javascript-cli.ts";
import { bundleJavascript } from "./javascript.ts";
import { normalizeConversionArgs } from "./cli-shortcuts.ts";
import { compile } from "./parser.ts";
import { createProgramArchive } from "./program.ts";
import { generateProgram, prepareProgram } from "./program-cli.ts";
import { generateReverse, prepareReverse } from "./reverse-cli.ts";
import { generateNativeScene } from "./scene-native-cli.ts";
import { inspectBitmap } from "./resources.ts";
import type { Artifact } from "./artifacts.ts";
import type { SceneDocument, SceneStyle } from "./reverse.ts";

let directory: string;
beforeEach(async () => {
  directory = await realpath(
    await mkdtemp(join(tmpdir(), "astro-fyne-web-page-")),
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const style: SceneStyle = {
  x: 0,
  y: 0,
  width: 160,
  height: 80,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  gap: 0,
  direction: "column",
  background: "#ffffff",
  color: "#000000",
  borderColor: "transparent",
  borderWidth: 0,
  radius: 0,
  fontSize: 14,
  lineHeight: 20,
  fontWeight: 400,
  fontFamily: "",
  fontStyle: "normal",
  textAlign: "left",
  whiteSpace: "normal",
  display: "block",
  opacity: 1,
  measured: true,
};
async function fixtures() {
  const source = join(directory, "Source.tsx");
  await writeFile(
    source,
    'export default function Source({observe}){return <button id="run" onClick={()=>observe("run")}>Run</button>}',
  );
  const javascript = await bundleJavascript(source, "default", {}, ["observe"]);
  const program = createProgramArchive(await compile(source));
  const bytes = await readFile(
    new URL("../example/public/images/local-image.png", import.meta.url),
  );
  const hash = createHash("sha256").update(bytes).digest("hex");
  const bitmap = inspectBitmap(bytes, "image/png");
  const scene: SceneDocument = {
    schema: 1,
    viewport: { width: 160, height: 80, scale: 1 },
    roots: [
      {
        id: "run",
        kind: "button",
        text: "Run",
        style: { ...style },
        events: { tap: "observe" },
        children: [],
      },
    ],
    tokens: {},
    requiredActions: ["observe"],
    resources: [
      {
        name: "image",
        path: `assets/${hash}.png`,
        hash,
        mediaType: "image/png",
        content: bytes.toString("base64"),
        width: bitmap.width,
        height: bitmap.height,
      },
    ],
  };
  const payload = JSON.stringify(scene);
  const catalogue: CatalogueSpec = {
    schema: 1,
    kind: "astro-fyne-catalogue",
    name: "Pages",
    resources: [],
    stylesheets: [],
    fontFaces: [],
    themes: [],
    layouts: [],
    components: [
      {
        id: "scene",
        kind: "scene",
        payload,
        hash: catalogueHash(payload),
        stylesheets: [],
        fontFaces: [],
        actions: ["observe"],
      },
    ],
    islands: [{ id: "main", component: "scene", key: "main" }],
  };
  const rows = [
    { kind: "javascript", value: javascript },
    { kind: "program", value: program },
    { kind: "scene", value: scene },
    { kind: "catalogue", value: catalogue },
  ];
  for (const row of rows)
    await writeFile(
      join(directory, `${row.kind}.json`),
      JSON.stringify(row.value),
    );
  return rows;
}
function options(kind: string) {
  return {
    out: join(directory, "pages", kind),
    name: "Page",
    direction: "web" as const,
    publicDir: join(directory, "public", kind),
    actionsModule: "../_actions.ts",
    page: true,
  };
}
async function prepare(kind: string, page = true) {
  const opts = { ...options(kind), page };
  const input = join(directory, `${kind}.json`);
  if (kind === "javascript")
    return prepareJavascript({ ...opts, program: input });
  if (kind === "program") return prepareProgram({ ...opts, program: input });
  if (kind === "catalogue")
    return prepareCatalogue({ ...opts, catalogue: input });
  return prepareReverse({ ...opts, scene: input });
}
function generatedImports(artifacts: Artifact[]) {
  return artifacts.flatMap((artifact) =>
    typeof artifact.content === "string"
      ? [...artifact.content.matchAll(/import\("([^"\n]+)"\)/g)].map(
          (match) => ({ path: artifact.path, module: match[1]! }),
        )
      : [],
  );
}

test("page mode creates one directory index for all reverse archive formats and preserves legacy helpers", async () => {
  for (const { kind } of await fixtures()) {
    const out = options(kind).out;
    const input = join(directory, `${kind}.json`);
    const args = [
      "to-web",
      input,
      "--page",
      "--out",
      out,
      "--name",
      "Page",
      "--actions-module",
      "../_actions.ts",
      ...(kind === "javascript"
        ? []
        : ["--public-dir", options(kind).publicDir]),
    ];
    await main(args);
    await main([...args, "--check"]);
    const page = await readFile(join(out, "index.astro"), "utf8");
    expect(page).toContain('import Page from "./_Page-web/Page.astro";');
    expect(page.includes("<!doctype html>")).toBe(kind !== "scene");
    expect((await readdir(out)).sort()).toEqual(["_Page-web", "index.astro"]);
    const prepared = await prepare(kind);
    const original = await prepare(kind, false);
    expect(prepared.artifacts).toHaveLength(original.artifacts.length + 1);
    const expectedActions = resolve(out, "../_actions.ts");
    const imports = generatedImports(prepared.artifacts);
    expect(imports.length).toBeGreaterThan(0);
    for (const imported of imports)
      expect(resolve(dirname(imported.path), imported.module)).toBe(
        expectedActions,
      );
    for (const artifact of original.artifacts) {
      if (generatedImports([artifact]).length) continue;
      const relocated = artifact.path.startsWith(out + "/")
        ? join(out, "_Page-web", relative(out, artifact.path))
        : artifact.path;
      expect(
        prepared.artifacts.find((candidate) => candidate.path === relocated)
          ?.content,
      ).toEqual(artifact.content);
    }
    expect(
      await normalizeConversionArgs("reverse", [input, "--page", "--check"]),
    ).toContain("--page");
    const changed = page + "<!-- edited checkpoint page -->\n";
    await writeFile(join(out, "index.astro"), changed);
    await expect(main([...args, "--check"])).rejects.toThrow("out of date");
    for (const artifact of prepared.artifacts)
      expect(await readFile(artifact.path)).toEqual(
        Buffer.from(
          artifact.path === join(out, "index.astro")
            ? changed
            : artifact.content,
        ),
      );
  }
}, 60_000);

test("stale page checks and a late handwritten index collision leave every helper and resource untouched", async () => {
  for (const { kind } of await fixtures()) {
    const opts = options(kind);
    const input = join(directory, `${kind}.json`);
    const args = [
      "to-web",
      input,
      "--page",
      "--out",
      opts.out,
      "--name",
      opts.name,
      "--actions-module",
      opts.actionsModule,
      ...(kind === "javascript" ? [] : ["--public-dir", opts.publicDir]),
    ];
    await expect(main([...args, "--check"])).rejects.toThrow("out of date");
    await expect(stat(opts.out)).rejects.toThrow();
    await expect(stat(opts.publicDir)).rejects.toThrow();
    await mkdir(opts.out, { recursive: true });
    await writeFile(join(opts.out, "index.astro"), "<p>Handwritten</p>\n");
    await expect(main(args)).rejects.toThrow("not owned by the generator");
    expect(await readdir(opts.out)).toEqual(["index.astro"]);
    expect(await readFile(join(opts.out, "index.astro"), "utf8")).toBe(
      "<p>Handwritten</p>\n",
    );
    await expect(stat(opts.publicDir)).rejects.toThrow();
  }
}, 60_000);

test("page action rebasing preserves package imports and never writes the caller's action source", async () => {
  await fixtures();
  const actions = join(directory, "pages", "_actions.ts");
  await mkdir(dirname(actions), { recursive: true });
  const content = "export const actions={observe(){}};\n";
  await writeFile(actions, content);
  for (const kind of ["javascript", "program", "catalogue", "scene"]) {
    const input = join(directory, `${kind}.json`),
      opts = options(kind);
    const packageOptions = { ...opts, actionsModule: "@host/actions" };
    const prepared =
      kind === "javascript"
        ? await prepareJavascript({ ...packageOptions, program: input })
        : kind === "program"
          ? await prepareProgram({ ...packageOptions, program: input })
          : kind === "catalogue"
            ? await prepareCatalogue({ ...packageOptions, catalogue: input })
            : await prepareReverse({ ...packageOptions, scene: input });
    for (const imported of generatedImports(prepared.artifacts))
      expect(imported.module).toBe("@host/actions");
    await main([
      "to-web",
      input,
      "--page",
      "--out",
      opts.out,
      "--name",
      opts.name,
      "--actions-module",
      opts.actionsModule,
      ...(kind === "javascript" ? [] : ["--public-dir", opts.publicDir]),
    ]);
    expect(await readFile(actions, "utf8")).toBe(content);
  }
}, 60_000);

test("page mode rejects native CLI and API routes before reading input or generating Go", async () => {
  for (const args of [
    ["to-fyne", "missing.tsx", "--page"],
    ["check", "missing.json", "--page"],
    ["to-fyne", "--catalogue", "missing.json", "--page"],
    ["to-fyne", "--program", "missing.json", "--page"],
    ["to-fyne", "--scene", "missing.json", "--page"],
    ["to-fyne", "--config", "missing.json", "--page"],
  ])
    await expect(main(args)).rejects.toThrow("--page requires to-web");
  const opts = {
    out: join(directory, "native"),
    name: "Page",
    direction: "native" as const,
    page: true,
  };
  await expect(
    generateJavascript({ ...opts, program: "missing.json" }),
  ).rejects.toThrow("--page requires to-web");
  await expect(
    generateProgram({ ...opts, program: "missing.json" }),
  ).rejects.toThrow("--page requires to-web");
  await expect(
    generateCatalogue({ ...opts, catalogue: "missing.json" }),
  ).rejects.toThrow("--page requires to-web");
  await expect(
    generateNativeScene({ ...opts, scene: "missing.json" }),
  ).rejects.toThrow("--page requires to-web");
  await expect(
    generate({ config: "missing.json", check: false, page: true }),
  ).rejects.toThrow("--page requires to-web");
  await expect(
    prepareSourceCatalogue({
      ...opts,
      source: "missing.tsx",
      fonts: "missing.json",
    }),
  ).rejects.toThrow("--page requires to-web");
  expect(await readdir(directory)).toEqual([]);
});

test("a generated page cannot replace an input reached through a directory symlink", async () => {
  await fixtures();
  const out = join(directory, "page");
  await mkdir(out);
  const input = join(out, "index.astro");
  const original = await readFile(join(directory, "scene.json"));
  await writeFile(input, original);
  const alias = join(directory, "alias");
  await symlink(out, alias);
  await expect(
    generateReverse({
      scene: join(alias, "index.astro"),
      out,
      name: "Page",
      page: true,
      actionsModule: "../_actions.ts",
    }),
  ).rejects.toThrow("protected input");
  expect(await readFile(input)).toEqual(original);
  expect(await readdir(out)).toEqual(["index.astro"]);
}, 60_000);

test("page helper directory symlinks cannot escape the selected output root", async () => {
  await fixtures();
  const out = join(directory, "page"),
    outside = join(directory, "outside");
  await mkdir(out);
  await mkdir(outside);
  await symlink(outside, join(out, "_Page-web"));
  await expect(
    generateReverse({
      scene: join(directory, "scene.json"),
      out,
      name: "Page",
      page: true,
      actionsModule: "../_actions.ts",
    }),
  ).rejects.toThrow("symlink points outside the selected directory");
  expect(await readdir(out)).toEqual(["_Page-web"]);
  expect(await readdir(outside)).toEqual([]);
}, 60_000);

test("preparing a page owns its scalar options before asynchronous input reads", async () => {
  await fixtures();
  const original = options("javascript");
  const input = join(directory, "javascript.json");
  const mutable = { ...original, program: input, check: true };
  const pending = prepareJavascript(mutable);
  mutable.name = 'Unvalidated"Name';
  mutable.page = false;
  mutable.out = join(directory, "changed");
  mutable.actionsModule = "../changed-actions.ts";
  mutable.check = false;
  const prepared = await pending;
  const page = prepared.artifacts.find(
    (artifact) => artifact.path === join(original.out, "index.astro"),
  );
  expect(page?.content).toContain('import Page from "./_Page-web/Page.astro";');
  expect(
    prepared.artifacts.every((artifact) => artifact.root === original.out),
  ).toBe(true);
  for (const imported of generatedImports(prepared.artifacts))
    expect(resolve(dirname(imported.path), imported.module)).toBe(
      resolve(original.out, original.actionsModule),
    );
  expect(
    prepared.artifacts.some((artifact) => artifact.path.includes("changed")),
  ).toBe(false);
  await expect(stat(original.out)).rejects.toThrow();
  await expect(stat(mutable.out)).rejects.toThrow();
});
