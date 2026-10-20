// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCatalogue } from "./catalogue-cli.ts";
import { catalogueHash, type CatalogueSpec } from "./catalogue.ts";
import { generateJavascript } from "./javascript-cli.ts";
import { fontResourceFactoryHeader } from "./javascript-data.ts";
import { createJavascriptComponent } from "./javascript-view.ts";
import { validateJavascriptArchive } from "./javascript.ts";
import type {
  JavascriptArchive,
  JavascriptFactory,
} from "./javascript-types.ts";

function resourceArchive(): JavascriptArchive {
  const code =
    fontResourceFactoryHeader +
    'function(host,archive){try{host("font-resources","1","[]")}catch(error){};throw new Error("factory must not execute")}';
  return {
    schema: 1,
    kind: "astro-fyne-javascript",
    code,
    codeHash: createHash("sha256").update(code).digest("hex"),
    sources: [{ path: "Resource.tsx", hash: catalogueHash(code) }],
    props: {},
    actions: [],
    events: [],
    journal: [],
  };
}

test("native resource factories diagnose browser admission before invoking a factory", async () => {
  const archive = await validateJavascriptArchive(resourceArchive());
  let calls = 0;
  const factory: JavascriptFactory = () => {
    calls++;
    throw new Error("factory ran");
  };
  expect(() => createJavascriptComponent(factory, archive)).toThrow(
    "browser resource adapter",
  );
  expect(calls).toBe(0);
  expect(() =>
    createJavascriptComponent(factory, {
      ...archive,
      code: archive.code.slice(fontResourceFactoryHeader.length),
    }),
  ).not.toThrow();
  expect(calls).toBe(0);
});

test("native resource archive web conversion fails before writing any output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-resource-archive-"));
  try {
    const out = join(directory, "web");
    await mkdir(out);
    await writeFile(join(out, "keep.txt"), "handwritten\r\n");
    const archive = resourceArchive();
    for (const check of [false, true])
      await expect(
        generateJavascript({
          archive,
          out,
          name: "Resource",
          direction: "web",
          check,
        }),
      ).rejects.toThrow("browser resource adapter");
    expect(await readdir(out)).toEqual(["keep.txt"]);
    expect(await readFile(join(out, "keep.txt"), "utf8")).toBe(
      "handwritten\r\n",
    );
    await generateJavascript({
      archive,
      out: join(directory, "native"),
      name: "Resource",
      direction: "native",
    });
    expect(
      await readFile(join(directory, "native/Resource.gen.go"), "utf8"),
    ).toContain("font resources:1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("catalogue web conversion retains native resource factory diagnostics without partial files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afy-resource-catalogue-"));
  try {
    const archive = resourceArchive(),
      payload = JSON.stringify(archive),
      plainCode = archive.code.slice(fontResourceFactoryHeader.length),
      plainPayload = JSON.stringify({
        ...archive,
        code: plainCode,
        codeHash: catalogueHash(plainCode),
      }),
      spec: CatalogueSpec = {
        schema: 1,
        kind: "astro-fyne-catalogue",
        name: "Resource",
        resources: [],
        stylesheets: [],
        fontFaces: [],
        themes: [],
        layouts: [],
        components: [
          {
            id: "Plain",
            kind: "javascript",
            payload: plainPayload,
            hash: catalogueHash(plainPayload),
            stylesheets: [],
            fontFaces: [],
            actions: [],
          },
          {
            id: "Resource",
            kind: "javascript",
            payload,
            hash: catalogueHash(payload),
            stylesheets: [],
            fontFaces: [],
            actions: [],
          },
        ],
        islands: [
          { id: "plain", component: "Plain", key: "plain" },
          { id: "resource", component: "Resource", key: "resource" },
        ],
      },
      catalogue = join(directory, "catalogue.json"),
      out = join(directory, "web");
    await writeFile(catalogue, JSON.stringify(spec));
    await mkdir(out);
    await writeFile(join(out, "keep.txt"), "handwritten");
    for (const check of [false, true])
      await expect(
        generateCatalogue({
          catalogue,
          out,
          name: "Resource",
          direction: "web",
          check,
        }),
      ).rejects.toThrow("browser resource adapter");
    expect(await readdir(out)).toEqual(["keep.txt"]);
    expect(await readFile(join(out, "keep.txt"), "utf8")).toBe("handwritten");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
