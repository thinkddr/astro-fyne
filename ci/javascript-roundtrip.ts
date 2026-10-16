// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { strict as assert } from "node:assert";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import {
  bundleJavascript,
  validateJavascriptArchive,
} from "../src/javascript.ts";
import { generateJavascript } from "../src/javascript-cli.ts";
import type {
  JavascriptArchive,
  JavascriptFrame,
} from "../src/javascript-types.ts";
// Declare the browser probe before generated pages or action modules exist.
declare global {
  interface Window {
    afyJavascriptEvents: unknown[][];
    afyJavascript: any;
  }
}

const astro = process.argv.includes("--astro");
const root = resolve(import.meta.dir, ".."),
  evidence = join(
    root,
    astro
      ? "artifacts/astro-javascript-roundtrip"
      : "artifacts/javascript-roundtrip",
  ),
  native = join(
    root,
    astro ? "native/.astro-javascript-probe" : "native/.javascript-probe",
  ),
  web = join(
    root,
    astro
      ? "example/src/pages/astro-javascript-roundtrip"
      : "example/src/pages/javascript-roundtrip",
  );
const tap = (...ids: string[]) => ids.map((id) => ({ id }));
const scenario = astro
  ? {
      prefix: tap("astro-js-script-increment", "astro-js-increment"),
      suffix: [
        ...tap("astro-js-script-increment", "astro-js-increment"),
        { id: "astro-js-input", value: "fyne" },
        ...tap(
          "astro-js-increment",
          "astro-js-script-increment",
          "astro-js-script-increment",
        ),
      ],
      follow: [
        ...tap("astro-js-increment", "astro-js-script-increment"),
        { id: "astro-js-input", value: "astro" },
      ],
      rejects: [] as { path: string; event: string; contains: string }[],
    }
  : {
      prefix: [
        ...tap("js-increment", "js-a-increment", "js-optional-increment"),
        { id: "js-insert-input", value: "edited" },
      ],
      suffix: [
        ...tap(
          "js-reorder",
          "js-b-increment",
          "js-toggle",
          "js-toggle",
          "js-optional-increment",
          "js-increment",
        ),
        { id: "js-input", value: "fyne" },
        { id: "js-uncontrolled", value: "native" },
        ...tap(
          "js-check-controlled",
          "js-check-local",
          "js-check-rerender",
          "js-check-programmatic",
          "js-check-cancelled",
          "js-check-disabled",
          "js-check-readonly",
          "js-check-label",
        ),
        { id: "js-check-controlled", key: "Space" },
        ...tap("js-programmatic"),
        ...tap(
          "js-events-options",
          "js-events-options",
          "js-events-mutation",
          "js-events-mutation",
          "js-events-property",
          "js-events-property",
          "js-events-recursive",
          "js-events-recursive",
        ),
        ...tap("css-increment", "css-mode", "css-increment", "css-disabled"),
        ...tap(...Array<string>(6).fill("js-attrs-step")),
        ...tap("js-reorder", "js-a-increment"),
        ...tap(
          "js-insert-invalid",
          "js-insert-move",
          "js-insert-foreign-self",
          "js-insert-self",
        ),
      ],
      follow: [
        ...tap(
          "js-increment",
          "js-toggle",
          "js-toggle",
          "js-optional-increment",
          "js-check-controlled",
          "js-check-local",
          "js-check-programmatic",
          "js-check-label",
          "css-mode",
          "css-increment",
          "js-events-options",
          "js-events-mutation",
          "js-events-property",
          "js-events-recursive",
          "js-attrs-step",
          "js-attrs-step",
        ),
        { id: "js-insert-input", value: "continued" },
        ...tap(
          "js-insert-invalid",
          "js-insert-move",
          "js-insert-foreign-self",
          "js-insert-self",
        ),
      ],
      rejects: [] as { path: string; event: string; contains: string }[],
    };
for (const dir of [evidence, native, web])
  await mkdir(dir, { recursive: true });
