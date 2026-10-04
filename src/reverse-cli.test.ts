// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateReverse, reverseMain } from "./reverse-cli.ts";
import { inspectBitmap } from "./resources.ts";
import type { SceneDocument } from "./reverse.ts";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "astro-fyne-reverse-cli-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const style = {
  x: 0,
  y: 0,
  width: 320,
  height: 240,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  gap: 0,
  direction: "column",
  background: "#ffffff",
  color: "#000000",
  borderColor: "transparent",
  borderWidth: 0,
  radius: 0,
  fontSize: 14,
  lineHeight: 20,
  fontWeight: 400,
  fontFamily: "",
  fontStyle: "normal",
  textAlign: "left",
  whiteSpace: "normal",
  display: "block",
  opacity: 1,
  measured: true,
};
function document(): SceneDocument {
  return {
    schema: 1,
    viewport: { width: 320, height: 240, scale: 1 },
    roots: [
      {
        id: "native-root",
        kind: "container",
        style: { ...style },
        children: [],
      },
    ],
    tokens: {},
    resources: [],
    requiredActions: [],
  };
}
async function options(scene = document()) {
  const path = join(directory, "scene.json");
  await writeFile(path, JSON.stringify(scene));
  return {
    scene: path,
    out: join(directory, "pages"),
    publicDir: join(directory, "public"),
    name: "NativePage",
  };
}

test("reverse CLI regenerates owned source and reports without asserting pixel parity", async () => {
  const config = await options();
  await generateReverse(config);
  await generateReverse({ ...config, check: true });
  const report = JSON.parse(
    await readFile(join(config.out, "NativePage.reverse.report.json"), "utf8"),
  );
  expect(report.generator).toBe("astro-fyne");
  expect(report.direction).toBe("fyne-to-astro");
  expect(report.visualVerified).toBe(false);
  const page = join(config.out, "NativePage.tsx");
  await writeFile(page, (await readFile(page, "utf8")) + "// changed\n");
  await expect(generateReverse({ ...config, check: true })).rejects.toThrow(
    "desactualizado",
  );
  await generateReverse(config);
  await generateReverse({ ...config, check: true });
});

test("handwritten CSS blocks all inverse output and remains intact", async () => {
  const config = await options();
  await mkdir(config.out);
  const css = join(config.out, "NativePage.css");
  await writeFile(css, "body { color: red; }\n");
  await expect(generateReverse(config)).rejects.toThrow("archivo ajeno");
  expect(await readFile(css, "utf8")).toBe("body { color: red; }\n");
  expect(await Bun.file(join(config.out, "NativePage.tsx")).exists()).toBe(
    false,
  );
  expect(await Bun.file(join(config.out, "NativePage.astro")).exists()).toBe(
    false,
  );
});

test("reverse assets go to publicDir, are checked byte-for-byte and never overwrite different bytes", async () => {
  const scene = document();
  const bytes = await readFile(
    new URL("../example/public/images/local-image.png", import.meta.url),
  );
  const hash = createHash("sha256").update(bytes).digest("hex");
  const bitmap = inspectBitmap(bytes, "image/png");
  const path = `assets/${hash}.png`;
  scene.resources.push({
    name: "image",
    path,
    hash,
    mediaType: "image/png",
    content: bytes.toString("base64"),
    width: bitmap.width,
    height: bitmap.height,
  });
  scene.roots[0]!.children.push({
    id: "bitmap",
    kind: "image",
    style: { ...style, width: bitmap.width, height: bitmap.height },
    resource: "image",
    accessibleLabel: "Four colored squares",
    children: [],
  });
  const config = await options(scene);
  await generateReverse(config);
  const asset = join(config.publicDir, path);
  expect((await readFile(asset)).equals(bytes)).toBe(true);
  expect(await Bun.file(join(config.out, path)).exists()).toBe(false);
  await writeFile(asset, new Uint8Array([1]));
  await expect(generateReverse({ ...config, check: true })).rejects.toThrow(
    "desactualizado",
  );
  await expect(generateReverse(config)).rejects.toThrow("archivo ajeno");
  expect([...(await readFile(asset))]).toEqual([1]);
});

test("missing callback bridges and unsupported scene data write no files", async () => {
  const scene = document();
  scene.roots[0]!.children.push({
    id: "go-action",
    kind: "button",
    text: "Run",
    style: { ...style },
    events: { tap: "run" },
    children: [],
  });
  scene.requiredActions.push("run");
  const config = await options(scene);
  await expect(generateReverse(config)).rejects.toThrow("actionsModule");
  expect(await Bun.file(config.out).exists()).toBe(false);
  await writeFile(
    config.scene,
    JSON.stringify({ ...scene, unexpected: "silent approximation" }),
  );
  await expect(
    generateReverse({ ...config, actionsModule: "./actions" }),
  ).rejects.toThrow("unknown field");
  expect(await Bun.file(config.out).exists()).toBe(false);
});

test("inverse CLI rejects missing values and duplicate flags", async () => {
  await expect(reverseMain(["--scene", "--out", "dir"])).rejects.toThrow(
    "Falta valor",
  );
  await expect(reverseMain(["--check", "--check"])).rejects.toThrow(
    "duplicada",
  );
  await expect(
    reverseMain(["--scene", "scene.json", "--unsafe"]),
  ).rejects.toThrow("desconocida");
});
