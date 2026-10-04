// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const responsiveTextStyle =
  "flexBasis:80,minWidth:0,minHeight:0,boxSizing:'border-box',height:32,margin:0,fontFamily:'AstroNoto',fontStyle:'normal',fontSize:14,lineHeight:'20px',fontWeight:400,textAlign:'left',whiteSpace:'nowrap',color:'#112233'";
const responsiveControlReset =
  ",appearance:'none',paddingTop:0,paddingRight:8,paddingBottom:0,paddingLeft:8,borderWidth:0,borderStyle:'solid',borderColor:'#112233',borderRadius:0,backgroundColor:'#ffffff'";
const responsiveLeaf = (leaf: string) =>
  `export function Page() { return <main id="root" style={{display:'flex',width:'100%',height:80,boxSizing:'border-box'}}>${leaf}</main>; }`;

test("responsive text and native controls emit complete literal typography and resets", async () => {
  const source = await program(`import {useState} from 'preact/hooks';
    export function Page() { const [value,setValue]=useState('A');return <main id="root"
      style={{display:'flex',width:'100%',height:80,boxSizing:'border-box'}}>
      <span id="text" style={{${responsiveTextStyle}}}>{value}</span>
      <input id="input" type="text" value={value} disabled={false}
        onInput={event=>setValue(event.currentTarget.value)}
        onChange={event=>setValue(event.currentTarget.value)}
        style={{${responsiveTextStyle}${responsiveControlReset}}}/>
      <button id="button" type="button" onClick={()=>setValue('B')}
        style={{${responsiveTextStyle}${responsiveControlReset}}}>Change</button>
    </main>; }`);
  const go = emitGo(source, options);
  for (const field of [
    'FontFamily: "AstroNoto"',
    'FontStyle: "normal"',
    "FontSize: 14",
    "LineHeight: 20",
    "FontWeight: 400",
    'TextAlign: "left"',
    'WhiteSpace: "nowrap"',
    "MarginSet: true",
    'Appearance: "none"',
    "PaddingTop: 0",
    "PaddingRight: 8",
    "BorderWidth: 0",
    "Radius: 0",
    "OnChange: func(value string)",
    "OnCommit: func(value string)",
    "OnTap: func()",
    "Disabled: webui.Truth(false)",
  ])
    expect(go).toContain(field);
  expect(go).toContain('Text: webui.ChildText(webui.Get(scope, "value"))');
  expect(go).toContain(
    'pending["value"] = webui.Get(webui.Get(webui.Get(eventScope, "event"), "currentTarget"), "value")',
  );
});

test("numeric Preact line height is a multiplier of explicit pixel font size independent of declaration order", async () => {
  for (const declarations of [
    "lineHeight:1.5,fontSize:14",
    "fontSize:'16px',lineHeight:1.5",
  ]) {
    const source = await program(
      responsiveLeaf(
        `<span id="text" style={{${responsiveTextStyle.replace(
          "fontSize:14,lineHeight:'20px'",
          declarations,
        )}}}>Label</span>`,
      ),
    );
    const go = emitGo(source, options);
    expect(go).toContain(
      `LineHeight: ${declarations.includes("16px") ? 24 : 21}`,
    );
    expect(go).not.toContain("LineHeight: 1.5");
  }
  const absolute = await program(
    `export function Page() { return <span style={{fontSize:14,lineHeight:'20px'}}>Label</span>; }`,
  );
  expect(emitGo(absolute, options)).toContain("LineHeight: 20");
  for (const declaration of [
    "lineHeight:1.5",
    "fontSize:'1rem',lineHeight:1.5",
    "fontSize:0,lineHeight:1.5",
  ]) {
    const invalid = await program(
      `export function Page() { return <span style={{${declaration}}}>Label</span>; }`,
    );
    expect(() => emitGo(invalid, options)).toThrow();
  }
});

