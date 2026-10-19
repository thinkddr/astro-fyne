// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import {
  bundleJavascript,
  validateJavascriptArchive,
} from "../src/javascript.ts";
import { generateJavascript } from "../src/javascript-cli.ts";
import type {
  JavascriptArchive,
  JavascriptFrame,
} from "../src/javascript-types.ts";

declare global {
  interface Window {
    afyCSSHas: {
      export(): JavascriptArchive;
      calls(): unknown[][];
      clear(): void;
    };
  }
}

const root = resolve(import.meta.dir, "..");
const out = join(root, "artifacts/css-has-roundtrip");
const native = join(root, "native/.css-has-probe");
const web = join(root, "example/src/pages/css-has-roundtrip");
const source = join(root, "example/src/components/JavascriptCSSHas.tsx");
const targets = [
  "has-desc",
  "has-child",
  "has-adjacent",
  "has-reverse",
  "has-general",
  "has-no-follow",
  "has-chain",
  "has-branch-search",
  "has-sibling-chain",
  "has-sibling-search",
  "has-anchor",
  "has-functional",
  "has-list",
  "has-not",
  "has-is",
  "has-where",
  "has-and",
  "has-specificity",
  "has-is-specificity",
  "has-where-specificity",
  "has-checked",
  "has-disabled",
  "has-move",
  "has-move-desc",
];
const scenario = {
  prefix: ["has-toggle", "has-checkbox", "has-move-button"],
  suffix: [
    "has-toggle",
    "has-disable",
    "has-move-button",
    "has-checkbox",
    "has-toggle",
  ],
  follow: [
    "has-toggle",
    "has-move-button",
    "has-disable",
    "has-checkbox",
    "has-toggle",
    "has-move-button",
  ],
  targets,
};
const allSteps = [...scenario.prefix, ...scenario.suffix, ...scenario.follow];
const checkpointIndex = scenario.prefix.length;
const finalIndex = checkpointIndex + scenario.suffix.length;
const hash = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
type Phase = { name: string; command: string[]; cwd: string; exitCode: number };
type NativeResult = {
  schema: number;
  archive: JavascriptArchive;
  final: JavascriptArchive;
  frames: JavascriptFrame[][];
  usedStyles: Record<
    string,
    { paddingLeft: number; backgroundColor: string }
  >[];
  labels: string[];
  calls: unknown[][];
  identitiesChecked: number;
  hostEffectsRepeatedOnRestore: boolean;
};
type State = {
  active: boolean;
  checked: boolean;
  disabled: boolean;
  direct: boolean;
  moves: number;
};
const phases: Phase[] = [];
const mode = process.argv[2];
assert.ok(
  ["prepare", "verify"].includes(mode ?? "") && process.argv.length === 3,
  "Usage: bun ci/css-has-roundtrip.ts prepare|verify",
);

