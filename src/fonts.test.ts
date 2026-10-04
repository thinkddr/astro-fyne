// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  fontsCSS,
  inspectFont,
  loadFonts,
  validateFontFaces,
} from "./fonts.ts";
import { compile } from "./parser.ts";
import { emitGo, sourceHash } from "./emit.ts";
import { generate } from "./cli.ts";

const bytes = await readFile(
  resolve(import.meta.dir, "../example/public/fonts/NotoSans-Regular.ttf"),
);
const boldBytes = await readFile(
  resolve(import.meta.dir, "../example/public/fonts/NotoSans-Bold.ttf"),
);
const face = {
  family: "AstroNoto",
  weight: 400 as const,
  style: "normal" as const,
  source: "regular.ttf",
  webSrc: "/fonts/regular.ttf",
};
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "astro-fyne-fonts-"));
  await writeFile(join(directory, "regular.ttf"), bytes);
  await writeFile(
    join(directory, "Page.tsx"),
    'export default function Page() { return <div id="root">Visible text</div>; }',
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("licensed static TTF is bound by bytes, face, CSS alias and browser URL", async () => {
  inspectFont(bytes, face);
  const fonts = await loadFonts([face], directory);
  expect(Buffer.from(fonts[0]!.content, "base64")).toEqual(bytes);
  expect(fonts[0]!.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(fontsCSS(fonts)).toContain('font-family: "AstroNoto"');
  expect(fontsCSS(fonts)).toContain(
    'src: url("/fonts/regular.ttf") format("truetype")',
  );
  const program = await compile(join(directory, "Page.tsx"), undefined, {
    root: directory,
    fonts: [face],
  });
  expect(program.sources).toContainEqual({
    path: "regular.ttf",
    hash: fonts[0]!.hash,
  });
  const go = emitGo(program, { name: "Page", packageName: "generated" });
  expect(go).toContain("func NewPageBackend() webui.FyneBackend");
  expect(go).toContain('"AstroNoto": {{Weight: 400, Italic: false}: fontPage_');
  expect(go).toContain("if len(backends) == 0");
  expect(go).toContain("generated.Fonts = map[fyne.TextStyle]fyne.Resource");
  expect(go).toContain('"regular.ttf": fontPage_');
});

test("font binding edits invalidate source hash even when bytes stay identical", async () => {
  const first = await compile(join(directory, "Page.tsx"), undefined, {
    root: directory,
    fonts: [face],
  });
  for (const edit of [{ family: "OtherAlias" }, { webSrc: "/other.ttf" }]) {
    const changed = await compile(join(directory, "Page.tsx"), undefined, {
      root: directory,
      fonts: [{ ...face, ...edit }],
    });
    expect(changed.sources).toEqual(first.sources);
    expect(sourceHash(changed)).not.toBe(sourceHash(first));
  }
  const bare = await compile(join(directory, "Page.tsx"), undefined, {
    root: directory,
  });
  expect(bare.fonts).toBeUndefined();
  expect(sourceHash(bare)).not.toBe(sourceHash(first));
});

test("config rejects implicit faces, fallback lists, URLs, duplicate faces and ambiguous families", () => {
  for (const value of [
    null,
    [],
    [{ ...face, weight: 600 }],
    [{ ...face, style: "oblique" }],
    [{ ...face, family: "Noto, sans-serif" }],
    [{ ...face, family: " Noto" }],
    [{ ...face, source: "/private/font.ttf" }],
    [{ ...face, webSrc: "https://example.com/font.ttf" }],
    [{ ...face, webSrc: "/../font.ttf" }],
    [{ ...face, webSrc: "/font.ttf?x" }],
    [{ ...face, unknown: true }],
    [face, { ...face }],
    [face, { ...face, family: "ASTRONOTO", weight: 700 }],
  ])
    expect(() => validateFontFaces(value)).toThrow();
});

test("TTF validation rejects corrupt payloads and synthesized weight or italic", () => {
  for (const changed of [
    Buffer.from("not a font"),
    bytes.subarray(0, 20),
    Buffer.from(bytes),
  ]) {
    if (changed.length === bytes.length)
      changed[changed.length - 16] = changed[changed.length - 16]! ^ 1;
    expect(() => inspectFont(changed, face)).toThrow();
  }
  expect(() => inspectFont(bytes, { weight: 700, style: "normal" })).toThrow(
    "do not match",
  );
  expect(() => inspectFont(bytes, { weight: 400, style: "italic" })).toThrow(
    "do not match",
  );
  const collection = Buffer.from(bytes);
  collection.write("ttcf", 0);
  expect(() => inspectFont(collection, face)).toThrow("static TrueType");
});

test("font symlinks cannot include files outside the public project", async () => {
  const linked = join(directory, "outside.ttf");
  await symlink(
    resolve(import.meta.dir, "../example/public/fonts/NotoSans-Regular.ttf"),
    linked,
  );
  await expect(
    loadFonts([{ ...face, source: "outside.ttf" }], directory),
  ).rejects.toThrow("escapes the project");
  await expect(
    loadFonts([{ ...face, source: "missing.ttf" }], directory),
  ).rejects.toThrow();
});

test("emitter rejects tampered embedded fonts and repeated native resource names", async () => {
  const program = await compile(join(directory, "Page.tsx"), undefined, {
    root: directory,
    fonts: [face],
  });
  const font = program.fonts![0]!;
  font.content = Buffer.from("corrupt").toString("base64");
  expect(() =>
    emitGo(program, { name: "Page", packageName: "generated" }),
  ).toThrow("SHA-256");
  font.content = bytes.toString("base64") + "\n";
  expect(() =>
    emitGo(program, { name: "Page", packageName: "generated" }),
  ).toThrow("SHA-256");
  font.content = bytes.toString("base64");
  program.fonts!.push({ ...font, family: "OtherAlias" });
  expect(() =>
    emitGo(program, { name: "Page", packageName: "generated" }),
  ).toThrow("duplicate");
});

test("multiple CSS aliases for one file keep one native resource inventory key", async () => {
  const program = await compile(join(directory, "Page.tsx"), undefined, {
    root: directory,
    fonts: [face, { ...face, family: "OtherAlias" }],
  });
  const go = emitGo(program, { name: "Page", packageName: "generated" });
  expect(go.split('"regular.ttf": fontPage_')).toHaveLength(2);
  expect(go).not.toContain("generated.Fonts =");
  expect(go).toContain(
    '"OtherAlias": {{Weight: 400, Italic: false}: fontPage_',
  );
});

test("a browser font URL cannot be bound to different native bytes", async () => {
  await writeFile(join(directory, "bold.ttf"), boldBytes);
  const bold = { ...face, weight: 700 as const, source: "bold.ttf" };
  await expect(loadFonts([face, bold], directory)).rejects.toThrow(
    "different hashes",
  );
  const program = await compile(join(directory, "Page.tsx"), undefined, {
    root: directory,
    fonts: [face, { ...bold, webSrc: "/fonts/bold.ttf" }],
  });
  expect(program.fonts).toHaveLength(2);
  expect(emitGo(program, { name: "Page", packageName: "generated" })).toContain(
    "{Bold: true, Italic: false}",
  );
  program.fonts![1]!.webSrc = face.webSrc;
  expect(() =>
    emitGo(program, { name: "Page", packageName: "generated" }),
  ).toThrow("different hashes");
});

test("CLI generates matching web fonts CSS, native backend, theme and resource inventory atomically", async () => {
  const path = join(directory, "config.json");
  await writeFile(
    path,
    JSON.stringify({
      schema: 1,
      package: "generated",
      entries: [
        {
          name: "Page",
          source: "Page.tsx",
          output: "page.gen.go",
          fonts: [face],
        },
      ],
    }),
  );
  await generate({ config: path, check: false });
  await generate({ config: path, check: true });
  const report = JSON.parse(
    await readFile(join(directory, "page.gen.report.json"), "utf8"),
  );
  expect(report.fonts[0]).toMatchObject({
    family: face.family,
    weight: 400,
    style: "normal",
    webSrc: face.webSrc,
  });
  expect(report.fonts[0].content).toBeUndefined();
  expect(report.visual.pixelPerfectVerified).toBe(false);
  expect(
    await readFile(join(directory, "page.gen.fonts.css"), "utf8"),
  ).toContain("@font-face");
  await writeFile(join(directory, "regular.ttf"), "corrupt");
  await expect(generate({ config: path, check: false })).rejects.toThrow(
    "TrueType",
  );
  expect(
    JSON.parse(await readFile(join(directory, "page.gen.report.json"), "utf8")),
  ).toEqual(report);
});

test("handwritten web font CSS blocks all generated artifacts", async () => {
  const path = join(directory, "config.json");
  await writeFile(
    path,
    JSON.stringify({
      schema: 1,
      package: "generated",
      entries: [
        {
          name: "Page",
          source: "Page.tsx",
          output: "page.gen.go",
          fonts: [face],
        },
      ],
    }),
  );
  await writeFile(
    join(directory, "page.gen.fonts.css"),
    "/* maintained by hand */\n",
  );
  await expect(generate({ config: path, check: false })).rejects.toThrow(
    "not owned by the generator",
  );
  await expect(readFile(join(directory, "page.gen.go"))).rejects.toThrow();
});
