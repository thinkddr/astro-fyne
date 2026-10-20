// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { captureUnicodeFontFamilies } from "../capture/unicode-font-family.ts";
import {
  checkUnicodeFontFamilies,
  type UnicodeFamilyReference,
} from "../capture/unicode-font-family-check.ts";

const root = resolve(import.meta.dir, ".."),
  native = join(root, "native"),
  out = join(root, "artifacts/unicode-font-family"),
  generated = join(native, ".program-roundtrip/unicode-font-family"),
  binary = join(out, "unicode-font-family.test"),
  packageName =
    "github.com/thinkddr/astro-fyne/native/.program-roundtrip/unicode-font-family",
  hash = (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex");

async function save(path: string, data: Uint8Array | string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}
async function json(path: string, value: unknown) {
  await save(path, JSON.stringify(value, null, 2) + "\n");
}
const commands: {
  name: string;
  argv: string[];
  cwd: string;
  exitCode: number;
  timeoutMs: number;
  timedOut: boolean;
}[] = [];
let ownsOutput = false;
async function command(
  name: string,
  argv: string[],
  cwd = native,
  extra: Record<string, string> = {},
  timeoutMs = 180_000,
) {
  const child = Bun.spawn(argv, {
    cwd,
    env: {
      ...Bun.env,
      GOWORK: "off",
      GOFLAGS: "-mod=readonly",
      GOTOOLCHAIN: "local",
      GOMAXPROCS: "2",
      ...extra,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    await save(join(out, name + ".stdout.log"), stdout);
    await save(join(out, name + ".stderr.log"), stderr);
    commands.push({
      name,
      argv,
      cwd: relative(root, cwd),
      exitCode,
      timeoutMs,
      timedOut,
    });
    await json(join(out, "commands.json"), commands);
    assert.ok(
      !timedOut && exitCode === 0,
      name + " failed; retained exact command outputs",
    );
    return stdout.trim();
  } finally {
    clearTimeout(timer);
  }
}

async function compareBun() {
  const referenceBytes = await readFile(join(out, "go-reference.json")),
    unicodeBytes = await readFile(
      join(root, "third_party/unicode17/UnicodeData.txt"),
    ),
    foldBytes = await readFile(
      join(root, "third_party/unicode17/CaseFolding.txt"),
    ),
    result = checkUnicodeFontFamilies(
      JSON.parse(referenceBytes.toString()) as UnicodeFamilyReference,
      unicodeBytes.toString(),
      foldBytes.toString(),
    );
  await json(join(out, "bun.json"), {
    schema: 1,
    bunVersion: Bun.version,
    bunRevision: Bun.revision,
    inputs: [
      {
        file: "go-reference.json",
        bytes: referenceBytes.length,
        hash: hash(referenceBytes),
      },
      {
        file: "third_party/unicode17/UnicodeData.txt",
        bytes: unicodeBytes.length,
        hash: hash(unicodeBytes),
      },
      {
        file: "third_party/unicode17/CaseFolding.txt",
        bytes: foldBytes.length,
        hash: hash(foldBytes),
      },
    ],
    comparison: result,
    renderingChecked: false,
    pixelPerfectVerified: false,
  });
  assert.ok(
    result.accepted,
    "Bun Unicode policy differs; retained comparison JSON",
  );
}

async function main() {
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out);
  ownsOutput = true;
  await mkdir(join(out, "inputs"));
  const paths = [
    "ci/unicode-font-family.ts",
    "ci/unicode-font-family.go.txt",
    "ci/run.sh",
    ".github/workflows/ci.yml",
    "capture/unicode-font-family.ts",
    "capture/unicode-font-family-check.ts",
    "capture/browser-provenance.ts",
    "src/font-family.ts",
    "src/font-family-data.ts",
    "src/font-family.test.ts",
    "docs/font-family-policy.md",
    "third_party/unicode17/CaseFolding.txt",
    "third_party/unicode17/UnicodeData.txt",
    "third_party/unicode17/LICENSE.txt",
    "third_party/unicode17/generate.py",
    "third_party/unicode17/provenance.json",
    "third_party/unicode17/README.md",
    "native/go.mod",
    "native/go.sum",
    "package.json",
    "bun.lock",
    "tsconfig.json",
  ];
  for (const directory of ["native", "native/fontresource"])
    for (const file of (await readdir(join(root, directory))).sort())
      if (file.endsWith(".go")) paths.push(directory + "/" + file);
  const inputs = [];
  for (const [index, path] of [...new Set(paths)].entries()) {
    const bytes = await readFile(join(root, path)),
      file = "inputs/" + String(index).padStart(4, "0") + ".source";
    await save(join(out, file), bytes);
    inputs.push({ path, file, bytes: bytes.length, hash: hash(bytes) });
  }
  await json(join(out, "inputs.json"), inputs);
  const pins = {
    "CaseFolding.txt":
      "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183",
    "UnicodeData.txt":
      "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c",
    "LICENSE.txt":
      "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96",
  };
  for (const [file, expected] of Object.entries(pins))
    assert.equal(
      hash(await readFile(join(root, "third_party/unicode17", file))),
      expected,
    );
  await command(
    "generated-data",
    ["python3", "third_party/unicode17/generate.py", "--check"],
    root,
  );
  const locks = await Promise.all(
    ["go.mod", "go.sum"].map((file) => readFile(join(native, file))),
  );
  for (const [index, file] of ["go.mod", "go.sum"].entries())
    await save(join(out, "before-" + file), locks[index]!);
  const sourceCommit = await command(
      "source-commit",
      ["git", "rev-parse", "HEAD"],
      root,
    ),
    sourceTree = await command(
      "source-tree",
      ["git", "rev-parse", "HEAD^{tree}"],
      root,
    ),
    goVersion = await command("go-version", ["go", "version"]),
    goRoot = await command("go-root", ["go", "env", "GOROOT"]);
  assert.ok(goVersion.endsWith("linux/arm64"), "expected hosted ARM64 Go");
  await command("modules", ["go", "list", "-m", "-json", "all"]);
  const stdlibInputs: {
    path: string;
    file: string;
    bytes: number;
    hash: string;
  }[] = [];
  async function retainStandardLibrary(path: string) {
    const bytes = await readFile(join(goRoot, path)),
      file = "stdlib/" + path;
    await save(join(out, file), bytes);
    stdlibInputs.push({
      path: "GOROOT/" + path,
      file,
      bytes: bytes.length,
      hash: hash(bytes),
    });
  }
  async function unicodeDirectory(path: string) {
    for (const entry of (
      await readdir(join(goRoot, path), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path + "/" + entry.name;
      if (entry.isDirectory()) await unicodeDirectory(child);
      else if (entry.isFile() && entry.name.endsWith(".go"))
        await retainStandardLibrary(child);
    }
  }
  await unicodeDirectory("src/unicode");
  for (const path of ["LICENSE", "VERSION", "src/strings/strings.go"])
    await retainStandardLibrary(path);
  await json(join(out, "stdlib-inputs.json"), stdlibInputs);
  const fixture = await readFile(
    join(root, "ci/unicode-font-family.go.txt"),
    "utf8",
  );
  assert.equal(fixture.split("PROBE_PACKAGE").length, 2);
  await mkdir(dirname(generated), { recursive: true });
  await mkdir(generated);
  await save(
    join(generated, "unicode_font_family_test.go"),
    fixture.replace("PROBE_PACKAGE", "unicode_font_family"),
  );
  await command(
    "format-driver",
    ["gofmt", "-w", "unicode_font_family_test.go"],
    generated,
  );
  await save(
    join(out, "unicode_font_family_test.go"),
    await readFile(join(generated, "unicode_font_family_test.go")),
  );
  await command(
    "build",
    ["go", "test", "-c", "-race", "-tags", "ci", "-p=1", "-o", binary, "."],
    generated,
    {},
    300_000,
  );
  await command("build-info", ["go", "version", "-m", binary], generated);
  const executable = await readFile(binary);
  assert.ok(
    executable.subarray(0, 6).equals(Buffer.from([127, 69, 76, 70, 2, 1])),
  );
  assert.equal(executable.readUInt16LE(18), 183, "expected retained ARM64 ELF");
  await command(
    "go-tests",
    [
      "go",
      "tool",
      "test2json",
      "-p",
      packageName,
      "-t",
      binary,
      "-test.v=test2json",
      "-test.count=1",
      "-test.timeout=180s",
    ],
    generated,
    { ASTRO_FYNE_UNICODE_FAMILY_OUTPUT: join(out, "go-reference.json") },
    210_000,
  );
  const events = (await readFile(join(out, "go-tests.stdout.log"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(events.every((event) => event.Package === packageName));
  assert.ok(!events.some((event) => ["fail", "skip"].includes(event.Action)));
  assert.deepEqual(
    events
      .filter((event) => event.Action === "pass" && event.Test)
      .map((event) => event.Test),
    ["TestUnicodeFontFamilyPolicy"],
  );
  assert.equal(
    events.filter((event) => event.Action === "pass" && !event.Test).length,
    1,
  );
  await command(
    "bun-comparison",
    ["bun", join(root, "ci/unicode-font-family.ts"), "compare-bun"],
    root,
  );
  const chromiumResult = await captureUnicodeFontFamilies(out),
    bunResult = JSON.parse(await readFile(join(out, "bun.json"), "utf8"));
  assert.deepEqual(chromiumResult, bunResult.comparison);
  for (const [index, file] of ["go.mod", "go.sum"].entries()) {
    const actual = await readFile(join(native, file));
    await save(join(out, "after-" + file), actual);
    assert.ok(
      locks[index]!.equals(actual),
      "Unicode gate changed native module locks",
    );
  }
  const outputs: { file: string; bytes: number; hash: string }[] = [];
  async function inventory(path: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await inventory(file);
      else {
        assert.ok(entry.isFile(), "unexpected Unicode artifact symlink");
        const bytes = await readFile(file);
        outputs.push({
          file: relative(out, file),
          bytes: bytes.length,
          hash: hash(bytes),
        });
      }
    }
  }
  await inventory(out);
  await json(join(out, "result.json"), {
    schema: 1,
    accepted: true,
    sourceCommit,
    sourceTree,
    unicodeVersion: chromiumResult.unicodeVersion,
    goVersion,
    bunVersion: Bun.version,
    inputs,
    standardLibraryInputs: stdlibInputs,
    outputs,
    comparison: chromiumResult,
    actualRaceExecutable: {
      file: "unicode-font-family.test",
      bytes: executable.length,
      hash: hash(executable),
    },
    nativeModuleLocksUnchanged: true,
    buildMetadataIsSourceAttestation: false,
    renderingChecked: false,
    pixelPerfectVerified: false,
    fallbackFreeRenderingVerified: false,
  });
}

try {
  assert.ok(
    process.argv.length === 2 ||
      (process.argv.length === 3 && process.argv[2] === "compare-bun"),
    "Usage: bun ci/unicode-font-family.ts [compare-bun]",
  );
  if (process.argv[2] === "compare-bun") {
    ownsOutput = true;
    await compareBun();
  } else await main();
} catch (error) {
  if (ownsOutput)
    await json(
      join(
        out,
        process.argv[2] === "compare-bun" ? "bun-failure.json" : "failure.json",
      ),
      {
        schema: 1,
        accepted: false,
        error: String(error),
        commands,
        renderingChecked: false,
        pixelPerfectVerified: false,
      },
    );
  throw error;
}
