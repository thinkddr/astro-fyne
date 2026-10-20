// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  javascriptHostJSON,
  validJavascriptText,
  validateJavascriptAnimationState,
} from "./javascript-data.ts";
import { astroJavascript } from "./javascript-astro.ts";
import { compileJavascriptCSS } from "./javascript-css.ts";
import { createCSSFontFamilyResolver } from "./font-family-css.ts";

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
  stylesheets: string[] = [],
  fontFamilies: readonly string[] = [],
): Promise<JavascriptArchive> {
  const { archive } = await prepareJavascriptBundle(
    source,
    selected,
    props,
    actions,
    stylesheets,
    fontFamilies,
  );
  return archive;
}

/** Return the archive and directly read source paths for output protection. */
export async function prepareJavascriptBundle(
  source: string,
  selected = "default",
  props: Record<string, unknown> = {},
  actions: string[] = [],
  stylesheets: string[] = [],
  fontFamilies: readonly string[] = [],
): Promise<{ archive: JavascriptArchive; inputPaths: string[] }> {
  if (!Array.isArray(fontFamilies))
    throw new Error("CSS font family: require a canonical family array.");
  const families = [...fontFamilies];
  createCSSFontFamilyResolver(families);
  source = resolve(source);
  if (![".astro", ".tsx", ".jsx", ".ts", ".js"].includes(extname(source)))
    throw new Error("JavaScript mode needs an Astro/TSX/JSX/TS/JS entry");
  if (selected !== "default" && !identifier.test(selected))
    throw new Error("JavaScript export must be an identifier");
  if (extname(source) === ".astro" && selected !== "default")
    throw new Error(
      "Astro JavaScript entries expose only the default component",
    );
  if (Object.keys(props).some((name) => name.startsWith("_afyAstro")))
    throw new Error(
      "_afyAstroSlots is reserved for native Astro slot metadata",
    );
  const inputPaths = new Set<string>(),
    sources = new Map<string, string>(),
    root = dirname(source);
  const cssSources = new Map<
    string,
    { path: string; hash: string; text: string }
  >();
  let heightAnimations = false;
  const features = (rules: any[]) => {
    if (
      rules.some(
        (rule) =>
          rule.heightKeyframes ||
          rule.declarations?.some((item: any) =>
            item.animation?.some(
              ([name, value]: [string, unknown]) =>
                name === "animation-name" && value !== "none",
            ),
          ),
      )
    )
      heightAnimations = true;
    return rules;
  };
  const recordCSS = (file: string, text: string) => {
    inputPaths.add(resolve(file));
    const path = relative(root, file).replaceAll("\\", "/"),
      digest = hash(text),
      previous = cssSources.get(path);
    if (previous && previous.hash !== digest)
      throw new Error(`CSS source changed while bundling: ${path}`);
    sources.set(path, digest);
    cssSources.set(path, { path, hash: digest, text });
  };
  const externalStyles = [];
  for (const file of stylesheets) {
    if (extname(file) !== ".css")
      throw new Error("Stylesheet input must be a local CSS file");
    externalStyles.push(
      ...features(await compileJavascriptCSS(file, recordCSS)),
    );
  }
  const scripts = new Map<string, { contents: string; directory: string }>();
  async function build(
    entry: string,
    contents: string,
    resolveDir = root,
    script = false,
  ): Promise<string> {
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
            builder.onResolve({ filter: /^preact(?:\/.*)?$/ }, (args) => {
              if (script)
                throw new Error(
                  "Scripts importing Preact require a shared renderer adapter; use a hydrated component",
                );
              return { path: fileURLToPath(import.meta.resolve(args.path)) };
            });
            builder.onResolve({ filter: /\.astro$/ }, (args) => {
              if (
                args.importer &&
                args.importer !== entry &&
                !args.importer.endsWith(".astro")
              )
                throw new Error(
                  "Astro server components require an Astro parent; JSX embedding needs an SSR adapter",
                );
              return undefined;
            });
            // Bun resolves literal absolute route paths itself. Relative
            // imports in virtual scripts retain the script's original base.
            builder.onResolve({ filter: /.*/ }, (args) =>
              args.importer === entry && !isAbsolute(args.path)
                ? {
                    path: Bun.resolveSync(args.path, resolveDir),
                    namespace: "astro-fyne-source",
                  }
                : undefined,
            );
            builder.onLoad({ filter: /.*/, namespace: "astro-fyne" }, () => ({
              contents,
              loader: script ? "ts" : "js",
              resolveDir,
            }));
            builder.onLoad({ filter: /\.astro$/ }, async (args) => {
              if (script)
                throw new Error(
                  "Browser scripts cannot import Astro server components",
                );
              const text = await readFile(args.path, "utf8");
              inputPaths.add(resolve(args.path));
              const identity = relative(root, args.path).replaceAll("\\", "/");
              sources.set(identity, hash(text));
              return {
                contents: await astroJavascript(
                  text,
                  args.path,
                  identity,
                  async (contents, label) => {
                    scripts.set(label, {
                      contents,
                      directory: dirname(args.path),
                    });
                    return `globalThis._afyAstroScripts[${JSON.stringify(label)}]();`;
                  },
                ),
                loader: "tsx",
                resolveDir: dirname(args.path),
              };
            });
            const loadSource: Parameters<typeof builder.onLoad>[1] = async (
              args,
            ) => {
              if (args.path.endsWith(".css")) {
                if (args.path.endsWith(".module.css"))
                  throw new Error(
                    "CSS modules require a native class-export adapter",
                  );
                const rules = features(
                  await compileJavascriptCSS(args.path, recordCSS),
                );
                return {
                  contents: `globalThis._afyCssInstall(${JSON.stringify(rules)});`,
                  loader: "js" as const,
                  resolveDir: dirname(args.path),
                };
              }
              const text = await readFile(args.path, "utf8");
              inputPaths.add(resolve(args.path));
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
                resolveDir: dirname(args.path),
              };
            };
            for (const namespace of ["file", "astro-fyne-source"])
              builder.onLoad(
                { filter: /\.(?:[cm]?[jt]sx?|json|css)$/, namespace },
                loadSource,
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
    `import {createRuntime} from ${JSON.stringify(resolve(import.meta.dir, "javascript-runtime.js"))}; ${families.length ? `import {createCSSFontFamilyResolver} from ${JSON.stringify(resolve(import.meta.dir, "font-family-css.ts"))}; globalThis._afyRuntime = (host,archive)=>createRuntime(host,archive,createCSSFontFamilyResolver(${JSON.stringify(families)}));` : "globalThis._afyRuntime = createRuntime;"}`,
  );
  const program = await build(
    "astro-fyne-entry:program",
    `import * as source from ${JSON.stringify(source)}; import {h,render,options} from "preact"; globalThis._afyComponent = source[${JSON.stringify(selected)}]; globalThis._afyPreact = {h,render,options};`,
  );
  const scriptFactories: string[] = [];
  for (const [label, script] of scripts) {
    const code = await build(
      "astro-fyne-entry:script:" + hash(label),
      script.contents,
      script.directory,
      true,
    );
    scriptFactories.push(`[${JSON.stringify(label)}]:()=>{${code}}`);
  }
  const licensePath = resolve(
      fileURLToPath(import.meta.resolve("preact")),
      "../../LICENSE",
    ),
    license = await readFile(licensePath, "utf8");
  inputPaths.add(licensePath);
  let unicodeNotice = "";
  if (families.length) {
    const path = resolve(
        import.meta.dir,
        "../third_party/unicode17/LICENSE.txt",
      ),
      notice = await readFile(path, "utf8");
    inputPaths.add(path);
    sources.set(relative(root, path).replaceAll("\\", "/"), hash(notice));
    unicodeNotice = `/* Bundled Unicode17 data: ${notice.replaceAll("*/", "* / ")} */\n`;
  }
  const code = `/* Bundled Preact: ${license.replaceAll("*/", "* / ")} */\n${unicodeNotice}function(host,archive){if(archive.schema!==${heightAnimations ? 2 : 1})throw new Error("JavaScript archive schema differs from its compiled animation ABI");const globalThis={};${runtime}\nconst runtime=globalThis._afyRuntime(host,archive);${stylesheets.length ? `runtime.environment._afyCssInstall(${JSON.stringify(externalStyles)});` : ""}return(function(environment){const{document,window,self,globalThis,Math,Date,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame,queueMicrotask,fetch,setInterval,getComputedStyle,console}=environment;${scriptFactories.length ? `globalThis._afyAstroScripts={${scriptFactories.join(",")}};` : ""}${program}\nreturn runtime.bind(globalThis._afyComponent,globalThis._afyPreact);})(runtime.environment);}`;
  const archive: JavascriptArchive = {
    schema: heightAnimations ? 2 : 1,
    kind: "astro-fyne-javascript",
    code,
    codeHash: hash(code),
    sources: [...sources]
      .map(([path, hash]) => ({ path, hash }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    ...(cssSources.size
      ? {
          stylesheets: [...cssSources.values()].sort((a, b) =>
            a.path.localeCompare(b.path),
          ),
        }
      : {}),
    props,
    actions,
    events: [],
    journal: [],
    ...(heightAnimations
      ? {
          animation: {
            schema: 1 as const,
            timeMs: 0,
            playState: "running" as const,
          },
        }
      : {}),
  };
  await validateJavascriptArchive(archive);
  return { archive, inputPaths: [...inputPaths].sort() };
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
    ["frame", "stylesheets", "animation"],
  );
  if (
    ![1, 2].includes(value.schema) ||
    value.kind !== "astro-fyne-javascript" ||
    typeof value.code !== "string" ||
    Buffer.byteLength(value.code) > 64 * 1024 * 1024 ||
    value.codeHash !== hash(value.code)
  )
    throw new Error("Invalid JavaScript archive or digest");
  if (value.schema === 2) validateJavascriptAnimationState(value.animation);
  else if (Object.hasOwn(value, "animation"))
    throw new Error("Schema 1 forbids animation state");
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
  if (value.stylesheets !== undefined) {
    if (!Array.isArray(value.stylesheets) || value.stylesheets.length > 10000)
      throw new Error("Invalid JavaScript stylesheet sources");
    const sourcePaths = new Map<string, { count: number; hash: string }>();
    for (const source of value.sources)
      sourcePaths.set(source.path, {
        count: (sourcePaths.get(source.path)?.count ?? 0) + 1,
        hash: source.hash,
      });
    const seen = new Set<string>();
    for (const sheet of value.stylesheets) {
      if (!record(sheet))
        throw new Error("Invalid JavaScript stylesheet source");
      fields(sheet, ["path", "hash", "text"]);
      if (
        typeof sheet.path !== "string" ||
        !sheet.path ||
        seen.has(sheet.path) ||
        typeof sheet.text !== "string" ||
        Buffer.byteLength(sheet.text) > 16 * 1024 * 1024 ||
        sheet.hash !== hash(validJavascriptText(sheet.text)) ||
        sourcePaths.get(sheet.path)?.count !== 1 ||
        sourcePaths.get(sheet.path)?.hash !== sheet.hash
      )
        throw new Error(
          "JavaScript stylesheet source digest mismatch or duplicate path",
        );
      validJavascriptText(sheet.path);
      seen.add(sheet.path);
    }
  }
  if (
    !Array.isArray(value.events) ||
    value.events.length > 10000 ||
    !Array.isArray(value.journal) ||
    value.journal.length > 100000
  )
    throw new Error("JavaScript history exceeds its limits");
  let eventTime = 0;
  for (const event of value.events) {
    if (!record(event)) throw new Error("Invalid JavaScript event");
    fields(
      event,
      ["node", "type", ...(value.schema === 2 ? ["timeMs"] : [])],
      ["value"],
    );
    if (
      typeof event.node !== "string" ||
      !event.node ||
      !["click", "input", "change"].includes(event.type) ||
      (event.value !== undefined && typeof event.value !== "string")
    )
      throw new Error("Invalid JavaScript event");
    if (value.schema === 2) {
      if (
        typeof event.timeMs !== "number" ||
        !Number.isFinite(event.timeMs) ||
        event.timeMs < eventTime ||
        event.timeMs > value.animation.timeMs
      )
        throw new Error(
          "JavaScript animation event time must be monotonic and within the final clock",
        );
      eventTime = event.timeMs;
    }
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