test("responsive typography rejects unresolved families and unsupported text formatting", async () => {
  for (const [property, initial, replacements] of [
    [
      "fontFamily",
      "'AstroNoto'",
      [
        "''",
        "'AstroNoto,serif'",
        "'var(--font)'",
        "'inherit'",
        "'serif'",
        "42",
      ],
    ],
    ["fontStyle", "'normal'", ["'oblique'", "1"]],
    ["textAlign", "'left'", ["'justify'", "'start'", "1"]],
    ["whiteSpace", "'nowrap'", ["'normal'", "'pre'", "1"]],
    ["fontWeight", "400", ["'400px'", "'bold'", "0", "1001", "400.5"]],
    ["fontSize", "14", ["0", "1e-100"]],
    ["lineHeight", "'20px'", ["'0px'", "'1.5'", "0"]],
  ] as const)
    for (const replacement of replacements) {
      const invalid = await program(
        responsiveLeaf(
          `<span id="text" style={{${responsiveTextStyle.replace(property + ":" + initial, property + ":" + replacement)}}}>Label</span>`,
        ),
      );
      expect(() => emitGo(invalid, options)).toThrow("text:");
    }
  const quoted = await program(
    responsiveLeaf(
      `<span id="text" style={{${responsiveTextStyle
        .replace("fontFamily:'AstroNoto'", `fontFamily:'"Astro Noto"'`)
        .replace("fontStyle:'normal'", "fontStyle:'italic'")
        .replace("textAlign:'left'", "textAlign:'right'")}}}>Label</span>`,
    ),
  );
  const go = emitGo(quoted, options);
  expect(go).toContain('FontFamily: "\\\"Astro Noto\\\""');
  expect(go).toContain('FontStyle: "italic"');
  expect(go).toContain('TextAlign: "right"');
});

test("responsive controls require declared resets and supported semantic control types", async () => {
  for (const property of [
    "fontFamily",
    "fontStyle",
    "fontSize",
    "lineHeight",
    "fontWeight",
    "textAlign",
    "whiteSpace",
    "color",
    "margin",
    "appearance",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderWidth",
    "borderStyle",
    "borderColor",
    "borderRadius",
    "backgroundColor",
  ]) {
    const style = (responsiveTextStyle + responsiveControlReset)
      .split(",")
      .filter((declaration) => !declaration.startsWith(property + ":"))
      .join(",");
    const invalid = await program(
      responsiveLeaf(`<input id="input" type="text" style={{${style}}}/>`),
    );
    expect(() => emitGo(invalid, options)).toThrow(property);
  }
  for (const type of ["", 'type="email"', 'type="search"']) {
    const invalid = await program(
      responsiveLeaf(
        `<input id="input" ${type} style={{${responsiveTextStyle}${responsiveControlReset}}}/>`,
      ),
    );
    expect(() => emitGo(invalid, options)).toThrow("type=text");
  }
  const button = await program(
    responsiveLeaf(
      `<button id="button" style={{${responsiveTextStyle}${responsiveControlReset}}}>Save</button>`,
    ),
  );
  expect(() => emitGo(button, options)).toThrow("type=button");
  for (const [property, before, after] of [
    ["appearance", "'none'", "'auto'"],
    ["margin", "0", "1"],
    ["margin", "0", "'auto'"],
  ]) {
    const invalid = await program(
      responsiveLeaf(
        `<input id="input" type="text" style={{${(responsiveTextStyle + responsiveControlReset).replace(property + ":" + before, property + ":" + after)}}}/>`,
      ),
    );
    expect(() => emitGo(invalid, options)).toThrow(property);
  }
});

