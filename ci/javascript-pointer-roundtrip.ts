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
import { generateJavascript } from "../src/javascript-cli.ts";
import {
  bundleJavascript,
  validateJavascriptArchive,
} from "../src/javascript.ts";
import { captureJavascriptPointers } from "../capture/javascript-pointer-roundtrip.ts";

const root = resolve(import.meta.dir, ".."),
  out = join(root, "artifacts/javascript-pointer-roundtrip"),
  native = join(root, "native/.program-roundtrip/javascript-pointer"),
  returnedNative = join(
    root,
    "native/.program-roundtrip/javascript-pointer-return",
  ),
  web = join(root, "example/src/pages/javascript-pointer-roundtrip"),
  binary = join(out, "pointer-native.test"),
  returnedBinary = join(out, "pointer-return-native.test"),
  mode = process.argv[2];
assert.ok(
  ["prepare", "verify"].includes(mode ?? "") && process.argv.length === 3,
  "Usage: bun ci/javascript-pointer-roundtrip.ts prepare|verify",
);
const hash = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const phases: {
  name: string;
  argv: string[];
  cwd: string;
  exitCode: number;
}[] = [];
async function json(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
async function command(
  name: string,
  argv: string[],
  cwd = root,
  extra: Record<string, string> = {},
) {
  const child = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      GOWORK: "off",
      GOFLAGS: "-mod=readonly",
      GOMAXPROCS: "2",
      ...extra,
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  await writeFile(join(out, `${name}.stdout.log`), stdout);
  await writeFile(join(out, `${name}.stderr.log`), stderr);
  phases.push({ name, argv, cwd: relative(root, cwd) || ".", exitCode });
  await json(join(out, `${mode}-phases.json`), phases);
  assert.equal(exitCode, 0, `${name} failed; retained logs in ${out}`);
  return stdout.trim();
}
async function retainTree(path: string, target: string) {
  const files: { path: string; hash: string }[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name);
      if (entry.isDirectory()) await visit(source);
      else if (entry.isFile()) {
        const pathName = relative(path, source),
          destination = join(target, pathName),
          bytes = await readFile(source);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes);
        files.push({ path: pathName, hash: hash(bytes) });
      }
    }
  }
  await visit(path);
  return files;
}

async function buildNative(
  directory: string,
  name: string,
  executable: string,
  label: string,
) {
  await copyFile(
    join(root, "ci/javascript-pointer-roundtrip.go"),
    join(directory, "pointer_probe_test.go"),
  );
  await writeFile(
    join(directory, "pointer_constructor_test.go"),
    `// SPDX-License-Identifier: Apache-2.0
package pointerprobe
import(webui "github.com/thinkddr/astro-fyne/native";js "github.com/thinkddr/astro-fyne/native/javascript")
const pointerProbeArchive = ${name}JavascriptArchive
const pointerProbeConstructor = "New${name}"
func newPointerProbe(actions webui.Actions)(*js.Widget,error){return New${name}(nil,actions)}
`,
  );
  await command(
    `${label}-format-driver`,
    ["gofmt", "-w", "pointer_probe_test.go", "pointer_constructor_test.go"],
    directory,
  );
  const locks = await Promise.all(
    ["go.mod", "go.sum"].map((file) => readFile(join(root, "native", file))),
  );
  await command(
    `${label}-build`,
    ["go", "test", "-c", "-race", "-tags", "ci", "-p=1", "-o", executable, "."],
    directory,
  );
  await command(`${label}-build-info`, ["go", "version", "-m", executable]);
  for (const [index, file] of ["go.mod", "go.sum"].entries())
    assert.ok(
      locks[index]!.equals(await readFile(join(root, "native", file))),
      "native pointer build changed a module lock",
    );
}

