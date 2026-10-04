// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyArtifacts, generatedText } from "./artifacts.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "astro-fyne-artifacts-"));
  directories.push(path);
  return path;
}
const header = "// generated\n";
const artifact = (path: string, content = header) => ({
  path,
  content,
  isOwned: generatedText(header),
});

test("validation of every destination precedes every write", async () => {
  const root = await directory();
  await writeFile(join(root, "b"), "handwritten");
  await expect(
    applyArtifacts([artifact(join(root, "a")), artifact(join(root, "b"))], {
      check: false,
    }),
  ).rejects.toThrow("archivo ajeno");
  expect(await Bun.file(join(root, "a")).exists()).toBe(false);
  expect(await readFile(join(root, "b"), "utf8")).toBe("handwritten");
});

test("symlink destinations cannot replace handwritten targets", async () => {
  const root = await directory();
  await writeFile(join(root, "source"), "handwritten");
  await symlink(join(root, "source"), join(root, "output"));
  await expect(
    applyArtifacts([artifact(join(root, "output"))], { check: false }),
  ).rejects.toThrow("destino ajeno");
  expect(await readFile(join(root, "source"), "utf8")).toBe("handwritten");
});

test("binary checking detects a one-byte change and duplicate paths before writes", async () => {
  const root = await directory();
  const path = join(root, "asset");
  const bytes = new Uint8Array([1, 2, 3]);
  const item = { path, content: bytes, isOwned: () => true };
  await expect(
    applyArtifacts([item, { ...item, path: join(root, ".", "asset") }], {
      check: false,
    }),
  ).rejects.toThrow("Salida duplicada");
  expect(await Bun.file(path).exists()).toBe(false);
  await applyArtifacts([item], { check: false });
  await applyArtifacts([item], { check: true });
  await writeFile(path, new Uint8Array([1, 2, 4]));
  await expect(applyArtifacts([item], { check: true })).rejects.toThrow(
    "desactualizado",
  );
});