async function json(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
async function command(name: string, argv: string[], cwd = root) {
  const child = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      GOWORK: "off",
      GOFLAGS: "-mod=readonly",
      GOMAXPROCS: "2",
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  await writeFile(join(out, `${name}.stdout.log`), stdout);
  await writeFile(join(out, `${name}.stderr.log`), stderr);
  phases.push({
    name,
    command: argv,
    cwd: relative(root, cwd) || ".",
    exitCode,
  });
  await json(join(out, `${mode}-phases.json`), phases);
  assert.equal(exitCode, 0, `${name} failed; retained logs in ${out}`);
  return stdout;
}
async function retain(directory: string, target: string) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const from = join(directory, entry.name),
      to = join(target, entry.name);
    if (entry.isDirectory()) await retain(from, to);
    else if (entry.isFile()) await copyFile(from, to);
  }
}
async function nativeProbe(mode: "export" | "restore") {
  const binary = join(out, `css-has-native-${mode}`);
  await command(
    `native-${mode}-build`,
    ["go", "build", "-race", "-p=1", "-o", binary, "./.css-has-probe"],
    join(root, "native"),
  );
  await command(`native-${mode}-build-info`, ["go", "version", "-m", binary]);
  await json(join(out, `native-${mode}-binary.json`), {
    schema: 1,
    path: relative(root, binary),
    hash: hash(await readFile(binary)),
    buildInfoHash: hash(
      await readFile(join(out, `native-${mode}-build-info.stdout.log`)),
    ),
  });
  return JSON.parse(
    await command(`native-${mode}`, [binary, join(out, "scenario.json"), mode]),
  ) as NativeResult;
}
const flatten = (frames: JavascriptFrame[]) => {
  const result = new Map<string, JavascriptFrame>();
  const visit = (nodes: JavascriptFrame[]) => {
    for (const node of nodes) {
      if (node.attrs?.id) {
        assert.equal(
          result.has(node.attrs.id),
          false,
          `Duplicate frame ID ${node.attrs.id}`,
        );
        result.set(node.attrs.id, node);
      }
      visit(node.children ?? []);
    }
  };
  visit(frames);
  return result;
};
const text = (node: JavascriptFrame): string =>
  node.tag === "#text"
    ? (node.text ?? "")
    : (node.children ?? []).map(text).join("");
const semantics = (frames: JavascriptFrame[]) =>
  Object.fromEntries(
    [...flatten(frames)].map(([id, node]) => [
      id,
      {
        tag: node.tag,
        className: node.attrs?.class ?? "",
        text: node.tag === "input" ? (node.value ?? "") : text(node),
        ...(node.tag === "input" ? { checked: node.checked ?? false } : {}),
        ...(node.tag === "button" ? { disabled: node.disabled ?? false } : {}),
      },
    ]),
  );
