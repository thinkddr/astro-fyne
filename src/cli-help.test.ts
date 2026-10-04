// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { helpText, resolveCommand } from "./cli-help.ts";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
let directory: string;

beforeEach(async () => {
  directory = await realpath(
    await mkdtemp(join(tmpdir(), "astro-fyne-cli-help-")),
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function run(args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: "utf8",
    timeout: 5_000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

const helpCases: { args: string[]; contains: string }[] = [
  { args: [], contains: "Commands:" },
  { args: ["--help"], contains: "Commands:" },
  { args: ["-h"], contains: "Commands:" },
  { args: ["help"], contains: "Commands:" },
  ...["generate", "check", "watch", "analyze", "to-fyne"].map((command) => ({
    args: [command, "--help"],
    contains: "--config <file>",
  })),
  { args: ["watch", "-h"], contains: "Ctrl+C" },
  { args: ["help", "to-fyne"], contains: "alias: to-fyne" },
  { args: ["reverse", "--help"], contains: "--public-dir <directory>" },
  { args: ["to-web", "-h"], contains: "--actions-module <path>" },
  { args: ["help", "to-web"], contains: "alias: to-web" },
  {
    args: ["generate", "--config", "missing.json", "--help"],
    contains: "--config <file>",
  },
];

test.each(helpCases)(
  "help is side-effect free for $args",
  async ({ args, contains }) => {
    const result = run(args);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(contains);
    expect(result.stdout).toContain("Usage:");
    expect(await readdir(directory)).toEqual([]);
  },
);

test("aliases resolve only explicit command names", () => {
  expect(resolveCommand("to-fyne")).toBe("generate");
  expect(resolveCommand("to-web")).toBe("reverse");
  expect(resolveCommand("check")).toBe("check");
  expect(resolveCommand("__proto__")).toBeUndefined();
  expect(resolveCommand("toString")).toBeUndefined();
  expect(helpText("analyze")).toContain("does not require gofmt");
});

const invalidCases: { args: string[]; diagnostic: string; help: string }[] = [
  {
    args: ["gnerate"],
    diagnostic: "Unknown command: gnerate",
    help: "astro-fyne --help",
  },
  {
    args: ["help", "unknown"],
    diagnostic: "Unknown command: unknown",
    help: "astro-fyne --help",
  },
  {
    args: ["generate", "--unknown"],
    diagnostic: "Unknown option: --unknown",
    help: "generate --help",
  },
  {
    args: ["to-fyne", "--config", "--entry", "Page"],
    diagnostic: "Missing value for --config",
    help: "generate --help",
  },
  {
    args: ["check", "--entry", "-huh"],
    diagnostic: "Missing value for --entry",
    help: "check --help",
  },
  {
    args: ["watch", "--config", "one.json", "--config", "two.json"],
    diagnostic: "Duplicate option: --config",
    help: "watch --help",
  },
  {
    args: ["to-web", "--unknown"],
    diagnostic: "Unknown option: --unknown",
    help: "reverse --help",
  },
  {
    args: ["reverse", "--scene", "--out", "pages"],
    diagnostic: "Missing value for --scene",
    help: "reverse --help",
  },
  {
    args: ["reverse", "--check", "--check"],
    diagnostic: "Duplicate option: --check",
    help: "reverse --help",
  },
  {
    args: ["to-web", "--scene", "scene.json"],
    diagnostic: "Missing required options: --out, --name",
    help: "reverse --help",
  },
];

test.each(invalidCases)(
  "invalid arguments explain $diagnostic before accessing files",
  async ({ args, diagnostic, help }) => {
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(diagnostic);
    expect(result.stderr).toContain(help);
    expect(await readdir(directory)).toEqual([]);
  },
);

test("a missing default config explains how to select one through the direction alias", () => {
  const result = run(["to-fyne"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    `Configuration file not found: ${join(directory, "astro-fyne.json")}`,
  );
  expect(result.stderr).toContain(
    "Create astro-fyne.json or pass --config <path>.",
  );
  expect(result.stderr).not.toContain("Unknown command");
});

test("analyze honors the default config and prints actual source JSON without output files", async () => {
  await writeFile(
    join(directory, "Page.tsx"),
    'export default function Page() { return <div id="root">Hello</div>; }',
  );
  await writeFile(
    join(directory, "astro-fyne.json"),
    JSON.stringify({
      schema: 1,
      package: "generated",
      entries: [{ name: "Page", source: "Page.tsx", output: "page.gen.go" }],
    }),
  );
  const result = run(["analyze", "--entry", "Page"]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const analysis = JSON.parse(result.stdout);
  expect(analysis.name).toBe("Page");
  expect(
    analysis.program.components.some(
      (component: { name: string }) =>
        component.name === analysis.program.entry,
    ),
  ).toBe(true);
  expect(JSON.stringify(analysis.program.components)).toContain(
    '"value":"Hello"',
  );
  expect(analysis.program.sources[0].path).toBe("Page.tsx");
  expect(analysis.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect((await readdir(directory)).sort()).toEqual([
    "Page.tsx",
    "astro-fyne.json",
  ]);
});

test("explicit config overrides are not shadowed by the default config", async () => {
  await writeFile(join(directory, "astro-fyne.json"), "invalid default JSON");
  await writeFile(
    join(directory, "Page.tsx"),
    'export default function Page() { return <div id="root">Selected</div>; }',
  );
  await writeFile(
    join(directory, "custom.json"),
    JSON.stringify({
      schema: 1,
      package: "generated",
      entries: [
        { name: "Selected", source: "Page.tsx", output: "selected.gen.go" },
      ],
    }),
  );
  const result = run(["analyze", "--config", "custom.json"]);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).name).toBe("Selected");
  expect(await readFile(join(directory, "astro-fyne.json"), "utf8")).toBe(
    "invalid default JSON",
  );
});

test("invalid JSON names the selected input file in both directions", async () => {
  const path = join(directory, "broken.json");
  await writeFile(path, "{");
  for (const args of [
    ["analyze", "--config", path],
    ["to-web", "--scene", path, "--out", "pages", "--name", "NativePage"],
  ]) {
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid JSON");
    expect(result.stderr).toContain(path);
    expect(await readdir(directory)).toEqual(["broken.json"]);
  }
});