test("responsive padding shorthand resets all four sides and preserves explicit zero", async () => {
  for (const padding of [0, 4]) {
    const reset = responsiveControlReset.replace(
      "paddingTop:0,paddingRight:8,paddingBottom:0,paddingLeft:8",
      "padding:" + padding,
    );
    const source = await program(
      responsiveLeaf(
        `<button id="button" type="button" style={{${responsiveTextStyle}${reset}}}>Save</button>`,
      ),
    );
    const go = emitGo(source, options);
    for (const side of ["Top", "Right", "Bottom", "Left"])
      expect(go).toContain("Padding" + side + ": " + padding);
  }
  const invalid = await program(
    responsiveLeaf(
      `<button id="button" type="button" style={{${responsiveTextStyle}${responsiveControlReset.replace(
        "paddingTop:0,paddingRight:8,paddingBottom:0,paddingLeft:8",
        "padding:'0 8px'",
      )}}}>Save</button>`,
    ),
  );
  expect(() => emitGo(invalid, options)).toThrow("padding");
});

test("responsive bitmap metadata uses declared dimensions without changing legacy sizing", async () => {
  await writeFile(
    join(directory, "bitmap.png"),
    await readFile(
      new URL("../example/public/images/local-image.png", import.meta.url),
    ),
  );
  const imageStyle =
    "flexBasis:16,minWidth:0,minHeight:0,boxSizing:'border-box',width:16,height:16,display:'block',margin:0,padding:0,borderWidth:0,borderRadius:0";
  const source = await program(
    responsiveLeaf(
      `<img id="image" src="./bitmap.png" alt="" style={{${imageStyle}}}/>`,
    ),
  );
  const go = emitGo(source, options);
  expect(go).toContain('Kind: "image"');
  expect(go).toContain("Basis: webui.FlexValue(16)");
  expect(go).toContain("Width: 16");
  expect(go).toContain("Height: 16");
  expect(go).toContain("WidthSet: true");
  expect(go).toContain("HeightSet: true");
  for (const property of [
    "display",
    "margin",
    "padding",
    "borderWidth",
    "borderRadius",
    "width",
    "height",
  ]) {
    const style = imageStyle
      .split(",")
      .filter((item) => !item.startsWith(property + ":"))
      .join(",");
    const invalid = await program(
      responsiveLeaf(`<img id="image" src="./bitmap.png" style={{${style}}}/>`),
    );
    expect(() => emitGo(invalid, options)).toThrow("image:");
  }
  const legacy = await program(
    `export function Page() { return <img id="image" src="./bitmap.png"/>; }`,
  );
  expect(emitGo(legacy, options)).toContain(
    "Style: webui.Style{Width: 16, Height: 16}",
  );
});

test("object initializer callbacks retain source order across integer-like keys", async () => {
  const source = await program(`export function Page({t}) {
    const record = {z:t('first'), '2':t('second'), '1':t('third')};
    return <p>{String(record)}</p>;
  }`);
  const go = emitGo(source, options);
  const first = go.indexOf('actions["t"]("first")');
  const second = go.indexOf('actions["t"]("second")');
  const third = go.indexOf('actions["t"]("third")');
  expect(first).toBeGreaterThan(-1);
  expect(second).toBeGreaterThan(first);
  expect(third).toBeGreaterThan(second);
  const object = source.components.find((item) => item.name === source.entry)!
    .constants[0]!.value;
  if (object.kind !== "object") throw new Error("missing record literal");
  object.order = ["z", "2", "2"];
  expect(() => emitGo(source, options)).toThrow("orden de inicialización");
  for (const invalid of [null, false, 0, ["z", "2", 1], ["z", "2"]]) {
    object.order = invalid as unknown as string[];
    expect(() => emitGo(source, options)).toThrow("orden de inicialización");
  }
});

test("HTML input and change events keep distinct immediate and commit callbacks", async () => {
  const source =
    await program(`export function Page({onEdit,onCommit}) { return <input
    onInput={event=>onEdit(event.currentTarget.value)}
    onChange={event=>onCommit(event.currentTarget.value)} />; }`);
  const go = emitGo(source, options);
  expect(go).toContain("OnChange: func(value string)");
  expect(go).toContain("OnCommit: func(value string)");
  expect(go).toContain("view.SetAutoRefreshEvents(false)");
});

