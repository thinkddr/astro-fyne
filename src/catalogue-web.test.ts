// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCatalogueExporter,
  type CatalogueJavascriptHandle,
} from "./catalogue-web.ts";
import { validateCatalogue } from "./catalogue.ts";
import type { CatalogueSpec } from "./catalogue-types.ts";
import { bundleJavascript } from "./javascript.ts";
import { createProgramArchive } from "./program.ts";
import type {
  JavascriptAPI,
  JavascriptArchive,
  JavascriptFactory,
  JavascriptFrame,
} from "./javascript-types.ts";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "astro-fyne-catalogue-web-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function archiveFixture(): JavascriptArchive {
  const code =
      "function(host,archive){return {flush:function(){},finishReplay:function(){},dispose:function(){},snapshot:function(){return []},dispatch:function(){return true},replay:function(){},export:function(){return archive}}}",
    css = "\ufeff/* exact bytes */\r\n.card{color:#123456}\r\n";
  return {
    schema: 1,
    kind: "astro-fyne-javascript",
    code,
    codeHash: hash(code),
    sources: [
      { path: "Counter.tsx", hash: hash(code) },
      { path: "../styles/card.css", hash: hash(css) },
    ],
    stylesheets: [{ path: "../styles/card.css", hash: hash(css), text: css }],
    props: { label: "Count" },
    actions: [],
    events: [],
    journal: [],
  };
}
function fixture(archive = archiveFixture()): CatalogueSpec {
  const payload = "\n" + JSON.stringify(archive) + "\r\n";
  return {
    schema: 1,
    kind: "astro-fyne-catalogue",
    name: "Counters",
    resources: [],
    stylesheets: (archive.stylesheets ?? []).map((sheet, index) => ({
      id: `sheet${index}`,
      path: sheet.path,
      hash: sheet.hash,
      content: Buffer.from(sheet.text).toString("base64"),
    })),
    fontFaces: [],
    themes: [],
    layouts: [],
    components: [
      {
        id: "counter",
        kind: "javascript",
        payload,
        hash: hash(payload),
        stylesheets: (archive.stylesheets ?? []).map(
          (_, index) => `sheet${index}`,
        ),
        fontFaces: [],
        actions: [...archive.actions],
      },
    ],
    islands: [
      { id: "left", component: "counter", key: "same-key" },
      { id: "right", component: "counter", key: "same-key" },
    ],
  };
}
function mount(archive: JavascriptArchive): JavascriptAPI {
  const factory: JavascriptFactory = eval(`(${archive.code})`),
    api = factory(() => {
      throw new Error("Unexpected host effect");
    }, archive);
  api.flush();
  for (const event of archive.events) {
    api.replay(event);
    api.flush();
  }
  api.finishReplay();
  return api;
}
function node(
  frames: JavascriptFrame[],
  id: string,
): JavascriptFrame | undefined {
  for (const frame of frames) {
    if (frame.attrs?.id === id) return frame;
    const found = node(frame.children ?? [], id);
    if (found) return found;
  }
}
function text(frame: JavascriptFrame): string {
  return frame.tag === "#text"
    ? (frame.text ?? "")
    : (frame.children ?? []).map(text).join("");
}

