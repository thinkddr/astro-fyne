// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleJavascript } from "./javascript.ts";
import { compile } from "./parser.ts";
import type {
  JavascriptArchive,
  JavascriptFrame,
  JavascriptAPI,
} from "./javascript-types.ts";

const mount = (archive: JavascriptArchive): JavascriptAPI => {
  const factory = eval("(" + archive.code + ")");
  const api = factory((kind: string) => {
    if (kind === "random") return 0.25;
    if (kind === "now") return 1000;
    throw new Error("Unexpected host effect");
  }, archive);
  api.flush();
  api.finishReplay();
  return api;
};
const values = (frames: JavascriptFrame[]) => {
  const result: Record<string, string> = {};
  const text = (frame: JavascriptFrame): string =>
    frame.tag === "#text"
      ? (frame.text ?? "")
      : (frame.children ?? []).map(text).join("");
  const walk = (frames: JavascriptFrame[]) => {
    for (const frame of frames) {
      if (frame.attrs?.id) result[frame.attrs.id] = text(frame);
      walk(frame.children ?? []);
    }
  };
  walk(frames);
  return result;
};
test("Astro JavaScript source accepts arbitrary frontmatter and retains imported script sources", async () => {
  const path = join(
    import.meta.dir,
    "../example/src/pages/astro-javascript-original.astro",
  );
  await expect(compile(path)).rejects.toThrow();
  const archive = await bundleJavascript(path);
  expect(
    archive.sources.some((source) => source.path.endsWith("script-helper.ts")),
  ).toBe(true);
  const api = mount(archive),
    initial = values(api.snapshot());
  expect(initial["astro-js-frontmatter"]).toBe("12|true|7|kept");
  expect(initial["astro-js-alias"]).toBe("false");
  expect(initial["astro-js-values"]).toBe("true||NaN|lambda|12|record");
  const find = (frames: JavascriptFrame[]): JavascriptFrame | undefined => {
    for (const frame of frames) {
      if (frame.attrs?.id === "astro-js-script-increment") return frame;
      const child = find(frame.children ?? []);
      if (child) return child;
    }
    return undefined;
  };
  api.dispatch({ node: find(api.snapshot())!.uid, type: "click" });
  api.flush();
  expect(values(api.snapshot())["astro-js-script-count"]).toBe("2");
}, 60_000);
test("Astro props retain key/ref/children data and default slots remain lazy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-astro-props-"));
  try {
    const path = join(directory, "Page.astro");
    await writeFile(
      path,
      `---\nconst {key,ref,children,constructor,data}=Astro.props;\n---\n<p id="value">{key}|{ref}|{children}|{constructor}|{Object.hasOwn(data,"__proto__")}|{data.__proto__.value}</p><slot><p id="fallback">Fallback</p></slot>`,
    );
    const props = JSON.parse(
      '{"key":"K","ref":"R","children":"C","constructor":"ctor","data":{"__proto__":{"value":7}}}',
    );
    expect(
      values(mount(await bundleJavascript(path, "default", props)).snapshot()),
    ).toEqual({ value: "K|R|C|ctor|true|7", fallback: "Fallback" });
    await writeFile(
      join(directory, "Frame.astro"),
      `<slot>Fallback</slot><slot/>`,
    );
    await writeFile(
      path,
      `---\nimport Frame from "./Frame.astro";\nlet count=0;\n---\n<Frame><p id="value">{++count}</p></Frame>`,
    );
    const frame = mount(await bundleJavascript(path)).snapshot();
    const texts: string[] = [];
    const walk = (frames: JavascriptFrame[]) => {
      for (const frame of frames) {
        if (frame.tag === "#text") texts.push(frame.text ?? "");
        walk(frame.children ?? []);
      }
    };
    walk(frame);
    expect(texts.filter((text) => text === "1")).toHaveLength(1);
    expect(texts.filter((text) => text === "2")).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
test("Astro script dependencies execute after DOM creation and invalidate program hashes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-astro-script-"));
  try {
    const path = join(directory, "Page.astro"),
      helper = join(directory, "helper.ts");
    await writeFile(
      path,
      `<p id="value">initial</p><script>import {next} from "./helper.ts";document.getElementById("value")!.textContent=String(next(1));</script>`,
    );
    await writeFile(
      helper,
      `document.getElementById("value")!.textContent="dependency";export const next=(value:number)=>value+2;`,
    );
    const before = await bundleJavascript(path);
    expect(values(mount(before).snapshot())["value"]).toBe("3");
    await writeFile(
      helper,
      `document.getElementById("value")!.textContent="dependency";export const next=(value:number)=>value+3;`,
    );
    const after = await bundleJavascript(path);
    expect(values(mount(after).snapshot())["value"]).toBe("4");
    expect(after.codeHash).not.toBe(before.codeHash);
    expect(
      after.sources.find((source) => source.path === "helper.ts")!.hash,
    ).not.toBe(
      before.sources.find((source) => source.path === "helper.ts")!.hash,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
test("Astro unsupported server/browser contracts produce source diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-astro-errors-"));
  try {
    const path = join(directory, "Page.astro");
    for (const [source, diagnostic] of [
      [
        `---\nconst value=await Promise.resolve(1);\n---\n<p>{value}</p>`,
        "frontmatter",
      ],
      [
        `---\nexport const getStaticPaths=()=>[];\n---\n<p>Route</p>`,
        "routing",
      ],
      [`<style>p{color:red}</style><p>Style</p>`, "CSS/window"],
      [`<html><head/><body>Document</body></html>`, "CSS/window"],
      [`<button onclick="void 0">Click</button>`, "event"],
      [`<p set:html="<b>Raw</b>"/>`, "directive"],
      [`<slot name="header"/>`, "slot"],
      [`<script is:inline>void 0;</script>`, "script attributes"],
      [`<Counter/>`, "Non-hydrated"],
      [`<Counter client:visible/>`, "deferred"],
      [
        `<script>import {h} from "preact";h("div",{});</script>`,
        "shared renderer",
      ],
    ]) {
      await writeFile(path, source!);
      await expect(bundleJavascript(path)).rejects.toThrow(diagnostic!);
    }
    await expect(bundleJavascript(path, "Named")).rejects.toThrow("default");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
test("Astro dynamic props and SSR APIs cannot silently become native events or client data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-astro-dynamic-"));
  try {
    const path = join(directory, "Page.astro");
    await writeFile(
      join(directory, "Child.tsx"),
      `export default function Child(){return <p>Child</p>}`,
    );
    for (const [source, diagnostic] of [
      [
        `---\nconst props={onclick:()=>{}};\n---\n<button {...props}>Click</button>`,
        "event",
      ],
      [
        `---\nconst props={ref:"discarded"};\n---\n<p {...props}>Ref</p>`,
        "attribute ref",
      ],
      [
        `---\nimport Child from "./Child.tsx";\n---\n<Child client:load callback={()=>{}}/>`,
        "JSON",
      ],
      [`<p>{Astro.url}</p>`, "SSR/platform"],
      [`<p>{Promise.resolve("later")}</p>`, "SSR/event-loop"],
    ]) {
      await writeFile(path, source!);
      const archive = await bundleJavascript(path);
      expect(() => mount(archive)).toThrow(diagnostic!);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
