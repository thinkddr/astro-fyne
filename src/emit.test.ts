// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitGo, sourceHash } from "./emit.ts";
import type { Measurements } from "./emit.ts";
import { compile } from "./parser.ts";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "astro-fyne-emitter-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function program(source: string) {
  const entry = join(directory, "Page.tsx");
  await writeFile(entry, source);
  return compile(entry);
}

const options = { name: "Page", packageName: "generated" };

test("invalid capture metadata or wrong style types never produce invalid Go", async () => {
  const source = await program(
    `export function Page() { return <div id="panel" />; }`,
  );
  const valid: Measurements = {
    schema: 1,
    sourceHash: sourceHash(source),
    state: "default",
    viewport: { width: 100, height: 30, scale: 1 },
    nodes: { panel: { measured: true, width: 100, height: 30 } },
  };
  const invalid: unknown[] = [
    null,
    { ...valid, viewport: { width: -1, height: 30, scale: 1 } },
    { ...valid, viewport: { width: 100, height: 30, scale: 3 } },
    { ...valid, state: "" },
    { ...valid, nodes: [] },
    { ...valid, tokens: { "--color-primary": 5 } },
    { ...valid, nodes: { panel: { measured: true, width: "100" } } },
    { ...valid, nodes: { panel: { measured: true, color: 5 } } },
    { ...valid, nodes: { panel: { measured: true, width: 1e100 } } },
    { ...valid, nodes: { panel: { measured: true, radius: -1 } } },
  ];
  for (const measurements of invalid)
    expect(() =>
      emitGo(source, {
        ...options,
        measurements: measurements as Measurements,
      }),
    ).toThrow();
});

test("missing scalar props keep undefined semantics in emitted Go", async () => {
  const source = await program(`export function Page({ missing }) {
    return <p>{String(missing)}{missing === null}{missing === undefined}</p>;
  }`);
  const go = emitGo(source, options);
  expect(go).toContain('webui.String(webui.Get(scope, "missing"))');
  expect(go).toContain('webui.Binary("===", webui.Get(scope, "missing"), nil)');
  expect(go).toContain(
    'webui.Binary("===", webui.Get(scope, "missing"), webui.Undefined)',
  );
});

test("the generated constructor reports invalid native trees before returning a widget", async () => {
  const source = await program(
    `export function Page() { return <p>Hola</p>; }`,
  );
  const go = emitGo(source, options);
  const construction = go.indexOf("view = webui.NewView(");
  const errorCheck = go.indexOf(
    "if err := view.Error(); err != nil { return nil, err }",
    construction,
  );
  const success = go.indexOf(
    "return &PageWidget{View:view}, nil",
    construction,
  );
  expect(construction).toBeGreaterThan(-1);
  expect(errorCheck).toBeGreaterThan(construction);
  expect(success).toBeGreaterThan(errorCheck);
});

test("display flex defaults to row without overriding an explicit column", async () => {
  const row = await program(
    `export function Page() { return <main className="flex"><p>A</p><p>B</p></main>; }`,
  );
  expect(emitGo(row, options)).toContain('Direction: "row"');
  const column = await program(
    `export function Page() { return <main className="flex-col flex"><p>A</p><p>B</p></main>; }`,
  );
  expect(emitGo(column, options)).toContain('Direction: "column"');
  const inline = await program(
    `export function Page() { return <main style={{display:'flex'}}><p>A</p><p>B</p></main>; }`,
  );
  expect(emitGo(inline, options)).toContain('Direction: "row"');
});

test("symbolic Tailwind colors require browser capture instead of invalid Go styles", async () => {
  for (const className of [
    "border",
    "bg-primary",
    "text-text-muted",
    "border-border-strong",
  ]) {
    const source = await program(
      `export function Page() { return <div id="panel" className="${className}" />; }`,
    );
    expect(() => emitGo(source, options)).toThrow(
      "capturar su color calculado",
    );
    const measurements: Measurements = {
      schema: 1,
      sourceHash: sourceHash(source),
      state: "default",
      viewport: { width: 100, height: 30, scale: 1 },
      nodes: {
        panel: {
          measured: true,
          x: 0,
          y: 0,
          width: 100,
          height: 30,
          background: "#123456",
          opacity: 1,
        },
      },
    };
    const go = emitGo(source, { ...options, measurements });
    expect(go).toContain('Background: "#123456"');
    expect(go).not.toContain('Background: "primary"');
    expect(go).not.toContain('Color: "text-muted"');
  }
});

test("unsupported CSS numeric units never become a string in a Go numeric field", async () => {
  const source = await program(
    `export function Page() { return <div style={{width:'100%'}} />; }`,
  );
  expect(() => emitGo(source, options)).toThrow(
    "width necesita px/rem o captura",
  );
});

test("entry constructors namespace shared component helpers", async () => {
  const source = await program(`function Shared() { return <p>Compartido</p>; }
export function Page() { return <main><Shared /><Shared /></main>; }`);
  const first = emitGo(source, { ...options, name: "First" });
  const second = emitGo(source, { ...options, name: "Second" });
  const helper = source.components.find((component) =>
    component.name.startsWith("Shared_"),
  )!.name;
  expect(first).toContain(`func buildFirst_${helper}(`);
  expect(first).not.toContain(`func buildSecond_${helper}(`);
  expect(second).toContain(`func buildSecond_${helper}(`);
});

test("lexical shadows fail explicitly rather than overwrite props or choose a module constant", async () => {
  for (const source of [
    `const label = 'module'; export function Page({label}) { return <p>{label}</p>; }`,
    `const value = 1; export function Page() { const value = 2; return <p>{value}</p>; }`,
    `import {useState} from 'preact/hooks'; const count = 10; export function Page() { const [count,setCount] = useState(0); return <p>{count}</p>; }`,
    `const props = 'module'; export function Page(props) { return <p>{props.label}</p>; }`,
  ]) {
    const compiled = await program(source);
    expect(() => emitGo(compiled, options)).toThrow("colisión lexical");
  }
});

test("a user prop named __astroProps is not overwritten by an internal helper", async () => {
  const compiled = await program(
    `export function Page({__astroProps}) { return <p>{__astroProps}</p>; }`,
  );
  const go = emitGo(compiled, options);
  expect(go).toContain('webui.ChildText(webui.Get(scope, "__astroProps"))');
  expect(go).not.toContain('scope["__astroProps"] = props');
});
