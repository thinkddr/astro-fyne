// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogueHash, parseCatalogue } from "./catalogue.ts";
import {
  generateSourceCatalogue,
  prepareSourceCatalogue,
} from "./source-catalogue.ts";

const launcher = fileURLToPath(
    new URL("../bin/astro-fyne.ts", import.meta.url),
  ),
  regular = await readFile(
    new URL("../example/public/fonts/NotoSans-Regular.ttf", import.meta.url),
  ),
  bold = await readFile(
    new URL("../example/public/fonts/NotoSans-Bold.ttf", import.meta.url),
  ),
  license =
    "\ufeff" +
    (
      await readFile(
        new URL(
          "../example/public/fonts/LICENSE-NotoSans.txt",
          import.meta.url,
        ),
        "utf8",
      )
    ).replace(/\r?\n/g, "\r\n"),
  face = {
    family: "Host",
    weight: 400,
    style: "normal",
    source: "regular.ttf",
    license: "OFL.txt",
  };
let directory: string;
beforeEach(async () => {
  directory = await realpath(
    await mkdtemp(join(tmpdir(), "afy-source-catalogue-")),
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function tree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name,
        file = join(path, entry.name);
      if (entry.isDirectory()) {
        files[`${name}/`] = "directory";
        await visit(file, `${name}/`);
      } else if (entry.isSymbolicLink())
        files[name] = `symlink:${await readlink(file)}`;
      else files[name] = (await readFile(file)).toString("base64");
    }
  }
  await visit(root, "");
  return files;
}
async function fixture() {
  const source = join(directory, "source/App.astro"),
    fonts = join(directory, "assets/fonts.json"),
    props = join(directory, "props.json"),
    cwd = join(directory, "foreign");
  for (const path of ["source", "styles", "assets", "foreign"])
    await mkdir(join(directory, path));
  await writeFile(
    source,
    '---\nimport Counter from "./Counter.tsx";\n---\n<Counter client:only="preact" />',
  );
  await writeFile(
    join(directory, "source/Counter.tsx"),
    'import{useState}from"preact/hooks";import"../styles/counter.css";export default function Counter({label="Initial"}){const[count,setCount]=useState(0);return <section class="card"><span id="count">{label}:{count}</span><button id="increment" onClick={()=>setCount(count+1)}>Increment</button></section>}',
  );
  await writeFile(
    join(directory, "styles/counter.css"),
    '@import "./palette.css";\r\n.card{font-family:Host;font-weight:400;font-size:16px;line-height:20px;white-space:nowrap;color:var(--accent)}\r\n',
  );
  await writeFile(
    join(directory, "styles/palette.css"),
    "\ufeff:root{--accent:#123456}\r\n",
  );
  await writeFile(join(directory, "assets/regular.ttf"), regular);
  await writeFile(join(directory, "assets/bold.ttf"), bold);
  await writeFile(join(directory, "assets/OFL.txt"), license);
  await writeFile(
    fonts,
    JSON.stringify({
      schema: 1,
      kind: "astro-fyne-font-manifest",
      faces: [face],
    }) + "\r\n",
  );
  await writeFile(props, '{"label":"From props"}\n');
  return {
    source,
    fonts,
    props,
    cwd,
    out: join(cwd, "native/generated"),
    name: "App",
  };
}
function run(cwd: string, args: string[], timeout = 15_000) {
  const start = Date.now(),
    result = spawnSync(process.execPath, [launcher, ...args], {
      cwd,
      encoding: "utf8",
      timeout,
    });
  if (result.error)
    throw new Error(
      JSON.stringify({
        args,
        cwd,
        status: result.status,
        signal: result.signal,
        elapsedMs: Date.now() - start,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error.message,
      }),
    );
  return result;
}
function success(cwd: string, args: string[]) {
  const result = run(cwd, args, 60_000);
  if (result.status !== 0)
    throw new Error(
      JSON.stringify({
        args,
        cwd,
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      }),
    );
  expect(result.stderr).toBe("");
  return result;
}