test("real counter handles export one checkpoint without changing other islands, CSS or original payloads", async () => {
  const source = join(directory, "Counter.tsx"),
    css = "\ufeff/* keep */\r\n.counter{color:#123456}\r\n";
  await writeFile(
    source,
    'import {useState} from "preact/hooks";import "./counter.css";export default function Counter(){const [count,setCount]=useState(0);return <section class="counter"><span id="count">{count}</span><button id="increment" onClick={()=>setCount(count+1)}>Increment</button></section>}',
  );
  await writeFile(join(directory, "counter.css"), css);
  const archive = await bundleJavascript(source),
    left = mount(archive),
    right = mount(archive),
    spec = fixture(archive);
  try {
    const rightPayload = "\n " + JSON.stringify(right.export()) + "\r\n";
    spec.islands[1]!.statePayload = rightPayload;
    spec.islands[1]!.stateHash = hash(rightPayload);
    const source = JSON.stringify(await validateCatalogue(spec)),
      capture = createCatalogueExporter(source);
    left.dispatch({
      node: node(left.snapshot(), "increment")!.uid,
      type: "click",
    });
    left.flush();
    expect(text(node(left.snapshot(), "count")!)).toBe("1");
    expect(text(node(right.snapshot(), "count")!)).toBe("0");
    const result = await capture(
      new Map([["left", { exportJavascript: () => left.export() }]]),
    );
    expect(result.components[0]!.payload).toBe(spec.components[0]!.payload);
    expect(result.islands[0]!.stateHash).toBe(
      hash(result.islands[0]!.statePayload!),
    );
    expect(result.islands[1]!.statePayload).toBe(rightPayload);
    expect(
      JSON.parse(result.islands[0]!.statePayload!).stylesheets[0].text,
    ).toBe(css);
    expect(await validateCatalogue(result)).toEqual(result);
    const restoredLeft = mount(JSON.parse(result.islands[0]!.statePayload!)),
      restoredRight = mount(JSON.parse(result.islands[1]!.statePayload!));
    try {
      expect(text(node(restoredLeft.snapshot(), "count")!)).toBe("1");
      expect(text(node(restoredRight.snapshot(), "count")!)).toBe("0");
    } finally {
      restoredLeft.dispose();
      restoredRight.dispose();
    }
    result.components[0]!.payload = "changed";
    result.islands[1]!.statePayload = "changed";
    expect(await capture(new Map())).toEqual(JSON.parse(source));
    expect(await readFile(join(directory, "counter.css"), "utf8")).toBe(css);
  } finally {
    left.dispose();
    right.dispose();
  }
}, 60_000);

test("all selected handles and JSON snapshots are captured before hashing can yield", async () => {
  const left = archiveFixture(),
    right = archiveFixture(),
    source = JSON.stringify(fixture()),
    capture = createCatalogueExporter(source),
    calls: string[] = [];
  const selected = new Map<string, CatalogueJavascriptHandle>([
    [
      "left",
      {
        exportJavascript() {
          calls.push("left");
          selected.delete("right");
          return left;
        },
      },
    ],
    [
      "right",
      {
        exportJavascript() {
          calls.push("right");
          left.props.label = "Changed by sibling";
          return right;
        },
      },
    ],
  ]);
  const pending = capture(selected);
  expect(calls).toEqual(["left", "right"]);
  right.props.label = "Changed after capture";
  const result = await pending;
  expect(JSON.parse(result.islands[0]!.statePayload!).props.label).toBe(
    "Count",
  );
  expect(JSON.parse(result.islands[1]!.statePayload!).props.label).toBe(
    "Count",
  );
  expect(await capture(new Map())).toEqual(JSON.parse(source));
});

test("unknown, non-JavaScript and foreign component handles cannot replace a catalogue checkpoint", async () => {
  const original = archiveFixture(),
    spec = fixture(original);
  const payload = JSON.stringify(
    createProgramArchive({
      entry: "Empty",
      components: [
        {
          name: "Empty",
          props: [],
          states: [],
          constants: [],
          initializers: [],
          body: [],
        },
      ],
      sources: [],
      actions: [],
    }),
  );
  spec.components.push({
    ...spec.components[0]!,
    id: "static",
    kind: "program",
    payload,
    hash: hash(payload),
    stylesheets: [],
  });
  spec.islands.push({
    id: "static-island",
    component: "static",
    key: "static",
  });
  const source = JSON.stringify(spec),
    capture = createCatalogueExporter(source);
  for (const id of ["missing", "constructor", "toString", "static-island"])
    await expect(
      capture(new Map([[id, { exportJavascript: () => original }]])),
    ).rejects.toThrow(/unknown island|requires a JavaScript component/);
  for (const change of [
    (a: any) => (a.schema = 2),
    (a: any) => (a.kind = "astro-fyne-program"),
    (a: any) => (a.code += " "),
    (a: any) => (a.codeHash = "0".repeat(64)),
    (a: any) => (a.sources[0].hash = "0".repeat(64)),
    (a: any) => (a.stylesheets[0].text += " "),
    (a: any) => a.actions.push("foreign"),
    (a: any) => (a.extra = true),
    (a: any) => delete a.events,
    (a: any) => (a.props = null),
  ]) {
    const archive = structuredClone(original);
    change(archive);
    await expect(
      capture(new Map([["left", { exportJavascript: () => archive }]])),
    ).rejects.toThrow("Catalogue export:");
  }
  await expect(capture(new Map([["left", {} as any]]))).rejects.toThrow(
    "mounted export handle",
  );
  expect(await capture(new Map())).toEqual(JSON.parse(source));
});

