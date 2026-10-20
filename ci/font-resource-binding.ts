// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, ".."),
  native = join(root, "native"),
  out = join(root, "artifacts/font-resource-binding"),
  binary = join(out, "font-resource-binding.test"),
  hash = (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex"),
  commands: {
    name: string;
    argv: string[];
    cwd: string;
    exitCode: number;
  }[] = [];

await mkdir(join(out, "inputs"), { recursive: true });
async function saveJSON(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
async function command(name: string, argv: string[], cwd = native) {
  const child = Bun.spawn(argv, {
    cwd,
    env: {
      ...Bun.env,
      GOWORK: "off",
      GOFLAGS: "-mod=readonly",
      GOMAXPROCS: "2",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  await writeFile(join(out, name + ".stdout.log"), stdout);
  await writeFile(join(out, name + ".stderr.log"), stderr);
  commands.push({ name, argv, cwd: relative(root, cwd), exitCode });
  await saveJSON(join(out, "commands.json"), commands);
  assert.equal(exitCode, 0, name + " failed; retained output in " + out);
  return stdout.trim();
}

const paths = [
  "ci/font-resource-binding.ts",
  "ci/run.sh",
  ".github/workflows/ci.yml",
  "native/go.mod",
  "native/go.sum",
  "example/public/fonts/NotoSans-Regular.ttf",
  "example/public/fonts/NotoSans-Bold.ttf",
  "example/public/fonts/LICENSE-NotoSans.txt",
];
for (const directory of ["native", "native/fontresource", "native/fontbackend"])
  for (const file of (await readdir(join(root, directory))).sort())
    if (file.endsWith(".go")) paths.push(directory + "/" + file);
const inputs = [];
for (const [index, path] of [...new Set(paths)].entries()) {
  const bytes = await readFile(join(root, path)),
    file = "inputs/" + String(index).padStart(4, "0") + ".source";
  await writeFile(join(out, file), bytes);
  inputs.push({ path, file, bytes: bytes.length, hash: hash(bytes) });
}
await saveJSON(join(out, "inputs.json"), inputs);
const locks = await Promise.all(
  ["go.mod", "go.sum"].map((file) => readFile(join(native, file))),
);
await command("modules", ["go", "list", "-m", "-json", "all"]);
await command("build", [
  "go",
  "test",
  "-c",
  "-race",
  "-tags",
  "ci",
  "-p=1",
  "-o",
  binary,
  ".",
]);
await command("build-info", ["go", "version", "-m", binary]);
for (const [index, file] of ["go.mod", "go.sum"].entries())
  assert.ok(
    locks[index]!.equals(await readFile(join(native, file))),
    "resource build changed a module lock",
  );
await command("tests", [
  "go",
  "tool",
  "test2json",
  "-p",
  "github.com/thinkddr/astro-fyne/native",
  "-t",
  binary,
  "-test.run=^TestFontResource",
  "-test.v=test2json",
  "-test.count=1",
]);
const events = (await readFile(join(out, "tests.stdout.log"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line)),
  passed = events
    .filter((event) => event.Action === "pass" && event.Test)
    .map((event) => event.Test);
assert.ok(
  !events.some((event) => ["fail", "skip"].includes(event.Action)),
  "font resource tests failed or skipped",
);
assert.deepEqual(
  passed.sort(),
  [
    "TestFontResourceRequirementsClosedJSON",
    "TestFontResourceBindingPreflight",
    "TestFontResourceBindingOwnershipAndPaint",
    "TestFontResourceBindingRequirementSnapshot",
    "TestFontResourceBindingStaticFaceAndHash",
    "TestFontResourceBindingResponsiveCache",
    "TestFontResourceBindingByteBudgets",
  ].sort(),
);
assert.equal(
  events.filter((event) => event.Action === "pass" && !event.Test).length,
  1,
);
const bytes = await readFile(binary);
assert.ok(bytes.subarray(0, 6).equals(Buffer.from([127, 69, 76, 70, 2, 1])));
assert.equal(bytes.readUInt16LE(18), 183, "expected actual ARM64 ELF");
const sourceCommit = await command("source-commit", [
    "git",
    "rev-parse",
    "HEAD",
  ]),
  sourceTree = await command("source-tree", [
    "git",
    "rev-parse",
    "HEAD^{tree}",
  ]);
const outputs = [];
for (const file of [
  "inputs.json",
  "commands.json",
  "font-resource-binding.test",
  "modules.stdout.log",
  "modules.stderr.log",
  "build.stdout.log",
  "build.stderr.log",
  "build-info.stdout.log",
  "build-info.stderr.log",
  "tests.stdout.log",
  "tests.stderr.log",
  "source-commit.stdout.log",
  "source-commit.stderr.log",
  "source-tree.stdout.log",
  "source-tree.stderr.log",
]) {
  const bytes = await readFile(join(out, file));
  outputs.push({ file, hash: hash(bytes), bytes: bytes.length });
}
await saveJSON(join(out, "result.json"), {
  schema: 1,
  sourceCommit,
  sourceTree,
  inputs,
  outputs,
  passed,
  raceEnabled: true,
  assertionValuesSeparatelyRetained: false,
  strictFontAdmissionEnabled: false,
  pixelPerfectVerified: false,
});
