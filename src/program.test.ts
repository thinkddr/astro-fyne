// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  stat,
  symlink,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compile } from "./parser.ts";
import { emitGo, scopeHelper } from "./emit.ts";
import { generate } from "./cli.ts";
import { generateProgram } from "./program-cli.ts";
import { createProgramArchive, validateProgramArchive } from "./program.ts";
import { encodeProgramData, decodeProgramData } from "./program-values.ts";
import { programExpression } from "./program-web-runtime.ts";

test("portable data retains special numbers, undefined, shared references and named bindings", () => {
  const shared: Record<string, unknown> = {
    zero: -0,
    nan: NaN,
    positive: Infinity,
    negative: -Infinity,
    absent: undefined,
    no: false,
    empty: "",
    unicode: "<>&🙂\u2028",
  };
  shared.self = shared;
  let invoked = false;
  const action = () => {
    invoked = true;
  };
  const encoded = encodeProgramData({ shared, save: action }, { shared }, [
    "save",
  ]);
  const decoded = decodeProgramData(encoded.props, encoded.state, {
    save: action,
  });
  expect(decoded.props.shared).toBe(decoded.state.shared);
  const result = decoded.props.shared as Record<string, unknown>;
  expect(result.self).toBe(result);
  expect(Object.is(result.zero, -0)).toBe(true);
  expect(result.nan).toBeNaN();
  expect(result.positive).toBe(Infinity);
  expect(result.negative).toBe(-Infinity);
  expect(Object.hasOwn(result, "absent")).toBe(true);
  expect(result.absent).toBeUndefined();
  expect(result.no).toBe(false);
  expect(result.empty).toBe("");
  expect(result.unicode).toBe("<>&🙂\u2028");
  expect(decoded.props.save).toBe(action);
  expect(invoked).toBe(false);
  expect(() => decodeProgramData(encoded.props, encoded.state)).toThrow(
    "named action",
  );
  for (const value of [
    () => {},
    new Date(),
    "\ud800",
    [, 1],
    Object.defineProperty({}, "getter", {
      enumerable: true,
      get() {
        throw new Error("invoked getter");
      },
    }),
  ])
    expect(() => encodeProgramData({ value }, {})).toThrow(
      /adapter|surrogates/,
    );
  const nested = encodeProgramData({}, {});
  nested.state = {
    kind: "object",
    id: 2,
    entries: [{ key: "save", value: { kind: "action", value: "save" } }],
  };
  expect(() =>
    decodeProgramData(nested.props, nested.state, { save: action }),
  ).toThrow("top-level prop");
});

test("browser IR expressions preserve lazy optional access and object evaluation order", () => {
  const calls: string[] = [];
  const actions = {
    t: (name: string) => {
      calls.push(name);
      return name;
    },
  };
  const actual = programExpression(
    {
      kind: "chain",
      object: { kind: "literal", value: null },
      accesses: [
        {
          optional: true,
          key: {
            kind: "call",
            name: "t",
            args: [{ kind: "literal", value: "skip" }],
          },
        },
        { optional: false, key: { kind: "literal", value: "missing" } },
      ],
    },
    {},
    actions,
  );
  expect(actual).toBeUndefined();
  expect(calls).toEqual([]);
  const record = programExpression(
    {
      kind: "object",
      entries: {
        z: {
          kind: "call",
          name: "t",
          args: [{ kind: "literal", value: "first" }],
        },
        "2": {
          kind: "call",
          name: "t",
          args: [{ kind: "literal", value: "second" }],
        },
        "1": {
          kind: "call",
          name: "t",
          args: [{ kind: "literal", value: "third" }],
        },
      },
      order: ["z", "2", "1"],
    },
    {},
    actions,
  );
  expect(calls).toEqual(["first", "second", "third"]);
  expect(Object.keys(record)).toEqual(["1", "2", "z"]);
});

