// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConversionArgs } from "./cli-shortcuts.ts";
import { compile } from "./parser.ts";
import { createProgramArchive } from "./program.ts";
import type { SceneDocument, SceneStyle } from "./reverse.ts";
import type { JavascriptArchive } from "./javascript-types.ts";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
const launcher = fileURLToPath(
  new URL("../bin/astro-fyne.ts", import.meta.url),
);
let directory: string;

beforeEach(async () => {
  directory = await realpath(
    await mkdtemp(join(tmpdir(), "astro-fyne-cli-shortcuts-")),
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function run(args: string[], entry = cli) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: directory,
    encoding: "utf8",
    timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

function success(args: string[], entry = cli) {
  const result = run(args, entry);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout;
}

test("file shortcuts add defaults without changing explicit flag forms or their arguments", async () => {
  const explicit = ["--javascript", "--source", "App.tsx", "--name", "App"];
  expect(await normalizeConversionArgs("generate", explicit)).toEqual(explicit);
  expect(explicit).toEqual([
    "--javascript",
    "--source",
    "App.tsx",
    "--name",
    "App",
  ]);
  expect(await normalizeConversionArgs("watch", ["App.tsx"])).toEqual([
    "App.tsx",
  ]);
  expect(
    await normalizeConversionArgs("generate", ["src/my-widget.tsx"]),
  ).toEqual([
    "--javascript",
    "--source",
    "src/my-widget.tsx",
    "--out",
    "native/generated",
    "--name",
    "MyWidget",
  ]);
  expect(await normalizeConversionArgs("reverse", ["src/URLView.jsx"])).toEqual(
    [
      "--javascript",
      "--source",
      "src/URLView.jsx",
      "--out",
      "src/pages/url-view",
      "--name",
      "URLView",
    ],
  );
  expect(
    await normalizeConversionArgs("check", ["123.astro", "--name", "Chosen"]),
  ).toEqual([
    "--javascript",
    "--source",
    "123.astro",
    "--name",
    "Chosen",
    "--out",
    "native/generated",
  ]);
});

test("JSON shortcuts derive names from the filename while content chooses the route", async () => {
  for (const [file, value, route, slug, name] of [
    [
      "App.javascript.json",
      { kind: "astro-fyne-javascript" },
      ["--javascript", "--program"],
      "app",
      "App",
    ],
    [
      "my-card.scene.json",
      { schema: 2, roots: [] },
      ["--scene"],
      "my-card",
      "MyCard",
    ],
    [
      "old.program.json",
      { kind: "astro-fyne-program" },
      ["--program"],
      "old",
      "Old",
    ],
  ] as const) {
    const input = join(directory, file);
    await writeFile(input, JSON.stringify(value));
    expect(await normalizeConversionArgs("reverse", [input])).toEqual([
      ...route,
      input,
      "--out",
      `src/pages/${slug}`,
      "--name",
      name,
    ]);
    expect(
      await normalizeConversionArgs("generate", [
        input,
        "--out",
        "chosen",
        "--name",
        "Explicit",
      ]),
    ).toEqual([...route, input, "--out", "chosen", "--name", "Explicit"]);
  }
});

async function sourceFixture() {
  const css =
    "\ufeff/* Retain CSS bytes. */\r\n@import './palette.css';\r\n.card:has(>button){color:var(--accent)}\r\n";
  const palette = ":root{--accent:#123456}\r\n";
  await writeFile(join(directory, "app.css"), css);
  await writeFile(join(directory, "palette.css"), palette);
  await writeFile(
    join(directory, "App.tsx"),
    'import "./app.css";export default function App(){return <section class="card"><button id="run">Convert</button></section>}',
  );
  return new Map([
    ["app.css", css],
    ["palette.css", palette],
  ]);
}

async function retainedCSS(
  out: string,
  name: string,
  expected: Map<string, string>,
) {
  const manifest = JSON.parse(
    await readFile(join(out, `${name}.css-sources.json`), "utf8"),
  );
  expect(manifest.stylesheets).toHaveLength(expected.size);
  for (const sheet of manifest.stylesheets) {
    expect(expected.has(sheet.path)).toBe(true);
    expect(await readFile(join(out, sheet.file), "utf8")).toBe(
      expected.get(sheet.path),
    );
  }
  return manifest;
}

test("real CLI file shortcuts retain CSS through generated Go, web and restored Go from another cwd", async () => {
  const css = await sourceFixture();
  expect(success(["to-fyne", "App.tsx"], launcher)).toContain(
    "native Fyne (Goja)",
  );
  const nativeOut = join(directory, "native/generated");
  const code = await readFile(join(nativeOut, "App.gen.go"), "utf8");
  expect(code).toContain("func NewApp(");
  const literal = code.match(
    /^const AppJavascriptArchive = ("(?:[^"\\]|\\.)*")$/m,
  );
  expect(literal).not.toBeNull();
  const archive = JSON.parse(JSON.parse(literal![1]!)) as JavascriptArchive;
  expect(archive.kind).toBe("astro-fyne-javascript");
  await retainedCSS(nativeOut, "App", css);
  const report = JSON.parse(
    await readFile(join(nativeOut, "App.javascript.report.json"), "utf8"),
  );
  expect(report.runtime).toBe("goja-pure-go");
  expect(report.visual.pixelPerfectVerified).toBe(false);
  await writeFile(join(directory, "App.program.json"), JSON.stringify(archive));
  success(["to-web", "App.program.json"], launcher);
  const webOut = join(directory, "src/pages/app");
  expect(await readFile(join(webOut, "App.astro"), "utf8")).toContain(
    'client:only="preact"',
  );
  const manifest = await retainedCSS(webOut, "App", css);
  success(["to-web", "App.program.json", "--check"]);
  const restored = [
    "to-fyne",
    "App.program.json",
    "--out",
    "restored",
    "--name",
    "Restored",
  ];
  success(restored);
  success([...restored, "--check"]);
  await retainedCSS(join(directory, "restored"), "Restored", css);
  const retained = join(webOut, manifest.stylesheets[0].file);
  await writeFile(retained, "/* handwritten CSS */\n");
  await rm(join(webOut, "App.astro"));
  const protectedResult = run(["to-web", "App.program.json"]);
  expect(protectedResult.status).toBe(1);
  expect(protectedResult.stderr).toContain("not owned by the generator");
  expect(await readFile(retained, "utf8")).toBe("/* handwritten CSS */\n");
  await expect(stat(join(webOut, "App.astro"))).rejects.toThrow();
}, 60_000);

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
function scene(responsive: boolean): SceneDocument {
  return {
    schema: responsive ? 2 : 1,
    ...(responsive ? { layout: "flex" as const } : {}),
    viewport: { width: 160, height: 80, scale: 1 },
    roots: [
      {
        id: "root",
        kind: "container",
        style: { ...style },
        children: [],
        ...(responsive
          ? {
              sourceStyle: {
                ...style,
                measured: false as const,
                display: "flex",
                flex: {
                  widthSet: true,
                  widthPercent: 100,
                  heightSet: true,
                  boxSizing: "border-box" as const,
                },
              },
            }
          : {}),
      },
    ],
    tokens: {},
    resources: [],
    requiredActions: [],
  };
}

test("real CLI detects portable programs and both scene schemas in either direction", async () => {
  const source = join(directory, "Page.tsx");
  await writeFile(
    source,
    'export default function Page(){return <div id="root">Portable</div>}',
  );
  const portable = createProgramArchive(await compile(source));
  for (const [file, document, reportSuffix] of [
    ["Portable.program.json", portable, "program.report.json"],
    ["Fixed.scene.json", scene(false), "reverse.report.json"],
    ["Responsive.scene.json", scene(true), "reverse.report.json"],
  ] as const) {
    await writeFile(join(directory, file), JSON.stringify(document));
    const out = `${file}-web`;
    success(["to-web", file, "--out", out, "--name", "Chosen"]);
    expect(
      await readFile(join(directory, out, "Chosen.astro"), "utf8"),
    ).toContain("Chosen");
    expect(
      JSON.parse(
        await readFile(join(directory, out, `Chosen.${reportSuffix}`), "utf8"),
      ).generator,
    ).toBe("astro-fyne");
    success(["to-web", file, "--out", out, "--name", "Chosen", "--check"]);
    const nativeOut = `${file}-native`;
    success(["to-fyne", file, "--out", nativeOut, "--name", "Chosen"]);
    expect(
      await readFile(join(directory, nativeOut, "Chosen.gen.go"), "utf8"),
    ).toContain("func NewChosen(");
    success([
      "to-fyne",
      file,
      "--out",
      nativeOut,
      "--name",
      "Chosen",
      "--check",
    ]);
  }
}, 60_000);

test("Astro source shortcuts use Goja and read-only checks do not create output", async () => {
  await writeFile(
    join(directory, "hello-world.astro"),
    '<section id="hello">Hello Astro</section>',
  );
  const check = run(["to-fyne", "hello-world.astro", "--check"]);
  expect(check.status).toBe(1);
  expect(check.stderr).toContain("out of date");
  await expect(stat(join(directory, "native"))).rejects.toThrow();
  success(["to-fyne", "hello-world.astro"]);
  const code = await readFile(
    join(directory, "native/generated/HelloWorld.gen.go"),
    "utf8",
  );
  expect(code).toContain("JavascriptArchive");
  success(["check", "hello-world.astro"]);
}, 30_000);

test("JSON auto-detection rejects unknown formats and invalid recognized archives before output", async () => {
  const input = join(directory, "invalid.json");
  for (const value of [
    null,
    [],
    { schema: 3, roots: [] },
    { schema: 1, roots: [], kind: "another-format" },
    { schema: 1, entries: [] },
    { schema: 1, kind: "astro-fyne-javascript" },
    { schema: 1, kind: "astro-fyne-program" },
  ]) {
    await writeFile(input, JSON.stringify(value));
    for (const command of ["to-fyne", "to-web"]) {
      const result = run([command, "invalid.json"]);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(await readdir(directory)).toEqual(["invalid.json"]);
    }
  }
  await writeFile(input, "{");
  const result = run(["to-web", "invalid.json"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    `Invalid JSON in conversion input file: ${input}`,
  );
  expect(await readdir(directory)).toEqual(["invalid.json"]);
}, 60_000);

test("file shortcuts reject ambiguous inputs while preserving flag diagnostics and help without reads", async () => {
  for (const [args, message] of [
    [["to-fyne", "App.tsx", "Other.tsx"], "Only one input file"],
    [
      ["to-fyne", "App.tsx", "--source", "Other.tsx"],
      "Use one positional input",
    ],
    [
      ["to-fyne", "App.tsx", "--config", "config.json"],
      "Use one positional input",
    ],
    [
      ["to-web", "App.json", "--program", "Other.json"],
      "Use one positional input",
    ],
    [
      ["to-web", "App.json", "--scene", "Other.json"],
      "Use one positional input",
    ],
    [
      ["to-web", "main.go"],
      "Export your Fyne view as scene or program JSON first",
    ],
    [["to-fyne", "styles.css"], "Use an Astro/Preact source file"],
    [
      ["to-fyne", "App.tsx", "--unknown"],
      "Unknown JavaScript option: --unknown",
    ],
    [["to-fyne", "App.tsx", "--name"], "Missing value for --name"],
    [
      ["to-fyne", "App.tsx", "--out", "one", "--out", "two"],
      "Duplicate option: --out",
    ],
    [
      ["to-fyne", "--javascript", "--out", "one", "App.tsx"],
      "Unknown JavaScript option: App.tsx",
    ],
  ] as const) {
    const result = run([...args]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(await readdir(directory)).toEqual([]);
  }
  for (const command of ["to-fyne", "to-web"]) {
    expect(success([command, "missing.json", "--help"])).toContain(
      "File shortcut:",
    );
    expect(await readdir(directory)).toEqual([]);
  }
}, 60_000);