const initial = await bundleJavascript(
  join(
    root,
    astro
      ? "example/src/pages/astro-javascript-original.astro"
      : "example/src/components/JavascriptConformance.tsx",
  ),
  astro ? "default" : "JavascriptConformance",
  astro
    ? {}
    : { data: JSON.parse('{"__proto__":{"count":7},"constructor":"kept"}') },
  astro ? [] : ["observe"],
);
await writeFile(join(evidence, "initial.json"), JSON.stringify(initial));
const rejectionCSSImport = `import ${JSON.stringify(join(root, "example/src/components/javascript-css.css"))};`;
for (const [name, source, event, contains] of [
  [
    "css",
    `export default function Page(){return <p style={{position:"absolute"}}>No adapter</p>}`,
    "",
    "CSS property position",
  ],
  [
    "css-token-width",
    `${rejectionCSSImport}export default function Page(){return <p style={{"--number":"1",width:"var(--number)0px"}}>No fabricated dimension</p>}`,
    "",
    "CSS token adjacency",
  ],
  [
    "css-token-unit",
    `${rejectionCSSImport}export default function Page(){return <p style={{"--number":"12",width:"var(--number)px"}}>No appended unit</p>}`,
    "",
    "CSS token adjacency",
  ],
  [
    "css-token-color",
    `${rejectionCSSImport}export default function Page(){return <p style={{"--hex":"#abc",color:"var(--hex)def"}}>No fabricated color</p>}`,
    "",
    "CSS token adjacency",
  ],
  [
    "css-token-inherited-width",
    `${rejectionCSSImport}export default function Page(){return <section style={{"--number":"1"}}><p style={{width:"var(--number)0px"}}>No inherited token join</p></section>}`,
    "",
    "CSS token adjacency",
  ],
  [
    "css-token-fallback-width",
    `${rejectionCSSImport}export default function Page(){return <p style={{"--number":"1",width:"var(--missing,var(--number)0px)"}}>No fallback token join</p>}`,
    "",
    "CSS token adjacency",
  ],
  [
    "css-token-event-width",
    `${rejectionCSSImport}import {useState} from "preact/hooks";export default function Page(){const[bad,setBad]=useState(false);return <button id="bad" style={{"--number":"1",width:bad?"var(--number)0px":"12px"}} onClick={()=>setBad(true)}>No later token join</button>}`,
    "bad",
    "CSS token adjacency",
  ],
  [
    "checkbox-style",
    `export default function Page(){return <input type="checkbox" style={{width:20}} />}`,
    "",
    "checkbox styles",
  ],
  [
    "measurement",
    `import {useRef,useLayoutEffect} from "preact/hooks";export default function Page(){const ref=useRef();useLayoutEffect(()=>{ref.current.offsetWidth;},[]);return <p ref={ref}>No layout query</p>}`,
    "",
    "DOM property offsetWidth",
  ],
  [
    "property",
    `import {useRef,useLayoutEffect} from "preact/hooks";export default function Page(){const ref=useRef();useLayoutEffect(()=>{ref.current.hidden=true;},[]);return <p ref={ref}>No hidden adapter</p>}`,
    "",
    "DOM property hidden",
  ],
  [
    "async",
    `export default function Page(){return <button id="bad" onClick={async()=>{}}>No event loop</button>}`,
    "bad",
    "Async event handlers",
  ],
  [
    "data",
    `export default function Page({observe}){return <button id="bad" onClick={()=>observe(NaN)}>No JSON data</button>}`,
    "bad",
    "finite JSON",
  ],
  [
    "link",
    `export default function Page(){return <a id="bad" href="/other">No navigation adapter</a>}`,
    "bad",
    "Link navigation",
  ],
] as const) {
  const sourcePath = join(evidence, `reject-${name}.tsx`),
    path = join(evidence, `reject-${name}.json`);
  await writeFile(sourcePath, source);
  await writeFile(
    path,
    JSON.stringify(
      await bundleJavascript(
        sourcePath,
        "default",
        {},
        name === "data" ? ["observe"] : [],
      ),
    ),
  );
  scenario.rejects.push({ path, event, contains });
}
await writeFile(
  join(evidence, "scenario.json"),
  JSON.stringify(scenario, null, 2) + "\n",
);
for (const name of ["JavascriptProbe", "RestoredJavascriptProbe"])
  await generateJavascript({
    program: join(evidence, "initial.json"),
    out: native,
    name,
    packageName: "main",
    direction: "native",
  });
await copyFile(
  join(root, "ci/javascript-roundtrip.go"),
  join(native, "main.go"),
);
async function command(argv: string[], cwd: string) {
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, errors, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(status, 0, `${argv.join(" ")} failed:\n${errors}`);
  return out;
}
await command(["gofmt", "-w", native], root);
const nativeResult = JSON.parse(
  await command(
    [
      "go",
      "run",
      "." + native.slice(join(root, "native").length),
      join(evidence, "scenario.json"),
      "export",
    ],
    join(root, "native"),
  ),
);
const frameValues = (frames: JavascriptFrame[]) => {
  const values: Record<string, string> = {};
  const text = (frame: JavascriptFrame): string =>
    frame.tag === "#text"
      ? (frame.text ?? "")
      : (frame.children ?? []).map(text).join("");
  const walk = (frames: JavascriptFrame[]) => {
    for (const frame of frames) {
      if (frame.attrs?.id)
        values[frame.attrs.id] =
          frame.tag === "input" &&
          (frame.attrs.type ?? "text").replace(/[A-Z]/g, (c) =>
            c.toLowerCase(),
          ) === "checkbox"
            ? String(frame.checked)
            : frame.tag === "input" || frame.tag === "textarea"
              ? (frame.value ?? "")
              : text(frame);
      walk(frame.children ?? []);
    }
  };
  walk(frames);
  return values;
};
type InsertionResult =
  | "ready"
  | {
      operation: string;
      error: string;
      returned: boolean;
      same: boolean;
      parent: string;
      value: string;
      defaultValue: string;
      left: string[];
      right: string[];
    };
type InsertionState = {
  value: string;
  moved: boolean;
  result: InsertionResult;
};
const insertionOrder = (moved: boolean) =>
  moved
    ? ["js-insert-anchor", "js-insert-input"]
    : ["js-insert-input", "js-insert-anchor"];
const insertionOutcomes: Record<
  string,
  { operation: string; error: string; returned: boolean }
