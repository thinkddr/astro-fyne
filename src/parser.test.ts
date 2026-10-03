// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compile, ConversionError } from "./parser.ts";
import type { Node } from "./ir.ts";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "astro-fyne-parser-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function source(path: string, text: string): Promise<string> {
  const file = join(directory, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}

function elements(nodes: Node[]): Extract<Node, { kind: "element" }>[] {
  return nodes.flatMap((node) => {
    if (node.kind === "element") return [node, ...elements(node.children)];
    if (node.kind === "component" || node.kind === "each")
      return elements(node.children);
    if (node.kind === "conditional")
      return [...elements(node.yes), ...elements(node.no)];
    return [];
  });
}

test("Astro imports a Preact component, preserving props, state, events and list branches", async () => {
  const entry = await source(
    "Page.astro",
    `---
import { Form as ContactForm } from './Form.js';
const title = 'Contactos';
const people = [{ name: 'Ana', active: true }, { name: 'Luis', active: false }];
---
<main id="page"><h1>{title}</h1><ContactForm client:load people={people} /></main>`,
  );
  await source(
    "Form.tsx",
    `import { useState as state } from 'preact/hooks';
export function Form({ people, onSave }) {
  const [name, setName] = state('');
  return <form id="form">
    <label>Nombre<input value={name} onInput={event => setName(event.currentTarget.value)} /></label>
    <button disabled={!name} onClick={() => onSave(name)}>Guardar</button>
    <ul>{people.map((person, index) => person.active ? <li id={\`person-\${index}\`}>{person.name}</li> : null)}</ul>
  </form>;
}`,
  );
  const program = await compile(entry);
  expect(program.sources.map((s) => s.path)).toEqual([
    "Form.tsx",
    "Page.astro",
  ]);
  expect(program.actions).toEqual(["onSave"]);
  const page = program.components.find((c) => c.name === program.entry)!;
  expect(elements(page.body).map((n) => n.tag)).toEqual(["main", "h1"]);
  const form = program.components.find((c) => c.name.startsWith("Form_"))!;
  expect(form.props).toEqual(["people", "onSave"]);
  expect(form.states).toEqual([
    {
      name: "name",
      setter: "setName",
      initial: { kind: "literal", value: "" },
    },
  ]);
  const input = elements(form.body).find((n) => n.tag === "input")!;
  expect(input.events.onInput!.parameter).toBe("event");
  expect(input.events.onInput!.steps[0]!.kind).toBe("set");
  expect(input.events.onInput!.steps[0]!.name).toBe("name");
  const button = elements(form.body).find((n) => n.tag === "button")!;
  expect(button.events.onClick!.steps).toEqual([
    { kind: "call", name: "onSave", args: [{ kind: "name", name: "name" }] },
  ]);
  const ul = elements(form.body).find((n) => n.tag === "ul")!;
  expect(ul.children[0]!.kind).toBe("each");
  if (ul.children[0]!.kind === "each") {
    expect(ul.children[0]!.index).toBe("index");
    expect(ul.children[0]!.children[0]!.kind).toBe("conditional");
  }
});

test("Astro expressions with JSX map and conditionals remain declarative", async () => {
  const entry = await source(
    "Page.astro",
    `---
const items = ['Uno', 'Dos'];
const visible = true;
---
<section>{visible ? <ul>{items.map((item) => <li>{item}</li>)}</ul> : <p>Vacío</p>}</section>`,
  );
  const program = await compile(entry);
  const section = elements(program.components[0]!.body)[0]!;
  expect(section.children[0]!.kind).toBe("conditional");
  const list = elements(section.children).find((n) => n.tag === "ul")!;
  expect(list.children[0]!.kind).toBe("each");
  expect(elements(list.children)[0]!.children[0]!).toEqual({
    kind: "text",
    value: { kind: "name", name: "item" },
  });
});

test("setter updater reads the state and sequential handler steps are preserved", async () => {
  const entry = await source(
    "Counter.tsx",
    `import { useState } from 'preact/hooks';
export default ({ onCount }) => {
  const [count, setCount] = useState(0);
  const add = () => { setCount(current => current + 1); onCount(count); };
  return <button onClick={add}>{count}</button>;
};`,
  );
  const program = await compile(entry);
  const button = elements(program.components[0]!.body)[0]!;
  expect(button.events.onClick!.steps).toEqual([
    {
      kind: "set",
      name: "count",
      updater: true,
      args: [
        {
          kind: "binary",
          op: "+",
          left: { kind: "name", name: "count" },
          right: { kind: "literal", value: 1 },
        },
      ],
    },
    { kind: "call", name: "onCount", args: [{ kind: "name", name: "count" }] },
  ]);
});

