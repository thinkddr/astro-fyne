// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
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
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleJavascript, prepareJavascriptBundle } from "./javascript.ts";
import { applyArtifacts } from "./artifacts.ts";
import { prepareCatalogueSource } from "./catalogue-cli.ts";
import { catalogueHash, type CatalogueSpec } from "./catalogue.ts";
import type { JavascriptArchive } from "./javascript-types.ts";

async function directory() {
  return realpath(await mkdtemp(join(tmpdir(), "afy-bundle-inputs-")));
}
async function tree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name,
        file = join(path, entry.name);
      if (entry.isDirectory()) {
        files[`${name}/`] = "directory";
        await visit(file, `${name}/`);
      } else if (entry.isSymbolicLink()) {
        files[name] = `symlink:${await readlink(file)}`;
      } else files[name] = (await readFile(file)).toString("base64");
    }
  }
  await visit(root, "");
  return files;
}
function catalogue(archive: JavascriptArchive) {
  const payload = JSON.stringify(archive),
    stylesheets = (archive.stylesheets ?? []).map((sheet, index) => ({
      id: `css${index}`,
      path: sheet.path,
      hash: sheet.hash,
      content: Buffer.from(sheet.text).toString("base64"),
    })),
    spec: CatalogueSpec = {
      schema: 1,
      kind: "astro-fyne-catalogue",
      name: "App",
      resources: [],
      stylesheets,
      fontFaces: [],
      themes: [],
      layouts: [],
      components: [
        {
          id: "app",
          kind: "javascript",
          payload,
          hash: catalogueHash(payload),
          stylesheets: stylesheets.map((sheet) => sheet.id),
          fontFaces: [],
          actions: [...archive.actions],
        },
      ],
      islands: [{ id: "app", component: "app", key: "app" }],
    };
  return JSON.stringify(spec);
}