> = {
  "js-insert-invalid": {
    operation: "invalid",
    error: "NotFoundError",
    returned: false,
  },
  "js-insert-move": { operation: "move", error: "none", returned: true },
  "js-insert-foreign-self": {
    operation: "foreign-self",
    error: "NotFoundError",
    returned: false,
  },
  "js-insert-self": { operation: "self", error: "none", returned: true },
};
function insertionStep(
  state: InsertionState,
  step: { id: string; value?: string },
): InsertionState {
  if (step.id === "js-insert-input") {
    assert.ok(typeof step.value === "string", "Insertion edit needs a value");
    return { ...state, value: step.value };
  }
  const outcome = insertionOutcomes[step.id];
  if (!outcome) return state;
  const moved = state.moved || outcome.operation === "move";
  return {
    ...state,
    moved,
    result: {
      ...outcome,
      same: true,
      parent: "js-insert-left",
      value: state.value,
      defaultValue: "initial",
      left: insertionOrder(moved),
      right: [],
    },
  };
}
const insertionStart = (): InsertionState => ({
  value: "edited",
  moved: false,
  result: "ready",
});
const insertionFollowStart = () =>
  insertionStep(
    { value: "edited", moved: true, result: "ready" },
    { id: "js-insert-self" },
  );
function assertInsertionValues(
  values: Record<string, string>,
  state: InsertionState,
  label: string,
) {
  assert.equal(
    values["js-insert-input"],
    state.value,
    `Insertion live value differs: ${label}`,
  );
  const result = values["js-insert-result"];
  assert.ok(typeof result === "string", `Missing insertion result: ${label}`);
  assert.deepEqual(
    state.result === "ready" ? result : JSON.parse(result),
    state.result,
    `Insertion outcome differs: ${label}`,
  );
}
function assertInsertionTimeline(
  frames: JavascriptFrame[][],
  steps: { id: string; value?: string }[],
  state: InsertionState,
  label: string,
) {
  assert.equal(
    frames.length,
    steps.length + 1,
    `Missing insertion frames: ${label}`,
  );
  let uid: string | undefined;
  let operations = 0;
  for (const [index, roots] of frames.entries()) {
    if (index) {
      const step = steps[index - 1]!;
      state = insertionStep(state, step);
      if (insertionOutcomes[step.id]) operations++;
    }
    const nodes = new Map<
      string,
      { frame: JavascriptFrame; parent?: string }
    >();
    const visit = (children: JavascriptFrame[], parent?: string) => {
      for (const frame of children) {
        const id = frame.attrs?.id;
        if (id?.startsWith("js-insert-")) {
          assert.equal(
            nodes.has(id),
            false,
            `Duplicate insertion node ${id}: ${label}`,
          );
          nodes.set(id, { frame, parent });
        }
        visit(frame.children ?? [], id);
      }
    };
    visit(roots);
    const input = nodes.get("js-insert-input");
    assert.ok(input, `Missing insertion input: ${label}, frame ${index}`);
    assert.ok(input.frame.uid, `Missing insertion UID: ${label}`);
    uid ??= input.frame.uid;
    assert.equal(
      input.frame.uid,
      uid,
      `Insertion changed virtual identity: ${label}`,
    );
    assert.equal(
      input.parent,
      "js-insert-left",
      `Insertion changed parent: ${label}`,
    );
    assert.equal(
      input.frame.attrs?.value,
      "initial",
      `Insertion changed default value: ${label}`,
    );
    assert.equal(
      input.frame.value,
      state.value,
      `Insertion changed live frame: ${label}`,
    );
    for (const [id, order] of [
      ["js-insert-left", insertionOrder(state.moved)],
      ["js-insert-right", []],
    ] as const) {
      const parent = nodes.get(id);
      assert.ok(parent, `Missing insertion parent ${id}: ${label}`);
      assert.deepEqual(
        (parent.frame.children ?? []).map((child) => child.attrs?.id),
        order,
        `Insertion order differs: ${label}, frame ${index}`,
      );
    }
    assertInsertionValues(
      frameValues(roots),
      state,
      `${label}, frame ${index}`,
    );
  }
  assert.equal(operations, 4, `Missing insertion operations: ${label}`);
}
const attributeFields = {
  input: [
    "tag",
    "type",
    "attr",
    "default",
    "live",
    "checked",
    "defaultChecked",
    "disabled",
    "disabledAttr",
    "note",
  ],
  textarea: ["attr", "default", "live", "text", "disabled"],
  button: ["attr", "live", "disabled", "disabledAttr", "clicks"],
};
// Fixed observations from the DOM contract, independent of either runtime adapter.
const attributeStates = [
  {
    input: [
      "input",
      "TeXt",
      "A\r\nB",
      "A\r\nB",
      "AB",
      false,
      false,
      true,
      "false",
      "null",
    ],
    textarea: [
      null,
      "one\r\ntwo\rthree",
      "one\ntwo\nthree",
      "one\r\ntwo\rthree",
      false,
    ],
    button: ["seed", "seed", true, "false", 0],
    inputFrame: "AB",
  },
  {
    input: [
      "input",
      "TeXt",
      "next\r\ndefault",
      "next\r\ndefault",
      "dirtytext",
      false,
      false,
      false,
      null,
      "null",
    ],
    textarea: [
      null,
      "changed\r\rthree",
      "changed\n\nthree",
      "changed\r\rthree",
      false,
    ],
    button: ["seed", "seed", false, null, 1],
    inputFrame: "dirtytext",
  },
  {
    input: [
      "input",
      "TeXt",
      "null",
      "null",
      "",
      false,
      false,
      true,
      "false",
      "null",
    ],
    textarea: [null, "null", "edited\nvalue\nend", "null", false],
    button: ["null", "null", true, "false", 1],
    inputFrame: "",
  },
  {
    input: ["input", "ChEcKbOx", "", "", "", false, true, false, null, "null"],
    textarea: [
      "ignored",
      "mutated\rdefault",
      "edited\nvalue\nend",
      "mutated\rdefault",
      false,
    ],
    button: ["null", "null", false, null, 2],
    inputFrame: "false",
  },
  {
    input: [
      "input",
      "ChEcKbOx",
      "box\r\nvalue",
      "box\r\nvalue",
      "box\r\nvalue",
      true,
      false,
      false,
      null,
      "null",
    ],
    textarea: [
      "ignored",
      "added\rtail",
      "edited\nvalue\nend",
      "added\rtail",
      false,
    ],
    button: ["button\r\nvalue", "button\r\nvalue", false, null, 2],
    inputFrame: "true",
  },
  {
    input: [
      "input",
      "tExT",
      "pristine\r\nagain",
      "pristine\r\nagain",
      "pristineagain",
      true,
      true,
      false,
      null,
      "null",
    ],
    textarea: ["ignored", "added\rtail", "", "added\rtail", true],
    button: ["button\r\nvalue", "button\r\nvalue", true, "", 2],
    inputFrame: "pristineagain",
  },
  {
    input: ["input", null, null, "", "", true, false, false, null, "null"],
    textarea: ["ignored", "last\r\nbase", "", "last\r\nbase", false],
    button: ["button\r\nvalue", "button\r\nvalue", false, null, 3],
    inputFrame: "",
  },
  {
    input: [
      "input",
      null,
      "null",
      "null",
      "null",
      true,
      false,
      false,
      null,
      "null",
    ],
    textarea: ["ignored", "null", "", "null", false],
    button: ["null", "null", false, null, 4],
    inputFrame: "null",
  },
  {
    input: [
      "input",
      "TEXT",
      null,
      "",
      "finaledit",
      true,
      false,
      false,
      null,
      "null",
    ],
    textarea: ["ignored", "null", "final\ntextarea", "null", false],
    button: ["null", "null", true, "false", 4],
    inputFrame: "finaledit",
  },
];
function assertAttributeValues(
  values: Record<string, string>,
  phase: number,
  label: string,
) {
  const expected = attributeStates[phase];
  assert.ok(expected, `Unexpected attribute phase ${phase}: ${label}`);
  assert.equal(
    typeof values["js-attrs-state"],
    "string",
    `Missing attribute state: ${label}`,
  );
  assert.deepEqual(
    JSON.parse(values["js-attrs-state"]!),
    {
      phase,
      ...Object.fromEntries(
        (Object.keys(attributeFields) as (keyof typeof attributeFields)[]).map(
          (control) => [
            control,
            Object.fromEntries(
              attributeFields[control].map((field, index) => [
                field,
                expected[control][index],
              ]),
            ),
          ],
        ),
      ),
    },
    `DOM attribute/default/live state differs at phase ${phase}: ${label}`,
  );
  assert.equal(
    values["js-attrs-input"],
    expected.inputFrame,
    `Input frame differs at phase ${phase}: ${label}`,
  );
  assert.equal(
    values["js-attrs-textarea"],
    expected.textarea[2],
    `Textarea frame differs at phase ${phase}: ${label}`,
  );
}
function assertAttributeTimeline(
  frames: JavascriptFrame[][],
  steps: { id: string }[],
  initialPhase: number,
  label: string,
) {
  assert.equal(frames.length, steps.length + 1, `Missing frames: ${label}`);
  let phase = initialPhase;
  for (const [index, frame] of frames.entries()) {
    if (index && steps[index - 1]!.id === "js-attrs-step") phase++;
    assertAttributeValues(
      frameValues(frame),
      phase,
      `${label}, frame ${index}`,
    );
  }
  return phase;
}
function assertListenerCalls(calls: unknown[][], phase: "suffix" | "follow") {
  const capture = ["listener-capture", 2, true],
    passive = ["listener-passive", false],
    object = ["listener-object", true, true],
    mutate = ["listener-mutate"],
    late = ["listener-late"],
    regular = ["listener-regular"],
    property = ["listener-property"],
    recursive = ["listener-recursive-tail"];
  const expected =
    phase === "suffix"
      ? [
          capture,
          ["listener-once"],
          passive,
          object,
          capture,
          passive,
          object,
          mutate,
          mutate,
          late,
          regular,
          property,
          regular,
          property,
          ["listener-recursive-once"],
          recursive,
          recursive,
        ]
      : [capture, passive, object, mutate, late, regular, property, recursive];
  assert.deepEqual(
    calls.filter((args) => String(args[0]).startsWith("listener-")),
    expected,
    `DOM listener lifecycle differs during ${phase}`,
  );
}
if (!astro) {
  assert.equal(
    nativeResult.insertionIdentityChecked,
    true,
    "Native insertion pointer checks did not run",
  );
  assertInsertionTimeline(
    nativeResult.frames,
    scenario.suffix,
    insertionStart(),
    "native suffix",
  );
  assert.equal(
    assertAttributeTimeline(
      nativeResult.frames,
      scenario.suffix,
      0,
      "native suffix",
    ),
    6,
  );
  assertListenerCalls(nativeResult.calls, "suffix");
  assert.equal(
    frameValues(nativeResult.frames[0])["js-standard"],
    "true",
    "Date/Math intrinsic shape changed",
  );
  assert.equal(
    frameValues(nativeResult.frames[0])["js-data"],
    "true|42|false|true|true|7|kept",
    "Internal cycles/Maps/special numbers changed",
  );
} else {
  assert.equal(
    frameValues(nativeResult.frames[0])["astro-js-values"],
    "true||NaN|lambda|12|record",
  );
  assert.equal(
    frameValues(nativeResult.frames[0])["astro-js-script-count"],
    "2",
    "Astro repeated a hoisted script for repeated components",
  );
  for (const [id, expected] of Object.entries({
    "astro-js-slot-start": "4",
    "astro-js-slot-parent": "4",
    "astro-js-slot-after": "6",
    "astro-js-header-first": "23",
    "astro-js-header-again": "78",
    "astro-js-slot-default": "D-1",
    "astro-js-slot-missing": "M-9",
    "astro-js-slot-empty": "E",
    "astro-js-forward": "true|falseENTITY",
  }))
    assert.equal(
      frameValues(nativeResult.frames[0])[id],
      expected,
      `Astro slot lifecycle differs at ${id}`,
    );
}
await writeFile(
  join(evidence, "native.json"),
  JSON.stringify(nativeResult, null, 2) + "\n",
);
await writeFile(
  join(evidence, "native-program.json"),
  JSON.stringify(nativeResult.archive),
);
await validateJavascriptArchive(nativeResult.archive);
await generateJavascript({
  program: join(evidence, "native-program.json"),
  out: web,
  name: "JavascriptBrowser",
  direction: "web",
  actionsModule: "../../../javascript-actions.ts",
});
await generateJavascript({
  program: join(evidence, "native-program.json"),
  out: web,
  name: "JavascriptBrowser",
  direction: "web",
  actionsModule: "../../../javascript-actions.ts",
  check: true,
});
await mkdir(join(web, "_probe"), { recursive: true });
const probe = join(web, "_probe/Probe.tsx");
await writeFile(
  probe,
  `import {h,render,createRef} from "preact";
import {JavascriptBrowser} from "../_JavascriptBrowser-javascript/JavascriptBrowser.tsx";
import {JavascriptConformance} from "../../../components/JavascriptConformance.tsx";
import {actions} from "../../../javascript-actions.ts";
const ref=createRef();render(h(JavascriptBrowser,{actions,ref}),document.getElementById("probe")!);
window.afyJavascript={export(){return ref.current.exportJavascript();},calls(){return window.afyJavascriptEvents??[];},clear(){window.afyJavascriptEvents=[];},original(){render(null,document.getElementById("probe")!);window.afyJavascriptEvents=[];render(h(JavascriptConformance,{observe:actions.observe}),document.getElementById("probe")!);}};
`,
);
const built = await Bun.build({
  entrypoints: [probe],
  target: "browser",
  format: "esm",
});
assert.equal(
  built.success,
  true,
  built.logs.map((log) => log.message).join("\n"),
);
const code = await built.outputs[0]!.text();
const originalCSS = (
  await Promise.all(
    built.outputs
      .filter((output) => output.type.startsWith("text/css"))
      .map((output) => output.text()),
  )
).join("\n");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === "/probe.css")
      return new Response(originalCSS, {
        headers: { "Content-Type": "text/css" },
      });
    return new URL(request.url).pathname === "/probe.js"
      ? new Response(code, { headers: { "Content-Type": "text/javascript" } })
      : new Response(
          '<html><head><link rel="stylesheet" href="/probe.css"></head><body><div id="probe"></div><script type="module" src="/probe.js"></script></body></html>',
          { headers: { "Content-Type": "text/html" } },
        );
  },
});
const browser = await chromium.launch({ headless: true }),
  errors: string[] = [];