test("object props and updater batches retain the distinction from closure values", async () => {
  const entry = await source(
    "Counter.tsx",
    `import { useState } from 'preact/hooks';
export function Counter(props) {
  const [count, setCount] = useState(0);
  return <button onClick={() => {
    setCount(count + 1); setCount(previous => previous + 1); setCount(count + 2);
  }}>{props.title}{count}</button>;
}`,
  );
  const program = await compile(entry);
  const counter = program.components[0]!;
  expect(counter.propsObject).toBe("props");
  expect(counter.props).toEqual([]);
  const steps = elements(counter.body)[0]!.events.onClick!.steps;
  expect(steps.map((step) => step.updater === true)).toEqual([
    false,
    true,
    false,
  ]);
  expect(steps.map((step) => step.args[0]!)).toEqual([
    {
      kind: "binary",
      op: "+",
      left: { kind: "name", name: "count" },
      right: { kind: "literal", value: 1 },
    },
    {
      kind: "binary",
      op: "+",
      left: { kind: "name", name: "count" },
      right: { kind: "literal", value: 1 },
    },
    {
      kind: "binary",
      op: "+",
      left: { kind: "name", name: "count" },
      right: { kind: "literal", value: 2 },
    },
  ]);
});

test("inline and imported CSS require measurement and all stylesheet hashes are kept", async () => {
  const entry = await source(
    "Page.astro",
    `---
import './base.css';
const { title } = Astro.props;
---
<h1>{title}</h1><style>h1 { color: rebeccapurple }</style>`,
  );
  await source("base.css", `@import './spacing.css'; h1 { padding: 10.5px }`);
  await source("spacing.css", `h1 { margin: 0 }`);
  const program = await compile(entry);
  expect(program.hasStyles).toBe(true);
  expect(program.sources.map((item) => item.path)).toEqual([
    "Page.astro",
    "base.css",
    "spacing.css",
  ]);
  expect(elements(program.components[0]!.body).map((node) => node.tag)).toEqual(
    ["h1"],
  );
});

test("default imports and named aliases resolve to the same canonical component", async () => {
  const entry = await source(
    "Page.tsx",
    `import Primary from './Button';
import { Action as Secondary } from './Button';
export default function Page() { return <main><Primary title="A" /><Secondary title="B" /></main>; }`,
  );
  await source(
    "Button.tsx",
    `export function Action({ title }) { return <button>{title}</button>; }
export default Action;`,
  );
  const program = await compile(entry);
  expect(program.components).toHaveLength(2);
  const page = program.components.find((c) => c.name === program.entry)!;
  const children = elements(page.body)[0]!.children;
  expect(children[0]!.kind).toBe("component");
  expect(children[1]!.kind).toBe("component");
  if (children[0]!.kind === "component" && children[1]!.kind === "component") {
    expect(children[0]!.name).toBe(children[1]!.name);
    expect(children[0]!.id).not.toBe(children[1]!.id);
  }
});

test("state initializes after its seed constant and before a derived constant", async () => {
  const entry = await source(
    "Counter.tsx",
    `import { useState } from 'preact/hooks';
const seed = 7;
export function Counter() {
  const [count, setCount] = useState(seed);
  const doubled = count * 2;
  return <button onClick={() => setCount(count + 1)}>{doubled}</button>;
}`,
  );
  const counter = (await compile(entry)).components[0]!;
  expect(counter.initializers).toEqual([
    { kind: "constant", name: "seed" },
    { kind: "state", name: "count" },
    { kind: "constant", name: "doubled" },
  ]);
  expect(counter.states[0]!.initial).toEqual({ kind: "name", name: "seed" });
});

test("undefined remains distinct from null and overflowing numeric literals fail", async () => {
  const entry = await source(
    "Page.tsx",
    `const absent = undefined; const empty = null;
export function Page() { return <p>{absent === empty}</p>; }`,
  );
  const program = await compile(entry);
  expect(
    program.components[0]!.constants.map((constant) => constant.value),
  ).toEqual([{ kind: "undefined" }, { kind: "literal", value: null }]);
  await expect(
    compile(
      await source(
        "Overflow.tsx",
        `const value = 1e400;
export function Overflow() { return <p>{value}</p>; }`,
      ),
    ),
  ).rejects.toThrow("debe ser finito");
});

test("keyed component identity is rejected instead of degrading to index identity", async () => {
  const entry = await source(
    "Page.tsx",
    `function Counter() { return <span>0</span>; }
export function Page({ items }) { return <main>{items.map(item => <Counter key={item.id} />)}</main>; }`,
  );
  await expect(compile(entry)).rejects.toThrow("key requiere identidad");
});