test("source font shortcuts work from a foreign cwd and return a portable catalogue", async () => {
  const input = await fixture(),
    args = [
      "to-fyne",
      "../source/App.astro",
      "--fonts",
      "../assets/fonts.json",
      "--props",
      "../props.json",
    ],
    before = await tree(directory);
  const missing = run(input.cwd, [...args, "--check"], 60_000);
  expect(missing.status).not.toBe(0);
  expect(missing.stderr).toContain("out of date");
  expect(await tree(directory)).toEqual(before);
  success(input.cwd, args);
  const generated = await tree(input.out);
  success(input.cwd, [...args, "--check"]);
  expect(await tree(input.out)).toEqual(generated);
  const report = JSON.parse(
      await readFile(join(input.out, "App.source-fonts.report.json"), "utf8"),
    ),
    spec = await parseCatalogue(
      await readFile(join(input.out, report.archiveFile), "utf8"),
    );
  expect(report.manifestHash).toBe(catalogueHash(await readFile(input.fonts)));
  expect(report.strictFontAdmissionEnabled).toBe(false);
  expect(report.visual.pixelPerfectVerified).toBe(false);
  expect(spec.islands).toEqual([{ id: "app", component: "app", key: "app" }]);
  expect(Buffer.from(spec.resources[0]!.content, "base64")).toEqual(regular);
  expect(spec.resources[0]!.license).toBe(license);
  expect(JSON.parse(spec.components[0]!.payload).props).toEqual({
    label: "From props",
  });
  const constructors = await readFile(join(input.out, "App.gen.go"), "utf8");
  expect(constructors).toContain(
    "func NewApp(props webui.Scope, actions webui.Actions)",
  );
  expect(constructors).toContain("func NewAppWithOptions(");
  expect(constructors).toContain("func ExportAppCatalogue(");
  expect(constructors).toContain(
    "jsruntime.NewWithOptions(archive, input.Actions, options, input.Backend)",
  );
  const reverse = [
    "to-web",
    join(input.out, report.archiveFile),
    "--out",
    "web",
    "--name",
    "Returned",
  ];
  success(input.cwd, reverse);
  success(input.cwd, [...reverse, "--check"]);
  expect(
    await readFile(
      join(
        input.cwd,
        "web/Returned.catalogue-assets",
        `${catalogueHash(regular)}.ttf`,
      ),
    ),
  ).toEqual(regular);
  expect(
    await readFile(
      join(
        input.cwd,
        "web/Returned.catalogue-assets",
        `${catalogueHash(regular)}.ttf.license.txt`,
      ),
      "utf8",
    ),
  ).toBe(license);
}, 180_000);

test("font-free shortcuts and scene font arrays keep their existing routes", async () => {
  const input = await fixture();
  success(input.cwd, ["to-fyne", "../source/App.astro", "--out", "plain"]);
  expect(
    JSON.parse(
      await readFile(
        join(input.cwd, "plain/App.javascript.report.json"),
        "utf8",
      ),
    ).runtime,
  ).toBe("goja-pure-go");
  await expect(
    stat(join(input.cwd, "plain/App.catalogue.gen.go")),
  ).rejects.toThrow();
  const scene = {
    schema: 1,
    viewport: { width: 100, height: 100, scale: 1 },
    roots: [
      {
        id: "root",
        kind: "container",
        style: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
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
        },
        children: [],
      },
    ],
    resources: [],
    tokens: {},
    requiredActions: [],
  };
  await writeFile(join(directory, "legacy.scene.json"), JSON.stringify(scene));
  await writeFile(
    join(directory, "assets/scene-fonts.json"),
    JSON.stringify([
      {
        family: "Host",
        weight: 400,
        style: "normal",
        source: "regular.ttf",
        webSrc: "/fonts/host.ttf",
      },
    ]),
  );
  success(input.cwd, [
    "to-fyne",
    "../legacy.scene.json",
    "--fonts",
    "../assets/scene-fonts.json",
    "--out",
    "scene",
    "--name",
    "Scene",
  ]);
  expect(
    await readFile(join(input.cwd, "scene/Scene.gen.fonts.css"), "utf8"),
  ).toContain("/fonts/host.ttf");
}, 120_000);

