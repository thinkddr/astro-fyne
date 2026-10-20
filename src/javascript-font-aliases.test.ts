// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCSSFontFamilyResolver } from "./font-family-css.ts";
import { fontsCSS, loadFonts, validateFontFaces } from "./fonts.ts";
import { bundleJavascript, prepareJavascriptBundle } from "./javascript.ts";
import { generateCatalogue, prepareCatalogueSource } from "./catalogue-cli.ts";
import { compileJavascriptCSS } from "./javascript-css.ts";
import {
  catalogueHash,
  validateCatalogue,
  type CatalogueSpec,
} from "./catalogue.ts";
import type {
  JavascriptArchive,
  JavascriptFactory,
} from "./javascript-types.ts";

const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);
const face = {
  family: "Host",
  weight: 400 as const,
  style: "normal" as const,
  source: "regular.ttf",
  webSrc: "/fonts/regular.ttf",
};
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
function mount(archive: JavascriptArchive, effects: unknown[][]) {
  const factory = eval(`(${archive.code})`) as JavascriptFactory;
  const api = factory((kind, name, args) => {
    expect(kind).toBe("action");
    expect(name).toBe("observe");
    effects.push(JSON.parse(args));
    return null;
  }, archive);
  for (const event of archive.events) api.replay(event);
  api.finishReplay();
  return api;
}