test("package adapters are optional and unavailable external components fail explicitly", async () => {
  const entry = await source(
    "Page.tsx",
    `import { Button as Action, Card } from '@example/design';
export function Page({ onSave }) { return <Card><Action onClick={() => onSave()}>Guardar</Action></Card>; }`,
  );
  await expect(compile(entry)).rejects.toThrow(
    "Componente externo sin adaptador",
  );
  const program = await compile(entry, undefined, {
    adapters: { "@example/design": { Button: "Button", Card: "Card" } },
  });
  const card = program.components[0]!.body[0]!;
  expect(card.kind).toBe("component");
  if (card.kind === "component") {
    expect(card.name).toBe("$ui.Card");
    expect(card.children[0]!.kind).toBe("element");
    if (card.children[0]!.kind === "element") {
      expect(card.children[0]!.attrs["data-native-component"]).toEqual({
        kind: "literal",
        value: "Button",
      });
      expect(card.children[0]!.events.onClick!.steps[0]!.name).toBe("onSave");
    }
  }
});

test("source hashes and IDs are deterministic, and source changes alter the hash", async () => {
  const entry = await source(
    "Page.tsx",
    `export function Page() { return <main><p>Hola</p></main>; }`,
  );
  const first = await compile(entry);
  expect(await compile(entry)).toEqual(first);
  await writeFile(
    entry,
    (await readFile(entry, "utf8")).replace("Hola", "Adiós"),
  );
  const second = await compile(entry);
  expect(second.entry).toBe(first.entry);
  expect(second.sources[0]!.hash).not.toBe(first.sources[0]!.hash);
});

test("SSR, unknown hooks, DOM, network and unknown callbacks are never skipped", async () => {
  const cases: [string, string, string][] = [
    [
      "Page.astro",
      `---\nconst data = await fetch('/api/private');\n---\n<p>{data}</p>`,
      "no convertible",
    ],
    [
      "Page.tsx",
      `import { useEffect } from 'preact/hooks';\nexport function Page() { useEffect(() => {}, []); return <p>Hola</p>; }`,
      "otros efectos",
    ],
    [
      "Page.tsx",
      `export function Page() { return <p>{document.title}</p>; }`,
      "Binding desconocido: document",
    ],
    [
      "Page.tsx",
      `export function Page() { const data = fetch('/api'); return <p>{data}</p>; }`,
      "no convertible",
    ],
    [
      "Page.tsx",
      `export function Page() { return <button onClick={() => save()}>Guardar</button>; }`,
      "no declarada en props",
    ],
    [
      "Page.tsx",
      `export function Page() { return <div dangerouslySetInnerHTML={{__html: '<p>x</p>'}} />; }`,
      "depende del DOM",
    ],
    [
      "Page.astro",
      `---\nconst title = Astro.locals.title;\n---\n<p>{title}</p>`,
      "depende de SSR",
    ],
  ];
  for (const [path, text, message] of cases) {
    await expect(compile(await source(path, text))).rejects.toThrow(message);
  }
});

test("spread, duplicate IDs, complex setters and recursive components fail with locations", async () => {
  const cases = [
    `export function Page({ extra }) { return <div {...extra} />; }`,
    `export function Page() { return <main><p id="same" /><p id="same" /></main>; }`,
    `import { useState } from 'preact/hooks'; export function Page() {
      const [value, setValue] = useState(0);
      return <button onClick={() => setValue(current => { return current + 1; })} />;
    }`,
    `export function Page() { return <Page />; }`,
  ];
  for (const text of cases) {
    try {
      await compile(await source("Page.tsx", text));
      throw new Error("La conversión aceptó una construcción no soportada.");
    } catch (error) {
      expect(error).toBeInstanceOf(ConversionError);
      expect((error as Error).message).toMatch(/^Page\.tsx:\d+:\d+: /);
    }
  }
});

test("styles and attributes reach the emitter instead of being discarded", async () => {
  const entry = await source(
    "Page.tsx",
    `export function Page({ label }) {
    return <div id="box" className="grid gap-4" style={{ padding: 10.5 }} aria-label={label}>
      <span>Hola </span>{label}
    </div>;
  }`,
  );
  const program = await compile(entry);
  const box = elements(program.components[0]!.body)[0]!;
  expect(box.id).toBe("box");
  expect(box.attrs.className).toEqual({ kind: "literal", value: "grid gap-4" });
  expect(box.attrs.style).toEqual({
    kind: "object",
    entries: { padding: { kind: "literal", value: 10.5 } },
  });
  expect(box.attrs["aria-label"]).toEqual({ kind: "name", name: "label" });
  expect(elements(box.children)[0]!.children[0]!).toEqual({
    kind: "text",
    value: { kind: "literal", value: "Hola " },
  });
});