test("native identities use source sites even when public DOM IDs change", async () => {
  const source = await program(
    `export function Page({domID,value}) { return <main>{value}<input id={domID} /></main>; }`,
  );
  const root = source.components.find((item) => item.name === source.entry)!
    .body[0]!;
  if (root.kind !== "element") throw new Error("missing main");
  const input = root.children.find((item) => item.kind === "element")!;
  if (input.kind !== "element") throw new Error("missing input");
  const go = emitGo(source, options);
  expect(go).toContain(`Identity: prefix + ${JSON.stringify("/" + input.id)}`);
  expect(go).toContain('ID: webui.String(webui.Get(scope, "domID"))');
  expect(go).toContain('Identity: prefix + "/text_0"');
});

test("compatible component branches share the same hook-state prefix", async () => {
  const source = await program(`import {useState} from "preact/hooks";
function Counter({seed}) { const [count,setCount] = useState(seed); return <p>{count}</p>; }
export function Page({active}) { return <main>{active ? <Counter seed={1}/> : <Counter seed={2}/>}</main>; }`);
  const root = source.components.find((item) => item.name === source.entry)!
    .body[0]!;
  if (root.kind !== "element") throw new Error("missing main");
  const branch = root.children[0]!;
  if (branch.kind !== "conditional") throw new Error("missing branch");
  const component = branch.yes[0]!;
  if (component.kind !== "component") throw new Error("missing Counter");
  const expected = `prefix + ${JSON.stringify("/" + component.identity)}`;
  expect(emitGo(source, options).split(expected)).toHaveLength(3);
});

test("JSX short circuit evaluates its host action once for either result", async () => {
  for (const result of ["truthy", "falsy"]) {
    const source = await program(
      `export function Page() { return <main>{t("${result}") && <section id="child" />}</main>; }`,
    );
    const go = emitGo(source, options);
    const call = `actions["t"]("${result}")`;
    expect(go.split(call)).toHaveLength(2);
    expect(go).toContain(`left := ${call}; if webui.Truth(left)`);
    expect(go).toContain("webui.ChildText(left)");
    expect(go).toContain('Identity: prefix + "/text_0"');
  }
});

test("Boolean JSX short circuit evaluates once without a falsy text node", async () => {
  const source = await program(
    `export function Page() { return <main>{Boolean(t("condition")) && <section id="child" />}</main>; }`,
  );
  const go = emitGo(source, options);
  expect(go.split('actions["t"]("condition")')).toHaveLength(2);
  expect(go).toContain(
    'left := webui.Truth(actions["t"]("condition")); if webui.Truth(left)',
  );
  expect(go).not.toContain("webui.ChildText(left)");
});

test("each array keeps its source-site group in the enclosing component namespace", async () => {
  const source = await program(`export function Page() {
    return <main>{['a'].map(item => <input key={item} id={item}/>)}{['b'].map(item => <input key={item} id={item}/>)}</main>;
  }`);
  const root = source.components.find((item) => item.name === source.entry)!
    .body[0]!;
  if (root.kind !== "element") throw new Error("missing main");
  const groups = root.children.filter((node) => node.kind === "each");
  expect(groups).toHaveLength(2);
  expect(groups[0]!.id).not.toBe(groups[1]!.id);
  const go = emitGo(source, options);
  for (const group of groups)
    expect(go).toContain(
      `}; return webui.GroupList(result, prefix + ${JSON.stringify("/" + group.id)})`,
    );
});

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

test("measured CSS attributes stay state-bound instead of disappearing into a stale profile", async () => {
  const source = await program(`export function Page({active}) {
    return <main id="root"><div id="panel" className={active ? "red" : "blue"}
      style={{backgroundColor: active ? "#ff0000" : "#0000ff"}} aria-label={active}/></main>;
  }`);
  const go = emitGo(source, {
    ...options,
    measurements: {
      schema: 1,
      sourceHash: sourceHash(source),
      state: "default",
      viewport: { width: 100, height: 30, scale: 1 },
      nodes: {
        root: { measured: true, width: 100, height: 30, opacity: 1 },
        panel: { measured: true, width: 100, height: 30, opacity: 1 },
      },
    },
  });
  expect(go).toContain("capturedAttrs := webui.Scope{");
  expect(go).toContain(
    'CaptureSignature: webui.SnapshotAttributes("div", capturedAttrs)',
  );
  expect(go).toContain(
    '"className": func() any { if webui.Truth(webui.Get(scope, "active"))',
  );
  expect(go).toContain('"style": webui.Scope{"backgroundColor": func() any');
  expect(go).toContain('"aria-label": webui.Get(scope, "active")');
});

