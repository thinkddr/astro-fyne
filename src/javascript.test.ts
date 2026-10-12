// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "./parser.ts";
import { bundleJavascript, validateJavascriptArchive } from "./javascript.ts";
import { generateJavascript } from "./javascript-cli.ts";
import { javascriptHostJSON } from "./javascript-data.ts";

test("JavaScript host data diagnoses values that JSON would silently change", () => {
  expect(javascriptHostJSON({ text: "🙂", value: 0 })).toBe(
    '{"text":"🙂","value":0}',
  );
  expect(javascriptHostJSON(JSON.parse('{"__proto__":{"count":7}}'))).toBe(
    '{"__proto__":{"count":7}}',
  );
  for (const value of [
    NaN,
    -0,
    undefined,
    "\ud800",
    [, 1],
    Object.defineProperty({}, "hidden", { value: 1 }),
    {
      get value() {
        throw new Error("getter was invoked");
      },
    },
  ])
    expect(() => javascriptHostJSON(value)).toThrow(/adapter|JSON/);
});

test("JavaScript mode bundles general functions and hooks that the declarative compiler rejects", async () => {
  const source = join(
    import.meta.dir,
    "../example/src/components/JavascriptConformance.tsx",
  );
  await expect(compile(source, "JavascriptConformance")).rejects.toThrow();
  const archive = await bundleJavascript(source, "JavascriptConformance", {}, [
    "observe",
  ]);
  expect(archive.code.length).toBeGreaterThan(1000);
  expect(
    archive.sources.some((source) =>
      source.path.endsWith("JavascriptConformance.tsx"),
    ),
  ).toBe(true);
  const directory = await mkdtemp(join(tmpdir(), "afy-javascript-"));
  try {
    const path = join(directory, "program.json"),
      out = join(directory, "native");
    await writeFile(path, JSON.stringify(archive));
    await generateJavascript({
      program: path,
      out,
      name: "Example",
      direction: "native",
    });
    const code = await readFile(join(out, "Example.gen.go"), "utf8");
    expect(code).toContain(
      'jsruntime "github.com/thinkddr/astro-fyne/native/javascript"',
    );
    expect(code).toContain("func NewExample(");
    expect(code).not.toContain("os/exec");
    await generateJavascript({
      program: path,
      out,
      name: "Example",
      direction: "native",
      check: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
test("JavaScript output rejects invalid history and preserves handwritten files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-javascript-files-"));
  try {
    const source = join(directory, "Source.tsx"),
      path = join(directory, "program.json"),
      out = join(directory, "out");
    await writeFile(
      source,
      "export default function Page(){return <p>Hello</p>}",
    );
    const archive = await bundleJavascript(source);
    await expect(
      validateJavascriptArchive({ ...archive, code: archive.code + " " }),
    ).rejects.toThrow("digest");
    await expect(
      validateJavascriptArchive({
        ...archive,
        events: [{ node: "1", type: "submit" }],
      }),
    ).rejects.toThrow("event");
    await writeFile(
      path,
      JSON.stringify({
        ...archive,
        journal: [
          { kind: "action", name: "missing", args: "[]", value: "null" },
        ],
      }),
    );
    await expect(
      generateJavascript({
        program: path,
        out,
        name: "Page",
        direction: "native",
      }),
    ).rejects.toThrow("journal");
    await expect(stat(out)).rejects.toThrow();
    await writeFile(path, JSON.stringify(archive));
    await generateJavascript({
      program: path,
      out,
      name: "Page",
      direction: "native",
    });
    await writeFile(
      join(out, "Page.gen.go"),
      "// handwritten\npackage generated\n",
    );
    await expect(
      generateJavascript({
        program: path,
        out,
        name: "Page",
        direction: "native",
      }),
    ).rejects.toThrow();
    expect(await readFile(join(out, "Page.gen.go"), "utf8")).toStartWith(
      "// handwritten",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
test("JavaScript bundling diagnoses missing platform assets before writing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-javascript-css-"));
  try {
    await writeFile(join(directory, "style.css"), "p{color:red}");
    await writeFile(
      join(directory, "Page.tsx"),
      "import './style.css';export default function Page(){return <p>Hello</p>}",
    );
    await expect(bundleJavascript(join(directory, "Page.tsx"))).rejects.toThrow(
      "CSS imports",
    );
    await writeFile(
      join(directory, "Page.astro"),
      "---\nconst value=await Promise.resolve(1);\n---\n<p>{value}</p>",
    );
    await expect(
      bundleJavascript(join(directory, "Page.astro")),
    ).rejects.toThrow("frontmatter");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JavaScript bundling supports Astro route filenames and relative processed scripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-route-path-"));
  try {
    for (const route of ["[id]", "[...locale]"]) {
      const directory = join(root, route);
      await mkdir(directory);
      await writeFile(join(directory, "value.ts"), "export const value=12;");
      await writeFile(
        join(directory, "logic.ts"),
        'import{value}from"./value.ts";export const label=String(value+4);',
      );
      const source = join(directory, "Page.astro");
      await writeFile(
        source,
        '<p id="label">Hello</p><script>import{label}from"./logic.ts";document.getElementById("label").textContent=label;</script>',
      );
      const archive = await bundleJavascript(source);
      for (const path of ["Page.astro", "logic.ts", "value.ts"])
        expect(archive.sources.some((source) => source.path === path)).toBe(
          true,
        );
      await writeFile(
        source,
        "---\nexport const prerender=false;\n---\n<p>Hello</p>",
      );
      await expect(bundleJavascript(source)).rejects.toThrow("route exports");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