const stateAt = (index: number) => {
  const state: State = {
    active: true,
    checked: false,
    disabled: false,
    direct: false,
    moves: 0,
  };
  for (const id of allSteps.slice(0, index)) {
    if (id === "has-toggle") state.active = !state.active;
    if (id === "has-checkbox") state.checked = !state.checked;
    if (id === "has-disable") state.disabled = !state.disabled;
    if (id === "has-move-button") {
      state.direct = !state.direct;
      state.moves++;
    }
  }
  return state;
};
function expectedPadding(index: number) {
  const state = stateAt(index),
    result = Object.fromEntries(targets.map((id) => [id, 2]));
  if (state.active)
    Object.assign(result, {
      "has-desc": 7,
      "has-child": 9,
      "has-adjacent": 11,
      "has-general": 13,
      "has-chain": 15,
      "has-branch-search": 39,
      "has-sibling-chain": 47,
      "has-sibling-search": 49,
      "has-functional": 37,
      "has-list": 17,
      "has-is": 21,
      "has-where": 23,
      "has-and": 25,
      "has-specificity": 17,
      "has-is-specificity": 19,
    });
  else result["has-not"] = 19;
  if (!state.active) {
    result["has-specificity"] = 3;
    result["has-is-specificity"] = 4;
  }
  result["has-where-specificity"] = 5;
  result["has-checked"] = state.checked ? 29 : 2;
  result["has-disabled"] = state.disabled ? 31 : 2;
  result["has-move"] = state.direct ? 33 : 2;
  result["has-move-desc"] = 35;
  return result;
}
function checkNative(result: NativeResult, start: number, steps: string[]) {
  assert.equal(result.schema, 1);
  assert.equal(result.frames.length, steps.length + 1);
  assert.equal(result.usedStyles.length, result.frames.length);
  assert.deepEqual(result.labels, ["initial", ...steps]);
  assert.equal(result.identitiesChecked, targets.length + 2);
  assert.equal(result.hostEffectsRepeatedOnRestore, false);
  const ids = new Map<string, string>();
  for (const [index, frames] of result.frames.entries()) {
    const nodes = flatten(frames),
      padding = expectedPadding(start + index);
    for (const id of [...targets, "has-marker", "has-checkbox"]) {
      const node = nodes.get(id);
      assert.ok(node?.uid, `Missing native frame ${id}`);
      if (!ids.has(id)) ids.set(id, node.uid);
      assert.equal(node.uid, ids.get(id), `Native UID changed ${id}`);
    }
    for (const id of targets) {
      const node = nodes.get(id)!;
      assert.equal(node.css, true, `Missing CSS marker ${id}`);
      assert.equal(typeof node.style?.paddingLeft, "string");
      assert.equal(
        node.style?.paddingLeft,
        `${padding[id]}px`,
        `Native cascade ${id} phase ${start + index}`,
      );
      assert.deepEqual(
        result.usedStyles[index]![id],
        {
          paddingLeft: padding[id],
          backgroundColor: "#e5e7eb",
        },
        `Native used style ${id} phase ${start + index}`,
      );
    }
    assert.equal(
      nodes.get("has-checkbox")?.checked,
      stateAt(start + index).checked,
    );
    assert.equal(
      text(nodes.get("has-moves")!),
      String(stateAt(start + index).moves),
    );
  }
}
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
async function click(page: Page, id: string) {
  await page
    .locator(`[id="${id}"]`)
    .evaluate((element) => (element as HTMLElement).click());
  await settle(page);
}
async function capture(page: Page, index: number, ids: string[]) {
  const actual = await page.evaluate(
    ({ ids, targets }) => {
      const result: Record<string, unknown> = {},
        padding: Record<string, number> = {};
      for (const id of ids) {
        const node = document.getElementById(id);
        if (!node) throw new Error(`Missing browser node ${id}`);
        result[id] = {
          tag: node.localName,
          className: node.getAttribute("class") ?? "",
          text:
            node instanceof HTMLInputElement
              ? node.value
              : (node.textContent ?? ""),
          ...(node instanceof HTMLInputElement
            ? { checked: node.checked }
            : {}),
          ...(node instanceof HTMLButtonElement
            ? { disabled: node.disabled }
            : {}),
        };
        if (targets.includes(id)) {
          const computed = getComputedStyle(node);
          if (computed.backgroundColor !== "rgb(229, 231, 235)")
            throw new Error(`Background ${id}: ${computed.backgroundColor}`);
          padding[id] = Number.parseFloat(computed.paddingLeft);
        }
      }
      return { semantics: result, padding };
    },
    { ids, targets },
  );
  const inventory = await page.evaluate(() => {
    const root = document.getElementById("has-root");
    if (!root) throw new Error("Missing CSS fixture root");
    return [
      root.id,
      ...Array.from(root.querySelectorAll("[id]"), (node) => node.id),
    ].sort();
  });
  assert.deepEqual(
    inventory,
    [...ids].sort(),
    `Browser/native full ID inventory phase ${index}`,
  );
  assert.deepEqual(
    actual.padding,
    expectedPadding(index),
    `Original CSS semantics phase ${index}`,
  );
  return actual;
}
async function retainedCSS(
  archive: JavascriptArchive,
  directory: string,
  name: string,
  stage: string,
) {
  assert.equal(archive.stylesheets?.length, 1);
  const manifest = JSON.parse(
    await readFile(join(directory, `${name}.css-sources.json`), "utf8"),
  );
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.stylesheets.length, 1);
  const sheet = archive.stylesheets![0]!,
    item = manifest.stylesheets[0];
  assert.equal(item.path, sheet.path);
  assert.equal(item.hash, sheet.hash);
  const bytes = await readFile(join(directory, item.file));
  assert.equal(hash(bytes), sheet.hash);
  assert.deepEqual(bytes, Buffer.from(sheet.text));
  return {
    stage,
    path: sheet.path,
    file: relative(root, join(directory, item.file)),
    hash: sheet.hash,
    bytes: bytes.length,
  };
}
async function inputs() {
  const paths = [
    "ci/css-has-roundtrip.ts",
    "ci/css-has-roundtrip.go",
    "ci/run.sh",
    ".github/workflows/ci.yml",
    "tsconfig.json",
    "example/src/components/JavascriptCSSHas.tsx",
    "example/src/components/css-has.css",
    "src/javascript.ts",
    "src/javascript-cli.ts",
    "src/javascript-types.ts",
    "src/javascript-css.ts",
    "src/javascript-css-runtime.js",
    "src/javascript-runtime.js",
    "src/javascript-dom.js",
    "src/javascript-view.ts",
    "src/javascript-managed-dom.ts",
    "src/javascript-data.ts",
    "native/javascript/runtime.go",
    "native/javascript/nodes.go",
    "native/view.go",
    "native/controls.go",
    "native/go.mod",
    "native/go.sum",
    "package.json",
    "bun.lock",
  ];
  const bindings = [];
  for (const path of paths) {
    const bytes = await readFile(join(root, path));
    bindings.push({ path, hash: hash(bytes), bytes: bytes.length });
    await mkdir(dirname(join(out, "inputs", path)), { recursive: true });
    await writeFile(join(out, "inputs", path), bytes);
  }
  await json(join(out, "inputs.json"), bindings);
}
async function prepare() {
  await inputs();
  const sourceCommit = (
    await command("source-commit", ["git", "rev-parse", "HEAD"])
  ).trim();
  const sourceTree = (
    await command("source-tree", ["git", "rev-parse", "HEAD^{tree}"])
  ).trim();
  await json(join(out, "scenario.json"), scenario);
  const initial = await bundleJavascript(source, "JavascriptCSSHas", {}, [
    "observe",
  ]);
  assert.equal(initial.stylesheets?.length, 1);
  const bytes = await readFile(join(dirname(source), "css-has.css"));
  assert.deepEqual(Buffer.from(initial.stylesheets![0]!.text), bytes);
  assert.equal(initial.stylesheets![0]!.hash, hash(bytes));
  await json(join(out, "initial.json"), initial);
  for (const name of ["CSSHasProbe", "RestoredCSSHasProbe"]) {
    await generateJavascript({
      program: join(out, "initial.json"),
      out: native,
      name,
      packageName: "main",
      direction: "native",
    });
    await generateJavascript({
      program: join(out, "initial.json"),
      out: native,
      name,
      packageName: "main",
      direction: "native",
      check: true,
    });
  }
  await copyFile(
    join(root, "ci/css-has-roundtrip.go"),
    join(native, "main.go"),
  );
  await command("format-generated-driver", [
    "gofmt",
    "-w",
    join(native, "main.go"),
  ]);
  const result = await nativeProbe("export");
  checkNative(result, 0, [...scenario.prefix, ...scenario.suffix]);
  await validateJavascriptArchive(result.archive);
  assert.deepEqual(result.archive.stylesheets, initial.stylesheets);
  assert.deepEqual(result.final.stylesheets, initial.stylesheets);
  await json(join(out, "native.json"), result);
  await json(join(out, "native-program.json"), result.archive);
  for (const check of [false, true])
    await generateJavascript({
      program: join(out, "native-program.json"),
      out: web,
      name: "CSSHasBrowser",
      direction: "web",
      actionsModule: "./actions.ts",
      check,
    });
  await mkdir(join(web, "_probe"), { recursive: true });
  await writeFile(
    join(web, "_probe/Probe.tsx"),
    `// SPDX-License-Identifier: Apache-2.0
import {h,render,createRef} from "preact";
import {useLayoutEffect} from "preact/hooks";
import {CSSHasBrowser} from "../_CSSHasBrowser-javascript/CSSHasBrowser.tsx";
const calls:unknown[][]=[];const actions={observe:(...args:unknown[])=>{calls.push(args);return null;}};
export function Probe(){const ref=createRef<CSSHasBrowser>();useLayoutEffect(()=>{window.afyCSSHas={export:()=>ref.current!.exportJavascript(),calls:()=>calls,clear:()=>{calls.length=0;}};},[]);return h(CSSHasBrowser,{actions,ref});}
`,
  );
  await writeFile(
    join(web, "_CSSHasBrowser-javascript/actions.ts"),
    `// SPDX-License-Identifier: Apache-2.0\nexport const actions={observe:(..._args:unknown[])=>null};\n`,
  );
  await writeFile(
    join(web, "CSSHasProbe.astro"),
    `---\n// SPDX-License-Identifier: Apache-2.0\nimport {Probe} from "./_probe/Probe.tsx";\n---\n<Probe client:only="preact" />\n`,
  );
  const probe = join(out, "Original.tsx");
  await writeFile(
    probe,
    `// SPDX-License-Identifier: Apache-2.0
import {h,render} from "preact";
import {JavascriptCSSHas} from ${JSON.stringify(source)};
const calls:unknown[][]=[];const actions={observe:(...args:unknown[])=>{calls.push(args);return null;}};
render(h(JavascriptCSSHas,actions),document.getElementById("probe")!);
window.afyCSSHas={calls:()=>calls,clear:()=>{calls.length=0;},export:()=>{throw new Error("Original browser source has no native archive");}};
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
  const js = built.outputs.find((item) =>
    item.type.startsWith("text/javascript"),
  );
  assert.ok(js, "Missing original browser JS bundle");
  const code = await js.text(),
    css = (
      await Promise.all(
        built.outputs
          .filter((item) => item.type.startsWith("text/css"))
          .map((item) => item.text()),
      )
    ).join("\n");
  assert.ok(css.includes(":has("));
  await writeFile(join(out, "original-browser.js"), code);
  await writeFile(join(out, "original-browser.css"), css);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/probe.js")
        return new Response(code, {
          headers: { "Content-Type": "text/javascript" },
        });
      if (path === "/probe.css")
        return new Response(css, { headers: { "Content-Type": "text/css" } });
      return new Response(
        '<!doctype html><html><head><link rel="stylesheet" href="/probe.css"></head><body><div id="probe"></div><script type="module" src="/probe.js"></script></body></html>',
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  const browser = await chromium.launch({ headless: true }),
    errors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    assert.ok((await page.goto(server.url.href))?.ok());
    await page.waitForFunction(() => !!window.afyCSSHas);
    await settle(page);
    assert.equal(
      await page.evaluate(() => CSS.supports("selector(:has(> .flag))")),
      true,
    );
    const ids = [...flatten(result.frames[0]!).keys()];
    const handles = await Promise.all(
      [...targets, "has-marker", "has-checkbox"].map((id) =>
        page.locator(`[id="${id}"]`).elementHandle(),
      ),
    );
    const timeline = [],
      calls = [];
    for (let index = 0; index <= allSteps.length; index++) {
      if (index) await click(page, allSteps[index - 1]!);
      for (const [offset, handle] of handles.entries()) {
        assert.ok(handle);
        assert.equal(
          await handle.evaluate(
            (node, id) => document.getElementById(id) === node,
            [...targets, "has-marker", "has-checkbox"][offset]!,
          ),
          true,
        );
      }
      const frame = await capture(page, index, ids);
      if (index <= finalIndex)
        assert.deepEqual(
          frame.semantics,
          semantics(result.frames[index]!),
          `Original/native DOM semantics phase ${index}`,
        );
      timeline.push(frame);
      calls.push(await page.evaluate(() => window.afyCSSHas.calls()));
    }
    assert.deepEqual(calls[finalIndex], result.calls);
    assert.deepEqual(errors, []);
    await json(join(out, "original-browser.json"), {
      schema: 1,
      browser: browser.version(),
      timeline,
      calls,
      errors,
      identitiesChecked: handles.length,
      originalAuthoredCSS: true,
    });
  } finally {
    await browser.close();
    server.stop(true);
  }
  const retained = [
    await retainedCSS(initial, native, "CSSHasProbe", "native"),
    await retainedCSS(initial, web, "CSSHasBrowser", "astro"),
  ];
  await retain(native, join(out, "generated-native"));
  await retain(web, join(out, "generated-web"));
  await json(join(out, "prepared.json"), {
    schema: 1,
    accepted: true,
    sourceInputsHash: hash(await readFile(join(out, "inputs.json"))),
    originalBrowserBundleHash: hash(code),
    originalBrowserCSSHash: hash(css),
    codeHash: initial.codeHash,
    sourceCommit,
    sourceTree,
    retained,
    phases,
  });
}

async function verify() {
  const bindings = JSON.parse(
    await readFile(join(out, "inputs.json"), "utf8"),
  ) as { path: string; hash: string }[];
  for (const binding of bindings)
    assert.equal(
      hash(await readFile(join(root, binding.path))),
      binding.hash,
      `${binding.path} changed during gate`,
    );
  const prepared = JSON.parse(
    await readFile(join(out, "prepared.json"), "utf8"),
  );
  assert.equal(
    prepared.sourceInputsHash,
    hash(await readFile(join(out, "inputs.json"))),
  );
  assert.equal(
    prepared.originalBrowserBundleHash,
    hash(await readFile(join(out, "original-browser.js"))),
  );
  assert.equal(
    prepared.originalBrowserCSSHash,
    hash(await readFile(join(out, "original-browser.css"))),
  );
  assert.ok(prepared.phases.every((phase: Phase) => phase.exitCode === 0));
  const original = JSON.parse(
    await readFile(join(out, "original-browser.json"), "utf8"),
  );
  const exported: NativeResult = JSON.parse(
    await readFile(join(out, "native.json"), "utf8"),
  );
  const initial = await validateJavascriptArchive(
    JSON.parse(await readFile(join(out, "initial.json"), "utf8")),
  );
  const browser = await chromium.launch({ headless: true }),
    errors: string[] = [];
  let returned: JavascriptArchive;
  const astroTimeline = [],
    astroFrames = [];
  let suffixCalls: unknown[][] = [],
    followCalls: unknown[][] = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    assert.ok(
      (
        await page.goto("http://127.0.0.1:4321/css-has-roundtrip/CSSHasProbe")
      )?.ok(),
    );
    await page.waitForFunction(() => !!window.afyCSSHas);
    await settle(page);
    assert.deepEqual(
      await page.evaluate(() => window.afyCSSHas.calls()),
      [],
      "Astro hydration repeated recorded host actions",
    );
    const ids = [...flatten(exported.frames[0]!).keys()];
    const handles = await Promise.all(
      [...targets, "has-marker", "has-checkbox"].map((id) =>
        page.locator(`[id="${id}"]`).elementHandle(),
      ),
    );
    for (
      let offset = 0;
      offset <= scenario.suffix.length + scenario.follow.length;
      offset++
    ) {
      const index = checkpointIndex + offset;
      if (offset)
        await click(
          page,
          [...scenario.suffix, ...scenario.follow][offset - 1]!,
        );
      for (const [position, handle] of handles.entries()) {
        assert.ok(handle);
        assert.equal(
          await handle.evaluate(
            (node, id) => document.getElementById(id) === node,
            [...targets, "has-marker", "has-checkbox"][position]!,
          ),
          true,
        );
      }
      const observation = await capture(page, index, ids);
      assert.deepEqual(
        observation,
        original.timeline[index],
        `Astro/original phase ${index}`,
      );
      const archive = await page.evaluate(() => window.afyCSSHas.export());
      await validateJavascriptArchive(archive);
      assert.deepEqual(archive.stylesheets, initial.stylesheets);
      assert.deepEqual(
        semantics(archive.frame!),
        observation.semantics,
        `Astro archive/DOM phase ${index}`,
      );
      if (index <= finalIndex)
        assert.deepEqual(
          archive.frame,
          exported.frames[index],
          `Astro/native frame phase ${index}`,
        );
      astroTimeline.push(observation);
      astroFrames.push(archive.frame!);
      if (index === finalIndex) {
        returned = archive;
        suffixCalls = await page.evaluate(() => window.afyCSSHas.calls());
        assert.deepEqual(
          suffixCalls,
          original.calls[index].slice(original.calls[checkpointIndex].length),
        );
        await page.evaluate(() => window.afyCSSHas.clear());
      }
    }
    followCalls = await page.evaluate(() => window.afyCSSHas.calls());
    assert.deepEqual(
      followCalls,
      original.calls[allSteps.length].slice(original.calls[finalIndex].length),
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
  await json(join(out, "astro-browser.json"), {
    schema: 1,
    timeline: astroTimeline,
    frames: astroFrames,
    suffixCalls,
    followCalls,
    errors,
    replayedHostEffects: 0,
  });
  await json(join(out, "astro-program.json"), returned!);
  for (const check of [false, true])
    await generateJavascript({
      program: join(out, "astro-program.json"),
      out: native,
      name: "RestoredCSSHasProbe",
      packageName: "main",
      direction: "native",
      check,
    });
  const restored = await nativeProbe("restore");
  checkNative(restored, finalIndex, scenario.follow);
  assert.deepEqual(restored.archive.stylesheets, initial.stylesheets);
  assert.deepEqual(restored.final.stylesheets, initial.stylesheets);
  assert.deepEqual(restored.calls, followCalls);
  assert.deepEqual(restored.frames, astroFrames.slice(scenario.suffix.length));
  for (const [index, frames] of restored.frames.entries())
    assert.deepEqual(
      semantics(frames),
      original.timeline[finalIndex + index].semantics,
    );
  await json(join(out, "restored-native.json"), restored);
  const retained = [
    ...prepared.retained,
    await retainedCSS(
      initial,
      native,
      "RestoredCSSHasProbe",
      "restored-native",
    ),
  ];
  await retain(native, join(out, "restored-generated-native"));
  const binaries = [];
  for (const stage of ["export", "restore"]) {
    const binary = JSON.parse(
      await readFile(join(out, `native-${stage}-binary.json`), "utf8"),
    );
    assert.equal(binary.hash, hash(await readFile(join(root, binary.path))));
    assert.equal(
      binary.buildInfoHash,
      hash(await readFile(join(out, `native-${stage}-build-info.stdout.log`))),
    );
    binaries.push(binary);
  }
  await json(join(out, "summary.json"), {
    schema: 1,
    accepted: true,
    sourceInputsHash: prepared.sourceInputsHash,
    sourceCodeHash: initial.codeHash,
    sourceCommit: prepared.sourceCommit,
    sourceTree: prepared.sourceTree,
    binaries,
    targets: targets.length,
    actions: allSteps.length,
    originalBrowserFrames: original.timeline.length,
    astroBrowserFrames: astroFrames.length,
    nativeFrames: exported.frames.length + restored.frames.length,
    nativeUsedStyleObservations:
      (exported.frames.length + restored.frames.length) * targets.length,
    retained,
    originalBrowserBundleHash: prepared.originalBrowserBundleHash,
    originalBrowserCSSHash: prepared.originalBrowserCSSHash,
    replayedHostEffects: 0,
    preparePhases: prepared.phases,
    verifyPhases: phases,
    visualPixelPerfectVerified: false,
    universalCSSVerified: false,
    limitations: [
      "Bounded selector, live state, retained source and native used-style coverage; no arbitrary browser APIs or pixel comparison.",
    ],
  });
  console.log(
    `CSS :has roundtrip passed: ${targets.length} targets, ${allSteps.length} actions; original Chromium, generated Astro and restored native Goja agree.`,
  );
}

for (const directory of [out, native, web])
  await mkdir(directory, { recursive: true });
try {
  if (mode === "prepare") await prepare();
  else await verify();
} catch (error) {
  await json(join(out, `${mode}-failure.json`), {
    schema: 1,
    accepted: false,
    message: error instanceof Error ? error.message : String(error),
    phases,
  });
  throw error;
}
