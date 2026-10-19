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
import { dirname, join, relative } from "node:path";
import {
  bundleJavascript,
  validateJavascriptArchive,
} from "../src/javascript.ts";
import { generateJavascript } from "../src/javascript-cli.ts";
import { captureCSSZeroHeight } from "../capture/css-zero-height.ts";

type Context = {
  root: string;
  out: string;
  command(
    name: string,
    argv: string[],
    cwd?: string,
    extra?: Record<string, string>,
  ): Promise<string>;
  retain(path: string, target: string): Promise<void>;
};
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function json(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
async function execute(
  context: Context,
  directory: string,
  name: string,
  mode: "initialize" | "source" | "return",
) {
  const { root, out, command, retain } = context,
    evidence = join(out, "zero-height"),
    binary = join(evidence, `${mode}.test`);
  await copyFile(
    join(root, "ci/css-zero-height.go"),
    join(directory, "zero_probe_test.go"),
  );
  await writeFile(
    join(directory, "zero_constructor_test.go"),
    `// SPDX-License-Identifier: Apache-2.0
package zeroprobe
import js "github.com/thinkddr/astro-fyne/native/javascript"
const zeroProbeArchive = ${name}JavascriptArchive
const zeroProbeConstructor = "New${name}WithOptions"
func newZeroProbe()(*js.Widget,error){return New${name}WithOptions(nil,nil,js.Options{ManualAnimations:true})}
`,
  );
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith(".go"),
  );
  await command(`zero-${mode}-format`, ["gofmt", "-w", ...files], directory);
  const locks = await Promise.all(
    ["go.mod", "go.sum"].map((file) => readFile(join(root, "native", file))),
  );
  await command(
    `zero-${mode}-build`,
    ["go", "test", "-c", "-race", "-tags", "ci", "-p=1", "-o", binary, "."],
    directory,
  );
  const info = await command(`zero-${mode}-build-info`, [
    "go",
    "version",
    "-m",
    binary,
  ]);
  for (const [index, file] of ["go.mod", "go.sum"].entries())
    assert.ok(
      locks[index]!.equals(await readFile(join(root, "native", file))),
      "zero build changed module locks",
    );
  await json(join(evidence, `${mode}-binary.json`), {
    schema: 1,
    path: relative(root, binary),
    sha256: hash(await readFile(binary)),
    buildInfoSha256: hash(Buffer.from(info)),
  });
  await retain(directory, join(evidence, `generated-${mode}-native`));
  await command(
    `zero-${mode}-constructor`,
    [binary, "-test.run=^TestGeneratedCSSZeroHeight$", "-test.v"],
    directory,
    { ASTRO_FYNE_ZERO_OUTPUT: evidence, ASTRO_FYNE_ZERO_MODE: mode },
  );
}

