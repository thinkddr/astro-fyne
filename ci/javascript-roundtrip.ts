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

const root = resolve(import.meta.dir, ".."),
  evidence = join(root, "artifacts/javascript-roundtrip"),
  native = join(root, "native/.javascript-probe"),
  web = join(root, "example/src/pages/javascript-roundtrip");
const tap = (...ids: string[]) => ids.map((id) => ({ id }));
const scenario = {
  prefix: tap("js-increment", "js-a-increment", "js-optional-increment"),
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
    ...tap("js-programmatic"),
    ...tap("js-reorder", "js-a-increment"),
  ],
  follow: [
    ...tap("js-increment", "js-toggle", "js-toggle", "js-optional-increment"),
  ],
  rejects: [] as { path: string; event: string; contains: string }[],
};
for (const dir of [evidence, native, web])
  await mkdir(dir, { recursive: true });
const initial = await bundleJavascript(
  join(root, "example/src/components/JavascriptConformance.tsx"),
  "JavascriptConformance",
  {},
  ["observe"],
);
await writeFile(join(evidence, "initial.json"), JSON.stringify(initial));
for (const [name, source, event, contains] of [
  [
    "css",
    `export default function Page(){return <p style={{position:"absolute"}}>No adapter</p>}`,
    "",
    "CSS property position",
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
          frame.tag === "input" ? (frame.value ?? "") : text(frame);
      walk(frame.children ?? []);
    }
  };
  walk(frames);
  return values;
};
assert.equal(
  frameValues(nativeResult.frames[0])["js-standard"],
  "true",
  "Date/Math intrinsic shape changed",
);
assert.equal(
  frameValues(nativeResult.frames[0])["js-data"],
  "true|42|false|true",
  "Internal cycles/Maps/special numbers changed",
);
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
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return new URL(request.url).pathname === "/probe.js"
      ? new Response(code, { headers: { "Content-Type": "text/javascript" } })
      : new Response(
          '<html><body><div id="probe"></div><script type="module" src="/probe.js"></script></body></html>',
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
  assert.deepEqual(
    await page.evaluate(() => window.afyJavascript.calls()),
    [],
    "Browser restore repeated native effects",
  );
  const frames = [
    await page.evaluate(() => window.afyJavascript.export().frame),
  ];
  const perform = async (step: { id: string; value?: string }) => {
    if (step.value !== undefined) {
      const input = page.locator(`[id=${JSON.stringify(step.id)}]`);
      await input.selectText();
      await input.pressSequentially(step.value);
      await input.evaluate((element) => (element as HTMLElement).blur());
    } else
      await page
        .locator(`[id=${JSON.stringify(step.id)}]`)
        .evaluate((element) => (element as HTMLElement).click());
    await settle();
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
  const calls = await page.evaluate(() => window.afyJavascript.calls());
  assert.deepEqual(
    normalize(calls),
    normalize(nativeResult.calls),
    "Callback order, lexical closures or effects differ",
  );
  exported = await page.evaluate(() => window.afyJavascript.export());
  await writeFile(
    join(evidence, "browser-program.json"),
    JSON.stringify(exported),
  );
  await validateJavascriptArchive(exported);
  await page.evaluate(() => window.afyJavascript.clear());
  const follow = [exported.frame];
  for (const step of scenario.follow) {
    await perform(step);
    follow.push(await page.evaluate(() => window.afyJavascript.export().frame));
  }
  await writeFile(
    join(evidence, "browser.json"),
    JSON.stringify(
      {
        frames,
        calls,
        follow,
        followCalls: await page.evaluate(() => window.afyJavascript.calls()),
      },
      null,
      2,
    ) + "\n",
  );
  await page.evaluate(() => window.afyJavascript.original());
  await settle();
  for (const step of scenario.prefix) await perform(step);
  await page.evaluate(() => window.afyJavascript.clear());
  const originalValues: Record<string, string>[] = [];
  const originalCapture = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("#probe [id]")].map((element) => [
          element.id,
          element instanceof HTMLInputElement
            ? element.value
            : element.textContent,
        ]),
      ),
    );
  for (let i = 0; i <= scenario.suffix.length; i++) {
    if (i) await perform(scenario.suffix[i - 1]!);
    const values = await originalCapture();
    assert.deepEqual(
      values,
      frameValues(nativeResult.frames[i]),
      "Original browser source differs from native JavaScript",
    );
    originalValues.push(values as Record<string, string>);
  }
  assert.deepEqual(
    normalize(await page.evaluate(() => window.afyJavascript.calls())),
    normalize(nativeResult.calls),
    "Original source callbacks/closures/effects differ",
  );
  await writeFile(
    join(evidence, "original-browser.json"),
    JSON.stringify({ frames: originalValues }, null, 2) + "\n",
  );
  assert.deepEqual(errors, [], "Browser runtime errors");
} finally {
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
      browserFrames: webResult.frames.length * 2 + webResult.follow.length,
      originalBrowserFrames: webResult.frames.length,
      platformDiagnostics: scenario.rejects.length,
      nativeFrames: nativeResult.frames.length + restored.frames.length,
      externalEffectsReplayed: 0,
      codeHash: exported!.codeHash,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `JavaScript roundtrip passed: ${webResult.frames.length * 2 + webResult.follow.length} browser (including ${webResult.frames.length} original-source) and ${nativeResult.frames.length + restored.frames.length} generated-Go frames; replay repeated zero host effects.`,
);