test("source font bundles resolve dynamic CSS aliases and restore the same warm checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-font-alias-runtime-"));
  try {
    const source = join(root, "Counter.tsx"),
      css = join(root, "counter.css");
    const raw =
      '\ufeff/* exact aliases */\r\n.probe{font-family:"STRASSE";font-size:16px;line-height:20px}\r\n';
    await writeFile(css, raw);
    await writeFile(
      source,
      'import{useState}from"preact/hooks";import"./counter.css";export default function Counter({observe}){const[count,setCount]=useState(0);const family=count%2?"i\\u0307":"STRASSE";return <button class="probe" id="counter" data-authored-family={family} style={{fontFamily:family}} onClick={()=>{setCount(count+1);observe(count+1)}}>{count}</button>}',
    );
    const prepared = await prepareJavascriptBundle(
      source,
      "default",
      {},
      ["observe"],
      [],
      ["Straße", "İ"],
    );
    const archive = prepared.archive,
      effects: unknown[][] = [],
      api = mount(archive, effects);
    expect(archive.stylesheets?.[0]?.text).toBe(raw);
    expect(archive.stylesheets?.[0]?.hash).toBe(digest(raw));
    expect(
      prepared.inputPaths.some((path) => path.endsWith("/font-family-data.ts")),
    ).toBe(true);
    expect(
      prepared.inputPaths.some((path) => path.endsWith("/font-family-css.ts")),
    ).toBe(true);
    const unicodeLicense = await readFile(
      new URL("../third_party/unicode17/LICENSE.txt", import.meta.url),
      "utf8",
    );
    expect(archive.code).toContain(unicodeLicense);
    expect(
      archive.sources.some(
        (source) =>
          source.path.endsWith("third_party/unicode17/LICENSE.txt") &&
          source.hash === digest(unicodeLicense),
      ),
    ).toBe(true);
    expect(
      prepared.inputPaths.some((path) =>
        path.endsWith("/third_party/unicode17/LICENSE.txt"),
      ),
    ).toBe(true);
    const initial = api.snapshot()[0]!;
    expect(initial.attrs?.["data-authored-family"]).toBe("STRASSE");
    expect(initial.style?.fontFamily).toBe('"Straße"');
    api.dispatch({ node: initial.uid, type: "click" });
    const checkpoint = api.export();
    expect(checkpoint.frame?.[0]?.attrs?.["data-authored-family"]).toBe(
      "i\u0307",
    );
    expect(checkpoint.frame?.[0]?.style?.fontFamily).toBe('"İ"');
    expect(effects).toEqual([[1]]);
    const replayEffects: unknown[][] = [],
      restored = mount(checkpoint, replayEffects);
    expect(restored.export()).toEqual(checkpoint);
    expect(replayEffects).toEqual([]);
    restored.dispatch({ node: initial.uid, type: "click" });
    expect(restored.snapshot()[0]?.style?.fontFamily).toBe('"Straße"');
    expect(replayEffects).toEqual([[2]]);
    expect(restored.export().stylesheets).toEqual(archive.stylesheets);
    restored.dispose();
    api.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("font alias snapshots preserve authored inline values and inherited CSS", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-font-alias-cascade-"));
  try {
    const dom = createDocument(createCSSFontFamilyResolver(["Straße", "İ"]));
    const parent = dom.document.createElement("div"),
      child = dom.document.createElement("p");
    parent.style.fontFamily = "STRASSE";
    child.style.fontFamily = "i\u0307";
    parent.appendChild(child);
    dom.root.appendChild(parent);
    expect(dom.snapshot()[0].style.fontFamily).toBe('"Straße"');
    expect(dom.snapshot()[0].children[0].style.fontFamily).toBe('"İ"');
    expect(parent.style.fontFamily).toBe("STRASSE");
    expect(child.style.fontFamily).toBe("i\u0307");
    expect(dom.snapshot()[0].style.fontFamily).toBe('"Straße"');
    child.style.fontFamily = "Straße";
    expect(dom.snapshot()[0].children[0].style.fontFamily).toBe("Straße");
    child.style.fontFamily = "";
    expect(() => dom.snapshot()).not.toThrow();
    const stylesheet = join(root, "style.css");
    await writeFile(
      stylesheet,
      ".parent{font-family:STRASSE}.child{font-size:16px}",
    );
    parent.className = "parent";
    child.className = "child";
    dom.installCSS(await compileJavascriptCSS(stylesheet, () => {}));
    expect(dom.snapshot()[0].children[0].style.fontFamily).toBe('"Straße"');
    parent.style.fontFamily = "i\u0307";
    const inherited = dom.snapshot()[0];
    expect(inherited.style.fontFamily).toBe('"İ"');
    expect(inherited.children[0].style.fontFamily).toBe('"İ"');
    expect(parent.style.fontFamily).toBe("i\u0307");
    expect(child.style.fontFamily).toBe("");
    expect(dom.snapshot()[0].children[0].style.fontFamily).toBe('"İ"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source font bundles can clear and restore an inline family across warm replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-font-alias-clear-"));
  try {
    const source = join(root, "Clear.tsx");
    await writeFile(
      source,
      'import{useState}from"preact/hooks";export default function Clear(){const[count,setCount]=useState(0);return <button style={{fontFamily:count%2?undefined:"STRASSE"}} onClick={()=>setCount(count+1)}>{count}</button>}',
    );
    const archive = await bundleJavascript(
        source,
        "default",
        {},
        [],
        [],
        ["Straße"],
      ),
      api = mount(archive, []);
    const node = api.snapshot()[0]!;
    expect(node.style?.fontFamily).toBe('"Straße"');
    api.dispatch({ node: node.uid, type: "click" });
    const checkpoint = api.export();
    expect(checkpoint.frame?.[0]?.style?.fontFamily || "").toBe("");
    const restored = mount(checkpoint, []);
    expect(restored.export()).toEqual(checkpoint);
    restored.dispatch({ node: node.uid, type: "click" });
    expect(restored.snapshot()[0]?.style?.fontFamily).toBe('"Straße"');
    restored.dispose();
    api.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("font bundle options are snapshotted and bind canonical names to the code hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-font-alias-options-"));
  try {
    const source = join(root, "Page.tsx");
    await writeFile(
      source,
      'export default function Page(){return <p style={{fontFamily:"STRASSE"}}>Alias</p>}',
    );
    const families = ["Straße"],
      pending = prepareJavascriptBundle(
        source,
        "default",
        {},
        [],
        [],
        families,
      );
    families[0] = "Changed";
    const first = await pending,
      legacy = await bundleJavascript(
        source,
        "default",
        {},
        [],
        [],
        ["Straße"],
      );
    expect(first.archive).toEqual(legacy);
    const other = await bundleJavascript(
      source,
      "default",
      {},
      [],
      [],
      ["STRASSE"],
    );
    expect(first.archive.codeHash).not.toBe(other.codeHash);
    expect(first.archive.sources).toEqual(other.sources);
    expect(first.archive.stylesheets).toEqual(other.stylesheets);
    const a = mount(first.archive, []),
      b = mount(other, []);
    expect(a.snapshot()[0]?.style?.fontFamily).toBe('"Straße"');
    expect(b.snapshot()[0]?.style?.fontFamily).toBe("STRASSE");
    a.dispose();
    b.dispose();
    await expect(
      prepareJavascriptBundle(
        join(root, "missing.tsx"),
        "default",
        {},
        [],
        [],
        ["Straße", "STRASSE"],
      ),
    ).rejects.toThrow("distinct native aliases");
    for (const value of ["Source", "", null, {}])
      await expect(
        prepareJavascriptBundle(
          join(root, "missing.tsx"),
          "default",
          {},
          [],
          [],
          value as unknown as string[],
        ),
      ).rejects.toThrow("canonical family array");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("font manifests use native simple equality and preserve Unicode scalar boundaries", () => {
  for (const family of ["日本語", "Σans", "A\u0301_١-Host", "𐐀".repeat(80)])
    expect(() => validateFontFaces([{ ...face, family }])).not.toThrow();
  for (const family of ["A\ud800", "𐐀".repeat(81), "A\u00a0B", "AⅧ", "A😀"])
    expect(() => validateFontFaces([{ ...face, family }])).toThrow();
  for (const [left, right] of [
    ["Σ", "ς"],
    ["S", "ſ"],
    ["K", "K"],
    ["ß", "ẞ"],
    ["ﬅ", "ﬆ"],
  ])
    for (const weight of [400, 700])
      expect(() =>
        validateFontFaces([
          { ...face, family: left },
          { ...face, family: right, weight },
        ]),
      ).toThrow();
  for (const [left, right] of [
    ["Straße", "STRASSE"],
    ["İ", "i\u0307"],
    ["I", "ı"],
    ["é", "e\u0301"],
  ])
    expect(() =>
      validateFontFaces([
        { ...face, family: left },
        { ...face, family: right },
      ]),
    ).not.toThrow();
});

test("font resource names preserve ASCII hashes and Unicode ordering is stable", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-font-alias-sort-"));
  try {
    const bytes = await readFile(
      new URL("../example/public/fonts/NotoSans-Regular.ttf", import.meta.url),
    );
    await writeFile(join(root, "regular.ttf"), bytes);
    const [ascii] = await loadFonts([face], root);
    expect(ascii!.name).toBe(
      "font_" +
        digest(`host:400:normal:regular.ttf:${catalogueHash(bytes)}`).slice(
          0,
          24,
        ),
    );
    const names = ["𐐀", "Ａ", "é", "Z"];
    const first = await loadFonts(
      names.map((family) => ({ ...face, family })),
      root,
    );
    const second = await loadFonts(
      names
        .slice()
        .reverse()
        .map((family) => ({ ...face, family })),
      root,
    );
    expect(first).toEqual(second);
    expect(first.map((font) => font.family)).toEqual(["Z", "é", "Ａ", "𐐀"]);
    expect(fontsCSS(first)).toContain('font-family: "𐐀"');
    const colliding = await loadFonts(
      ["Straße", "STRASSE"].map((family) => ({ ...face, family })),
      root,
    );
    expect(() => fontsCSS(colliding)).toThrow("distinct native aliases");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("catalogue CSS collisions reject both CLI directions before output writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-font-alias-catalogue-"));
  try {
    const bytes = await readFile(
      new URL("../example/public/fonts/NotoSans-Regular.ttf", import.meta.url),
    );
    const license = await readFile(
      new URL("../example/public/fonts/LICENSE-NotoSans.txt", import.meta.url),
      "utf8",
    );
    const hash = catalogueHash(bytes),
      spec: CatalogueSpec = {
        schema: 1,
        kind: "astro-fyne-catalogue",
        name: "Aliases",
        resources: [
          {
            name: "regular.ttf",
            mediaType: "font/ttf",
            hash,
            content: bytes.toString("base64"),
            license,
          },
        ],
        fontFaces: ["Straße", "STRASSE"].map((family, index) => ({
          id: "face" + index,
          family,
          weight: 400 as const,
          style: "normal" as const,
          hash,
          resource: "regular.ttf",
        })),
        stylesheets: [],
        themes: [],
        layouts: [],
        components: [],
        islands: [],
      };
    await expect(validateCatalogue(spec)).resolves.toBeDefined();
    for (const direction of ["native", "web"] as const)
      await expect(
        prepareCatalogueSource(JSON.stringify(spec), {
          out: root,
          name: "Aliases",
          direction,
        }),
      ).rejects.toThrow("distinct native aliases");
    expect(await readdir(root)).toEqual([]);
    const input = join(root, "fonts.catalogue.json"),
      out = join(root, "out"),
      publicDir = join(root, "public");
    await writeFile(input, JSON.stringify(spec));
    for (const direction of ["native", "web"] as const)
      await expect(
        generateCatalogue({
          catalogue: input,
          out,
          ...(direction === "web" ? { publicDir } : {}),
          name: "Aliases",
          direction,
        }),
      ).rejects.toThrow("distinct native aliases");
    for (const path of [out, publicDir])
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    const changed = structuredClone(spec);
    changed.fontFaces[1]!.family = "ẞtraße";
    changed.fontFaces[0]!.family = "ßtraße";
    await expect(validateCatalogue(changed)).rejects.toThrow(
      "duplicate or inconsistently named font face",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
