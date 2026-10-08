// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { compile } from "../src/parser.ts";
import { emitGo, scopeHelper } from "../src/emit.ts";
import { generateProgram } from "../src/program-cli.ts";
import { validateProgramArchive, type ProgramArchive } from "../src/program.ts";

interface Action {
  id: string;
  append?: string;
  focus?: boolean;
}
interface Scenario {
  name: string;
  source: string;
  export: string;
  ids: string[];
  prefix: Action[];
  suffix: Action[];
  follow: Action[];
  props: Record<string, unknown>;
  actions: string[];
  lists: Record<string, string[]>;
  watch: Record<string, string[]>;
}
const root = resolve(import.meta.dir, ".."),
  evidence = join(root, "artifacts/program-roundtrip"),
  native = join(root, "native/.program-roundtrip"),
  web = join(root, "example/src/pages/program-roundtrip");
const tap = (...ids: string[]) => ids.map((id) => ({ id }));
const scenario = async (path: string) =>
  JSON.parse(await readFile(join(root, path), "utf8")) as { ids: string[] };
const cases: Scenario[] = [
  {
    name: "Identity",
    source: "PortableConformance",
    export: "PortableConformance",
    ids: [
      "portable-count",
      "portable-other",
      "portable-value",
      "portable-chain-value",
      "portable-special",
    ],
    prefix: tap("portable-inspect", "portable-noop", "portable-noop"),
    suffix: tap(
      "portable-noop",
      "portable-inspect",
      "portable-advance",
      "portable-inspect",
      "portable-swap",
      "portable-advance",
      "portable-inspect",
      "portable-noop",
    ),
    follow: tap(
      "portable-inspect",
      "portable-advance",
      "portable-inspect",
      "portable-swap",
      "portable-noop",
    ),
    props: { seed: { value: 7, self: null } },
    actions: ["inspect"],
    lists: {},
    watch: {},
  },
  {
    name: "Counter",
    source: "Counter",
    export: "Counter",
    ids: ["count", "name", "greeting", "changed"],
    prefix: [...tap("increment", "increment"), { id: "name", append: "!" }],
    suffix: [
      ...tap("increment"),
      { id: "name", append: "?" },
      ...tap("increment"),
    ],
    follow: [...tap("increment"), { id: "name", append: "+" }],
    props: {},
    actions: [],
    lists: {},
    watch: { input: ["name"] },
  },
  {
    name: "Conformance",
    source: "Conformance",
    export: "Conformance",
    ids: (await scenario("conformance-scenario.json")).ids,
    prefix: tap("left-increment", "left-batch", "left-batch"),
    suffix: tap(
      "ephemeral-increment",
      "toggle-ephemeral",
      "toggle-ephemeral",
      "right-increment",
      "left-batch",
    ),
    follow: tap("left-batch", "right-increment"),
    props: {
      disabledBranch: false,
      retainedText: "kept",
      retainedNumber: 0,
      nullValue: null,
    },
    actions: ["observe", "t"],
    lists: {},
    watch: {},
  },
  {
    name: "Keyed",
    source: "KeyedConformance",
    export: "KeyedConformance",
    ids: [
      ...(await scenario("keyed-scenario.json")).ids,
      "a-input",
      "a-renamed-input",
      "b-input",
      "a-branch-input",
      "side-X-input",
      "side-Z-input",
    ],
    prefix: [
      { id: "a-input", append: "!" },
      ...tap("a-increment"),
      { id: "a-branch-input", append: "!" },
      ...tap("a-branch-increment", "a-branch-toggle", "reorder"),
    ],
    suffix: [
      ...tap("a-increment", "change-input-id"),
      { id: "a-renamed-input", append: "?" },
      ...tap(
        "a-branch-toggle",
        "reorder",
        "toggle-a",
        "toggle-a",
        "change-key",
        "a-increment",
        "swap-primitives",
        "prepend-row",
      ),
      { id: "b-input", append: "!" },
      ...tap("prepend-row", "prepend-row"),
      { id: "side-X-input", focus: true },
      ...tap("update-side-lists", "reset-side-lists"),
      { id: "side-Z-input", focus: true },
      ...tap("update-side-lists"),
    ],
    follow: [
      ...tap("a-increment"),
      { id: "a-renamed-input", append: "+" },
      ...tap("reorder"),
    ],
    props: {},
    actions: [],
    lists: {
      "keyed-list": ["a-row", "b-row", "c-row"],
      "primitive-list": ["x-primitive", "y-primitive"],
      "side-lists": ["side-A-row", "side-X-row", "side-Y-row", "side-Z-row"],
    },
    watch: {
      a: ["a-input", "a-renamed-input"],
      b: ["b-input"],
      branch: ["a-branch-input"],
      x: ["side-X-input"],
      z: ["side-Z-input"],
    },
  },
  {
    name: "Primitives",
    source: "PrimitiveConformance",
    export: "PrimitiveConformance",
    ids: (await scenario("primitive-scenario.json")).ids,
    prefix: tap("observe-order", "next-phase"),
    suffix: tap(
      "observe-order",
      "next-phase",
      "observe-order",
      "next-phase",
      "observe-order",
    ),
    follow: tap("next-phase", "observe-order"),
    props: {},
    actions: ["observeObject", "t"],
    lists: {},
    watch: {},
  },
];
await mkdir(evidence, { recursive: true });
await mkdir(native, { recursive: true });
await mkdir(web, { recursive: true });
await writeFile(
  join(evidence, "scenario.json"),
  JSON.stringify(cases, null, 2) + "\n",
);
await writeFile(
  join(native, "astro_fyne_scope.gen.go"),
  `// Code generated by astro-fyne. DO NOT EDIT.\npackage main\nimport webui "github.com/thinkddr/astro-fyne/native"\n${scopeHelper}`,
);
await copyFile(join(root, "ci/program-roundtrip.go"), join(native, "main.go"));
const programs = new Map();
for (const c of cases) {
  const program = await compile(
    join(root, `example/src/components/${c.source}.tsx`),
    c.export,
    { root },
  );
  programs.set(c.name, program);
  for (const variant of ["Original", "Restored"])
    await writeFile(
      join(native, `${variant}${c.name}.gen.go`),
      emitGo(program, {
        name: variant + c.name,
        packageName: "main",
        portableProgram: true,
      }),
    );
}
const constructors = (variant: string) =>
  cases
    .map(
      (c) =>
        `${JSON.stringify(c.name)}:func(props webui.Scope,actions webui.Actions)(*webui.View,portable,error){widget,err:=New${variant}${c.name}(props,actions);if err!=nil{return nil,nil,err};return widget.View,widget,nil}`,
    )
    .join(",");
