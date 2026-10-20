// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  collectBrowserProvenance,
  verifyBrowserProvenance,
} from "../capture/browser-provenance.ts";
import { parseCatalogue } from "../src/catalogue.ts";
import type {
  JavascriptArchive,
  JavascriptFrame,
} from "../src/javascript-types.ts";
import {
  assertReverseBehaviorTrace,
  compareReverseBehaviorTraces,
  reverseControlScenario,
} from "../src/reverse-behavior-contract.ts";

const root = resolve(import.meta.dir, ".."),
  out = join(root, "artifacts/cli-page-roundtrip"),
  site = join(out, "site"),
  pages = join(site, "src/pages"),
  foreign = join(out, "foreign"),
  hash = (bytes: Uint8Array | string) =>
    createHash("sha256").update(bytes).digest("hex");
const phases: unknown[] = [],
  observations: Record<string, unknown> = {},
  errors: string[] = [];
async function save(path: string, value: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}
async function json(path: string, value: unknown) {
  await save(path, JSON.stringify(value, null, 2) + "\n");
}
async function readJSON(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function files(path: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of (await readdir(path, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) result.push(...(await files(full)));
    else {
      assert.ok(entry.isFile(), "Unexpected non-file input: " + full);
      result.push(full);
    }
  }
  return result;
}
async function records(paths: string[], retain = false) {
  const rows = [];
  for (const [index, path] of [...new Set(paths)].sort().entries()) {
    const bytes = await readFile(path),
      file = "inputs/" + String(index).padStart(4, "0") + ".source";
    if (retain) await save(join(out, file), bytes);
    rows.push({
      path: relative(root, path),
      ...(retain ? { file } : {}),
      bytes: bytes.length,
      sha256: hash(bytes),
    });
  }
  return rows;
}
function signalGroup(pid: number, value: NodeJS.Signals) {
  try {
    process.kill(-pid, value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
async function command(name: string, argv: string[], cwd = root) {
  const started = Date.now(),
    child = Bun.spawn(argv, {
      cwd,
      env: { ...Bun.env, NO_COLOR: "1" },
      detached: true,
      stdout: "pipe",
      stderr: "pipe",
    });
  let timedOut = false,
    force: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    signalGroup(child.pid, "SIGTERM");
    force = setTimeout(() => signalGroup(child.pid, "SIGKILL"), 5000);
  }, 300_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    await save(join(out, name + ".stdout.log"), stdout);
    await save(join(out, name + ".stderr.log"), stderr);
    phases.push({
      name,
      argv,
      cwd: relative(root, cwd),
      elapsedMs: Date.now() - started,
      exitCode,
      signal: child.signalCode,
      timedOut,
      stdoutHash: hash(stdout),
      stderrHash: hash(stderr),
    });
    await json(join(out, "commands.json"), phases);
    assert.equal(timedOut, false, name + " timed out; see retained logs");
    assert.equal(
      exitCode,
      0,
      name +
        " failed; see retained logs\n" +
        stderr.slice(-12000) +
        "\n" +
        stdout.slice(-4000),
    );
    return stdout + "\n" + stderr;
  } finally {
    clearTimeout(timeout);
    if (force) clearTimeout(force);
    if (timedOut) signalGroup(child.pid, "SIGKILL");
  }
}
function frameText(nodes: JavascriptFrame[], id: string): string {
  const found: JavascriptFrame[] = [];
  function visit(nodes: JavascriptFrame[]) {
    for (const node of nodes) {
      if (node.attrs?.id === id) found.push(node);
      visit(node.children ?? []);
    }
  }
  function text(node: JavascriptFrame): string {
    return (node.text ?? "") + (node.children ?? []).map(text).join("");
  }
  visit(nodes);
  assert.equal(found.length, 1, "Missing or duplicate native frame ID " + id);
  return text(found[0]!);
}
async function nextFrame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
}
async function calls(page: Page): Promise<unknown[][]> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          afyPageCalls: unknown[][];
        }
      ).afyPageCalls,
  );
}
async function unusedPort() {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return port;
}
function noRouteWarnings(value: string) {
  assert.doesNotMatch(
    value,
    /Unsupported file type|No API Route handler exists for the method\s+["']GET["']/i,
    "The sterile site produced a helper route or unsupported page warning",
  );
}

let browser: Browser | undefined,
  preview: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined,
  previewOutput: Promise<string> | undefined,
  previewErrors: Promise<string> | undefined;
async function stopPreview() {
  if (!preview) return;
  const owned = preview;
  preview = undefined;
  signalGroup(owned.pid, "SIGTERM");
  const force = setTimeout(() => signalGroup(owned.pid, "SIGKILL"), 5000);
  try {
    await owned.exited;
    const stdout = await previewOutput!,
      stderr = await previewErrors!;
    await save(join(out, "astro-preview.stdout.log"), stdout);
    await save(join(out, "astro-preview.stderr.log"), stderr);
    observations.previewCleanup = {
      pid: owned.pid,
      exitCode: owned.exitCode,
      signal: owned.signalCode,
      ownedProcessGroup: true,
    };
    noRouteWarnings(stdout + "\n" + stderr);
  } finally {
    clearTimeout(force);
  }
}
try {
  await mkdir(foreign, { recursive: true });
  const paths = {
      catalogue: join(
        root,
        "artifacts/source-fonts-roundtrip/native-prepare.catalogue.json",
      ),
      fontsNative: join(
        root,
        "artifacts/source-fonts-roundtrip/native-prepare.json",
      ),
      javascript: join(
        root,
        "artifacts/javascript-roundtrip/native-program.json",
      ),
      program: join(
        root,
        "artifacts/program-roundtrip/Counter.native-program.json",
      ),
      portableNative: join(
        root,
        "artifacts/program-roundtrip/native-export.json",
      ),
      scene: join(root, "artifacts/reverse-controls/scene.json"),
      sceneNative: join(
        root,
        "artifacts/reverse-controls/native-behavior.json",
      ),
    },
    catalogue = await parseCatalogue(await readFile(paths.catalogue, "utf8")),
    fontsNative = await readJSON(paths.fontsNative),
    javascript = (await readJSON(paths.javascript)) as JavascriptArchive,
    portableNative = await readJSON(paths.portableNative),
    scene = await readJSON(paths.scene),
    sceneNative = await readJSON(paths.sceneNative),
    initialJavascript = frameText(javascript.frame!, "js-count"),
    initialCounter: string = portableNative.Counter.frames[0].nodes.count,
    { initialValue } = reverseControlScenario(scene);
  const packageManifest = await readJSON(join(root, "package.json")),
    installedPackages = [],
    installedCLI = Bun.which("astro-fyne");
  assert.ok(installedCLI, "The linked CLI is missing from PATH");
  assert.equal(
    await realpath(installedCLI),
    await realpath(join(root, "bin/astro-fyne.ts")),
  );
  for (const name of ["astro", "@astrojs/preact", "preact", "playwright"]) {
    const file = join(root, "node_modules", name, "package.json"),
      installed = await readJSON(file);
    assert.equal(installed.version, packageManifest.devDependencies[name]);
    installedPackages.push({ name, version: installed.version, file });
  }
  observations.runtime = {
    bun: Bun.version,
    installedCLI,
    installedPackages: installedPackages.map(({ name, version }) => ({
      name,
      version,
    })),
    sourceCommit: (
      await command("source-commit", ["git", "rev-parse", "HEAD"])
    ).trim(),
    sourceTree: (
      await command("source-tree", ["git", "rev-parse", "HEAD^{tree}"])
    ).trim(),
  };
  assert.equal(fontsNative.after.count, "Native override:1");
  assert.deepEqual(fontsNative.calls, [[1]]);
  assert.equal(fontsNative.replayCalls, 0);
  assert.deepEqual(
    JSON.parse(catalogue.islands[0]!.statePayload!),
    fontsNative.afterArchive,
  );
  assert.match(initialJavascript, /^\d+$/);
  assert.match(initialCounter, /^Count: \d+$/);
  const counterAfter = "Count: " + (Number(initialCounter.slice(7)) + 1),
    javascriptAfter = String(Number(initialJavascript) + 2),
    fonts = catalogue.resources.filter(
      (resource) => resource.mediaType === "font/ttf",
    );
  assert.equal(fonts.length, 2);
  assert.equal(catalogue.fontFaces.length, 2);
  assert.deepEqual(
    catalogue.fontFaces
      .map((face) => [face.family, face.weight, face.style])
      .sort(),
    [
      ["SourceNoto", 400, "normal"],
      ["SourceNoto", 700, "normal"],
    ],
  );
  for (const font of fonts)
    assert.equal(hash(Buffer.from(font.content, "base64")), font.hash);
  assert.equal(fontsNative.fonts.length, 3);
  assert.deepEqual(
    fontsNative.fonts.map((row: { id: string }) => row.id).sort(),
    ["font-count", "font-increment", "font-seed"],
  );
  for (const row of fontsNative.fonts) {
    const face = catalogue.fontFaces.find((face) => face.weight === row.weight);
    assert.ok(face);
    assert.equal(
      row.hash,
      face.hash,
      "Native painter bytes differ from the catalogue",
    );
  }
  observations.nativeInputs = {
    initialJavascript,
    initialCounter,
    fonts: fontsNative.after,
    sourceFontNativeCalls: fontsNative.calls,
    sceneInitialValue: initialValue,
  };
  await json(
    join(out, "inputs.json"),
    await records(
      [
        ...Object.values(paths),
        ...installedPackages.map(({ file }) => file),
        ...(await files(join(root, "src"))).filter((path) =>
          /\.(?:ts|js)$/.test(path),
        ),
        ...[
          "bin/astro-fyne.ts",
          "package.json",
          "bun.lock",
          "tsconfig.json",
          "ci/run.sh",
          "ci/cli-page-roundtrip.ts",
          "ci/source-fonts-roundtrip.ts",
          "ci/source-fonts-probe.go.txt",
          "ci/javascript-roundtrip.ts",
          "ci/program-roundtrip.ts",
          "ci/program-roundtrip.go",
          "capture/browser-provenance.ts",
          "capture/browser-provenance-validation.ts",
          "native/reverse/cmd/scene-fixture/main.go",
        ].map((path) => join(root, path)),
      ],
      true,
    ),
  );
  await save(join(site, "package.json"), '{"private":true,"type":"module"}\n');
  const routeFile = join(out, "routes.json");
  await save(
    join(site, "astro.config.mjs"),
    `// SPDX-License-Identifier: Apache-2.0
import {defineConfig} from "astro/config";
import preact from "@astrojs/preact";
import {writeFileSync} from "node:fs";
export default defineConfig({integrations:[preact(),{name:"cli-page-route-oracle",hooks:{"astro:routes:resolved"({routes}){writeFileSync(${JSON.stringify(routeFile)},JSON.stringify(routes.map(route=>({component:route.entrypoint,pathname:route.pathname,route:route.pattern,type:route.type,origin:route.origin})),null,2)+"\\n")}}}],outDir:"./dist",vite:{preview:{strictPort:true}}});
`,
  );
  const actionSources = {
    catalogue:
      "const calls:unknown[][]=[];(window as any).afyPageCalls=calls;export const actions={observe:(...args:unknown[])=>{calls.push(args);return null}};\n",
    javascript:
      "const calls:unknown[][]=[];(window as any).afyPageCalls=calls;export const actions={observe:(...args:unknown[])=>{calls.push(args);return null}};\n",
    program: "export const actions={};\n",
    scene:
      'const events:{action:string;value?:string}[]=[];(window as any).afyPageSceneEvents=events;document.documentElement.dataset.cliPageSceneReady="true";export const actions={input:(value:string)=>events.push({action:"input",value}),commit:(value:string)=>events.push({action:"commit",value}),tap:()=>events.push({action:"tap"})};\n',
  };
  for (const [name, source] of Object.entries(actionSources))
    await save(
      join(pages, "_actions", name + ".ts"),
      "// SPDX-License-Identifier: Apache-2.0\n" + source,
    );
  const cases = [
    {
      slug: "catalogue",
      name: "PageFonts",
      input: paths.catalogue,
      actions: "catalogue",
    },
    {
      slug: "javascript",
      name: "PageJavascript",
      input: paths.javascript,
      actions: "javascript",
    },
    {
      slug: "program",
      name: "PageProgram",
      input: paths.program,
      actions: "program",
    },
    { slug: "scene", name: "PageScene", input: paths.scene, actions: "scene" },
    {
      slug: "legacy",
      name: "Legacy",
      input: paths.javascript,
      actions: "javascript",
    },
  ];
  for (const item of cases) {
    const args = [
      "to-web",
      relative(foreign, item.input),
      "--out",
      relative(foreign, join(pages, item.slug)),
      "--name",
      item.name,
      ...(["javascript", "legacy"].includes(item.slug)
        ? []
        : ["--public-dir", relative(foreign, join(site, "public"))]),
      "--actions-module",
      (item.slug === "legacy" ? "../../_actions/" : "../_actions/") +
        item.actions +
        ".ts",
      ...(item.slug === "legacy" ? [] : ["--page"]),
    ];
    await command("generate-" + item.slug, ["astro-fyne", ...args], foreign);
    const before = await records(await files(site));
    await command(
      "check-" + item.slug,
      ["astro-fyne", ...args, "--check"],
      foreign,
    );
    assert.deepEqual(
      await records(await files(site)),
      before,
      "--check changed generated output",
    );
  }
  await json(join(out, "site-inputs.json"), await records(await files(site)));
  const build = await command("astro-build", [
    "bunx",
    "--no-install",
    "astro",
    "build",
    "--root",
    site,
  ]);
  noRouteWarnings(build);
  await json(
    join(out, "built-files.json"),
    await records(await files(join(site, "dist"))),
  );
  const routes: {
      component: string;
      pathname?: string;
      route: string;
      type: string;
      origin: string;
    }[] = await readJSON(routeFile),
    projectRoutes = routes.filter((route) => route.origin === "project"),
    internalRoutes = routes.filter((route) => route.origin === "internal");
  assert.equal(
    projectRoutes.length + internalRoutes.length,
    routes.length,
    "Unexpected external injected route",
  );
  const expectedRoutes = [
    "catalogue/index.astro",
    "javascript/index.astro",
    "program/index.astro",
    "scene/index.astro",
    "legacy/Legacy.astro",
  ].sort();
  assert.deepEqual(
    projectRoutes
      .map((route) =>
        route.component.replaceAll("\\", "/").split("src/pages/").at(-1),
      )
      .sort(),
    expectedRoutes,
  );
  assert.ok(projectRoutes.every((route) => route.type === "page"));
  observations.routeInventory = {
    projectRoutes,
    internalRoutes,
    expectedRoutes,
  };
  const port = await unusedPort(),
    base = "http://127.0.0.1:" + port,
    previewArgs = [
      "bunx",
      "--no-install",
      "astro",
      "preview",
      "--ignore-lock",
      "--root",
      site,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ];
  preview = Bun.spawn(previewArgs, {
    cwd: root,
    env: { ...Bun.env, NO_COLOR: "1" },
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  previewOutput = new Response(preview.stdout).text();
  previewErrors = new Response(preview.stderr).text();
  observations.preview = {
    argv: previewArgs,
    cwd: relative(root, root),
    pid: preview.pid,
  };
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(
      preview.exitCode,
      null,
      "Owned preview process exited before readiness",
    );
    try {
      ready = (await fetch(base + "/catalogue/")).status === 200;
    } catch {}
    if (ready) break;
    await Bun.sleep(250);
  }
  assert.ok(ready, "Owned preview did not become ready");
  const http: {
    path: string;
    status: number;
    contentType: string | null;
    bytes: number;
    sha256: string;
  }[] = [];
  observations.http = http;
  for (const path of [
    "/catalogue/",
    "/javascript/",
    "/program/",
    "/scene/",
    "/legacy/Legacy",
  ]) {
    const response = await fetch(base + path),
      bytes = new Uint8Array(await response.arrayBuffer()),
      html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    await save(
      join(out, "http", path.split("/").filter(Boolean).join("-") + ".html"),
      bytes,
    );
    http.push({
      path,
      status: response.status,
      contentType: response.headers.get("content-type"),
      bytes: bytes.length,
      sha256: hash(bytes),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/i);
    if (path !== "/legacy/Legacy") {
      assert.match(html, /<meta\s+charset=["']?utf-8/i);
      for (const tag of ["html", "head", "body"])
        for (const prefix of ["<", "</"])
          assert.equal(
            (html.match(new RegExp(prefix + tag + "(?:\\s|>)", "gi")) ?? [])
              .length,
            1,
            path + " must contain one " + prefix + tag + ">",
          );
    }
  }
  const helperPaths = new Set<string>();
  for (const path of await files(pages)) {
    const rel = relative(pages, path).replaceAll("\\", "/");
    if (!rel.split("/").some((part) => part.startsWith("_"))) continue;
    helperPaths.add("/" + rel);
    if (/\.(?:astro|[cm]?[jt]sx?)$/.test(rel))
      helperPaths.add("/" + rel.replace(/\.[^.]+$/, ""));
  }
  const hidden: { path: string; status: number; sha256: string }[] = [];
  observations.helperHTTP = hidden;
  for (const path of [...helperPaths].sort()) {
    const response = await fetch(base + path),
      bytes = new Uint8Array(await response.arrayBuffer());
    hidden.push({ path, status: response.status, sha256: hash(bytes) });
    assert.equal(response.status, 404, "Helper became an HTTP route: " + path);
  }
  assert.ok(hidden.length > 30);
  browser = await chromium.launch({ headless: true });
  const provenance = await collectBrowserProvenance(browser);
  await json(join(out, "browser-before.json"), provenance);
  const responses: Promise<unknown>[] = [];
  async function pageAt(path: string, observe?: (page: Page) => void) {
    const page = await browser!.newPage({
      viewport: { width: 1100, height: 900 },
    });
    page.on("pageerror", (error) => errors.push(path + ": " + error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(path + ": " + message.text());
    });
    page.on("response", (response) => {
      const type = response.request().resourceType();
      if (!["document", "script", "stylesheet", "font"].includes(type)) return;
      responses.push(
        (async () => {
          const bytes = await response.body(),
            sha256 = hash(bytes);
          await save(join(out, "responses", sha256 + ".body"), bytes);
          return {
            page: path,
            url: response.url(),
            type,
            status: response.status(),
            bytes: bytes.length,
            sha256,
          };
        })().catch((error) => {
          const message =
            "Response body failed: " + response.url() + ": " + String(error);
          errors.push(message);
          return { page: path, url: response.url(), type, error: message };
        }),
      );
    });
    observe?.(page);
    const response = await page.goto(base + path);
    assert.equal(response?.status(), 200);
    assert.equal(
      (await page.evaluate(() => document.characterSet)).toLowerCase(),
      "utf-8",
    );
    return page;
  }
  const fontResponses: Promise<unknown>[] = [],
    cataloguePage = await pageAt("/catalogue/", (page) => {
      page.on("response", (response) => {
        if (!new URL(response.url()).pathname.endsWith(".ttf")) return;
        fontResponses.push(
          (async () => {
            const bytes = await response.body(),
              sha256 = hash(bytes);
            await save(join(out, "assets", sha256 + ".ttf"), bytes);
            return {
              url: response.url(),
              status: response.status(),
              bytes: bytes.length,
              sha256,
            };
          })().catch((error) => {
            const message =
              "Font response body failed: " +
              response.url() +
              ": " +
              String(error);
            errors.push(message);
            return {
              url: response.url(),
              status: response.status(),
              bytes: 0,
              sha256: "",
              error: message,
            };
          }),
        );
      });
    });
  await cataloguePage.locator("#font-count").waitFor();
  await nextFrame(cataloguePage);
  assert.equal(
    await cataloguePage.locator("#font-count").textContent(),
    fontsNative.after.count,
  );
  assert.deepEqual(await calls(cataloguePage), []);
  const seed = await cataloguePage.locator("#font-seed").textContent();
  assert.equal(seed, fontsNative.after.seed);
  const fontLoads = await cataloguePage.evaluate(async () => {
    const rows = [];
    for (const weight of [400, 700]) {
      const query = `${weight} 16px "SourceNoto"`,
        loaded = await document.fonts.load(query, "Native override Increment");
      rows.push({
        query,
        loaded: loaded.length,
        faces: loaded.map((face) => ({
          family: face.family,
          weight: face.weight,
          style: face.style,
          status: face.status,
        })),
      });
    }
    return rows;
  });
  observations.catalogueFontLoads = fontLoads;
  for (const [index, row] of fontLoads.entries()) {
    assert.equal(row.loaded, 1);
    assert.equal(row.faces[0]!.weight, String([400, 700][index]));
    assert.equal(
      row.faces[0]!.family.replace(/^["']|["']$/g, ""),
      "SourceNoto",
    );
    assert.equal(row.faces[0]!.style, "normal");
    assert.equal(row.faces[0]!.status, "loaded");
  }
  await cataloguePage.locator("#font-increment").click();
  await cataloguePage.waitForFunction(
    () =>
      document.getElementById("font-count")?.textContent ===
      "Native override:2",
  );
  await nextFrame(cataloguePage);
  assert.deepEqual(await calls(cataloguePage), [[2]]);
  assert.equal(await cataloguePage.locator("#font-seed").textContent(), seed);
  const fontHTTP = (await Promise.all(fontResponses)) as {
    url: string;
    status: number;
    bytes: number;
    sha256: string;
  }[];
  observations.catalogueFontHTTP = fontHTTP;
  assert.equal(fontHTTP.length, 2);
  assert.ok(fontHTTP.every((row) => row.status === 200));
  assert.deepEqual(
    fontHTTP.map((row) => row.sha256).sort(),
    fonts.map((font) => font.hash).sort(),
  );
  observations.catalogue = {
    initial: fontsNative.after.count,
    after: await cataloguePage.locator("#font-count").textContent(),
    seed,
    effects: await calls(cataloguePage),
    fontLoads,
    fontHTTP,
  };
  await cataloguePage.close();
  for (const path of ["/javascript/", "/legacy/Legacy"]) {
    const page = await pageAt(path);
    await page.locator("#js-count").waitFor();
    await nextFrame(page);
    assert.equal(
      await page.locator("#js-count").textContent(),
      initialJavascript,
    );
    assert.deepEqual(
      await calls(page),
      [],
      "Restored JavaScript replayed external actions",
    );
    await page.locator("#js-increment").click();
    await page.waitForFunction(
      (wanted) => document.getElementById("js-count")?.textContent === wanted,
      javascriptAfter,
    );
    await nextFrame(page);
    const effects = await calls(page),
      closure = effects.filter((row) => row[0] === "closure");
    assert.equal(closure.length, 1);
    assert.equal(closure[0]![1], Number(initialJavascript));
    for (const action of ["capture", "bubble"])
      assert.equal(effects.filter((row) => row[0] === action).length, 1);
    observations[path] = {
      initial: initialJavascript,
      after: await page.locator("#js-count").textContent(),
      effects,
    };
    await page.close();
  }
  const programPage = await pageAt("/program/");
  await programPage.locator("#count").waitFor();
  assert.equal(
    await programPage.locator("#count").textContent(),
    initialCounter,
  );
  assert.equal(
    await programPage.locator("#name").inputValue(),
    portableNative.Counter.frames[0].nodes.name,
  );
  await programPage.locator("#increment").click();
  await programPage.waitForFunction(
    (wanted) => document.getElementById("count")?.textContent === wanted,
    counterAfter,
  );
  observations.program = {
    initial: initialCounter,
    after: await programPage.locator("#count").textContent(),
    name: await programPage.locator("#name").inputValue(),
  };
  await programPage.close();
  const scenePage = await pageAt("/scene/");
  await scenePage.locator('html[data-cli-page-scene-ready="true"]').waitFor();
  const edit = scenePage.locator("#edit"),
    button = scenePage.locator("#save");
  assert.equal(await edit.inputValue(), initialValue);
  assert.equal(await edit.isDisabled(), false);
  assert.equal(await button.isDisabled(), false);
  await edit.focus();
  await edit.press("End");
  await edit.pressSequentially("x");
  await edit.press("Enter");
  await edit.press("Enter");
  await button.click();
  await edit.focus();
  await edit.press("End");
  await edit.pressSequentially("y");
  await edit.press("Tab");
  assert.equal(
    await button.evaluate((element) => document.activeElement === element),
    true,
  );
  await nextFrame(scenePage);
  const sceneTrace = assertReverseBehaviorTrace(
    {
      schema: 1,
      events: await scenePage.evaluate(
        () =>
          (window as unknown as { afyPageSceneEvents: unknown[] })
            .afyPageSceneEvents,
      ),
      finalValue: await edit.inputValue(),
      disabled: {
        edit: await edit.isDisabled(),
        save: await button.isDisabled(),
      },
    },
    scene,
  );
  observations.scene = {
    trace: sceneTrace,
    nativeComparison: compareReverseBehaviorTraces(
      sceneTrace,
      sceneNative,
      scene,
    ),
  };
  await scenePage.close();
  observations.browserResponses = await Promise.all(responses);
  assert.deepEqual(errors, []);
  const after = await verifyBrowserProvenance(browser, provenance);
  await json(join(out, "browser-after.json"), after);
  await browser.close();
  browser = undefined;
  await stopPreview();
  await json(join(out, "result.json"), {
    schema: 1,
    accepted: true,
    ...observations,
    errors,
    generatedPageBehaviorVerified: true,
    sourceAuthoredPreviewVerified: false,
    pageCheckpointExportVerified: false,
    returningNativeCheckpointVerifiedHere: false,
    fallbackFreeRenderingVerified: false,
    pixelPerfectVerified: false,
  });
} catch (error) {
  await json(join(out, "failure.json"), {
    schema: 1,
    accepted: false,
    error: String(error),
    observations,
    errors,
    phases,
  });
  throw error;
} finally {
  await browser?.close();
  await stopPreview();
}
