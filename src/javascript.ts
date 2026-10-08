// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { javascriptHostJSON } from "./javascript-data.ts";

import type { JavascriptArchive } from "./javascript-types.ts";
export type { JavascriptArchive } from "./javascript-types.ts";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const identifier = /^[A-Za-z_$][\w$]*$/;

/** Bundle source without running it; Goja's parser verifies the engine contract. */
export async function bundleJavascript(
  source: string,
  selected = "default",
  props: Record<string, unknown> = {},
  actions: string[] = [],
): Promise<JavascriptArchive> {
  source = resolve(source);
  if (![".tsx", ".jsx", ".ts", ".js"].includes(extname(source)))
    throw new Error(
      "JavaScript mode needs a TSX/JSX/TS/JS entry; use the declarative compiler for Astro frontmatter",
    );
  if (selected !== "default" && !identifier.test(selected))
    throw new Error("JavaScript export must be an identifier");
  const sources = new Map<string, string>(),
    root = dirname(source);
  async function build(entry: string, contents: string): Promise<string> {
    const result = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      format: "iife",
      minify: true,
      throw: false,
      jsx: { runtime: "automatic", importSource: "preact" },
      plugins: [
        {
          name: "astro-fyne-javascript",
          setup(builder) {
            builder.onResolve({ filter: /^astro-fyne-entry:/ }, (args) => ({
              path: args.path,
              namespace: "astro-fyne",
            }));
            builder.onResolve({ filter: /^preact(?:\/.*)?$/ }, (args) => ({
              path: fileURLToPath(import.meta.resolve(args.path)),
            }));
            builder.onLoad({ filter: /.*/, namespace: "astro-fyne" }, () => ({
              contents,
              loader: "js",
              resolveDir: root,
            }));
            builder.onLoad(
              { filter: /\.(?:[cm]?[jt]sx?|json|css)$/ },
              async (args) => {
                if (args.path.endsWith(".css"))
                  throw new Error(
                    "CSS imports need a native stylesheet adapter; use supported inline styles",
                  );
                const text = await readFile(args.path, "utf8");
                sources.set(
                  relative(root, args.path).replaceAll("\\", "/"),
                  hash(text),
                );
                const extension = extname(args.path).slice(1);
                return {
                  contents: text,
                  loader:
                    extension === "tsx"
                      ? "tsx"
                      : extension === "jsx"
                        ? "jsx"
                        : extension === "ts"
                          ? "ts"
                          : extension === "json"
                            ? "json"
                            : "js",
                };
              },
            );
          },
        },
      ],
    });
    if (!result.success)
      throw new Error(
        "Cannot bundle JavaScript: " +
          result.logs.map((log) => log.message).join("\n"),
      );
    if (
      result.outputs.length !== 1 ||
      result.outputs[0]!.kind !== "entry-point"
    )
      throw new Error(
        "JavaScript programs require one self-contained bundle; dynamic assets/imports need adapters",
      );
    return result.outputs[0]!.text();
  }
  const runtime = await build(
    "astro-fyne-entry:runtime",
    `import {createRuntime} from ${JSON.stringify(resolve(import.meta.dir, "javascript-runtime.js"))}; globalThis._afyRuntime = createRuntime;`,
  );
  const program = await build(
    "astro-fyne-entry:program",
    `import * as source from ${JSON.stringify(source)}; import {h,render,options} from "preact"; globalThis._afyComponent = source[${JSON.stringify(selected)}]; globalThis._afyPreact = {h,render,options};`,
  );
  const license = await readFile(
    resolve(fileURLToPath(import.meta.resolve("preact")), "../../LICENSE"),
    "utf8",
  );
  const code = `/* Bundled Preact: ${license.replaceAll("*/", "* / ")} */\nfunction(host,archive){const globalThis={};${runtime}\nconst runtime=globalThis._afyRuntime(host,archive);return(function(environment){const{document,window,self,globalThis,Math,Date,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame,queueMicrotask,fetch,setInterval,getComputedStyle,console}=environment;${program}\nreturn runtime.bind(globalThis._afyComponent,globalThis._afyPreact);})(runtime.environment);}`;
  const archive: JavascriptArchive = {
    schema: 1,
    kind: "astro-fyne-javascript",
    code,
    codeHash: hash(code),
    sources: [...sources]
      .map(([path, hash]) => ({ path, hash }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    props,
    actions,
    events: [],
    journal: [],
  };
  await validateJavascriptArchive(archive);
  return archive;
}

/** Close archive vocabulary and verify all code before any generated writes. */
export async function validateJavascriptArchive(
  value: unknown,
): Promise<JavascriptArchive> {
  const record = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  const fields = (
    value: Record<string, any>,
    required: string[],
    optional: string[] = [],
  ) => {
    if (
      required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(
        (key) => !required.includes(key) && !optional.includes(key),
      )
    )
      throw new Error("Unknown or missing JavaScript archive fields");
  };
  if (!record(value))
    throw new Error("JavaScript archive must be a JSON record");
  fields(
    value,
    [
      "schema",
      "kind",
      "code",
      "codeHash",
      "sources",
      "props",
      "actions",
      "events",
      "journal",
    ],
    ["frame"],
  );
  if (
    value.schema !== 1 ||
    value.kind !== "astro-fyne-javascript" ||
    typeof value.code !== "string" ||
    Buffer.byteLength(value.code) > 64 * 1024 * 1024 ||
    value.codeHash !== hash(value.code)
  )
    throw new Error("Invalid JavaScript archive or digest");
  if (
    !record(value.props) ||
    Buffer.byteLength(JSON.stringify(value.props)) > 1024 * 1024 ||
    !Array.isArray(value.actions) ||
    new Set(value.actions).size !== value.actions.length ||
    value.actions.some(
      (name: unknown) =>
        typeof name !== "string" ||
        !identifier.test(name) ||
        name.startsWith("_afy") ||
        Object.hasOwn(value.props, name),
    )
  )
    throw new Error("Invalid JavaScript props or action bindings");
  javascriptHostJSON(value.props);
  if (Buffer.byteLength(JSON.stringify(value)) > 128 * 1024 * 1024)
    throw new Error("JavaScript archive exceeds 128MiB");
  if (
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.some(
      (source: unknown) =>
        !record(source) ||
        typeof source.path !== "string" ||
        !source.path ||
        !/^[a-f0-9]{64}$/.test(source.hash),
    )
  )
    throw new Error("Invalid JavaScript sources");
  for (const source of value.sources) fields(source, ["path", "hash"]);
  if (
    !Array.isArray(value.events) ||
    value.events.length > 10000 ||
    !Array.isArray(value.journal) ||
    value.journal.length > 100000
  )
    throw new Error("JavaScript history exceeds its limits");
  for (const event of value.events) {
    if (!record(event)) throw new Error("Invalid JavaScript event");
    fields(event, ["node", "type"], ["value"]);
    if (
      typeof event.node !== "string" ||
      !event.node ||
      !["click", "input", "change"].includes(event.type) ||
      (event.value !== undefined && typeof event.value !== "string")
    )
      throw new Error("Invalid JavaScript event");
  }
  for (const entry of value.journal) {
    if (!record(entry)) throw new Error("Invalid JavaScript journal entry");
    fields(entry, ["kind", "name", "args"], ["value", "error"]);
    if (
      !["action", "now", "random"].includes(entry.kind) ||
      typeof entry.name !== "string" ||
      (entry.kind === "action" && !value.actions.includes(entry.name)) ||
      (entry.kind !== "action" && entry.name !== "") ||
      typeof entry.args !== "string" ||
      (entry.value === undefined) === (entry.error === undefined) ||
      (entry.value !== undefined && typeof entry.value !== "string") ||
      (entry.error !== undefined && typeof entry.error !== "string")
    )
      throw new Error("Invalid JavaScript host journal");
    if (!Array.isArray(JSON.parse(entry.args)))
      throw new Error("Journal arguments require an array");
    if (entry.value !== undefined) JSON.parse(entry.value);
  }
  if (value.frame !== undefined && !Array.isArray(value.frame))
    throw new Error("JavaScript frame must be an array");
  const process = spawnSync("go", ["run", "./javascript/cmd/check"], {
    cwd: resolve(import.meta.dir, "../native"),
    input: JSON.stringify(value),
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (process.error || process.status !== 0)
    throw new Error(
      "Goja program validation failed: " +
        (process.error?.message ?? process.stderr),
    );
  return value as JavascriptArchive;
}
