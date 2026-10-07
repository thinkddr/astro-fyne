// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compile } from "./parser.ts";
import { emitGo, scopeHelper } from "./emit.ts";

const cases = [
  "null?.child.value",
  "undefined?.[t('forbidden')].value",
  "({child:null})?.child.value",
  "(null?.child).value",
  "({child:null})?.child?.value",
  "(null?.child)?.value",
  "false?.missing",
  "0?.missing",
  "false?.[t('false-key')]",
  "0?.[t('zero-key')]",
  "''?.length",
  "[7]?.[0]",
  "({child:{value:7}})?.[t('child')][t('value')]",
  "t('once')?.length",
  "null?.child[t('forbidden')]",
  "({child:undefined})?.child?.[t('forbidden')]",
  "({child:undefined})?.child[t('evaluated-before-error')]",
  "(null?.child)[t('evaluated-before-error')]",
  { js: "null?.child.value", source: "(null as any)?.child!.value" },
  { js: "(null?.child).value", source: "((null as any)?.child!).value" },
  {
    js: "({child:{value:7}})?.child.value",
    source: "({child:{value:7}})?.child!.value",
  },
].map((value) =>
  typeof value === "string" ? { js: value, source: value } : value,
);

test("generated native optional access matches JavaScript values, errors and evaluation order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astro-fyne-optional-"));
  try {
    const expected = cases.map(({ js }, index) => {
      const calls: string[] = [];
      let result = "",
        failed = false;
      try {
        result = new Function("t", `return String(${js});`)((key: string) => {
          calls.push(key);
          return key;
        });
      } catch {
        failed = true;
      }
      return { index, result, failed, calls };
    });
    const constructors: string[] = [];
    await writeFile(
      join(directory, "astro_fyne_scope.gen.go"),
      `package main\nimport webui "github.com/thinkddr/astro-fyne/native"\n${scopeHelper}`,
    );
    for (const [index, { source }] of cases.entries()) {
      const entry = join(directory, `Probe${index}.tsx`);
      await writeFile(
        entry,
        `export function Page({t}) { return <p id="result">{String(${source})}</p>; }`,
      );
      await writeFile(
        join(directory, `probe${index}.gen.go`),
        emitGo(await compile(entry), {
          name: `Probe${index}`,
          packageName: "main",
        }),
      );
      constructors.push(
        `func() { calls:=[]string{}; translate:=func(args ...any) any { key:=webui.String(args[0]); calls=append(calls,key); return key }; view,err:=NewProbe${index}(webui.Scope{"t":translate},webui.Actions{"t":translate}); result:=""; if err==nil { result=view.Object("result").(interface{AccessibilityLabel() string}).AccessibilityLabel() }; rows=append(rows,map[string]any{"index":${index},"result":result,"failed":err!=nil,"calls":calls}) }()`,
      );
    }
    const nativePath = resolve(import.meta.dir, "../native");
    const mod = (await readFile(join(nativePath, "go.mod"), "utf8")).replace(
      /^module .*$/m,
      "module astro-fyne-optional-probe",
    );
    await writeFile(
      join(directory, "go.mod"),
      `${mod}\nrequire github.com/thinkddr/astro-fyne/native v0.0.0\nreplace github.com/thinkddr/astro-fyne/native => ${JSON.stringify(nativePath)}\n`,
    );
    await writeFile(
      join(directory, "go.sum"),
      await readFile(join(nativePath, "go.sum")),
    );
    await writeFile(
      join(directory, "main.go"),
      `package main
import("encoding/json";"os";"fyne.io/fyne/v2/test";webui "github.com/thinkddr/astro-fyne/native")
func main(){ app:=test.NewApp(); defer app.Quit(); rows:=[]map[string]any{}; ${constructors.join("; ")}; if err:=json.NewEncoder(os.Stdout).Encode(rows);err!=nil{panic(err)} }
`,
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
    expect(JSON.parse(output)).toEqual(expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test("optional calls, module host effects and SSR reads retain explicit diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astro-fyne-chain-"));
  try {
    const entry = join(directory, "Page.tsx");
    for (const source of [
      "export function Page({value}) { return <p>{value?.method().name}</p>; }",
      "export function Page({t}) { return <p>{t?.('key')}</p>; }",
      "const value=null?.[t('key')]; export function Page() { return <p>{value}</p>; }",
      "export function Page() { return <p>{Astro.request?.url}</p>; }",
    ]) {
      await writeFile(entry, source);
      await expect(compile(entry)).rejects.toThrow(
        /Optional calls|initialization|Astro.request/,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