await mkdir(out, { recursive: true });
if (mode === "prepare") {
  const scenario = {
    prefix: [
      { id: "pointer-padding", corner: true, calls: 4 },
      { id: "pointer-silent", calls: 4 },
      { id: "pointer-text", calls: 3 },
      { id: "pointer-raw", calls: 2 },
      { id: "pointer-stop", calls: 2 },
      { id: "pointer-immediate", calls: 2 },
      { id: "pointer-dynamic", calls: 3 },
      { id: "pointer-toggle", calls: 3 },
      { id: "pointer-dynamic", calls: 2 },
      { id: "pointer-reparent", calls: 3 },
      { id: "pointer-moving", calls: 2 },
      { id: "pointer-input", calls: 3 },
      { id: "pointer-textarea", calls: 3 },
      { id: "pointer-label", calls: 8 },
      { id: "pointer-cancel", calls: 3 },
      { id: "pointer-disabled", calls: 0 },
    ],
    suffix: [
      { id: "pointer-check", calls: 5 },
      { id: "pointer-text", calls: 3 },
      { id: "pointer-toggle", calls: 3 },
      { id: "pointer-dynamic", calls: 3 },
      { id: "pointer-reparent", calls: 3 },
      { id: "pointer-moving", calls: 2 },
      { id: "pointer-label", calls: 8 },
      { id: "pointer-cancel", calls: 3 },
      { id: "pointer-padding", corner: true, calls: 4 },
      { id: "pointer-silent", calls: 4 },
    ],
    follow: [
      { id: "pointer-raw", calls: 2 },
      { id: "pointer-text", calls: 3 },
      { id: "pointer-disabled", calls: 0 },
      { id: "pointer-dynamic", calls: 3 },
      { id: "pointer-label", calls: 8 },
    ],
  };
  await json(join(out, "scenario.json"), scenario);
  const archive = await bundleJavascript(
    join(root, "example/src/components/JavascriptPointers.tsx"),
    "default",
    {},
    ["observe"],
  );
  assert.equal(
    archive.schema,
    1,
    "pointer gate must not widen CSS animation admission",
  );
  await json(join(out, "source.javascript.json"), archive);
  await generateJavascript({
    program: join(out, "source.javascript.json"),
    out: native,
    name: "Pointer",
    packageName: "pointerprobe",
    direction: "native",
  });
  await buildNative(native, "Pointer", binary, "native");
  await command(
    "native-prepare",
    [binary, "-test.run=^TestJavascriptPointerRoundtrip$", "-test.v"],
    native,
    { ASTRO_FYNE_POINTER_OUTPUT: out, ASTRO_FYNE_POINTER_MODE: "prepare" },
  );
  const checkpoint = await validateJavascriptArchive(
    JSON.parse(
      await readFile(join(out, "native-checkpoint.javascript.json"), "utf8"),
    ),
  );
  assert.equal(checkpoint.codeHash, archive.codeHash);
  assert.equal(
    checkpoint.events.length,
    scenario.prefix.length - 1,
    "disabled control generated an event or one click generated duplicate events",
  );
  await generateJavascript({
    program: join(out, "native-checkpoint.javascript.json"),
    out: web,
    name: "Pointer",
    direction: "web",
    actionsModule: "../actions.ts",
  });
  await generateJavascript({
    program: join(out, "native-checkpoint.javascript.json"),
    out: web,
    name: "Pointer",
    direction: "web",
    actionsModule: "../actions.ts",
    check: true,
  });
  await writeFile(
    join(web, "actions.ts"),
    "export const actions={observe(){throw new Error('Pointer harness must bind its actions')}};\n",
  );
  await writeFile(
    join(web, "Harness.tsx"),
    `import {createRef} from "preact";import Original from "../../components/JavascriptPointers.tsx";import Pointer from "./_Pointer-javascript/Pointer.tsx";const ref=createRef<any>();const calls:unknown[][]=[];const actions={observe:(...args:unknown[])=>{calls.push(args);return null}};export default function Harness({original=false}:{original?:boolean}){if(typeof window!=="undefined")(window as any).afyPointers={ready:()=>{if(original)return !!document.getElementById("pointer-root");try{ref.current?.exportJavascript();return !!ref.current}catch{return false}},calls:()=>calls.map(call=>[...call]),clear:()=>{calls.length=0},export:()=>{if(original)throw new Error("Authored browser is not an archive adapter");return ref.current!.exportJavascript()}};return original?<Original observe={actions.observe}/>:<Pointer ref={ref} actions={actions}/>};\n`,
  );
  for (const original of [true, false])
    await writeFile(
      join(web, `${original ? "original" : "restored"}.astro`),
      `---\nimport Harness from "./Harness.tsx";\n---\n<html lang="en"><head><title>JavaScript pointer roundtrip</title></head><body><Harness original={${original}} client:only="preact" /></body></html><style is:global>body{margin:0}</style>\n`,
    );
  const paths = [
    "ci/javascript-pointer-roundtrip.ts",
    "ci/javascript-pointer-roundtrip.go",
    "capture/javascript-pointer-roundtrip.ts",
    "capture/browser-provenance.ts",
    "example/src/components/JavascriptPointers.tsx",
    "src/javascript-managed-dom.ts",
    "src/javascript-view.ts",
    "src/javascript-dom.js",
    "src/javascript-dom.test.ts",
    "src/javascript-runtime.js",
    "src/javascript-data.ts",
    "src/javascript-types.ts",
    "src/javascript.ts",
    "src/javascript-cli.ts",
    "native/view.go",
    "native/controls.go",
    "native/backend.go",
    "native/javascript/nodes.go",
    "native/javascript/runtime.go",
    "native/pointer_test.go",
    "native/javascript/pointer_test.go",
    "ci/run.sh",
    ".github/workflows/ci.yml",
    "native/go.mod",
    "native/go.sum",
    "package.json",
    "bun.lock",
  ];
  const inputs = [];
  for (const [index, path] of paths.entries()) {
    const bytes = await readFile(join(root, path)),
      file = `inputs/${String(index).padStart(4, "0")}.source`;
    await mkdir(join(out, "inputs"), { recursive: true });
    await writeFile(join(out, file), bytes);
    inputs.push({ path, file, hash: hash(bytes) });
  }
  await json(join(out, "inputs.json"), inputs);
  await json(join(out, "prepare.json"), {
    schema: 1,
    sourceCommit: await command("source-commit", ["git", "rev-parse", "HEAD"]),
    sourceTree: await command("source-tree", [
      "git",
      "rev-parse",
      "HEAD^{tree}",
    ]),
    inputsHash: hash(await readFile(join(out, "inputs.json"))),
    binaryHash: hash(await readFile(binary)),
    buildInfoHash: hash(
      await readFile(join(out, "native-build-info.stdout.log")),
    ),
    generatedNative: await retainTree(native, join(out, "generated-native")),
    generatedWeb: await retainTree(web, join(out, "generated-web")),
    pixelPerfectVerified: false,
  });
} else {
  const prepared = JSON.parse(
    await readFile(join(out, "prepare.json"), "utf8"),
  );
  assert.equal(hash(await readFile(binary)), prepared.binaryHash);
  await captureJavascriptPointers("http://127.0.0.1:4321", out);
  const browserArchive = await validateJavascriptArchive(
    JSON.parse(await readFile(join(out, "browser.javascript.json"), "utf8")),
  );
  const source = await validateJavascriptArchive(
    JSON.parse(await readFile(join(out, "source.javascript.json"), "utf8")),
  );
  assert.equal(browserArchive.code, source.code);
  assert.deepEqual(browserArchive.sources, source.sources);
  await generateJavascript({
    program: join(out, "browser.javascript.json"),
    out: returnedNative,
    name: "ReturnedPointer",
    packageName: "pointerprobe",
    direction: "native",
  });
  await buildNative(
    returnedNative,
    "ReturnedPointer",
    returnedBinary,
    "return-native",
  );
  await json(join(out, "return-build.json"), {
    constructor: "NewReturnedPointer",
    binaryHash: hash(await readFile(returnedBinary)),
    buildInfoHash: hash(
      await readFile(join(out, "return-native-build-info.stdout.log")),
    ),
    generatedNative: await retainTree(
      returnedNative,
      join(out, "generated-return-native"),
    ),
    browserCheckpointHash: hash(
      await readFile(join(out, "browser.javascript.json")),
    ),
  });
  await command(
    "native-verify",
    [returnedBinary, "-test.run=^TestJavascriptPointerRoundtrip$", "-test.v"],
    returnedNative,
    { ASTRO_FYNE_POINTER_OUTPUT: out, ASTRO_FYNE_POINTER_MODE: "verify" },
  );
  const first = JSON.parse(
      await readFile(join(out, "native-prepare.json"), "utf8"),
    ),
    returned = JSON.parse(
      await readFile(join(out, "native-verify.json"), "utf8"),
    ),
    browser = JSON.parse(await readFile(join(out, "browser.json"), "utf8"));
  assert.equal(returned.replayCalls, 0);
  assert.equal(first.actualGeneratedConstructor, true);
  assert.equal(first.constructor, "NewPointer");
  assert.equal(returned.actualGeneratedConstructor, true);
  assert.equal(returned.constructor, "NewReturnedPointer");
  assert.deepEqual(returned.follow.archives, first.follow.archives);
  assert.deepEqual(returned.follow.calls, first.follow.calls);
  await json(join(out, "comparison.json"), {
    schema: 1,
    passed: true,
    sourceCommit: prepared.sourceCommit,
    sourceTree: prepared.sourceTree,
    binaryHash: prepared.binaryHash,
    returnBinaryHash: hash(await readFile(returnedBinary)),
    returnBuildHash: hash(await readFile(join(out, "return-build.json"))),
    actualGeneratedConstructors: [first.constructor, returned.constructor],
    inputsHash: prepared.inputsHash,
    actualCanvasHitTesting: true,
    actualChromiumCoordinateClicks: true,
    stages: browser.records.map(
      (record: {
        label: string;
        states: unknown[];
        calls: unknown[];
        stableDOMObjects: number;
        archives?: unknown[];
      }) => ({
        label: record.label,
        frames: record.states.length,
        effects: record.calls.length,
        stableDOMObjects: record.stableDOMObjects,
        retainedArchives: record.archives?.length ?? 0,
      }),
    ),
    stableNativeObjects: returned.follow.stableNativeObjects,
    browserRejections: browser.rejections,
    nativePrepareHash: hash(await readFile(join(out, "native-prepare.json"))),
    browserHash: hash(await readFile(join(out, "browser.json"))),
    browserProvenanceBeforeHash: hash(
      await readFile(join(out, "browser-provenance-before.json")),
    ),
    browserProvenanceAfterHash: hash(
      await readFile(join(out, "browser-provenance-after.json")),
    ),
    nativeReturnHash: hash(await readFile(join(out, "native-verify.json"))),
    replayedExternalEffects: 0,
    pixelPerfectVerified: false,
    universalPointerEventsVerified: false,
  });
  console.log(
    "JavaScript pointer roundtrip passed: native canvas hit testing, authored Chromium clicks and retained continuation.",
  );
}
