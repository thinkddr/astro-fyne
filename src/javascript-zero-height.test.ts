// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileJavascriptCSS } from "./javascript-css.ts";
import { generateJavascript } from "./javascript-cli.ts";
import { prepareJavascriptDOM } from "./javascript-managed-dom.ts";
import type { JavascriptFrame } from "./javascript-types.ts";
const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);

test("stylesheet zero endpoints retain source bytes and sample zero without changing flow identities", async () => {
  for (const zero of ["0", "0px"]) {
    const directory = await mkdtemp(join(tmpdir(), "afy-zero-height-"));
    try {
      const text = `#panel{height:${zero};animation:grow 1000ms linear 100ms 2 alternate both}#following{height:24px}@keyframes grow{from{height:${zero}}to{height:64px}}`;
      const path = join(directory, "style.css");
      await writeFile(path, text);
      const retained: unknown[] = [],
        packet = await compileJavascriptCSS(path, (file, text) =>
          retained.push({ file, text }),
        ),
        doc = createDocument();
      doc.installCSS(packet);
      const root = doc.document.createElement("main"),
        panel = doc.document.createElement("section"),
        following = doc.document.createElement("section");
      panel.id = "panel";
      following.id = "following";
      root.appendChild(panel);
      root.appendChild(following);
      doc.root.appendChild(root);
      const ids = [panel.uid, following.uid];
      doc.snapshot();
      for (const [time, height] of [
        [0, 0],
        [100, 0],
        [350, 16],
        [1100, 64],
        [1600, 32],
        [2100, 0],
      ] as const) {
        doc.advanceAnimations(time);
        const frames = doc.snapshot();
        expect(
          Number(String(frames[0].children[0].style.height).replace(/px$/, "")),
        ).toBe(height);
        expect(
          frames[0].children.map((frame: JavascriptFrame) => frame.uid),
        ).toEqual(ids);
        expect(() => prepareJavascriptDOM(frames)).not.toThrow();
      }
      expect(retained).toEqual([expect.objectContaining({ text })]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("native zero admission is shared by source snapshots and generated DOM planning", () => {
  for (const css of [false, true]) {
    for (const frame of [
      { uid: "panel", tag: "button" },
      {
        uid: "panel",
        tag: "section",
        children: [{ uid: "text", tag: "#text", text: "overflow" }],
      },
      { uid: "panel", tag: "section", style: { paddingTop: "1px" } },
      { uid: "panel", tag: "section", style: { borderRadius: "1px" } },
      { uid: "panel", tag: "section", style: { width: "10px" } },
      ...(!css ? [{ uid: "panel", tag: "section" }] : []),
    ]) {
      const candidate = {
        ...frame,
        css,
        style: { ...frame.style, height: "0px" },
      } as JavascriptFrame;
      expect(() => prepareJavascriptDOM([candidate])).toThrow(/zero height/);
    }
  }
  const doc = createDocument(),
    panel = doc.document.createElement("section");
  panel.style.height = 0;
  doc.root.appendChild(panel);
  expect(() => doc.snapshot()).toThrow(/inline-only zero/);
  for (const height of ["1e-50px", "1e-500px", 1e-50])
    expect(() =>
      prepareJavascriptDOM([
        { uid: "panel", tag: "section", css: true, style: { height } },
      ]),
    ).toThrow(/underflows/);
});

test("zero endpoint admission rejects decorated targets before a later zero sample", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-zero-invalid-"));
  try {
    const path = join(directory, "style.css");
    await writeFile(
      path,
      "#panel{height:64px;border-radius:2px;animation:collapse 1000ms linear both}#following{height:24px}@keyframes collapse{from{height:64px}to{height:0}}",
    );
    const doc = createDocument();
    doc.installCSS(await compileJavascriptCSS(path, () => {}));
    const root = doc.document.createElement("main"),
      panel = doc.document.createElement("section"),
      following = doc.document.createElement("section");
    panel.id = "panel";
    following.id = "following";
    root.appendChild(panel);
    root.appendChild(following);
    doc.root.appendChild(root);
    expect(() => doc.snapshot()).toThrow(/zero height/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unsupported zero source is diagnosed before either CLI direction writes artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-zero-cli-"));
  try {
    await writeFile(join(directory, "style.css"), "#panel{height:0}");
    for (const [index, source] of [
      `export default function Panel(){return <section id="panel" style={{height:0}}/>}`,
      `import "./style.css";export default function Panel(){return <button id="panel">Overflow</button>}`,
      `import "./style.css";export default function Panel(){return <section id="panel">Overflow</section>}`,
    ].entries()) {
      const path = join(directory, `Panel${index}.tsx`);
      await writeFile(path, source);
      for (const direction of ["native", "web"] as const) {
        const out = join(directory, `out-${index}-${direction}`);
        await expect(
          generateJavascript({ source: path, out, name: "Panel", direction }),
        ).rejects.toThrow(/zero height/);
        await expect(stat(out)).rejects.toThrow();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("animation resets preserve nonzero decoration lexemes until admission diagnoses underflow", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-height-raw-reset-"));
  try {
    const path = join(directory, "style.css");
    for (const name of [
      "padding",
      "padding-top",
      "border-width",
      "margin",
      "margin-top",
      "gap",
    ])
      for (const literal of ["1e-500px", "0e-500px"]) {
        await writeFile(
          path,
          `#panel{height:20px;animation:grow 1000ms linear both;${name}:${literal}}#following{height:24px}@keyframes grow{from{height:20px}to{height:100px}}`,
        );
        const doc = createDocument();
        doc.installCSS(await compileJavascriptCSS(path, () => {}));
        const root = doc.document.createElement("main"),
          panel = doc.document.createElement("section"),
          following = doc.document.createElement("section");
        panel.id = "panel";
        following.id = "following";
        root.appendChild(panel);
        root.appendChild(following);
        doc.root.appendChild(root);
        if (literal.startsWith("1"))
          expect(() => doc.snapshot()).toThrow(/underflow/);
        else expect(() => doc.snapshot()).not.toThrow();
      }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("zero-height browser admission preserves native font, line-height and radius exclusions", () => {
  const frame = (style: JavascriptFrame["style"]): JavascriptFrame => ({
    uid: "panel",
    tag: "section",
    css: true,
    style: { height: "0px", ...style },
  });
  for (const name of ["fontSize", "lineHeight", "borderRadius"]) {
    for (const value of [
      0,
      "0",
      "0px",
      "-0px",
      "0.000e3px",
      " \t\r\n\f0px\f\n\r\t ",
    ])
      expect(() => prepareJavascriptDOM([frame({ [name]: value })])).toThrow(
        `CSS zero ${name}`,
      );
    for (const value of [1e-50, "1e-50px", "1e-500px", " \t1e-50px\r\n\f"])
      expect(() => prepareJavascriptDOM([frame({ [name]: value })])).toThrow(
        /native pixels/,
      );
    for (const value of ["0em", "0%", "0 px", "\u00a00px", "0px\u2003"])
      expect(() => prepareJavascriptDOM([frame({ [name]: value })])).toThrow(
        /finite nonnegative pixels/,
      );
    if (name !== "lineHeight")
      expect(() =>
        prepareJavascriptDOM([frame({ [name]: 3.4028235e38 })]),
      ).toThrow(/finite nonnegative pixels/);
  }
  const supported: NonNullable<JavascriptFrame["style"]>[] = [
    { fontSize: 20, lineHeight: 1.5 },
    { fontSize: " \t20px\r\n\f", lineHeight: "30px" },
    { display: "" },
    { fontSize: 1e-38, lineHeight: 3.4028235e38 },
  ];
  for (const style of supported)
    expect(() => prepareJavascriptDOM([frame(style)])).not.toThrow();
  expect(() => prepareJavascriptDOM([frame({ display: " " })])).toThrow(
    /zero height/,
  );
  expect(() =>
    prepareJavascriptDOM([frame({ fontSize: 1e-10, lineHeight: 1e-40 })]),
  ).toThrow(/lineHeight multiplier/);
});