test("focus guards and unrepresentable snapshot errors propagate without committing partial state", async () => {
  const archive = archiveFixture(),
    source = JSON.stringify(fixture(archive)),
    capture = createCatalogueExporter(source),
    focus = new Error("Focused input has pending native selection");
  let observed: unknown;
  try {
    await capture(
      new Map([
        ["left", { exportJavascript: () => archive }],
        [
          "right",
          {
            exportJavascript() {
              throw focus;
            },
          },
        ],
      ]),
    );
  } catch (error) {
    observed = error;
  }
  expect(observed).toBe(focus);
  let reads = 0;
  const getter = structuredClone(archive);
  Object.defineProperty(getter.props, "label", {
    enumerable: true,
    get() {
      reads++;
      return "unexpected";
    },
  });
  for (const invalid of [
    getter,
    { ...archive, props: { value: NaN } },
    { ...archive, props: { value: -0 } },
    { ...archive, props: { value: undefined } },
    { ...archive, props: { value: "\ud800" } },
  ])
    await expect(
      capture(new Map([["left", { exportJavascript: () => invalid }]])),
    ).rejects.toThrow("Catalogue export:");
  expect(reads).toBe(0);
  expect(await capture(new Map())).toEqual(JSON.parse(source));
});

test("failed Web Crypto leaves the closed baseline unchanged and a later export can succeed", async () => {
  const archive = archiveFixture(),
    source = JSON.stringify(fixture(archive)),
    capture = createCatalogueExporter(source),
    error = new Error("Digest failed"),
    digest = spyOn(globalThis.crypto.subtle, "digest").mockRejectedValueOnce(
      error,
    );
  try {
    await expect(
      capture(new Map([["left", { exportJavascript: () => archive }]])),
    ).rejects.toThrow("Digest failed");
    expect(await capture(new Map())).toEqual(JSON.parse(source));
  } finally {
    digest.mockRestore();
  }
  const result = await capture(
    new Map([["left", { exportJavascript: () => archive }]]),
  );
  expect(result.islands[0]!.stateHash).toBe(
    hash(result.islands[0]!.statePayload!),
  );
});

test("payload and whole-catalogue UTF-8 limits reject oversized snapshots before hashing", async () => {
  const archive = archiveFixture(),
    capture = createCatalogueExporter(JSON.stringify(fixture(archive))),
    oversized = {
      ...archive,
      props: { label: "😀".repeat(16 * 1024 * 1024 + 1) },
    };
  await expect(
    capture(new Map([["left", { exportJavascript: () => oversized }]])),
  ).rejects.toThrow("64MiB");
  expect(() =>
    createCatalogueExporter(" ".repeat(128 * 1024 * 1024 + 1)),
  ).toThrow("128MiB");
  const spec = fixture(archive),
    content = "A".repeat(18 * 1024 * 1024),
    resourceHash = createHash("sha256")
      .update(Buffer.alloc((content.length / 4) * 3))
      .digest("hex");
  for (let index = 0; index < 4; index++)
    spec.resources.push({
      name: `data/${index}.bin`,
      mediaType: "application/octet-stream",
      content,
      hash: resourceHash,
      license: "CC0-1.0",
    });
  const largeCapture = createCatalogueExporter(JSON.stringify(spec)),
    large = { ...archive, props: { label: "x".repeat(60 * 1024 * 1024) } },
    digest = spyOn(globalThis.crypto.subtle, "digest");
  try {
    await expect(
      largeCapture(new Map([["left", { exportJavascript: () => large }]])),
    ).rejects.toThrow("128MiB");
    expect(digest).not.toHaveBeenCalled();
  } finally {
    digest.mockRestore();
  }
}, 60_000);
