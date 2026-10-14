// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileJavascriptCSS } from "./javascript-css.ts";
const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);
async function withCSS(source: string, callback: (doc: any) => void) {
  const dir = await mkdtemp(join(tmpdir(), "afy-css-"));
  try {
    const file = join(dir, "style.css");
    await writeFile(file, source);
    const packet = await compileJavascriptCSS(file, () => {});
    const doc = createDocument();
    doc.installCSS(packet);
    callback(doc);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("CSS layers, specificity, ordered shorthands and inline priorities cascade", async () => {
  await withCSS(
    `@layer a,b;@layer a{.box{color:red!important;padding:2px 4px}}@layer b{#item{color:blue!important;padding-left:8px}}#item{color:green!important}.box{padding-left:3px;padding:5px 6px;padding-top:9px}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("div");
      node.id = "item";
      node.className = "box";
      root.appendChild(node);
      let style = snapshot()[0].style;
      expect(style.color).toBe("red");
      expect(style.paddingLeft).toBe("6px");
      expect(style.paddingTop).toBe("9px");
      expect(style.paddingBottom).toBe("5px");
      node.style.setProperty("color", "purple", "important");
      expect(snapshot()[0].style.color).toBe("purple");
      node.style.padding = "12px";
      node.style.paddingLeft = "8px";
      node.style.padding = "4px";
      expect(snapshot()[0].style.paddingLeft).toBe("4px");
    },
  );
});
test("CSS variables inherit computed values and selectors follow live DOM state", async () => {
  await withCSS(
    `:root{--root:#123456}.parent{--a:var(--b);--b:red;color:var(--root)}.child{--b:blue;background-color:var(--a)}:where(#c){color:green}.child:is(span,.other):not(.off){color:blue}.parent>span[data-x="yes" i]{padding:2px}.parent .peer:checked+span{color:red}.peer:disabled~span{background-color:yellow}`,
    ({ document, root, snapshot }) => {
      const parent = document.createElement("section");
      parent.className = "parent";
      root.appendChild(parent);
      const input = document.createElement("input");
      input.setAttribute("type", "checkbox");
      input.className = "peer";
      parent.appendChild(input);
      const child = document.createElement("span");
      child.id = "c";
      child.className = "child";
      child.setAttribute("data-x", "YES");
      parent.appendChild(child);
      let style = snapshot()[0].children[1].style;
      expect(style.backgroundColor).toBe("red");
      expect(style.color).toBe("blue");
      expect(style.paddingTop).toBe("2px");
      input.checked = true;
      expect(snapshot()[0].children[1].style.color).toBe("red");
      input.disabled = true;
      expect(snapshot()[0].children[1].style.backgroundColor).toBe("yellow");
    },
  );
});
test("CSS imports retain transitive source bytes and unsupported rules are diagnosed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afy-css-import-"));
  try {
    await writeFile(join(dir, "a.css"), '@import "b.css";.a{color:red}');
    await writeFile(join(dir, "b.css"), ".b{color:blue}");
    const inputs: string[] = [];
    const rules = await compileJavascriptCSS(join(dir, "a.css"), (file) =>
      inputs.push(file),
    );
    expect(inputs).toEqual([join(dir, "a.css"), join(dir, "b.css")]);
    expect(rules).toHaveLength(2);
    for (const text of [
      "@media(width>1px){.a{color:red}}",
      ".a:hover{color:red}",
      ".a{& .b{color:red}}",
      "@font-face{font-family:A;src:url(font.woff2)}",
    ]) {
      await writeFile(join(dir, "a.css"), text);
      await expect(
        compileJavascriptCSS(join(dir, "a.css"), () => {}),
      ).rejects.toThrow(/adapter/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CSS variable fallbacks preserve literal strings and diagnose unusable values", async () => {
  await withCSS(
    `.a{--cycle:var(--cycle);color:var(--cycle,var(--missing,red));font-family:"var(--literal)"}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      expect(snapshot()[0].style.color).toBe("red");
      expect(snapshot()[0].style.fontFamily).toBe('"var(--literal)"');
    },
  );
  await withCSS(`.a{color:var(--missing)}`, ({ document, root, snapshot }) => {
    const node = document.createElement("p");
    node.className = "a";
    root.appendChild(node);
    expect(snapshot).toThrow("CSS variable");
  });
});