test("source-only font options and invalid manifests fail without output", async () => {
  const input = await fixture(),
    prepared = await prepareSourceCatalogue(input);
  await writeFile(
    join(directory, "program.json"),
    JSON.stringify(prepared.archive),
  );
  const before = await tree(directory);
  for (const args of [
    ["to-web", "../source/App.astro", "--fonts", "../assets/fonts.json"],
    ["to-fyne", "../program.json", "--fonts", "../assets/fonts.json"],
    [
      "to-fyne",
      "../source/App.astro",
      "--fonts",
      "../assets/fonts.json",
      "--fonts",
      "../assets/fonts.json",
    ],
  ]) {
    const result = run(input.cwd, args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/native --source|Duplicate option/);
    expect(await tree(directory)).toEqual(before);
  }
  await writeFile(input.fonts, JSON.stringify([face]));
  const invalid = await tree(directory),
    result = run(input.cwd, [
      "to-fyne",
      "../source/App.astro",
      "--fonts",
      "../assets/fonts.json",
    ]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Font manifest");
  expect(await tree(directory)).toEqual(invalid);
}, 60_000);

test("source preparation snapshots input options and never writes output", async () => {
  const input = await fixture(),
    options = { ...input, actions: ["observe"] },
    before = await tree(directory),
    promise = prepareSourceCatalogue(options);
  options.source = join(directory, "missing.tsx");
  options.fonts = join(directory, "missing.json");
  options.props = join(directory, "missing-props.json");
  options.actions[0] = "changed";
  const prepared = await promise;
  expect(prepared.archive.props).toEqual({ label: "From props" });
  expect(prepared.archive.actions).toEqual(["observe"]);
  expect(prepared.inputPaths).toContain(input.source);
  expect(prepared.inputPaths).toContain(input.fonts);
  expect(prepared.inputPaths).toContain(input.props);
  expect(prepared.inputPaths).toContain(join(directory, "assets/regular.ttf"));
  expect(prepared.inputPaths).toContain(join(directory, "assets/OFL.txt"));
  expect(prepared.inputPaths).toContain(join(directory, "styles/counter.css"));
  expect(prepared.inputPaths).toContain(join(directory, "styles/palette.css"));
  expect(await tree(directory)).toEqual(before);
}, 60_000);

test("late convenience-wrapper collisions protect licensed inputs across aliases", async () => {
  const input = await fixture(),
    actual = join(directory, "assets"),
    chosen = join(directory, "asset-output"),
    licensePath = join(actual, "App.gen.go");
  await symlink(actual, chosen);
  await writeFile(
    licensePath,
    "// Code generated by astro-fyne. DO NOT EDIT.\n" + license,
  );
  await writeFile(
    input.fonts,
    JSON.stringify({
      schema: 1,
      kind: "astro-fyne-font-manifest",
      faces: [{ ...face, license: "App.gen.go" }],
    }),
  );
  const before = await tree(directory);
  await expect(
    generateSourceCatalogue({ ...input, out: chosen }),
  ).rejects.toThrow("Output cannot replace a protected input");
  expect(await tree(directory)).toEqual(before);
}, 60_000);

test("handwritten assets and changed license provenance leave the complete output unchanged", async () => {
  const input = await fixture();
  await generateSourceCatalogue(input);
  const report = JSON.parse(
      await readFile(join(input.out, "App.source-fonts.report.json"), "utf8"),
    ),
    spec = await parseCatalogue(
      await readFile(join(input.out, report.archiveFile), "utf8"),
    ),
    sheet = join(input.out, `App.css-sources/${spec.stylesheets[0]!.hash}.css`);
  await writeFile(sheet, "/* handwritten CSS */\r\n");
  await writeFile(
    input.fonts,
    JSON.stringify({
      schema: 1,
      kind: "astro-fyne-font-manifest",
      faces: [face, { ...face, weight: 700, source: "bold.ttf" }],
    }),
  );
  const before = await tree(directory);
  await expect(generateSourceCatalogue(input)).rejects.toThrow(
    "not owned by the generator",
  );
  expect(await tree(directory)).toEqual(before);
  await writeFile(sheet, Buffer.from(spec.stylesheets[0]!.content, "base64"));
  await writeFile(
    input.fonts,
    JSON.stringify({
      schema: 1,
      kind: "astro-fyne-font-manifest",
      faces: [face],
    }),
  );
  await writeFile(join(directory, "assets/OFL.txt"), license + "\r\n");
  const changed = await tree(directory);
  await expect(
    generateSourceCatalogue({ ...input, check: true }),
  ).rejects.toThrow("out of date");
  await expect(generateSourceCatalogue(input)).rejects.toThrow(
    "not owned by the generator",
  );
  expect(await tree(directory)).toEqual(changed);
}, 120_000);