const normalize = (calls: unknown[][]) =>
  calls.map((args) =>
    args[0] === "closure"
      ? [...args.slice(0, 4), typeof args[4], typeof args[5]]
      : args,
  );
let exported: JavascriptArchive;
const inputReflections: unknown[] = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.url.href);
  await page.waitForFunction(() => !!window.afyJavascript);
  const settle = () =>
    page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  await settle();
  let insertionElement = astro
    ? null
    : await page.locator('[id="js-insert-input"]').elementHandle();
  let browserInsertionState = insertionStart();
  let browserAttributePhase = 0;
  let browserStage = "restored";
  const assertBrowserInputReflection = async (label: string) => {
    if (astro) return;
    const inputs = await page.evaluate(
      (ids) =>
        ids.map((id) => {
          const element = document.getElementById(id);
          if (!(element instanceof HTMLInputElement))
            throw new Error(`Missing reflected input ${id}`);
          return {
            id,
            attr: element.getAttribute("value"),
            default: element.defaultValue,
            live: element.value,
          };
        }),
      ["js-attrs-input", "js-check-controlled", "js-check-local"],
    );
    inputReflections.push({
      stage: browserStage,
      label,
      phase: browserAttributePhase,
      inputs,
    });
    const expected = attributeStates[browserAttributePhase];
    assert.ok(
      expected,
      `Unexpected rendered attribute phase ${browserAttributePhase}`,
    );
    assert.deepEqual(
      inputs,
      [
        {
          id: "js-attrs-input",
          attr: expected.input[2],
          default: expected.input[3],
          live: expected.input[4],
        },
        { id: "js-check-controlled", attr: null, default: "", live: "on" },
        { id: "js-check-local", attr: null, default: "", live: "on" },
      ],
      `Rendered input attribute/default/live state differs at phase ${browserAttributePhase}: ${label}`,
    );
  };
  const assertBrowserInsertion = async (label: string) => {
    if (astro) return;
    assert.ok(insertionElement, `Missing browser insertion input: ${label}`);
    const actual = await insertionElement.evaluate((element) => {
      if (!(element instanceof HTMLInputElement))
        throw new Error("Insertion target is not an input");
      const order = (id: string) => {
        const parent = document.getElementById(id);
        if (!parent) throw new Error(`Missing insertion parent ${id}`);
        return Array.from(parent.childNodes).map((child) => {
          if (!(child instanceof HTMLElement))
            throw new Error("Unexpected insertion child");
          return child.id;
        });
      };
      return {
        same: document.getElementById("js-insert-input") === element,
        count: document.querySelectorAll('[id="js-insert-input"]').length,
        parent: element.parentElement?.id ?? null,
        value: element.value,
        defaultValue: element.defaultValue,
        attr: element.getAttribute("value"),
        left: order("js-insert-left"),
        right: order("js-insert-right"),
        result: document.getElementById("js-insert-result")?.textContent,
      };
    });
    const { result, ...control } = actual;
    assert.deepEqual(
      control,
      {
        same: true,
        count: 1,
        parent: "js-insert-left",
        value: browserInsertionState.value,
        defaultValue: "initial",
        attr: "initial",
        left: insertionOrder(browserInsertionState.moved),
        right: [],
      },
      `Browser insertion identity/tree/value differs: ${label}`,
    );
    assert.ok(
      typeof result === "string",
      `Missing browser insertion result: ${label}`,
    );
    assertInsertionValues(
      { "js-insert-input": actual.value, "js-insert-result": result },
      browserInsertionState,
      label,
    );
  };
  await assertBrowserInsertion("restored browser initial");
  await assertBrowserInputReflection("restored browser initial");
  assert.deepEqual(
    await page.evaluate(() => window.afyJavascript.calls()),
    [],
    "Browser restore repeated native effects",
  );
  const frames = [
    await page.evaluate(() => window.afyJavascript.export().frame),
  ];
  const perform = async (step: {
    id: string;
    value?: string;
    key?: string;
  }) => {
    if (step.key) {
      const input = page.locator(`[id=${JSON.stringify(step.id)}]`);
      await input.press(step.key);
      await input.evaluate((element) => (element as HTMLElement).blur());
    } else if (step.value !== undefined) {
      const input = page.locator(`[id=${JSON.stringify(step.id)}]`);
      await input.selectText();
      await input.pressSequentially(step.value);
      await input.evaluate((element) => (element as HTMLElement).blur());
    } else
      await page
        .locator(`[id=${JSON.stringify(step.id)}]`)
        .evaluate((element) => (element as HTMLElement).click());
    await settle();
    if (!astro) {
      browserInsertionState = insertionStep(browserInsertionState, step);
      if (step.id === "js-attrs-step") browserAttributePhase++;
      await assertBrowserInsertion(`after ${step.id}`);
      await assertBrowserInputReflection(`after ${step.id}`);
    }
  };
  for (const step of scenario.suffix) {
    await perform(step);
    frames.push(await page.evaluate(() => window.afyJavascript.export().frame));
  }
  assert.deepEqual(
    frames,
    nativeResult.frames,
    "Browser and generated Go frames differ",
  );
  if (!astro)
    assertInsertionTimeline(
      frames,
      scenario.suffix,
      insertionStart(),
      "restored browser suffix",
    );
  const calls = await page.evaluate(() => window.afyJavascript.calls());
  if (!astro) assertListenerCalls(calls, "suffix");
  assert.deepEqual(
    normalize(calls),
    normalize(nativeResult.calls),
    "Callback order, lexical closures or effects differ",
  );
  // Transfer archival JSON as a string: Playwright's object deserializer assigns
  // __proto__ keys, changing their data semantics before regeneration.
  exported = JSON.parse(
    await page.evaluate(() => JSON.stringify(window.afyJavascript.export())),
  );
  await writeFile(
    join(evidence, "browser-program.json"),
    JSON.stringify(exported),
  );
  await validateJavascriptArchive(exported);
  assert.ok(exported.frame, "Browser archive is missing its current frame");
  await page.evaluate(() => window.afyJavascript.clear());
  const follow: JavascriptFrame[][] = [exported.frame];
  for (const step of scenario.follow) {
    await perform(step);
    const frame: JavascriptFrame[] | undefined = await page.evaluate(
      () => window.afyJavascript.export().frame,
    );
    assert.ok(frame, `Browser archive is missing its frame after ${step.id}`);
    follow.push(frame);
  }
  const followCalls = await page.evaluate(() => window.afyJavascript.calls());
  if (!astro) {
    assertInsertionTimeline(
      follow,
      scenario.follow,
      insertionFollowStart(),
      "restored browser follow",
    );
    assert.equal(
      assertAttributeTimeline(
        follow,
        scenario.follow,
        6,
        "restored browser follow",
      ),
      8,
    );
  }
  await writeFile(
    join(evidence, "browser.json"),
    JSON.stringify(
      {
        frames,
        calls,
        follow,
        followCalls,
      },
      null,
      2,
    ) + "\n",
  );
  if (!astro) {
    await page.evaluate(() => window.afyJavascript.original());
    await settle();
    await insertionElement?.dispose();
    insertionElement = await page
      .locator('[id="js-insert-input"]')
      .elementHandle();
    browserInsertionState = { value: "initial", moved: false, result: "ready" };
    browserAttributePhase = 0;
    browserStage = "original";
    await assertBrowserInsertion("original browser initial");
    await assertBrowserInputReflection("original browser initial");
    for (const step of scenario.prefix) await perform(step);
    await page.evaluate(() => window.afyJavascript.clear());
    const originalValues: Record<string, string>[] = [];
    const originalFollowValues: Record<string, string>[] = [];
    const originalStyles: unknown[] = [];
    const originalCapture = () =>
      page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll("#probe [id]")].map((element) => [
            element.id,
            element instanceof HTMLInputElement
              ? element.type === "checkbox"
                ? String(element.checked)
                : element.value
              : element instanceof HTMLTextAreaElement
                ? element.value
                : element.textContent,
          ]),
        ),
      );
    let attributePhase = 0;
    for (let i = 0; i <= scenario.suffix.length; i++) {
      if (i) {
        const step = scenario.suffix[i - 1]!;
        await perform(step);
        if (step.id === "js-attrs-step") attributePhase++;
      }
      const values = await originalCapture();
      assertAttributeValues(
        values as Record<string, string>,
        attributePhase,
        `original suffix, frame ${i}`,
      );
      assertInsertionValues(
        values as Record<string, string>,
        browserInsertionState,
        `original suffix, frame ${i}`,
      );
      assert.deepEqual(
        values,
        frameValues(nativeResult.frames[i]),
        "Original browser source differs from native JavaScript",
      );
      // Canonicalize the native cascade in an isolated shadow tree, so the
      // original stylesheet cannot hide a wrong native specificity decision.
      const cssFrames: { id: string; style: Record<string, unknown> }[] = [];
      const collectCSS = (frames: JavascriptFrame[]) => {
        for (const frame of frames) {
          if (frame.attrs?.id?.startsWith("css-"))
            cssFrames.push({ id: frame.attrs.id, style: frame.style ?? {} });
          collectCSS(frame.children ?? []);
        }
      };
      collectCSS(nativeResult.frames[i]);
      const tokenExpectations: Record<string, Record<string, string>> = {
        "css-token-whitespace": {
          width: "120px",
          paddingTop: "2px",
          paddingRight: "4px",
          paddingBottom: "6px",
          paddingLeft: "4px",
        },
        "css-token-rgb": {
          color: "rgb(17, 35, 43)",
          backgroundColor: "rgba(17, 35, 43, 0.5)",
        },
        "css-token-fallback": {
          width: "120px",
          height: "24px",
          color: "rgb(17, 35, 43)",
        },
      };
      for (const [id, properties] of Object.entries(tokenExpectations)) {
        const frame = cssFrames.find((frame) => frame.id === id);
        assert.ok(frame, `Missing CSS token fixture ${id}, step ${i}`);
        for (const property of Object.keys(properties))
          assert.ok(
            Object.hasOwn(frame.style, property),
            `Missing native CSS token property ${id}.${property}, step ${i}`,
          );
      }
      const compared = await page.evaluate((frames) => {
        const host = document.createElement("div"),
          shadow = host.attachShadow({ mode: "open" });
        document.body.appendChild(host);
        try {
          return frames.map(({ id, style }) => {
            const actual = document.getElementById(id)!;
            const expected = document.createElement("div");
            shadow.appendChild(expected);
            for (const [key, value] of Object.entries(style))
              (expected.style as any)[key] =
                typeof value === "number" &&
                !["lineHeight", "fontWeight", "opacity"].includes(key)
                  ? value + "px"
                  : value;
            const a = getComputedStyle(actual),
              b = getComputedStyle(expected),
              keys = Object.keys(style);
            return {
              id,
              actual: Object.fromEntries(
                keys.map((key) => [key, (a as any)[key]]),
              ),
              native: Object.fromEntries(
                keys.map((key) => [key, (b as any)[key]]),
              ),
            };
          });
        } finally {
          host.remove();
        }
      }, cssFrames);
      for (const item of compared)
        assert.deepEqual(
          item.actual,
          item.native,
          `Original CSS cascade differs at ${item.id}, step ${i}`,
        );
      for (const [id, properties] of Object.entries(tokenExpectations)) {
        const item = compared.find((item) => item.id === id);
        assert.ok(item, `Missing computed CSS token fixture ${id}, step ${i}`);
        for (const [property, expected] of Object.entries(properties))
          assert.equal(
            item.actual[property],
            expected,
            `Original CSS token fixture ${id}.${property} differs, step ${i}`,
          );
      }
      originalStyles.push(compared);
      originalValues.push(values as Record<string, string>);
    }
    assertListenerCalls(
      await page.evaluate(() => window.afyJavascript.calls()),
      "suffix",
    );
    assert.deepEqual(
      normalize(await page.evaluate(() => window.afyJavascript.calls())),
      normalize(nativeResult.calls),
      "Original source callbacks/closures/effects differ",
    );
    assert.equal(
      attributePhase,
      6,
      "Missing original-source attribute suffix actions",
    );
    await page.evaluate(() => window.afyJavascript.clear());
    for (let i = 0; i <= scenario.follow.length; i++) {
      if (i) {
        const step = scenario.follow[i - 1]!;
        await perform(step);
        if (step.id === "js-attrs-step") attributePhase++;
      }
      const values = await originalCapture();
      assertAttributeValues(
        values as Record<string, string>,
        attributePhase,
        `original follow, frame ${i}`,
      );
      assertInsertionValues(
        values as Record<string, string>,
        browserInsertionState,
        `original follow, frame ${i}`,
      );
      const followFrame = follow[i];
      assert.ok(followFrame, `Missing restored browser follow frame ${i}`);
      assert.deepEqual(
        values,
        frameValues(followFrame),
        `Original browser source differs from restored follow, frame ${i}`,
      );
      originalFollowValues.push(values as Record<string, string>);
    }
    assert.equal(
      attributePhase,
      8,
      "Missing original-source attribute follow actions",
    );
    const originalFollowCalls = await page.evaluate(() =>
      window.afyJavascript.calls(),
    );
    assertListenerCalls(originalFollowCalls, "follow");
    assert.deepEqual(
      normalize(originalFollowCalls),
      normalize(followCalls),
      "Original source follow callbacks/closures/effects differ",
    );
    await writeFile(
      join(evidence, "original-browser.json"),
      JSON.stringify(
        {
          frames: originalValues,
          styles: originalStyles,
          follow: originalFollowValues,
          followCalls: originalFollowCalls,
        },
        null,
        2,
      ) + "\n",
    );
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
} finally {
  if (!astro)
    await writeFile(
      join(evidence, "browser-input-reflection.json"),
      JSON.stringify({ schema: 1, observations: inputReflections }, null, 2) +
        "\n",
    );
  await browser.close();
  server.stop(true);
}
await generateJavascript({
  program: join(evidence, "browser-program.json"),
  out: native,
  name: "RestoredJavascriptProbe",
  packageName: "main",
  direction: "native",
});
const restored = JSON.parse(
  await command(
    [
      "go",
      "run",
      "." + native.slice(join(root, "native").length),
      join(evidence, "scenario.json"),
      "restore",
    ],
    join(root, "native"),
  ),
);
const webResult = JSON.parse(
  await readFile(join(evidence, "browser.json"), "utf8"),
);
if (!astro) {
  assert.equal(
    restored.insertionIdentityChecked,
    true,
    "Restored native insertion pointer checks did not run",
  );
  assertInsertionTimeline(
    restored.frames,
    scenario.follow,
    insertionFollowStart(),
    "restored native follow",
  );
  assert.equal(
    assertAttributeTimeline(
      restored.frames,
      scenario.follow,
      6,
      "restored native follow",
    ),
    8,
  );
  assertListenerCalls(restored.calls, "follow");
  assertListenerCalls(webResult.followCalls, "follow");
}
assert.deepEqual(
  restored.frames,
  webResult.follow,
  "Browser state/closures did not survive regenerated Go",
);
assert.deepEqual(
  normalize(restored.calls),
  normalize(webResult.followCalls),
  "Restored Go effects differ",
);
await writeFile(
  join(evidence, "restored.json"),
  JSON.stringify(restored, null, 2) + "\n",
);
await command(["gofmt", "-w", native], root);
await writeFile(
  join(evidence, "comparison.json"),
  JSON.stringify(
    {
      passed: true,
      browserFrames:
        (webResult.frames.length + webResult.follow.length) * (astro ? 1 : 2),
      originalBrowserFrames: astro
        ? 0
        : webResult.frames.length + webResult.follow.length,
      platformDiagnostics: scenario.rejects.length,
      nativeFrames: nativeResult.frames.length + restored.frames.length,
      externalEffectsReplayed: 0,
      ...(!astro
        ? {
            insertion: {
              suffixOperations: 4,
              followOperations: 4,
              nativePointerIdentityChecked: true,
              browserElementIdentityChecked: true,
              inputReflectionObservations: inputReflections.length,
            },
          }
        : {}),
      codeHash: exported!.codeHash,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `${astro ? "Astro " : ""}JavaScript roundtrip passed: ${(webResult.frames.length + webResult.follow.length) * (astro ? 1 : 2)} browser (including ${astro ? 0 : webResult.frames.length + webResult.follow.length} original-source) and ${nativeResult.frames.length + restored.frames.length} generated-Go frames; replay repeated zero host effects.`,
);