test("archives reject altered identities, unknown IR and unknown state slots before writing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-program-invalid-"));
  try {
    const source = join(directory, "Page.tsx");
    await writeFile(
      source,
      "export function Page(){return <p id='result'>Valid</p>}",
    );
    const program = await compile(source),
      archive = createProgramArchive(program);
    expect(validateProgramArchive(archive).program).toEqual(program);
    const edits = [
      { ...archive, programHash: "0".repeat(64) },
      { ...archive, sourceHash: "0".repeat(64) },
      { ...archive, unknown: true },
      {
        ...archive,
        state: {
          kind: "object",
          id: 2,
          entries: [
            { key: "host-state", value: { kind: "number", value: "1" } },
          ],
        },
      },
      {
        ...archive,
        props: {
          kind: "object",
          id: 1,
          entries: [{ key: "x", value: { kind: "reference", id: 9 } }],
        },
      },
    ];
    const unknown = JSON.stringify({ ...program, unsupported: true });
    edits.push({
      ...archive,
      program: unknown,
      programHash: createHash("sha256").update(unknown).digest("hex"),
    });
    for (const value of edits) {
      await writeFile(join(directory, "program.json"), JSON.stringify(value));
      await expect(
        generateProgram({
          program: join(directory, "program.json"),
          out: join(directory, "out"),
          name: "Page",
          direction: "native",
        }),
      ).rejects.toThrow();
      await expect(stat(join(directory, "out"))).rejects.toThrow();
    }
    expect(() =>
      emitGo(
        { ...program, hasStyles: true },
        { name: "Page", packageName: "generated", portableProgram: true },
      ),
    ).toThrow("retained CSS source");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("portable generation preserves ownership, checks freshness, and guards output symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-program-files-"));
  try {
    const source = join(directory, "Page.tsx"),
      path = join(directory, "program.json"),
      out = join(directory, "out");
    await writeFile(
      source,
      "export function Page(){return <p id='result'>Valid</p>}",
    );
    await writeFile(
      path,
      JSON.stringify(createProgramArchive(await compile(source))),
    );
    await mkdir(join(out, "_Page-program"), { recursive: true });
    await writeFile(join(out, "_Page-program/Page.tsx"), "// handwritten\n");
    const options = {
      program: path,
      out,
      name: "Page",
      direction: "web" as const,
    };
    await expect(generateProgram(options)).rejects.toThrow("not owned");
    await expect(stat(join(out, "Page.astro"))).rejects.toThrow();
    await rm(join(out, "_Page-program/Page.tsx"));
    await generateProgram(options);
    await generateProgram({ ...options, check: true });
    await writeFile(
      join(out, "_Page-program/Page.tsx"),
      (await readFile(join(out, "_Page-program/Page.tsx"), "utf8")) +
        "// changed\n",
    );
    await expect(generateProgram({ ...options, check: true })).rejects.toThrow(
      "out of date",
    );
    await generateProgram(options);
    const outside = join(directory, "outside");
    await mkdir(outside);
    await rm(join(out, "_Page-program/ir.ts"));
    await symlink(join(outside, "file.ts"), join(out, "_Page-program/ir.ts"));
    await expect(generateProgram(options)).rejects.toThrow("not owned");
    await expect(stat(join(outside, "file.ts"))).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("configuration opts into declarative native export without changing default widgets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-program-config-"));
  try {
    await writeFile(
      join(directory, "Page.tsx"),
      "export function Page(){return <p>Hello</p>}",
    );
    const config = join(directory, "astro-fyne.json");
    for (const portableProgram of [false, true, "invalid"]) {
      await writeFile(
        config,
        JSON.stringify({
          schema: 1,
          package: "generated",
          entries: [
            {
              name: "Page",
              source: "Page.tsx",
              output: "Page.gen.go",
              portableProgram,
            },
          ],
        }),
      );
      if (portableProgram === "invalid") {
        await expect(generate({ config, check: false })).rejects.toThrow(
          "Boolean",
        );
        continue;
      }
      await generate({ config, check: false });
      const code = await readFile(join(directory, "Page.gen.go"), "utf8");
      expect(code.includes("ExportProgram()")).toBe(portableProgram === true);
      await generate({ config, check: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real generated Go resumes an exported update closure and named action from current state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-program-native-"));
  try {
    const source = join(directory, "Page.tsx");
    await writeFile(
      source,
      `import {useState} from 'preact/hooks'; export function Page({initial,observe}) {const [count,setCount]=useState(initial); return <main><p id="count">{count}</p><button id="batch" onClick={()=>{setCount(count+1);setCount(previous=>previous+10);setCount(count+2);setCount(previous=>previous+3);observe(count)}}>Batch</button></main>}`,
    );
    const program = await compile(source);
    const native = resolve(import.meta.dir, "../native");
    await writeFile(
      join(directory, "go.mod"),
      (await readFile(join(native, "go.mod"), "utf8")).replace(
        /^module .*$/m,
        "module program-probe",
      ) +
        `\nrequire github.com/thinkddr/astro-fyne/native v0.0.0\nreplace github.com/thinkddr/astro-fyne/native => ${JSON.stringify(native)}\n`,
    );
    await writeFile(
      join(directory, "go.sum"),
      await readFile(join(native, "go.sum")),
    );
    await writeFile(
      join(directory, "Original.gen.go"),
      emitGo(program, {
        name: "Original",
        packageName: "main",
        portableProgram: true,
      }),
    );
    await writeFile(
      join(directory, "astro_fyne_scope.gen.go"),
      `// Code generated by astro-fyne. DO NOT EDIT.\npackage main\nimport webui "github.com/thinkddr/astro-fyne/native"\n${scopeHelper}`,
    );
    const main = `package main
import("encoding/json";"os";"fyne.io/fyne/v2";"fyne.io/fyne/v2/test";webui "github.com/thinkddr/astro-fyne/native")
func main(){app:=test.NewApp();defer app.Quit();observed:=[]float64{};observe:=func(args ...any)any{observed=append(observed,webui.Number(args[0]));return nil};actions:=webui.Actions{"observe":observe};view,err:=NEW_WIDGET;if err!=nil{panic(err)};view.Object("batch").(fyne.Tappable).Tapped(&fyne.PointEvent{}); archive,err:=view.ExportProgram();if err!=nil{panic(err)};if err=json.NewEncoder(os.Stdout).Encode(map[string]any{"archive":archive,"value":view.Object("count").(interface{AccessibilityLabel()string}).AccessibilityLabel(),"observed":observed});err!=nil{panic(err)}}`;
    const run = async (constructor: string) => {
      await writeFile(
        join(directory, "main.go"),
        main.replace("NEW_WIDGET", constructor),
      );
      const process = Bun.spawn(["go", "run", "-mod=mod", "."], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [output, errors, status] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);
      expect(status, errors).toBe(0);
      return JSON.parse(output);
    };
    const initial = await run(
      'NewOriginal(webui.Scope{"initial":float64(2),"observe":observe},actions)',
    );
    expect(initial.value).toBe("7");
    expect(initial.observed).toEqual([2]);
    validateProgramArchive(initial.archive);
    await writeFile(
      join(directory, "archive.json"),
      JSON.stringify(initial.archive),
    );
    await generateProgram({
      program: join(directory, "archive.json"),
      out: directory,
      name: "Restored",
      packageName: "main",
      direction: "native",
    });
    const restored = await run("NewRestored(nil,actions)");
    expect(restored.value).toBe("12");
    expect(restored.observed).toEqual([7]);
    expect(restored.archive.programHash).toBe(initial.archive.programHash);
    expect(restored.archive.sourceHash).toBe(initial.archive.sourceHash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
