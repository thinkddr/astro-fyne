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
import { createHash } from "node:crypto";
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
    await writeFile(
      join(directory, "style.css"),
      "@media(min-width:1px){p{color:red}}",
    );
    await writeFile(
      join(directory, "Page.tsx"),
      "import './style.css';export default function Page(){return <p>Hello</p>}",
    );
    await expect(bundleJavascript(join(directory, "Page.tsx"))).rejects.toThrow(
      "CSS @media",
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

test("external generated stylesheets are bound to source digests and generated archives", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-external-css-"));
  try {
    const source = join(root, "View.tsx"),
      stylesheet = join(root, "generated.css");
    await writeFile(
      source,
      'export default function View(){return <p class="text">Hello</p>}',
    );
    await writeFile(stylesheet, ".text{color:red}");
    const first = await bundleJavascript(
      source,
      "default",
      {},
      [],
      [stylesheet],
    );
    expect(first.sources.some((item) => item.path === "generated.css")).toBe(
      true,
    );
    await writeFile(stylesheet, ".text{color:blue}");
    const second = await bundleJavascript(
      source,
      "default",
      {},
      [],
      [stylesheet],
    );
    expect(second.codeHash).not.toBe(first.codeHash);
    await generateJavascript({
      source,
      stylesheet,
      out: join(root, "native"),
      name: "Styled",
      direction: "native",
    });
    expect(
      await readFile(join(root, "native/Styled.gen.go"), "utf8"),
    ).toContain(second.codeHash);
    const program = join(root, "program.json");
    await writeFile(program, JSON.stringify(second));
    await expect(
      generateJavascript({
        program,
        stylesheet,
        out: join(root, "native"),
        name: "Styled",
        direction: "native",
      }),
    ).rejects.toThrow("already declares");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

test("CSS source bytes survive imported and explicit stylesheets without rewriting output paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-css-sources-"));
  try {
    const source = join(root, "View.tsx"),
      css =
        '\ufeff/* café 🙂 */\r\n@import "./shared.css";\r\n.text { color: red; }\r\n',
      shared = '/* keep comments */\n.text { --Accent: "UPPER"; }\n';
    await writeFile(
      source,
      'import "./style.css";export default function View(){return <p class="text">Hello</p>}',
    );
    await writeFile(join(root, "style.css"), css);
    await writeFile(join(root, "shared.css"), shared);
    const archive = await bundleJavascript(
      source,
      "default",
      {},
      [],
      [join(root, "shared.css")],
    );
    expect(archive.stylesheets?.map(({ path, text }) => [path, text])).toEqual([
      ["shared.css", shared],
      ["style.css", css],
    ]);
    for (const sheet of archive.stylesheets!)
      expect(sheet.hash).toBe(
        createHash("sha256").update(sheet.text).digest("hex"),
      );
    const program = join(root, "program.json");
    await writeFile(program, JSON.stringify(archive));
    for (const direction of ["native", "web"] as const) {
      const out = join(root, direction),
        options = { program, out, name: "Styled", direction };
      await generateJavascript(options);
      await generateJavascript({ ...options, check: true });
      const manifest = JSON.parse(
        await readFile(join(out, "Styled.css-sources.json"), "utf8"),
      );
      expect(manifest.stylesheets).toHaveLength(2);
      for (const [index, item] of manifest.stylesheets.entries()) {
        expect(item.path).toBe(archive.stylesheets![index]!.path);
        expect(item.file).toMatch(
          /^Styled\.css-sources\/\d{4}-[a-f0-9]{64}\.css$/,
        );
        expect(await readFile(join(out, item.file))).toEqual(
          Buffer.from(archive.stylesheets![index]!.text),
        );
      }
      const retained = join(out, manifest.stylesheets[0].file);
      await writeFile(retained, "/* handwritten edit */\n");
      await expect(generateJavascript(options)).rejects.toThrow("not owned");
      expect(await readFile(retained, "utf8")).toBe("/* handwritten edit */\n");
    }
    for (const stylesheets of [
      [{ ...archive.stylesheets![0], text: shared + " " }],
      [{ ...archive.stylesheets![0], path: "missing.css" }],
      [archive.stylesheets![0], archive.stylesheets![0]],
      [{ ...archive.stylesheets![0], text: "\ud800" }],
    ])
      await expect(
        validateJavascriptArchive({ ...archive, stylesheets }),
      ).rejects.toThrow();
    const duplicateSources = {
      ...archive,
      sources: [
        ...archive.sources,
        archive.sources.find((item) => item.path === "shared.css")!,
      ],
    };
    await expect(validateJavascriptArchive(duplicateSources)).rejects.toThrow(
      "duplicate",
    );
    const parentPath = {
      ...archive,
      sources: [
        ...archive.sources,
        { path: "../../outside.css", hash: archive.stylesheets![0]!.hash },
      ],
      stylesheets: [{ ...archive.stylesheets![0]!, path: "../../outside.css" }],
    };
    await writeFile(program, JSON.stringify(parentPath));
    await generateJavascript({
      program,
      out: join(root, "safe"),
      name: "Safe",
      direction: "web",
    });
    const manifest = JSON.parse(
      await readFile(join(root, "safe/Safe.css-sources.json"), "utf8"),
    );
    expect(manifest.stylesheets[0].path).toBe("../../outside.css");
    expect(manifest.stylesheets[0].file).toMatch(
      /^Safe\.css-sources\/0000-[a-f0-9]{64}\.css$/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