test("prepared JavaScript bundles preserve archive-only wrapper bytes and positional options", async () => {
  const root = await directory();
  try {
    const source = join(root, "Counter.tsx"),
      stylesheet = join(root, "counter.css"),
      props = { label: "Counter" },
      actions = ["observe"];
    await writeFile(
      source,
      'import{useState}from"preact/hooks";export function Counter({label,observe}){const[count,setCount]=useState(0);return <button class="counter" onClick={()=>{setCount(count+1);observe(count+1)}}>{label}:{count}</button>}',
    );
    await writeFile(
      stylesheet,
      "/* exact CSS */\r\n.counter{color:#123456}\r\n",
    );
    const before = await tree(root),
      prepared = await prepareJavascriptBundle(
        source,
        "Counter",
        props,
        actions,
        [stylesheet],
      ),
      legacy = await bundleJavascript(source, "Counter", props, actions, [
        stylesheet,
      ]),
      serialized = JSON.stringify(prepared.archive);
    expect(serialized).toBe(JSON.stringify(legacy));
    expect(prepared.archive.props).toEqual(props);
    expect(prepared.archive.actions).toEqual(actions);
    expect(prepared.archive.stylesheets?.[0]?.text).toBe(
      await readFile(stylesheet, "utf8"),
    );
    expect(Object.hasOwn(legacy, "archive")).toBe(false);
    expect(Object.hasOwn(legacy, "inputPaths")).toBe(false);
    expect(Object.hasOwn(prepared.archive, "inputPaths")).toBe(false);
    expect(prepared.inputPaths).toContain(source);
    expect(prepared.inputPaths).toContain(stylesheet);
    prepared.inputPaths[0] = "caller-owned list";
    prepared.inputPaths.length = 0;
    expect(JSON.stringify(prepared.archive)).toBe(serialized);
    expect(await tree(root)).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("prepared bundles track direct Astro, module, CSS and dependency reads", async () => {
  const root = await directory();
  try {
    const route = join(root, "[id]"),
      files: Record<string, string> = {
        "App.astro":
          '---\nimport Panel from "./Panel.astro";import Counter from "./Counter.tsx";import "./styles/view.css";\n---\n<Panel/><Counter client:only="preact"/><p id="script">Pending</p><script>import{label}from"./logic.ts";document.getElementById("script").textContent=label;</script>',
        "Panel.astro": "<p>Nested Astro</p>",
        "Counter.tsx":
          'import{useState}from"preact/hooks";export default function Counter(){const[count,setCount]=useState(0);return <button class="counter" onClick={()=>setCount(count+1)}>{count}</button>}',
        "logic.ts": 'export{label}from"./script.js";',
        "script.js":
          'import{suffix}from"./value.ts";import data from"./value.json";export const label=data.label+suffix;',
        "value.ts": 'export const suffix="!";',
        "value.json": '{"label":"Script value"}',
        "styles/view.css":
          '\ufeff/* café */\r\n@import "./shared.css";\r\n.counter{color:var(--accent)}\r\n',
        "styles/shared.css": ":root{--accent:#123456}\r\n",
        "styles/external.css":
          '@import "./shared.css";\n.counter{font-size:16px;line-height:20px}\n',
      };
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(dirname(join(route, path)), { recursive: true });
      await writeFile(join(route, path), contents);
    }
    const unused = join(route, "unused.ts");
    await writeFile(unused, 'throw new Error("Not imported");');
    const before = await tree(root),
      source = join(route, "App.astro"),
      stylesheet = join(route, "styles/external.css"),
      prepared = await prepareJavascriptBundle(
        source,
        "default",
        {},
        [],
        [stylesheet],
      ),
      legacy = await bundleJavascript(source, "default", {}, [], [stylesheet]),
      canonical = new Set(
        await Promise.all(prepared.inputPaths.map((path) => realpath(path))),
      );
    expect(JSON.stringify(prepared.archive)).toBe(JSON.stringify(legacy));
    expect(prepared.inputPaths).toEqual(
      [...new Set(prepared.inputPaths)].sort(),
    );
    for (const path of prepared.inputPaths) {
      expect(isAbsolute(path)).toBe(true);
      expect(path).toBe(resolve(path));
      expect((await stat(path)).isFile()).toBe(true);
      expect(path).not.toContain("astro-fyne-entry:");
    }
    for (const path of Object.keys(files))
      expect(canonical.has(await realpath(join(route, path)))).toBe(true);
    expect(canonical.has(await realpath(unused))).toBe(false);
    for (const path of [
      fileURLToPath(import.meta.resolve("preact")),
      fileURLToPath(import.meta.resolve("preact/hooks")),
      resolve(fileURLToPath(import.meta.resolve("preact")), "../../LICENSE"),
      fileURLToPath(new URL("./javascript-runtime.js", import.meta.url)),
      fileURLToPath(new URL("./javascript-dom.js", import.meta.url)),
      fileURLToPath(new URL("./javascript-data.ts", import.meta.url)),
      fileURLToPath(new URL("./javascript-css-runtime.js", import.meta.url)),
      fileURLToPath(new URL("./javascript-height-runtime.js", import.meta.url)),
      fileURLToPath(new URL("./javascript-astro-runtime.ts", import.meta.url)),
    ])
      expect(canonical.has(await realpath(path))).toBe(true);
    expect(prepared.archive.stylesheets).toHaveLength(3);
    for (const sheet of prepared.archive.stylesheets!)
      expect(sheet.text).toBe(files[sheet.path]!);
    expect(await tree(root)).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("bundle input paths protect generated CSS through catalogue output aliases", async () => {
  const root = await directory();
  try {
    const actual = join(root, "actual"),
      chosen = join(root, "chosen"),
      source = join(actual, "App.tsx"),
      stylesheet = join(actual, "App.fonts.css"),
      css =
        "/* Code generated by astro-fyne. DO NOT EDIT. */\n.text{color:#123456}\r\n";
    await mkdir(actual);
    await symlink(actual, chosen);
    await writeFile(
      source,
      'import"./App.fonts.css";export default function App(){return <p class="text">Retained</p>}',
    );
    await writeFile(stylesheet, css);
    const before = await tree(root),
      prepared = await prepareJavascriptBundle(source),
      plan = await prepareCatalogueSource(catalogue(prepared.archive), {
        out: chosen,
        name: "App",
        direction: "native",
        protectedInputs: prepared.inputPaths,
      });
    expect(prepared.inputPaths).toContain(stylesheet);
    expect(
      plan.artifacts.find(
        (artifact) => artifact.path === join(chosen, "App.fonts.css"),
      )!.content,
    ).not.toBe(css);
    await expect(
      applyArtifacts(plan.artifacts, {
        check: false,
        protectedInputs: prepared.inputPaths,
      }),
    ).rejects.toThrow("Output cannot replace a protected input");
    expect(await tree(root)).toEqual(before);
    expect(await readFile(stylesheet, "utf8")).toBe(css);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("prepared bundle diagnostics preserve existing wrapper failures", async () => {
  const root = await directory();
  try {
    const source = join(root, "App.astro");
    await writeFile(source, "<p>Hello</p>");
    for (const [path, selected, diagnostic] of [
      [join(root, "App.txt"), "default", "Astro/TSX/JSX/TS/JS entry"],
      [source, "not valid!", "export must be an identifier"],
      [source, "Named", "Astro JavaScript entries expose only the default"],
    ] as const) {
      await expect(prepareJavascriptBundle(path, selected)).rejects.toThrow(
        diagnostic,
      );
      await expect(bundleJavascript(path, selected)).rejects.toThrow(
        diagnostic,
      );
    }
    await writeFile(
      join(root, "style.css"),
      "@media(min-width:1px){p{color:red}}",
    );
    await writeFile(source, '---\nimport"./style.css";\n---\n<p>Hello</p>');
    await expect(prepareJavascriptBundle(source)).rejects.toThrow("CSS @media");
    await expect(bundleJavascript(source)).rejects.toThrow("CSS @media");
    expect(Object.keys(await tree(root)).sort()).toEqual([
      "App.astro",
      "style.css",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
