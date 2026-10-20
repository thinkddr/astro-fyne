// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCSSFontFamilyResolver } from "./font-family-css.ts";
import { compileJavascriptCSS } from "./javascript-css.ts";
import { prepareJavascriptBundle } from "./javascript.ts";
import type {
  JavascriptArchive,
  JavascriptFactory,
} from "./javascript-types.ts";

const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);
const family = "Comment Host",
  aliases = ["COMMENT/**/HOST", '/* lead */"Comment Host"/* tail */'] as const;

function mount(archive: JavascriptArchive, effects: unknown[][]) {
  const factory = eval(`(${archive.code})`) as JavascriptFactory,
    api = factory((kind, name, args) => {
      if (kind === "random" || kind === "now") {
        expect(name).toBe("");
        expect(JSON.parse(args)).toEqual([]);
        return kind === "random" ? 0.25 : 1000;
      }
      expect(kind).toBe("action");
      expect(name).toBe("observe");
      effects.push(JSON.parse(args));
      return null;
    }, archive);
  for (const event of archive.events) api.replay(event);
  api.finishReplay();
  return api;
}

test("commented font spellings survive source bundling and warm replay without replayed effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-font-comments-"));
  try {
    const source = join(root, "Counter.tsx"),
      raw = "\ufeff.probe{font-family:COMMENT/**/HOST;font-size:16px}\r\n";
    await writeFile(join(root, "counter.css"), raw);
    await writeFile(
      source,
      'import{useState}from"preact/hooks";import"./counter.css";const families=' +
        JSON.stringify(aliases) +
        ';export default function Counter({observe}){const[count,setCount]=useState(0);const family=families[count%2];return <button id="counter" class="probe" data-authored-family={family} style={{fontFamily:family}} onClick={()=>{setCount(count+1);observe(count+1)}}>{count}</button>}',
    );
    const { archive } = await prepareJavascriptBundle(
        source,
        "default",
        {},
        ["observe"],
        [],
        [family],
      ),
      effects: unknown[][] = [],
      api = mount(archive, effects),
      first = api.snapshot()[0]!;
    expect(archive.stylesheets?.[0]?.text).toBe(raw);
    expect(archive.stylesheets?.[0]?.hash).toBe(
      createHash("sha256").update(raw).digest("hex"),
    );
    expect(first.attrs?.["data-authored-family"]).toBe(aliases[0]);
    expect(first.style?.fontFamily).toBe(JSON.stringify(family));
    api.dispatch({ node: first.uid, type: "click" });
    const checkpoint = api.export();
    expect(checkpoint.frame?.[0]?.attrs?.["data-authored-family"]).toBe(
      aliases[1],
    );
    expect(checkpoint.frame?.[0]?.style?.fontFamily).toBe(
      JSON.stringify(family),
    );
    expect(effects).toEqual([[1]]);
    const replayEffects: unknown[][] = [],
      restored = mount(checkpoint, replayEffects);
    expect(restored.export()).toEqual(checkpoint);
    expect(replayEffects).toEqual([]);
    restored.dispatch({ node: first.uid, type: "click" });
    expect(restored.snapshot()[0]?.attrs?.["data-authored-family"]).toBe(
      aliases[0],
    );
    expect(restored.snapshot()[0]?.style?.fontFamily).toBe(
      JSON.stringify(family),
    );
    expect(restored.export().stylesheets).toEqual(archive.stylesheets);
    expect(replayEffects).toEqual([[2]]);
    restored.dispose();
    api.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("font snapshots retain comment token boundaries in compiled CSS and inherited variables", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-font-comment-cascade-"));
  try {
    const sheet = join(root, "style.css"),
      raw =
        "\ufeff.outer{--family:COMMENT/**/HOST;font-family:var(--family)}\r\n.child{font-size:16px}\r\n",
      dom = createDocument(createCSSFontFamilyResolver([family])),
      parent = dom.document.createElement("div"),
      child = dom.document.createElement("p"),
      recorded: { file: string; text: string }[] = [];
    await writeFile(sheet, raw);
    parent.className = "outer";
    child.className = "child";
    parent.appendChild(child);
    dom.root.appendChild(parent);
    dom.installCSS(
      await compileJavascriptCSS(sheet, (file, text) =>
        recorded.push({ file, text }),
      ),
    );
    expect(recorded).toEqual([{ file: sheet, text: raw }]);
    const inherited = dom.snapshot()[0];
    expect(inherited.style.fontFamily).toBe(JSON.stringify(family));
    expect(inherited.children[0].style.fontFamily).toBe(JSON.stringify(family));
    parent.style.fontFamily = aliases[1];
    child.style.fontFamily = aliases[0];
    expect(dom.snapshot()[0].style.fontFamily).toBe(JSON.stringify(family));
    expect(dom.snapshot()[0].children[0].style.fontFamily).toBe(
      JSON.stringify(family),
    );
    expect(parent.style.fontFamily).toBe(aliases[1]);
    expect(child.style.fontFamily).toBe(aliases[0]);
    child.style.fontFamily = "";
    expect(dom.snapshot()[0].children[0].style.fontFamily).toBe(
      JSON.stringify(family),
    );
    expect(parent.style.fontFamily).toBe(aliases[1]);
    expect(child.style.fontFamily).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("font variables retain comments through nested aliases and selected fallbacks", () => {
  const dom = createDocument(
      createCSSFontFamilyResolver([family, "H ost", "ser if"]),
    ),
    parent = dom.document.createElement("section"),
    child = dom.document.createElement("p"),
    fallback = dom.document.createElement("p");
  dom.installCSS([]);
  parent.style.setProperty("--raw", aliases[0]);
  parent.style.setProperty("--alias", "var(--raw)");
  parent.style.setProperty("--fallback", "var(--missing,var(--alias))");
  parent.style.fontFamily = "var(--fallback)";
  child.style.fontFamily = "var(--missing,var(--other,var(--alias)))";
  fallback.style.fontFamily =
    'var(--missing,/* lead */"Comment Host"/* tail */)';
  parent.appendChild(child);
  parent.appendChild(fallback);
  dom.root.appendChild(parent);
  for (const [raw, expected] of [
    [aliases[0], family],
    [aliases[1], family],
    [String.raw`\48/**/ost`, "H ost"],
    ["ser/**/if", "ser if"],
    ["/* quotes '\" backslash \\ and \r\n */COMMENT/**//**/HOST", family],
  ]) {
    parent.style.setProperty("--raw", raw!);
    const frame = dom.snapshot()[0];
    expect(frame.style.fontFamily).toBe(JSON.stringify(expected));
    expect(frame.children[0].style.fontFamily).toBe(JSON.stringify(expected));
    expect(frame.children[1].style.fontFamily).toBe(JSON.stringify(family));
    expect(parent.style["--raw"]).toBe(raw!);
    expect(parent.style["--alias"]).toBe("var(--raw)");
    expect(child.style.fontFamily).toBe(
      "var(--missing,var(--other,var(--alias)))",
    );
  }
});

test("font variable substitution never strips quoted comments or escaped punctuation", () => {
  for (const raw of [
    '"Comment/*literal*/Host"',
    String.raw`Comment\/**/Host`,
    String.raw`Comment/\**/Host`,
    String.raw`Comment\2f **/Host`,
    "COMMENT/*unclosed",
  ]) {
    const dom = createDocument(createCSSFontFamilyResolver([family])),
      node = dom.document.createElement("p");
    dom.installCSS([]);
    node.style.setProperty("--raw", raw);
    node.style.setProperty("--alias", "var(--raw)");
    node.style.fontFamily = "var(--alias)";
    dom.root.appendChild(node);
    expect(dom.snapshot).toThrow();
    expect(node.style["--raw"]).toBe(raw);
  }
});

test("comment-capable font variables preserve token adjacency diagnostics", () => {
  for (const value of [
    "var(--family)Suffix",
    "+var(--family)",
    "var(--family)/**/Suffix",
    "/**/var(--family)",
    "var(--family)/**/",
    "var(--missing,var(--family))Suffix",
    "var(--family)var(--family)",
  ]) {
    const dom = createDocument(createCSSFontFamilyResolver([family])),
      node = dom.document.createElement("p");
    dom.installCSS([]);
    node.style.setProperty("--family", aliases[0]);
    node.style.fontFamily = value;
    dom.root.appendChild(node);
    expect(dom.snapshot).toThrow("CSS token adjacency");
  }
  const dom = createDocument(createCSSFontFamilyResolver([family])),
    node = dom.document.createElement("p");
  dom.installCSS([]);
  node.style.setProperty("--family", aliases[0]);
  node.style.setProperty("--alias", "var(--family)Suffix");
  node.style.fontFamily = "var(--alias)";
  dom.root.appendChild(node);
  expect(dom.snapshot).toThrow("CSS token adjacency");
});

test("commented inherited variables still require adapters for other property consumers", () => {
  for (const [property, raw] of [
    ["width", "1/**/0px"],
    ["width", "/* leading */12px"],
    ["color", "#abc/**/def"],
    ["color", "/* leading */#112233"],
  ]) {
    const dom = createDocument(createCSSFontFamilyResolver([family])),
      parent = dom.document.createElement("section"),
      child = dom.document.createElement("p");
    dom.installCSS([]);
    parent.style.setProperty("--commented", raw!);
    parent.style.setProperty("--alias", "var(--commented)");
    child.style.setProperty(property!, "var(--alias)");
    parent.appendChild(child);
    dom.root.appendChild(parent);
    expect(dom.snapshot).toThrow("CSS comments in the replacement");
  }
  for (const value of ["var(--family)", "var(--missing,COMMENT/**/HOST)"]) {
    const dom = createDocument(),
      parent = dom.document.createElement("section"),
      child = dom.document.createElement("p");
    dom.installCSS([]);
    parent.style.setProperty("--family", aliases[0]);
    parent.style.setProperty("--alias", "var(--family)");
    child.style.fontFamily = value;
    parent.appendChild(child);
    dom.root.appendChild(parent);
    expect(dom.snapshot).toThrow("CSS comments in the replacement");
  }
});