await writeFile(
  join(native, "constructors.gen.go"),
  `package main\nimport webui "github.com/thinkddr/astro-fyne/native"\nvar originals=map[string]factory{${constructors("Original")}}\nvar restored=map[string]factory{${constructors("Restored")}}\n`,
);
type Results = Record<
  string,
  { archive: ProgramArchive; frames: unknown[]; events: unknown[] }
>;
async function probe(phase: string): Promise<Results> {
  const process = Bun.spawn(
    [
      "go",
      "run",
      "-race",
      "-p=1",
      "./.program-roundtrip",
      join(evidence, "scenario.json"),
      phase,
    ],
    {
      cwd: join(root, "native"),
      env: { ...Bun.env, GOMAXPROCS: "2" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [output, errors, status] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  await writeFile(join(evidence, `native-${phase}.log`), errors);
  if (status !== 0)
    throw new Error(`Native program ${phase} failed: ${errors}`);
  const results = JSON.parse(output) as Results;
  await writeFile(
    join(evidence, `native-${phase}.json`),
    JSON.stringify(results, null, 2) + "\n",
  );
  return results;
}
const expected = await probe("export");
await writeFile(
  join(web, "_actions.ts"),
  "// Code generated by astro-fyne. DO NOT EDIT.\nexport const actions={t:(key:string)=>key,observe:()=>undefined,observeObject:()=>undefined,inspect:()=>undefined};\n",
);
for (const c of cases) {
  validateProgramArchive(expected[c.name]!.archive);
  const path = join(evidence, `${c.name}.native-program.json`);
  await writeFile(
    path,
    JSON.stringify(expected[c.name]!.archive, null, 2) + "\n",
  );
  const options = {
    program: path,
    out: join(web, c.name),
    name: `Portable${c.name}`,
    direction: "web" as const,
    ...(c.actions.length ? { actionsModule: "../../_actions.ts" } : {}),
  };
  await generateProgram(options);
  await generateProgram({ ...options, check: true });
}

const imports = cases
  .map(
    (c) =>
      `import {${c.export} as Source${c.name}} from "../../components/${c.source}.tsx";\nimport {Portable${c.name}} from "./${c.name}/_Portable${c.name}-program/Portable${c.name}.tsx";`,
  )
  .join("\n");
const entry = join(web, "_probe.tsx");
await writeFile(
  entry,
  `// Code generated by astro-fyne. DO NOT EDIT.
import {h,render,createRef} from "preact";
${imports}
const cases=${JSON.stringify(cases)};
const originals={${cases.map((c) => `${c.name}:Source${c.name}`).join(",")}};
const restored={${cases.map((c) => `${c.name}:Portable${c.name}`).join(",")}};
let active:any,events:any[]=[],refs:Record<string,Element|null>={},handle:any=createRef();
const find=(ids:string[])=>ids.map(id=>document.querySelector("#probe #"+CSS.escape(id))).find(Boolean)??null;
function resetWatch(){refs={};for(const [name,ids] of Object.entries(active.watch)) refs[name]=find(ids as string[]);}
function capture(){
  const nodes:Record<string,string|null>={},lists:Record<string,string[]>={},same:Record<string,boolean>={};
  for(const id of active.ids){const element=find([id]);nodes[id]=element ? element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement ? element.value : element.textContent : null;}
  for(const [id,ids] of Object.entries(active.lists)){const parent=find([id])!;lists[id]=[...parent.querySelectorAll("[id]")].filter(element=>(ids as string[]).includes(element.id)).map(element=>element.id);}
  for(const [name,ids] of Object.entries(active.watch)){const element=find(ids as string[]);same[name]=!!element&&element===refs[name];}
  return {nodes,lists,same,focus:document.activeElement&&document.activeElement!==document.body?document.activeElement.id:""};
}
declare global {interface Window {afyProbe:any}}
window.afyProbe={capture,resetWatch,clearEvents(){events=[];},events(){return events;},export(){return handle.current.exportProgram();},mount(name:keyof typeof originals,variant:"original"|"restored"){
  render(null,document.getElementById("probe")!);active=cases.find(c=>c.name===name)!;events=[];handle=createRef();
  const actions:Record<string,(...args:any[])=>any>={};for(const key of active.actions) actions[key]=(...args:any[])=>{if(key==="inspect"){events.push({action:key,args:[args[0]===args[1],args[0].self===args[0],args[0].self.self===args[1]]});return;}if(key==="t"){if(args[0]==="forbidden-key")throw new Error("optional key evaluated");if(["first","second","third"].includes(args[0]))events.push({action:key,args});return args[0];}events.push({action:key,args});};
  if(name==="Identity" && variant==="original") active.props.seed.self=active.props.seed;
  render(variant==="original"?h(originals[name] as any,{...active.props,...actions}):h(restored[name] as any,{actions,ref:handle}),document.getElementById("probe")!);
}};
`,
);
const built = await Bun.build({
  entrypoints: [entry],
  outdir: join(evidence, "browser"),
  target: "browser",
  format: "esm",
  naming: "probe.js",
});
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
const bundle = built.outputs.find((file) => file.path.endsWith(".js"))!;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return new URL(request.url).pathname === "/probe.js"
      ? new Response(Bun.file(bundle.path), {
          headers: { "Content-Type": "text/javascript" },
        })
      : new Response(
          '<!doctype html><html><body><div id="probe"></div><script type="module" src="/probe.js"></script></body></html>',
          { headers: { "Content-Type": "text/html" } },
        );
  },
});
const browser = await chromium.launch({ headless: true });
const actual: Record<string, unknown> = {},
  follow: Results = {};
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.waitForFunction(() => !!window.afyProbe);
  const settle = () =>
    page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  const blur = async () => {
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    await settle();
  };
  const perform = async (a: Action) => {
    const element = page.locator(`#probe [id=${JSON.stringify(a.id)}]`);
    if (a.focus || a.append) {
      await element.focus();
      if (a.append) {
        await element.press("End");
        await element.pressSequentially(a.append);
      }
    } else
      await element.evaluate((element) => (element as HTMLElement).click());
    await settle();
  };
  for (const c of cases) {
    for (const variant of ["original", "restored"] as const) {
      await page.evaluate(
        ({ name, variant }) => window.afyProbe.mount(name, variant),
        { name: c.name, variant },
      );
      await settle();
      if (variant === "original") for (const a of c.prefix) await perform(a);
      await blur();
      await page.evaluate(() => {
        window.afyProbe.clearEvents();
        window.afyProbe.resetWatch();
      });
      const frames = [await page.evaluate(() => window.afyProbe.capture())];
      for (const a of c.suffix) {
        await perform(a);
        frames.push(await page.evaluate(() => window.afyProbe.capture()));
      }
      const events = await page.evaluate(() => window.afyProbe.events());
      actual[`${c.name}-${variant}`] = { frames, events };
      await writeFile(
        join(evidence, "browser-results.json"),
        JSON.stringify(actual, null, 2) + "\n",
      );
      assert.deepEqual(
        frames,
        expected[c.name]!.frames,
        `${c.name}/${variant}: rendered state, list order, focus or object retention differs`,
      );
      assert.deepEqual(
        events,
        expected[c.name]!.events,
        `${c.name}/${variant}: callback order or closure changed`,
      );
      if (variant === "restored") {
        await blur();
        const archive = (await page.evaluate(() =>
          window.afyProbe.export(),
        )) as ProgramArchive;
        validateProgramArchive(archive);
        assert.equal(
          archive.programHash,
          expected[c.name]!.archive.programHash,
        );
        const path = join(evidence, `${c.name}.browser-program.json`);
        await writeFile(path, JSON.stringify(archive, null, 2) + "\n");
        await generateProgram({
          program: path,
          out: native,
          name: `Restored${c.name}`,
          packageName: "main",
          direction: "native",
        });
        await page.evaluate(() => {
          window.afyProbe.clearEvents();
          window.afyProbe.resetWatch();
        });
        const frames = [await page.evaluate(() => window.afyProbe.capture())];
        for (const a of c.follow) {
          await perform(a);
          frames.push(await page.evaluate(() => window.afyProbe.capture()));
        }
        follow[c.name] = {
          archive,
          frames,
          events: await page.evaluate(() => window.afyProbe.events()),
        };
      }
    }
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
} finally {
  await browser.close();
  server.stop(true);
}
await writeFile(
  join(evidence, "browser-follow.json"),
  JSON.stringify(follow, null, 2) + "\n",
);
const nativeFollow = await probe("restore");
const formatted = Bun.spawn(["gofmt", "-w", native], {
  stdout: "ignore",
  stderr: "pipe",
});
const [formatErrors, formatStatus] = await Promise.all([
  new Response(formatted.stderr).text(),
  formatted.exited,
]);
if (formatStatus !== 0)
  throw new Error(`Formatting native program fixtures failed: ${formatErrors}`);
for (const c of cases) {
  assert.deepEqual(
    nativeFollow[c.name]!.frames,
    follow[c.name]!.frames,
    `${c.name}: browser → Go changed continuation`,
  );
  assert.deepEqual(
    nativeFollow[c.name]!.events,
    follow[c.name]!.events,
    `${c.name}: browser → Go changed callbacks`,
  );
}
const report = {
  schema: 1,
  cases: cases.map((c) => ({
    name: c.name,
    sourceHash: expected[c.name]!.archive.sourceHash,
    programHash: expected[c.name]!.archive.programHash,
    webFrames: (c.suffix.length + 1) * 2,
    restoredGoFrames: c.follow.length + 1,
  })),
  visual: { pixelPerfectVerified: false },
  passed: true,
};
await writeFile(
  join(evidence, "comparison.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `Portable program roundtrip passed: ${cases.length} real sources, ${report.cases.reduce((sum, c) => sum + c.webFrames, 0)} browser frames, ${report.cases.reduce((sum, c) => sum + c.restoredGoFrames, 0)} restored Go frames.`,
);