export async function prepareCSSZeroHeight(context: Context) {
  const { root, out, retain } = context,
    evidence = join(out, "zero-height"),
    initial = join(
      root,
      "native/.program-roundtrip/css-zero-height-initialize",
    ),
    native = join(root, "native/.program-roundtrip/css-zero-height"),
    web = join(root, "example/src/pages/css-zero-height-roundtrip");
  await mkdir(evidence, { recursive: true });
  const cold = await bundleJavascript(
    join(root, "example/src/components/JavascriptCSSZeroHeight.tsx"),
  );
  assert.equal(cold.schema, 2);
  assert.deepEqual(cold.journal, []);
  assert.equal(cold.frame, undefined);
  await json(join(evidence, "cold-source.javascript.json"), cold);
  await generateJavascript({
    archive: cold,
    out: initial,
    name: "InitialZeroHeight",
    direction: "native",
    packageName: "zeroprobe",
  });
  await execute(context, initial, "InitialZeroHeight", "initialize");
  const archive = await validateJavascriptArchive(
      JSON.parse(
        await readFile(join(evidence, "source.javascript.json"), "utf8"),
      ),
    ),
    initialized = JSON.parse(
      await readFile(join(evidence, "native-initialize.json"), "utf8"),
    );
  assert.equal(initialized.actualGeneratedConstructor, true);
  assert.equal(initialized.constructor, "NewInitialZeroHeightWithOptions");
  assert.equal(initialized.inputFile, "cold-source.javascript.json");
  assert.equal(initialized.outputFile, "source.javascript.json");
  assert.deepEqual(initialized.archive, archive);
  assert.ok(archive.journal.length > 0, "initialization journal is empty");
  assert.ok(archive.frame?.length, "initialization frame is empty");
  assert.deepEqual(archive, {
    ...cold,
    journal: archive.journal,
    frame: archive.frame,
  });
  assert.deepEqual(archive.animation, {
    schema: 1,
    timeMs: 0,
    playState: "running",
  });
  await generateJavascript({
    archive,
    out: native,
    name: "ZeroHeight",
    direction: "native",
    packageName: "zeroprobe",
  });
  await execute(context, native, "ZeroHeight", "source");
  const checkpoint = await validateJavascriptArchive(
    JSON.parse(
      await readFile(
        join(evidence, "native-checkpoint.javascript.json"),
        "utf8",
      ),
    ),
  );
  assert.deepEqual(checkpoint.animation, {
    schema: 1,
    timeMs: 100,
    playState: "paused",
  });
  for (const [name, initial] of [
    ["ZeroHeight", archive],
    ["RestoredZeroHeight", checkpoint],
  ] as const)
    await generateJavascript({
      archive: initial,
      out: web,
      name,
      direction: "web",
    });
  for (const [index, sheet] of archive.stylesheets!.entries())
    for (const [directory, name] of [
      [initial, "InitialZeroHeight"],
      [native, "ZeroHeight"],
      [web, "ZeroHeight"],
      [web, "RestoredZeroHeight"],
    ]) {
      const bytes = await readFile(
        join(
          directory!,
          `${name}.css-sources/${String(index).padStart(4, "0")}-${sheet.hash}.css`,
        ),
      );
      assert.equal(hash(bytes), sheet.hash);
      assert.ok(
        bytes.equals(Buffer.from(sheet.text)),
        "zero CSS source bytes changed",
      );
    }
  await writeFile(
    join(web, "Harness.tsx"),
    `// SPDX-License-Identifier: Apache-2.0
import {h,createRef} from "preact";
import ZeroHeight from "./_ZeroHeight-javascript/ZeroHeight.tsx";
import RestoredZeroHeight from "./_RestoredZeroHeight-javascript/RestoredZeroHeight.tsx";
const ref=createRef<any>(),options={manual:true};
export default function Harness(){(window as any).afyZero={ready:()=>{try{return !!ref.current?.exportJavascript()}catch{return false}},export:()=>ref.current!.exportJavascript(),advance:(time:number)=>ref.current!.advanceAnimations(time),pause:()=>ref.current!.pauseAnimations(),play:()=>ref.current!.playAnimations()};return h(new URLSearchParams(location.search).has("restore")?RestoredZeroHeight:ZeroHeight,{ref,animation:options})}
`,
  );
  await writeFile(
    join(web, "index.astro"),
    `---
// SPDX-License-Identifier: Apache-2.0
import Harness from "./Harness.tsx";
---
<html lang="en"><head><meta charset="utf-8"/><title>Zero height roundtrip</title></head><body><Harness client:only="preact"/></body></html>
<style is:global>html,body{margin:0;padding:0;background:#ffffff}</style>
`,
  );
  await retain(web, join(evidence, "generated-web"));
  const inputs = [
    "native/view.go",
    "native/zero_height_test.go",
    "native/javascript/nodes.go",
    "native/javascript/runtime.go",
    "native/javascript/zero_height_test.go",
    "src/javascript-data.ts",
    "src/javascript.ts",
    "src/javascript-cli.ts",
    "src/javascript-runtime.js",
    "src/javascript-dom.js",
    "src/javascript-managed-dom.ts",
    "src/javascript-css-height.ts",
    "src/javascript-height-runtime.js",
    "src/javascript-zero-height.test.ts",
    "ci/css-zero-height.ts",
    "ci/css-zero-height.go",
    "capture/css-zero-height.ts",
    "capture/browser-provenance.ts",
    "example/src/components/JavascriptCSSZeroHeight.tsx",
    "example/src/components/javascript-css-zero-height.css",
    "example/src/pages/css-zero-height-original.astro",
  ];
  await json(join(evidence, "prepare.json"), {
    schema: 1,
    initialization: {
      constructor: initialized.constructor,
      files: await Promise.all(
        [
          "cold-source.javascript.json",
          "source.javascript.json",
          "native-initialize.json",
        ].map(async (file) => ({
          file,
          sha256: hash(await readFile(join(evidence, file))),
        })),
      ),
    },
    inputs: await Promise.all(
      inputs.map(async (path) => {
        const bytes = await readFile(join(root, path)),
          target = join(evidence, "implementation", path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
        return { path, sha256: hash(bytes) };
      }),
    ),
  });
}

export async function verifyCSSZeroHeight(context: Context) {
  const { root, out } = context,
    evidence = join(out, "zero-height"),
    native = join(root, "native/.program-roundtrip/css-zero-height-return");
  const input = JSON.parse(
    await readFile(join(evidence, "prepare.json"), "utf8"),
  );
  for (const file of input.inputs)
    assert.equal(
      hash(await readFile(join(root, file.path))),
      file.sha256,
      `zero implementation changed after build: ${file.path}`,
    );
  for (const file of input.initialization.files)
    assert.equal(
      hash(await readFile(join(evidence, file.file))),
      file.sha256,
      `zero initialization changed after build: ${file.file}`,
    );
  for (const mode of ["initialize", "source"]) {
    const binary = JSON.parse(
      await readFile(join(evidence, `${mode}-binary.json`), "utf8"),
    );
    assert.equal(hash(await readFile(join(root, binary.path))), binary.sha256);
  }
  await captureCSSZeroHeight("http://127.0.0.1:4321", evidence);
  const archive = await validateJavascriptArchive(
    JSON.parse(
      await readFile(
        join(evidence, "browser-checkpoint.javascript.json"),
        "utf8",
      ),
    ),
  );
  await generateJavascript({
    archive,
    out: native,
    name: "ReturnedZeroHeight",
    direction: "native",
    packageName: "zeroprobe",
  });
  await execute(context, native, "ReturnedZeroHeight", "return");
  const source = JSON.parse(
      await readFile(join(evidence, "native-source.json"), "utf8"),
    ),
    initialized = JSON.parse(
      await readFile(join(evidence, "native-initialize.json"), "utf8"),
    ),
    returned = JSON.parse(
      await readFile(join(evidence, "native-return.json"), "utf8"),
    );
  assert.equal(source.actualGeneratedConstructor, true);
  assert.equal(returned.actualGeneratedConstructor, true);
  assert.equal(returned.constructor, "NewReturnedZeroHeightWithOptions");
  for (const profile of returned.profiles) {
    const original = source.profiles.find(
      (item: any) => item.scale === profile.scale,
    );
    for (const sample of profile.samples) {
      const expected = original.samples.find(
        (item: any) => item.timeMs === sample.timeMs,
      );
      assert.deepEqual(sample.objects, expected.objects);
      assert.deepEqual(sample.snapshot, expected.snapshot);
      if (sample.timeMs !== 100)
        assert.deepEqual(sample.archive, expected.archive);
      else assert.deepEqual(sample.archive, archive);
      assert.ok(
        (await readFile(join(evidence, sample.image))).equals(
          await readFile(join(evidence, expected.image)),
        ),
        "returned zero frame changed native PNG bytes",
      );
    }
  }
  await json(join(evidence, "roundtrip.json"), {
    schema: 1,
    actualGeneratedConstructors: [
      initialized.constructor,
      source.constructor,
      returned.constructor,
    ],
    sharedNativeInitializationJournal: true,
    browserCheckpointAtZero: true,
    stableNativeAndBrowserIdentities: true,
    restorationContinuesAtZero: true,
    originalHeightContractUnchanged: true,
  });
}
