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
test("CSS class and attribute tokens use HTML ASCII whitespace", async () => {
  await withCSS(
    `.token{color:red}[data-tags~=token]{background:blue}[data-tags~="token\u00a0other"]{padding:3px}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("div");
      node.className = "token\u00a0other";
      node.setAttribute("data-tags", "token\u00a0other");
      root.appendChild(node);
      let style = snapshot()[0].style;
      expect(style.color).toBeUndefined();
      expect(style.backgroundColor).toBeUndefined();
      expect(style.paddingTop).toBe("3px");
      node.className = "token\tother";
      node.setAttribute("data-tags", "token\nother");
      style = snapshot()[0].style;
      expect(style.color).toBe("red");
      expect(style.backgroundColor).toBe("blue");
      expect(style.paddingTop).toBeUndefined();
    },
  );
});
test(":checked recognizes ASCII-case-insensitive input types without styling the checkbox", async () => {
  await withCSS(
    ".peer:checked+span{color:#112233}",
    ({ document, root, snapshot }) => {
      const checkbox = document.createElement("InPuT");
      checkbox.setAttribute("type", "CHECKBOX");
      checkbox.className = "peer";
      const label = document.createElement("span");
      label.textContent = "Check state";
      root.appendChild(checkbox);
      root.appendChild(label);
      expect(snapshot()[0].style).toEqual({});
      expect(snapshot()[1].style.color).toBeUndefined();
      checkbox.checked = true;
      expect(snapshot()[0].style).toEqual({});
      expect(snapshot()[1].style.color).toBe("#112233");
      checkbox.setAttribute("type", "cHeCkBoX");
      expect(snapshot()[1].style.color).toBe("#112233");
      checkbox.setAttribute("type", "TeXt");
      expect(snapshot()[1].style.color).toBeUndefined();
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
      ".a{color:red;color:}",
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

test("a self cycle invalidates its own fallback before a consuming declaration resolves", async () => {
  await withCSS(
    `.a{--ink:var(--ink,#112233);color:var(--ink,#cc3300)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      expect(snapshot()[0].style.color).toBe("#cc3300");
    },
  );
});

test("mutual cycles invalidate every member while dependents may use their own fallbacks", async () => {
  await withCSS(
    `.a{--one:var(--two,#112233);--two:var(--one,#223344);--safe:var(--one,#123456);color:var(--safe);background-color:var(--two,#cc3300)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      const style = snapshot()[0].style;
      expect(style.color).toBe("#123456");
      expect(style.backgroundColor).toBe("#cc3300");
    },
  );
});

test("unselected fallbacks do not introduce a cycle into a resolved custom property", async () => {
  await withCSS(
    `.a{--ready:#112233;--one:var(--ready,var(--two));--two:var(--one);color:var(--one,#cc3300);background-color:var(--two,#445566)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      const style = snapshot()[0].style;
      expect(style.color).toBe("#112233");
      expect(style.backgroundColor).toBe("#112233");
    },
  );
});

test("selected fallback branches preserve every participant in a visited cycle", async () => {
  await withCSS(
    `.a{--one:var(--two,var(--three));--two:var(--one);--three:var(--two);color:var(--three,#cc3300)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      expect(snapshot()[0].style.color).toBe("#cc3300");
    },
  );
});

test("acyclic nested fallbacks resolve without treating quoted references as dependencies", async () => {
  await withCSS(
    `.a{--ready:#112233;--one:var(--ready,var(--missing,#445566));--quoted:"var(--quoted)";color:var(--one);background-color:var(--missing,var(--other,#778899));font-family:var(--quoted)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      const style = snapshot()[0].style;
      expect(style.color).toBe("#112233");
      expect(style.backgroundColor).toBe("#778899");
      expect(style.fontFamily).toBe('"var(--quoted)"');
    },
  );
});

test("inherited computed properties do not form new cycles through child declarations", async () => {
  await withCSS(
    `.parent{--one:var(--two);--two:#112233}.child{--two:var(--one);color:var(--two)}`,
    ({ document, root, snapshot }) => {
      const parent = document.createElement("section");
      parent.className = "parent";
      const child = document.createElement("p");
      child.className = "child";
      parent.appendChild(child);
      root.appendChild(parent);
      expect(snapshot()[0].children[0].style.color).toBe("#112233");
    },
  );
});

test("a child override cannot revive an inherited invalid value but can replace it", async () => {
  await withCSS(
    `.parent{--one:var(--two,#112233);--two:var(--one)}.inherited{--two:#445566;color:var(--one,#cc3300)}.overridden{--one:#778899;color:var(--one)}`,
    ({ document, root, snapshot }) => {
      const parent = document.createElement("section");
      parent.className = "parent";
      for (const name of ["inherited", "overridden"]) {
        const child = document.createElement("p");
        child.className = name;
        parent.appendChild(child);
      }
      root.appendChild(parent);
      const children = snapshot()[0].children;
      expect(children[0].style.color).toBe("#cc3300");
      expect(children[1].style.color).toBe("#778899");
    },
  );
});

test("a cyclic variable without a consuming fallback retains the unresolved declaration diagnostic", async () => {
  await withCSS(
    `.a{--ink:var(--ink,#112233);color:var(--ink)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      expect(snapshot).toThrow("CSS variable");
    },
  );
});

test("a selected fallback cycle invalidates its participants when the ready property is absent", async () => {
  await withCSS(
    `.a{--one:var(--ready,var(--two));--two:var(--one);color:var(--one,#cc3300);background-color:var(--two,#445566)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      const style = snapshot()[0].style;
      expect(style.color).toBe("#cc3300");
      expect(style.backgroundColor).toBe("#445566");
    },
  );
});

test("an acyclic caller keeps its fallback regardless of declaration order", async () => {
  const cycle = "--one:var(--two,#112233);--two:var(--one,#223344)",
    outside = "--outside:var(--one,#334455)";
  for (const declarations of [`${outside};${cycle}`, `${cycle};${outside}`])
    await withCSS(
      `.a{${declarations};color:var(--outside);background-color:var(--two,#cc3300)}`,
      ({ document, root, snapshot }) => {
        const node = document.createElement("p");
        node.className = "a";
        root.appendChild(node);
        const style = snapshot()[0].style;
        expect(style.color).toBe("#334455");
        expect(style.backgroundColor).toBe("#cc3300");
      },
    );
});

test("comments and longer function names do not invent variable references", async () => {
  for (const fallback of [
    "/*var(--ink)*/ #445566",
    "/* ), ((, var(--ink) */ #445566",
    "notvar(--ink)",
    "xvar(--ink)",
    "évar(--ink)",
    String.raw`x\76 ar(--ink)`,
    "1var(--ink)",
    "#var(--ink)",
    "@var(--ink)",
  ])
    await withCSS(
      `.a{--ready:#112233;--ink:var(--ready,${fallback});color:var(--ink,#cc3300)}`,
      ({ document, root, snapshot }) => {
        const node = document.createElement("p");
        node.className = "a";
        root.appendChild(node);
        expect(snapshot()[0].style.color).toBe("#112233");
      },
    );
});

test("comments around a variable name cannot become argument separators or parentheses", async () => {
  await withCSS(
    `.a{--ready:#112233;color:var(/* , ) */--ready/* (, */,#cc3300)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      expect(snapshot()[0].style.color).toBe("#112233");
    },
  );
});

test("direct custom-property inherit and unset use the parent's computed variable", async () => {
  for (const value of ["inherit", "unset", " /*note*/ InHeRiT /*note*/ "])
    await withCSS(
      `.parent{--ink:#112233;color:#445566}.child{--ink:${value};color:var(--ink,#cc3300)}`,
      ({ document, root, snapshot }) => {
        const parent = document.createElement("section");
        parent.className = "parent";
        const child = document.createElement("p");
        child.className = "child";
        parent.appendChild(child);
        root.appendChild(parent);
        expect(snapshot()[0].children[0].style.color).toBe("#112233");
      },
    );
});

test("direct custom-property initial supplies an invalid value for the consumer's fallback", async () => {
  await withCSS(
    `.parent{--ink:#112233;color:#445566}.child{--ink:initial;color:var(--ink,#cc3300)}`,
    ({ document, root, snapshot }) => {
      const parent = document.createElement("section");
      parent.className = "parent";
      const child = document.createElement("p");
      child.className = "child";
      parent.appendChild(child);
      root.appendChild(parent);
      expect(snapshot()[0].children[0].style.color).toBe("#cc3300");
    },
  );
});

test("unsupported variable syntax and replacement semantics receive explicit diagnostics", async () => {
  for (const [declarations, message] of [
    ["--ink:revert;color:var(--ink,red)", "cascade-origin adapter"],
    ["--ink:revert-layer;color:var(--ink,red)", "cascade-origin adapter"],
    [
      "--ink:var(--missing,inherit);color:var(--ink,red)",
      "property-replacement adapter",
    ],
  ])
    await withCSS(`.a{${declarations}}`, ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      expect(snapshot).toThrow(message);
    });
});

test("unsupported variable tokens fail at the parser or inline-style boundary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afy-css-variable-"));
  try {
    const file = join(dir, "style.css");
    await writeFile(file, ".a{color:var(var(--name),red)}");
    await expect(compileJavascriptCSS(file, () => {})).rejects.toThrow(
      "CSS syntax requires a parser adapter",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  for (const [value, message] of [
    ["var(var(--name),red)", "first argument"],
    [String.raw`var(--\69 nk,red)`, "first argument"],
    [String.raw`v\61 r(--ink,red)`, "variable functions"],
  ]) {
    const { document, root, snapshot, installCSS } = createDocument();
    installCSS([]);
    const node = document.createElement("p");
    node.style.color = value;
    root.appendChild(node);
    expect(snapshot).toThrow(message);
  }
});

test("ordinary Unicode custom-property names remain distinct and supported", async () => {
  await withCSS(
    `.a{--é:#112233;--é:#445566;color:var(--é);background-color:var(--é)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      const style = snapshot()[0].style;
      expect(style.color).toBe("#112233");
      expect(style.backgroundColor).toBe("#445566");
    },
  );
});

test("dependency-depth exhaustion is diagnosed instead of selecting a fallback", async () => {
  const declarations = Array.from(
    { length: 34 },
    (_, index) => `--x${index}:var(--x${index + 1},#112233)`,
  ).join(";");
  await withCSS(
    `.a{${declarations};--x34:#445566;color:var(--x0,#cc3300)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      expect(snapshot).toThrow("supported depth of 32");
    },
  );
});

test("whole CSS values, RGB channels and whitespace-separated padding survive substitution", async () => {
  await withCSS(
    `.a{--width:12px;--red:17;--green:35;--blue:43;--alpha:.5;--top:2px;--sides:4px;--bottom:6px;width:var(--width);color:rgb(var(--red),var(--green),var(--blue));background-color:rgba(var(--red),var(--green),var(--blue),var(--alpha));padding:var(--top) var(--sides) var(--bottom)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      const style = snapshot()[0].style;
      expect(style.width).toBe("12px");
      expect(style.color).toBe("rgb(17,35,43)");
      expect(style.backgroundColor).toBe("rgba(17,35,43,.5)");
      expect([
        style.paddingTop,
        style.paddingRight,
        style.paddingBottom,
        style.paddingLeft,
      ]).toEqual(["2px", "4px", "6px", "4px"]);
    },
  );
});

test("complete RGB token lists and selected nested fallbacks remain usable", async () => {
  await withCSS(
    `.a{--channels:17 35 43;--fallback:12px;color:rgb(var(--channels));width:var(--missing,var(--other,var(--fallback)));padding:var(--missing,2px 4px)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      const style = snapshot()[0].style;
      expect(style.color).toBe("rgb(17 35 43)");
      expect(style.width).toBe("12px");
      expect(style.paddingTop).toBe("2px");
      expect(style.paddingLeft).toBe("4px");
    },
  );
});

test("substitution cannot fabricate dimensions, colors, functions or adjacent value tokens", () => {
  for (const [property, value] of [
    ["width", "var(--number)0px"],
    ["width", "var(--number)px"],
    ["width", "var(--number)e2px"],
    ["width", "+var(--pixels)"],
    ["width", ".var(--number)px"],
    ["color", "var(--hex)def"],
    ["color", "var(--hash)112233"],
    ["color", "var(--function)(17,35,43)"],
    ["color", "rgba(17,35,43,.var(--number))"],
    ["color", "rgba(17,35,43,var(--number)%)"],
    ["padding", "var(--pixels)var(--pixels)"],
    ["width", "var(--missing,10px)0px"],
  ]) {
    const { document, root, snapshot, installCSS } = createDocument();
    installCSS([]);
    const node = document.createElement("p");
    for (const [name, initial] of [
      ["--number", "1"],
      ["--pixels", "2px"],
      ["--hex", "#abc"],
      ["--hash", "#"],
      ["--function", "rgb"],
    ])
      node.style.setProperty(name, initial);
    node.style.setProperty(property, value);
    root.appendChild(node);
    expect(snapshot).toThrow("CSS token adjacency");
  }
});

test("custom aliases and inherited values cannot hide token fabrication", async () => {
  for (const declarations of [
    ".a{--number:1;--bad:var(--number)0px;--alias:var(--bad);width:var(--alias)}",
    ".a{--hex:#abc;--bad:var(--hex)def;--alias:var(--bad);color:var(--alias)}",
  ])
    await withCSS(declarations, ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      expect(snapshot).toThrow("CSS token adjacency");
    });
  await withCSS(
    `.parent{--number:1}.child{width:var(--number)0px}`,
    ({ document, root, snapshot }) => {
      const parent = document.createElement("section");
      parent.className = "parent";
      const child = document.createElement("p");
      child.className = "child";
      parent.appendChild(child);
      root.appendChild(parent);
      expect(snapshot()[0].children[0].style.width).toBe("1 0px");
      child.style.width = "var(--number)0px";
      expect(snapshot).toThrow("CSS token adjacency");
    },
  );
});

test("comments at joins or inside replacements never erase token boundaries", async () => {
  for (const [property, value] of [
    ["width", "var(--number)/**/0px"],
    ["width", "/**/var(--pixels)"],
    ["width", "var(--pixels)/**/"],
    ["color", "var(--hex)/**/def"],
  ]) {
    const { document, root, snapshot, installCSS } = createDocument();
    installCSS([]);
    const node = document.createElement("p");
    node.style.setProperty("--number", "1");
    node.style.setProperty("--pixels", "2px");
    node.style.setProperty("--hex", "#abc");
    node.style.setProperty(property, value);
    root.appendChild(node);
    expect(snapshot).toThrow("native token-stream adapter");
  }
  for (const value of [
    "/* leading */12px",
    "12px/* trailing */",
    "1/**/0px",
    "#abc/**/def",
  ])
    await withCSS(
      `.a{--commented:${value};width:var(--commented)}`,
      ({ document, root, snapshot }) => {
        const node = document.createElement("p");
        node.className = "a";
        root.appendChild(node);
        expect(snapshot).toThrow("CSS comments in the replacement");
      },
    );
  for (const fallback of ["/* leading */12px", "12px/* trailing */"]) {
    const { document, root, snapshot, installCSS } = createDocument();
    installCSS([]);
    const node = document.createElement("p");
    node.style.width = `var(--missing,${fallback})`;
    root.appendChild(node);
    expect(snapshot).toThrow("CSS comments in the replacement");
  }
});

test("quoted comment text remains a literal CSS string", async () => {
  await withCSS(
    `.a{--quoted:"/*literal*/";font-family:var(--quoted)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      expect(snapshot()[0].style.fontFamily).toBe('"/*literal*/"');
    },
  );
});

test("unselected unsafe fallback joins and invalid cycles do not run adjacency diagnostics", async () => {
  await withCSS(
    `.a{--ready:12px;--color:#112233;--number:1;--hex:#abc;--cycle:var(--cycle,var(--number)0px);width:var(--ready,/* unused */var(--number)0px);color:var(--color,var(--hex)def/* unused */);height:var(--cycle,14px)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      const style = snapshot()[0].style;
      expect(style.width).toBe("12px");
      expect(style.color).toBe("#112233");
      expect(style.height).toBe("14px");
    },
  );
});

test("fallback trimming removes CSS whitespace without erasing Unicode name characters", async () => {
  await withCSS(
    `.a{width:var(--missing,\u00a012px);height:var(--missing, \t12px \n)}`,
    ({ document, root, snapshot }) => {
      const node = document.createElement("p");
      node.className = "a";
      root.appendChild(node);
      const style = snapshot()[0].style;
      expect(style.width).toBe("\u00a012px");
      expect(style.height).toBe("12px");
    },
  );
});
