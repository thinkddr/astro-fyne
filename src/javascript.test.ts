// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
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
    await writeFile(join(directory, "Page.astro"), "<p>Hello</p>");
    await expect(
      bundleJavascript(join(directory, "Page.astro")),
    ).rejects.toThrow("frontmatter");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
