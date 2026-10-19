// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateCatalogue } from "./catalogue-cli.ts";
import {
  catalogueHash,
  withCatalogueIslandState,
  type CatalogueComponent,
  type CatalogueSpec,
} from "./catalogue.ts";
import { bundleJavascript } from "./javascript.ts";
import type {
  JavascriptAPI,
  JavascriptArchive,
  JavascriptFactory,
  JavascriptFrame,
} from "./javascript-types.ts";
import { compile } from "./parser.ts";
import { createProgramArchive } from "./program.ts";
import { inspectFont } from "./fonts.ts";
import type { MotionSpec } from "./motion.ts";
import type { SceneDocument, SceneStyle } from "./reverse.ts";

const launcher = fileURLToPath(
  new URL("../bin/astro-fyne.ts", import.meta.url),
);
const fontFile = new URL(
  "../example/public/fonts/NotoSans-Regular.ttf",
  import.meta.url,
);
const fontLicense = new URL(
  "../example/public/fonts/LICENSE-NotoSans.txt",
  import.meta.url,
);
const nativeRoot = fileURLToPath(new URL("../native", import.meta.url));
let directory: string;
beforeEach(async () => {
  directory = await realpath(
    await mkdtemp(join(tmpdir(), "astro-fyne-catalogue-cli-")),
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const style: SceneStyle = {
  x: 0,
  y: 0,
  width: 320,
  height: 240,
  paddingTop: 8,
  paddingRight: 8,
  paddingBottom: 8,
  paddingLeft: 8,
  gap: 4,
  direction: "column",
  background: "#ffffff",
  color: "#123456",
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
function scene(): SceneDocument {
  return {
    schema: 1,
    viewport: { width: 320, height: 240, scale: 1 },
    roots: [
      {
        id: "root",
        kind: "container",
        style: { ...style },
        children: [
          {
            id: "greeting",
            kind: "text",
            text: "Retained scene",
            style: { ...style, width: 180, height: 24 },
            children: [],
          },
        ],
      },
    ],
    resources: [],
    tokens: {},
    requiredActions: [],
  };
}
function component(
  id: string,
  kind: CatalogueComponent["kind"],
  document: unknown,
): CatalogueComponent {
  const payload = JSON.stringify(document, null, 1) + "\n";
  return {
    id,
    kind,
    payload,
    hash: catalogueHash(payload),
    stylesheets: [],
    fontFaces: [],
    actions: [],
  };
}
function emptyCatalogue(name: string): CatalogueSpec {
  return {
    schema: 1,
    kind: "astro-fyne-catalogue",
    name,
    resources: [],
    stylesheets: [],
    fontFaces: [],
    themes: [],
    layouts: [],
    components: [],
    islands: [],
  };
}
async function fixture(actions = false) {
  await mkdir(join(directory, "components"));
  await mkdir(join(directory, "styles"));
  await writeFile(
    join(directory, "styles/card.css"),
    '\ufeff/* café 🙂 */\r\n@import "./palette.css";\r\n.card:has(>button){color:var(--accent);font-family:CatalogueSans}\r\n',
  );
  await writeFile(
    join(directory, "styles/palette.css"),
    ":root{--accent:#123456}\r\n",
  );
  const source = join(directory, "components/Counter.tsx");
  await writeFile(
    source,
    `import {useState} from "preact/hooks";import "../styles/card.css";
export default function Counter({label="Count",observe}){
 const [count,setCount]=useState(0);
 return <section class="card"><span id="count">{label}:{count}</span><button id="increment" onClick={()=>{setCount(value=>value+1);${actions ? 'observe("increment");' : ""}}}>Increment</button></section>;
}`,
  );
  const archive = await bundleJavascript(
    source,
    "default",
    { label: "Count" },
    actions ? ["observe"] : [],
  );
  const font = await readFile(fontFile),
    license = await readFile(fontLicense, "utf8"),
    opaque = Buffer.from([0, 255, 17, 128, 10]),
    counter = component("counter", "javascript", archive);
  counter.stylesheets = (archive.stylesheets ?? []).map(
    (_, index) => `sheet${index}`,
  );
  counter.fontFaces = ["regular"];
  counter.theme = "light";
  counter.layout = "stack";
  counter.actions = [...archive.actions];
  const spec: CatalogueSpec = {
    schema: 1,
    kind: "astro-fyne-catalogue",
    name: "Library",
    resources: [
      {
        name: "fonts/regular.ttf",
        mediaType: "font/ttf",
        hash: catalogueHash(font),
        content: font.toString("base64"),
        license,
      },
      {
        name: "data/fixture.bin",
        mediaType: "application/octet-stream",
        hash: catalogueHash(opaque),
        content: opaque.toString("base64"),
        license: "CC0-1.0\nTest fixture bytes.\n",
      },
    ],
    stylesheets: (archive.stylesheets ?? []).map((sheet, index) => ({
      id: `sheet${index}`,
      path: sheet.path,
      hash: sheet.hash,
      content: Buffer.from(sheet.text).toString("base64"),
    })),
    fontFaces: [
      {
        id: "regular",
        family: "CatalogueSans",
        weight: 400,
        style: "normal",
        resource: "fonts/regular.ttf",
        hash: catalogueHash(font),
      },
    ],
    themes: [
      {
        id: "light",
        tokens: { "--color-primary": "#123456", "--fyne-size-padding": "8px" },
        fontFaces: ["regular"],
      },
    ],
    layouts: [
      {
        id: "stack",
        style: {
          ...style,
          measured: false,
          display: "flex",
          flex: { boxSizing: "border-box", alignItems: "stretch" },
        },
      },
    ],
    components: [counter],
    islands: [
      { id: "left", component: "counter", key: "same-key" },
      { id: "right", component: "counter", key: "same-key" },
    ],
  };
  expect(spec.stylesheets).toHaveLength(2);
  expect(
    spec.stylesheets.some((sheet) => sheet.path.startsWith("../styles/")),
  ).toBe(true);
  return { spec, archive };
}
async function save(spec: CatalogueSpec, name = "Library.catalogue.json") {
  const path = join(directory, name),
    source = JSON.stringify(spec, null, 2) + "\r\n";
  await writeFile(path, source);
  return { path, source };
}
async function tree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`,
        file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file, `${name}/`);
      else files[name] = (await readFile(file)).toString("base64");
    }
  }
  await visit(root, "");
  return files;
}
function find(frames: JavascriptFrame[], id: string): JavascriptFrame {
  for (const frame of frames) {
    if (frame.attrs?.id === id) return frame;
    try {
      return find(frame.children ?? [], id);
    } catch {}
  }
  throw new Error(`Missing fixture node ${id}`);
}
function text(frame: JavascriptFrame): string {
  return frame.tag === "#text"
    ? (frame.text ?? "")
    : (frame.children ?? []).map(text).join("");
}
function mount(
  archive: JavascriptArchive,
  factory: JavascriptFactory = eval(`(${archive.code})`),
  effects: string[] = [],
): JavascriptAPI {
  const api = factory((kind, name) => {
    if (kind === "action") {
      effects.push(name);
      return null;
    }
    if (kind === "random") return 0.25;
    if (kind === "now") return 1000;
    throw new Error(`Unexpected host effect ${kind}`);
  }, archive);
  api.flush();
  for (const event of archive.events) {
    api.replay(event);
    api.flush();
  }
  api.finishReplay();
  return api;
}
async function generatedArchive(out: string, name: string) {
  const wrapper = await readFile(
    join(out, `_${name}-javascript/${name}.tsx`),
    "utf8",
  );
  const literal = wrapper.match(
    /const archive=JSON\.parse\(("(?:[^"\\]|\\.)*")\)/,
  );
  expect(literal).not.toBeNull();
  const archive = JSON.parse(JSON.parse(literal![1]!)) as JavascriptArchive;
  const module = await import(
    pathToFileURL(join(out, `_${name}-javascript/program.js`)).href
  );
  return { archive, factory: module.default as JavascriptFactory, wrapper };
}
async function compileNative(out: string, testSource: string) {
  const ignored = join(nativeRoot, ".program-roundtrip");
  await mkdir(ignored, { recursive: true });
  const generated = await mkdtemp(join(ignored, "catalogue-cli-"));
  try {
    for (const file of await readdir(out))
      if (file.endsWith(".go"))
        await writeFile(join(generated, file), await readFile(join(out, file)));
    await writeFile(join(generated, "catalogue_test.go"), testSource);
    const result = spawnSync(
      "go",
      [
        "test",
        "-count=1",
        "-p=1",
        "-tags",
        "ci",
        `./${relative(nativeRoot, generated)}`,
      ],
      {
        cwd: nativeRoot,
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, GOMAXPROCS: "2" },
      },
    );
    expect(result.error).toBeUndefined();
    if (result.status !== 0)
      throw new Error(
        `Generated catalogue did not compile or run:\n${result.stdout}\n${result.stderr}`,
      );
    expect(result.stdout).toContain("ok");
  } finally {
    await rm(generated, { recursive: true, force: true });
  }
}

test("catalogue generation retains exact licensed font, resource, CSS and archive bytes in both directions", async () => {
  const { spec, archive } = await fixture(),
    input = await save(spec);
  for (const direction of ["native", "web"] as const) {
    const out = join(directory, direction),
      options = {
        catalogue: input.path,
        out,
        name: "Library",
        direction,
      };
    await generateCatalogue(options);
    await generateCatalogue({ ...options, check: true });
    for (const resource of spec.resources) {
      const suffix = resource.mediaType === "font/ttf" ? "ttf" : "bin",
        path = join(out, `Library.catalogue-assets/${resource.hash}.${suffix}`);
      expect(await readFile(path)).toEqual(
        Buffer.from(resource.content, "base64"),
      );
      expect(await readFile(`${path}.license.txt`, "utf8")).toBe(
        resource.license,
      );
    }
    for (const sheet of spec.stylesheets)
      expect(
        await readFile(join(out, `Library.css-sources/${sheet.hash}.css`)),
      ).toEqual(Buffer.from(sheet.content, "base64"));
    const report = JSON.parse(
      await readFile(join(out, "Library.catalogue.report.json"), "utf8"),
    );
    expect(report.sourceHash).toBe(catalogueHash(input.source));
    expect(report.archiveFile).toBe(
      `Library.catalogue-sources/${catalogueHash(input.source)}.json`,
    );
    expect(await readFile(join(out, report.archiveFile), "utf8")).toBe(
      input.source,
    );
    expect(report.direction).toBe(direction);
    expect(report.components).toEqual([
      { id: "counter", kind: "javascript", hash: spec.components[0]!.hash },
    ]);
    expect(report.stylesheetSources).toEqual(
      spec.stylesheets.map(({ content: _content, ...sheet }) => sheet),
    );
    expect(report.resources[0].content).toBeUndefined();
    expect(report.visual.pixelPerfectVerified).toBe(false);
    expect(await readFile(join(out, "Library.fonts.css"), "utf8")).toContain(
      `Library.catalogue-assets/${spec.fontFaces[0]!.hash}.ttf`,
    );
    if (direction === "native") {
      const code = await readFile(
        join(out, "Library.catalogue.gen.go"),
        "utf8",
      );
      expect(code).toContain(
        "func NewLibraryCatalogue() (*catalog.Registry, error)",
      );
      expect(code).toContain("catalog.Parse([]byte(LibraryCatalogueArchive))");
      const embedded = code.match(
        /^const LibraryCatalogueArchive = ("(?:[^"\\]|\\.)*")$/m,
      );
      expect(embedded).not.toBeNull();
      expect(JSON.parse(embedded![1]!)).toBe(input.source);
      expect(code).not.toContain('RegisterFactory("counter"');
      await compileNative(
        out,
        `package generated
import("testing";"fyne.io/fyne/v2/test";"github.com/thinkddr/astro-fyne/native/javascript")
func TestGeneratedJavascriptCatalogue(t *testing.T){
 app:=test.NewApp();defer app.Quit()
 registry,err:=NewLibraryCatalogue();if err!=nil{t.Fatal(err)}
 left,err:=registry.NewIsland("left",nil);if err!=nil{t.Fatal(err)}
 right,err:=registry.NewIsland("right",nil);if err!=nil{t.Fatal(err)}
 if left==right{t.Fatal("islands share a native widget")}
 for _,item:=range []*javascript.Widget{left.(*javascript.Widget),right.(*javascript.Widget)}{
  defer item.Close();if item.Object("count")==nil{t.Fatal("missing rendered counter")}
  archive,err:=item.ExportJavascript();if err!=nil||len(archive.Stylesheets)!=2{t.Fatalf("CSS archive lost: %v",err)}
 }
}`,
      );
    } else {
      const generated = await generatedArchive(out, "LibraryComponent0");
      expect(generated.archive).toEqual(archive);
      const index = await readFile(join(out, "Library.catalogue.tsx"), "utf8");
      expect(index).toContain('import "./Library.fonts.css"');
      expect(index).toContain('"counter":LibraryComponent0');
      expect(index).toContain('"--color-primary":"#123456"');
      expect(index).toContain('"stack":');
      const page = await readFile(join(out, "Library.astro"), "utf8");
      expect(page).toContain(
        '<LibraryIsland id="left" client:only="preact" />',
      );
      expect(page).toContain(
        '<LibraryIsland id="right" client:only="preact" />',
      );
    }
  }
}, 180_000);

test("generated island checkpoints preserve independent state and explicit actions for equal source keys", async () => {
  const { spec, archive } = await fixture(true),
    effects: string[] = [],
    left = mount(archive, undefined, effects),
    right = mount(archive, undefined, effects);
  let checkpoint: JavascriptArchive;
  try {
    left.dispatch({
      node: find(left.snapshot(), "increment").uid,
      type: "click",
    });
    left.flush();
    expect(text(find(left.snapshot(), "count"))).toBe("Count:1");
    expect(text(find(right.snapshot(), "count"))).toBe("Count:0");
    expect(effects).toEqual(["observe"]);
    checkpoint = left.export();
  } finally {
    left.dispose();
    right.dispose();
  }
  const captured = await withCatalogueIslandState(
    spec,
    "left",
    JSON.stringify(checkpoint!),
  );
  expect(spec.islands[0]!.statePayload).toBeUndefined();
  expect(captured.islands[1]!.statePayload).toBeUndefined();
  const input = await save(captured),
    out = join(directory, "web");
  await generateCatalogue({
    catalogue: input.path,
    out,
    name: "Library",
    direction: "web",
    actionsModule: "./actions.ts",
  });
  const restored = await generatedArchive(out, "LibraryIsland0"),
    prototype = await generatedArchive(out, "LibraryComponent0"),
    restoredEffects: string[] = [],
    restoredLeft = mount(restored.archive, restored.factory, restoredEffects),
    restoredRight = mount(
      prototype.archive,
      prototype.factory,
      restoredEffects,
    );
  try {
    expect(text(find(restoredLeft.snapshot(), "count"))).toBe("Count:1");
    expect(text(find(restoredRight.snapshot(), "count"))).toBe("Count:0");
    expect(restoredEffects).toEqual([]);
    expect(restored.archive.stylesheets).toEqual(archive.stylesheets);
    expect(restored.archive.codeHash).toBe(prototype.archive.codeHash);
    const actionImport = restored.wrapper.match(
      /import\(("(?:[^"\\]|\\.)*")\)/,
    );
    expect(actionImport).not.toBeNull();
    expect(
      resolve(
        dirname(join(out, "_LibraryIsland0-javascript/LibraryIsland0.tsx")),
        JSON.parse(actionImport![1]!),
      ),
    ).toBe(join(out, "actions.ts"));
    for (let count = 0; count < 2; count++) {
      restoredRight.dispatch({
        node: find(restoredRight.snapshot(), "increment").uid,
        type: "click",
      });
      restoredRight.flush();
    }
    expect(text(find(restoredRight.snapshot(), "count"))).toBe("Count:2");
    expect(text(find(restoredLeft.snapshot(), "count"))).toBe("Count:1");
    expect(restoredEffects).toEqual(["observe", "observe"]);
    expect(restoredLeft.export().events).toHaveLength(1);
  } finally {
    restoredLeft.dispose();
    restoredRight.dispose();
  }
  const index = await readFile(join(out, "Library.catalogue.tsx"), "utf8");
  expect(index).toContain('"left":LibraryIsland0,"right":LibraryComponent0');
  expect(index).toContain("ref:handleRef,key:id");
  const report = JSON.parse(
    await readFile(join(out, "Library.catalogue.report.json"), "utf8"),
  );
  expect(
    JSON.parse(await readFile(join(out, report.archiveFile), "utf8")),
  ).toEqual(captured);
}, 60_000);

test("catalogue checks are read-only and handwritten exact assets block all pending output", async () => {
  const { spec } = await fixture(),
    input = await save(spec),
    out = join(directory, "web"),
    options = {
      catalogue: input.path,
      out,
      name: "Library",
      direction: "web" as const,
    };
  await expect(generateCatalogue({ ...options, check: true })).rejects.toThrow(
    "out of date",
  );
  await expect(stat(out)).rejects.toThrow();
  await generateCatalogue(options);
  const initial = await tree(out);
  await generateCatalogue({ ...options, check: true });
  expect(await tree(out)).toEqual(initial);
  const index = join(out, "Library.catalogue.tsx");
  await writeFile(index, (await readFile(index, "utf8")) + "// drift\n");
  const drift = await tree(out);
  await expect(generateCatalogue({ ...options, check: true })).rejects.toThrow(
    "out of date",
  );
  expect(await tree(out)).toEqual(drift);
  await generateCatalogue(options);
  expect(await tree(out)).toEqual(initial);
  const sheet = spec.stylesheets[0]!,
    retained = join(out, `Library.css-sources/${sheet.hash}.css`);
  await writeFile(retained, "/* Handwritten CSS. */\r\n");
  const handwritten = await tree(out);
  const added = Buffer.from([222]);
  spec.resources.push({
    name: "data/added.bin",
    mediaType: "application/octet-stream",
    hash: catalogueHash(added),
    content: added.toString("base64"),
    license: "CC0-1.0",
  });
  await writeFile(input.path, JSON.stringify(spec) + "\n");
  await expect(generateCatalogue(options)).rejects.toThrow(
    "not owned by the generator",
  );
  expect(await tree(out)).toEqual(handwritten);
  expect(await readFile(retained, "utf8")).toBe("/* Handwritten CSS. */\r\n");
}, 60_000);

test("a late invalid component or missing action binding leaves native, web and public destinations untouched", async () => {
  const { spec } = await fixture(true);
  spec.components.unshift(component("scene", "scene", scene()));
  const input = await save(spec),
    out = join(directory, "web"),
    publicDir = join(directory, "public");
  await expect(
    generateCatalogue({
      catalogue: input.path,
      out,
      publicDir,
      name: "Library",
      direction: "web",
    }),
  ).rejects.toThrow("actions-module");
  await expect(stat(out)).rejects.toThrow();
  await expect(stat(publicDir)).rejects.toThrow();
  const invalid = structuredClone(spec);
  invalid.components[1]!.payload += " ";
  await save(invalid);
  for (const direction of ["native", "web"] as const) {
    const destination = join(directory, direction);
    await expect(
      generateCatalogue({
        catalogue: input.path,
        out: destination,
        name: "Library",
        direction,
        ...(direction === "web" ? { actionsModule: "./actions.ts" } : {}),
      }),
    ).rejects.toThrow("digest");
    await expect(stat(destination)).rejects.toThrow();
  }
}, 60_000);

test("scene and portable-program factories retain their own styles and embedded fonts in aggregate output", async () => {
  const source = join(directory, "Portable.tsx");
  await writeFile(
    source,
    "export default function Portable(){return <p>Portable text</p>}",
  );
  const regular = await readFile(fontFile),
    document = scene();
  document.roots[0]!.style.fontFamily = "PortableSans";
  document.roots[0]!.children[0]!.style.fontFamily = "PortableSans";
  await writeFile(join(directory, "regular.ttf"), regular);
  const program = await compile(source, undefined, {
    root: directory,
    fonts: [
      {
        family: "PortableSans",
        source: "regular.ttf",
        webSrc: "/fonts/portable.ttf",
        weight: 400,
        style: "normal",
      },
    ],
  });
  const spec: CatalogueSpec = {
    schema: 1,
    kind: "astro-fyne-catalogue",
    name: "Mixed",
    resources: [
      {
        name: "fonts/regular.ttf",
        mediaType: "font/ttf",
        hash: catalogueHash(regular),
        content: regular.toString("base64"),
        license: await readFile(fontLicense, "utf8"),
      },
    ],
    stylesheets: [],
    fontFaces: [
      {
        id: "regular",
        family: "PortableSans",
        weight: 400,
        style: "normal",
        resource: "fonts/regular.ttf",
        hash: catalogueHash(regular),
      },
    ],
    themes: [],
    layouts: [],
    components: [
      {
        ...component("scene", "scene", document),
        fontFaces: ["regular"],
      },
      component("program", "program", createProgramArchive(program)),
      component("other-program", "program", createProgramArchive(program)),
    ],
    islands: [
      { id: "scene-instance", component: "scene", key: "scene" },
      { id: "program-instance", component: "program", key: "program" },
    ],
  };
  const input = await save(spec),
    nativeOut = join(directory, "native"),
    webOut = join(directory, "web"),
    publicDir = join(directory, "public");
  await generateCatalogue({
    catalogue: input.path,
    out: nativeOut,
    name: "Mixed",
    direction: "native",
    packageName: "widgets",
  });
  const native = await readFile(
    join(nativeOut, "Mixed.catalogue.gen.go"),
    "utf8",
  );
  expect(native).toContain("package widgets");
  for (const id of ["scene", "program", "other-program"])
    expect(native).toContain(`RegisterFactory("${id}"`);
  expect(native).toContain(
    "NewMixedComponent0(nil, input.Actions, input.Backend)",
  );
  expect(native).toContain("NewMixedComponent1Backend()");
  expect(native).toContain("mergeMixedFonts(&backend, input.Backend)");
  expect(
    (await readdir(nativeOut)).filter(
      (file) => file === "astro_fyne_scope.gen.go",
    ),
  ).toHaveLength(1);
  await compileNative(
    nativeOut,
    `package widgets
import("testing";"fyne.io/fyne/v2";"fyne.io/fyne/v2/test")
func TestGeneratedDeclarativeCatalogue(t *testing.T){
 app:=test.NewApp();defer app.Quit()
 registry,err:=NewMixedCatalogue();if err!=nil{t.Fatal(err)}
 for _,id:=range []string{"scene-instance","program-instance"}{
  object,err:=registry.NewIsland(id,nil);if err!=nil||object==nil{t.Fatalf("%s: %v",id,err)}
  object.Resize(fyne.NewSize(320,240))
 }
 other,err:=registry.NewWidget("other-program",nil);if err!=nil||other==nil{t.Fatalf("second program factory: %v",err)}
}`,
  );
  await generateCatalogue({
    catalogue: input.path,
    out: webOut,
    name: "Mixed",
    direction: "web",
    publicDir,
  });
  const index = await readFile(join(webOut, "Mixed.catalogue.tsx"), "utf8");
  expect(index).toContain('import "./MixedComponent0.css"');
  expect(index).toContain('import "./MixedComponent1.fonts.css"');
  expect(index).toContain('import "./MixedComponent2.fonts.css"');
  expect(
    await readFile(join(webOut, "MixedComponent1.fonts.css"), "utf8"),
  ).toContain('font-family: "PortableSans"');
  expect(await readFile(join(publicDir, "fonts/portable.ttf"))).toEqual(
    await readFile(fontFile),
  );
  await generateCatalogue({
    catalogue: input.path,
    out: webOut,
    name: "Mixed",
    direction: "web",
    publicDir,
    check: true,
  });
}, 180_000);

test("installed CLI catalogue shortcuts work from the caller's directory and preserve option diagnostics", async () => {
  const { spec } = await fixture();
  await save(spec);
  function run(args: string[]) {
    const result = spawnSync(process.execPath, [launcher, ...args], {
      cwd: directory,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.error).toBeUndefined();
    return result;
  }
  for (const command of ["to-fyne", "to-web"] as const) {
    const result = run([command, "Library.catalogue.json"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      command === "to-fyne" ? "Fyne Go" : "Astro + Preact + CSS",
    );
  }
  expect(
    await readFile(
      join(directory, "native/generated/Library.catalogue.gen.go"),
      "utf8",
    ),
  ).toContain("NewLibraryCatalogue");
  expect(
    await readFile(join(directory, "src/pages/library/Library.astro"), "utf8"),
  ).toContain("LibraryIsland");
  for (const [args, diagnostic] of [
    [
      [
        "to-fyne",
        "--catalogue",
        "Library.catalogue.json",
        "--name",
        "Library",
        "--out",
        "unused",
        "--name",
        "Again",
      ],
      "Duplicate catalogue option",
    ],
    [
      ["to-web", "--catalogue", "Library.catalogue.json", "--out"],
      "Missing value for --out",
    ],
    [
      ["to-web", "Library.catalogue.json", "--unknown", "value"],
      "Unknown catalogue option",
    ],
    [
      [
        "to-web",
        "Library.catalogue.json",
        "--catalogue",
        "Library.catalogue.json",
      ],
      "Use one positional input",
    ],
  ] as const) {
    const result = run([...args]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(diagnostic);
  }
  await expect(stat(join(directory, "unused"))).rejects.toThrow();
}, 120_000);

test("invalid UTF-8 inside an otherwise valid token is rejected before either destination exists", async () => {
  const spec = emptyCatalogue("Raw");
  spec.themes.push({ id: "light", tokens: { "--note": "RAW" }, fontFaces: [] });
  const source = Buffer.from(JSON.stringify(spec)),
    at = source.indexOf('"RAW"');
  expect(at).toBeGreaterThan(0);
  source[at + 1] = 0xff;
  const input = join(directory, "Raw.catalogue.json");
  await writeFile(input, source);
  for (const direction of ["native", "web"] as const) {
    const out = join(directory, direction),
      publicDir = join(directory, "public");
    await expect(
      generateCatalogue({
        catalogue: input,
        out,
        name: "Raw",
        direction,
        ...(direction === "web" ? { publicDir } : {}),
      }),
    ).rejects.toThrow();
    await expect(stat(out)).rejects.toThrow();
    await expect(stat(publicDir)).rejects.toThrow();
  }
});

test("conflicting valid static font hashes across catalogue and program faces block all output", async () => {
  const regular = await readFile(fontFile),
    padded = Buffer.concat([regular, Buffer.alloc(4)]),
    face = { weight: 400 as const, style: "normal" as const };
  inspectFont(regular, face);
  inspectFont(padded, face);
  expect(catalogueHash(padded)).not.toBe(catalogueHash(regular));
  const source = join(directory, "Portable.tsx");
  await writeFile(
    source,
    "export default function Portable(){return <p>Font conflict</p>}",
  );
  await writeFile(join(directory, "padded.ttf"), padded);
  const program = await compile(source, undefined, {
    root: directory,
    fonts: [
      {
        ...face,
        family: "CatalogueSans",
        source: "padded.ttf",
        webSrc: "/fonts/padded.ttf",
      },
    ],
  });
  const spec = emptyCatalogue("Conflict");
  spec.resources.push({
    name: "fonts/regular.ttf",
    mediaType: "font/ttf",
    hash: catalogueHash(regular),
    content: regular.toString("base64"),
    license: await readFile(fontLicense, "utf8"),
  });
  spec.fontFaces.push({
    id: "regular",
    family: "CatalogueSans",
    ...face,
    resource: "fonts/regular.ttf",
    hash: catalogueHash(regular),
  });
  spec.components.push(
    component("portable", "program", createProgramArchive(program)),
  );
  const input = await save(spec),
    out = join(directory, "web"),
    publicDir = join(directory, "public");
  await expect(
    generateCatalogue({
      catalogue: input.path,
      out,
      publicDir,
      name: "Conflict",
      direction: "web",
    }),
  ).rejects.toThrow("Catalogue web font collision: cataloguesans:400:normal");
  await expect(stat(out)).rejects.toThrow();
  await expect(stat(publicDir)).rejects.toThrow();
}, 60_000);

test("declared catalogue motions export typed definitions and complete portable browser modules", async () => {
  const motion: MotionSpec = {
    schema: 1,
    id: "move",
    tracks: [
      {
        id: "horizontal",
        target: "panel",
        property: "x",
        keyframes: [
          { offset: 0, value: 0 },
          { offset: 1, value: 100 },
        ],
      },
    ],
    timing: {
      durationMs: 1000,
      delayMs: 0,
      iterations: 1,
      direction: "normal",
      fill: "both",
      easing: { kind: "linear" },
    },
  };
  const spec = emptyCatalogue("Animated");
  spec.motions = [motion];
  const input = await save(spec),
    out = join(directory, "web"),
    options = {
      catalogue: input.path,
      out,
      name: "Animated",
      direction: "web" as const,
    };
  await generateCatalogue(options);
  const index = await readFile(join(out, "Animated.catalogue.tsx"), "utf8");
  expect(index).toContain(
    'import type {MotionSpec} from "./_Animated-catalogue/motion.ts"',
  );
  expect(index).toContain(
    'export {WebMotionController} from "./_Animated-catalogue/motion-web.ts"',
  );
  const definition = index.match(
    /^export const motions:MotionSpec\[\]=(.*);$/m,
  );
  expect(definition).not.toBeNull();
  expect(JSON.parse(definition![1]!)).toEqual([motion]);
  const header =
    "// Code generated by astro-fyne. DO NOT EDIT.\n// SPDX-License-Identifier: Apache-2.0\n";
  for (const file of ["motion.ts", "motion-web.ts"])
    expect(await readFile(join(out, "_Animated-catalogue", file), "utf8")).toBe(
      header + (await readFile(new URL(file, import.meta.url), "utf8")),
    );
  const initial = await tree(out);
  await generateCatalogue({ ...options, check: true });
  expect(await tree(out)).toEqual(initial);
});