test("capture signatures reuse evaluated attributes without extra host calls", async () => {
  const source = await program(
    `export function Page() { return <input id="field" value={t("seed")}/>; }`,
  );
  const go = emitGo(source, {
    ...options,
    measurements: {
      schema: 1,
      sourceHash: sourceHash(source),
      state: "default",
      viewport: { width: 100, height: 30, scale: 1 },
      nodes: { field: { measured: true, width: 100, height: 30, opacity: 1 } },
    },
  });
  expect(go.split('actions["t"]("seed")')).toHaveLength(2);
  expect(go).toContain(
    'Value: webui.String(webui.Get(capturedAttrs, "value"))',
  );
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

test("array and ordinary object conversions use the native ECMAScript projection boundary", async () => {
  const source = await program(`export function Page() { return <main>
    <p>{Number([])}{Number([null])}{Number([1,2])}{Number({})}</p>
    <p>{String([null,undefined,[1,2]])}{String({valueOf:7})}{String({toString:null})}</p>
    <p>{[] + 1}{1 + [2]}{({}) + ''}{[2] < [11]}{[] <= [1]}{'2' >= [11]}</p>
    <p>{String({constructor:'own',toString:3}.toString)}</p>
  </main>; }`);
  const go = emitGo(source, options);
  for (const expression of [
    "webui.Number([]any{})",
    "webui.Number([]any{nil})",
    "webui.Number([]any{float64(1), float64(2)})",
    "webui.Number(webui.Scope{})",
    "webui.String([]any{nil, webui.Undefined, []any{float64(1), float64(2)}})",
    'webui.String(webui.Scope{"valueOf": float64(7)})',
    'webui.String(webui.Scope{"toString": nil})',
    'webui.Binary("+", []any{}, float64(1))',
    'webui.Binary("+", float64(1), []any{float64(2)})',
    'webui.Binary("+", webui.Scope{}, "")',
    'webui.Binary("<", []any{float64(2)}, []any{float64(11)})',
    'webui.Binary("<=", []any{}, []any{float64(1)})',
    'webui.Binary(">=", "2", []any{float64(11)})',
    'webui.String(webui.Get(webui.Scope{"constructor": "own", "toString": float64(3)}, "toString"))',
  ]) {
    expect(go).toContain(`webui.ChildText(${expression})`);
  }
});

test("the generated constructor reports invalid native trees before returning a widget", async () => {
  const source = await program(
    `export function Page() { return <p>Hola</p>; }`,
  );
  const go = emitGo(source, options);
  const construction = go.indexOf("view = webui.NewViewForWidget(");
  const errorCheck = go.indexOf(
    "if err := view.Error(); err != nil { return nil, err }",
    construction,
  );
  const success = go.indexOf("return generated, nil", construction);
  expect(construction).toBeGreaterThan(-1);
  expect(errorCheck).toBeGreaterThan(construction);
  expect(success).toBeGreaterThan(errorCheck);
});

test("the generated wrapper owns Fyne's renderer before the initial render", async () => {
  const source = await program(
    `export function Page() { return <input id="field" />; }`,
  );
  const go = emitGo(source, options);
  expect(go).toContain("var generated *PageWidget");
  expect(go).toContain(
    "webui.NewViewForWidget(func(v *webui.View) fyne.Widget { generated = &PageWidget{View:v}; return generated }, func() []webui.Node",
  );
  expect(go).toContain("return generated, nil");
  expect(go).not.toContain("return &PageWidget{View:view}, nil");
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
    `export function Page() { return <div style={{width:'50%'}} />; }`,
  );
  expect(() => emitGo(source, options)).toThrow(
    "width necesita px/rem o captura",
  );
});

test("responsive flex emits explicit zero, unset defaults and percentage metadata", async () => {
  const source = await program(`export function Page() { return <main id="root"
    style={{display:'flex',width:'100%',height:120,boxSizing:'border-box',gap:'8px',
      justifyContent:'space-evenly',alignItems:'stretch'}}>
    <section id="item" style={{flexBasis:'40px',minWidth:0,minHeight:'0px',
      boxSizing:'border-box',width:0,height:'100%',flexGrow:0.25,flexShrink:0,
      alignSelf:'center',backgroundColor:'#123456'}} />
  </main>; }`);
  const go = emitGo(source, options);
  for (const field of [
    'Display: "flex"',
    'Direction: "row"',
    "Flex: &webui.FlexStyle{",
    "WidthPercent: webui.FlexValue(100)",
    "HeightPercent: webui.FlexValue(100)",
    "WidthSet: true",
    "HeightSet: true",
    "Width: 0",
    "Height: 120",
    "Gap: 8",
    'JustifyContent: "space-evenly"',
    'AlignItems: "stretch"',
    'AlignSelf: "center"',
    'BoxSizing: "border-box"',
    "Basis: webui.FlexValue(40)",
    "MinWidth: webui.FlexValue(0)",
    "MinHeight: webui.FlexValue(0)",
    "Grow: webui.FlexValue(0.25)",
    "Shrink: webui.FlexValue(0)",
  ])
    expect(go).toContain(field);
  expect(go).not.toContain("Width: 100");
  expect(go).not.toContain("Height: 100");
  const defaults = await program(`export function Page() { return <div id="root"
    style={{display:'flex',width:'100%',height:100,boxSizing:'border-box'}}>
    <div style={{flexBasis:0,minWidth:0,minHeight:0,boxSizing:'border-box'}}/>
  </div>; }`);
  const defaultGo = emitGo(defaults, options);
  expect(defaultGo).toContain("Basis: webui.FlexValue(0)");
  expect(defaultGo).not.toContain("Grow:");
  expect(defaultGo).not.toContain("Shrink:");
  expect(defaultGo).not.toContain("Width: 0");
});

test("responsive flex keeps column direction and each supported alignment value", async () => {
  for (const justify of [
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
  ]) {
    const source = await program(`export function Page() { return <div
      style={{display:'flex',flexDirection:'column',justifyContent:'${justify}',
        alignItems:'flex-end',alignSelf:'auto',boxSizing:'border-box'}}/>; }`);
    const go = emitGo(source, options);
    expect(go).toContain('Direction: "column"');
    expect(go).toContain(`JustifyContent: "${justify}"`);
    expect(go).toContain('AlignItems: "flex-end"');
    expect(go).toContain('AlignSelf: "auto"');
  }
});

test("responsive flex serializes explicit solid borders and rejects other border styles", async () => {
  const source = await program(`export function Page() { return <main id="root"
    style={{display:'flex',width:'100%',height:100,boxSizing:'border-box',
      borderStyle:'solid',borderWidth:2,borderColor:'#123456'}}/>; }`);
  const go = emitGo(source, options);
  expect(go).toContain('BorderStyle: "solid"');
  expect(go).toContain("BorderWidth: 2");
  expect(go).toContain('BorderColor: "#123456"');
  for (const borderStyle of ["none", "dashed"]) {
    const invalid =
      await program(`export function Page() { return <main id="root"
      style={{display:'flex',borderStyle:'${borderStyle}',borderWidth:2}}/>; }`);
    expect(() => emitGo(invalid, options)).toThrow(
      "CSS borderStyle sin soporte",
    );
  }
  const missing = await program(`export function Page() { return <main id="root"
    style={{display:'flex',width:'100%',height:100,boxSizing:'border-box',borderWidth:2}}/>; }`);
  const missingGo = emitGo(missing, options);
  expect(missingGo).not.toContain("BorderStyle:");
  expect(missingGo).not.toContain("BorderColor:");
  expect(missingGo).toContain(
    "if err := view.Error(); err != nil { return nil, err }",
  );
  for (const declaration of [
    "borderStyle:'solid',borderColor:'#123456'",
    "borderStyle:'solid',borderWidth:0",
  ]) {
    const implicit =
      await program(`export function Page() { return <main id="root"
      style={{display:'flex',${declaration}}}/>; }`);
    expect(() => emitGo(implicit, options)).toThrow(
      "CSS borderStyle solid requiere",
    );
  }
  const zero = await program(`export function Page() { return <main id="root"
    style={{display:'flex',borderStyle:'solid',borderWidth:0,borderColor:'#123456'}}/>; }`);
  const zeroGo = emitGo(zero, options);
  expect(zeroGo).toContain('BorderStyle: "solid"');
  expect(zeroGo).toContain("BorderWidth: 0");
});

test("responsive flex rejects unsupported units, intrinsic sizing and formatting modes", async () => {
  for (const declaration of [
    "flexBasis:'auto'",
    "flexBasis:'50%'",
    "flexBasis:'1rem'",
    "flexGrow:'1'",
    "flexShrink:-1",
    "flexShrink:1e100",
    "minWidth:1",
    "minHeight:'auto'",
    "boxSizing:'content-box'",
    "width:'50%'",
    "height:'100vh'",
    "width:'1rem'",
    "gap:'1rem'",
    "paddingLeft:'1rem'",
    "borderWidth:'1rem'",
    "flexWrap:'nowrap'",
    "flexDirection:'row-reverse'",
    "flex:1",
    "order:1",
    "justifyContent:'start'",
    "alignItems:'baseline'",
    "alignSelf:'baseline'",
    "toString:'ignored'",
  ]) {
    const source =
      await program(`export function Page() { return <main id="root"
      style={{display:'flex',${declaration}}}/>; }`);
    expect(() => emitGo(source, options)).toThrow("root:");
  }
  const missingContext =
    await program(`export function Page() { return <div id="orphan"
    style={{width:'100%'}}/>; }`);
  expect(() => emitGo(missingContext, options)).toThrow("metadata explícita");
  const classes = await program(`export function Page() { return <main id="root"
    className="p-2" style={{display:'flex'}}/>; }`);
  expect(() => emitGo(classes, options)).toThrow("estilos inline sin clases");
});

test("responsive item metadata is emitted before dynamic parents are validated natively", async () => {
  const source = await program(`function Item() { return <section id="item"
    style={{flexBasis:40,flexGrow:1,minWidth:0,minHeight:0,boxSizing:'border-box'}}/>; }
    export function Page({enabled}) { return <main id="root"
      style={{display:'flex',width:'100%',height:100,boxSizing:'border-box'}}>
      {enabled ? <Item/> : <section id="empty"/>}
    </main>; }`);
  const go = emitGo(source, options);
  expect(go).toContain("Basis: webui.FlexValue(40)");
  expect(go).toContain(
    "if err := view.Error(); err != nil { return nil, err }",
  );
});

test("responsive flex validates non-finite public IR values before emitting Go", async () => {
  const source = await program(`export function Page() { return <main id="root"
    style={{display:'flex',flexGrow:1,width:120}}/>; }`);
  const root = source.components.find((item) => item.name === source.entry)!
    .body[0]!;
  if (root.kind !== "element" || root.attrs.style?.kind !== "object")
    throw new Error("missing literal style");
  for (const property of ["flexGrow", "width"])
    for (const value of [NaN, Infinity, -Infinity, 1e100]) {
      root.attrs.style.entries[property] = { kind: "literal", value };
      expect(() => emitGo(source, options)).toThrow("finito");
      root.attrs.style.entries[property] = { kind: "literal", value: 1 };
    }
});

test("measured flex remains frozen geometry and retains its source CSS signature", async () => {
  const source = await program(`export function Page() { return <main id="root"
    className="p-2" style={{display:'flex',flexBasis:'auto',flexWrap:'wrap',gap:'1rem'}}/>; }`);
  const go = emitGo(source, {
    ...options,
    measurements: {
      schema: 1,
      sourceHash: sourceHash(source),
      state: "default",
      viewport: { width: 100, height: 30, scale: 1 },
      nodes: { root: { measured: true, width: 100, height: 30, opacity: 1 } },
    },
  });
  expect(go).not.toContain("Flex: &webui.FlexStyle{");
  expect(go).toContain("Style: webui.Style{}");
  expect(go).toContain('"flexBasis": "auto"');
  expect(go).toContain('"flexWrap": "wrap"');
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

test("only the updater parameter reads pending state while closed-over states keep event values", async () => {
  const compiled = await program(`import {useState} from 'preact/hooks';
export function Page() {
  const [a,setA] = useState(0); const [b,setB] = useState(1);
  return <button onClick={() => { setB(2); setA(current => current + b); setA(current => current + a); }} />;
}`);
  const go = emitGo(compiled, options);
  expect(go).toContain(
    'webui.Binary("+", webui.Get(pending, "a"), webui.Get(eventScope, "b"))',
  );
  expect(go).toContain(
    'webui.Binary("+", webui.Get(pending, "a"), webui.Get(eventScope, "a"))',
  );
  expect(go).not.toContain('webui.Get(pending, "b")');
});

test("an event parameter shadowing the state cannot replace the updater current value", async () => {
  const compiled = await program(`import {useState} from 'preact/hooks';
export function Page() { const [count,setCount] = useState(0); return <input onInput={count => setCount(current => current + 1)} />; }`);
  const go = emitGo(compiled, options);
  expect(go).toContain('eventScope["count"] = webui.Scope');
  expect(go).toContain("pending := cloneScope(scope)");
  expect(go).not.toContain("pending := cloneScope(eventScope)");
  expect(go).toContain('webui.Get(pending, "count")');
});

test("mapped handlers update the component state while loop names keep lexical values", async () => {
  const compiled = await program(`import {useState} from 'preact/hooks';
export function Page() { const [count,setCount] = useState(0); const items=[10,20]; return <main>{items.map(count => <button onClick={() => setCount(current => current + count)} />)}<p>{count}</p></main>; }`);
  const go = emitGo(compiled, options);
  const key = `componentPrefix + "/${compiled.entry}/count"`;
  expect(go).toContain("componentPrefix := prefix");
  expect(go).toContain(`pending["count"] = state[${key}]`);
  expect(go).toContain(`state[${key}] = pending["count"]`);
  expect(go).toContain(
    'webui.Binary("+", webui.Get(pending, "count"), webui.Get(eventScope, "count"))',
  );
});

test("action-only handlers do not force a source render without a state update", async () => {
  const compiled = await program(
    `export function Page({observe}) { return <button onClick={() => observe()}>Observe</button>; }`,
  );
  const go = emitGo(compiled, options);
  const tap = go.slice(go.indexOf("OnTap: func()"));
  expect(tap).toContain('actions["observe"]()');
  expect(tap).not.toContain("refresh()");
});

test("HTML forms require native submission behavior rather than a silent container", async () => {
  for (const body of [
    `<form><input /><button>Submit</button></form>`,
    `<form><button type="button">Click</button></form>`,
  ]) {
    const compiled = await program(
      `export function Page() { return ${body}; }`,
    );
    expect(() => emitGo(compiled, options)).toThrow(
      "semántica submit requiere binding nativo",
    );
  }
  const supported = await program(
    `export function Page({save}) { return <section><button type="button" onClick={()=>save()}>Save</button></section>; }`,
  );
  expect(emitGo(supported, options)).toContain('actions["save"]()');
});
