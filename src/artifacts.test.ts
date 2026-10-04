// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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

test("a linked parent cannot escape the selected root before any output is written", async () => {
  const root = await directory();
  const outside = await directory();
  const publicDir = join(root, "public");
  await mkdir(publicDir);
  await symlink(outside, join(publicDir, "assets"));
  const files = [
    { ...artifact(join(root, "Page.tsx")), root },
    { ...artifact(join(publicDir, "assets", "bitmap.png")), root: publicDir },
  ];
  await expect(applyArtifacts(files, { check: false })).rejects.toThrow(
    "enlaza fuera del directorio elegido",
  );
  expect(await Bun.file(join(root, "Page.tsx")).exists()).toBe(false);
  expect(await Bun.file(join(outside, "bitmap.png")).exists()).toBe(false);
  await writeFile(join(outside, "bitmap.png"), header);
  await expect(applyArtifacts([files[1]!], { check: true })).rejects.toThrow(
    "enlaza fuera del directorio elegido",
  );
});

test("an explicitly selected root alias remains usable and canonical aliases detect duplicates", async () => {
  const root = await directory();
  const actual = join(root, "actual");
  const chosen = join(root, "chosen");
  await mkdir(actual);
  await symlink(actual, chosen);
  const output = {
    ...artifact(join(chosen, "nested", "Page.tsx")),
    root: chosen,
  };
  await applyArtifacts([output], { check: false });
  expect(await readFile(join(actual, "nested", "Page.tsx"), "utf8")).toBe(
    header,
  );
  await applyArtifacts([output], { check: true });
  await symlink(join(actual, "nested"), join(actual, "alias"));
  await expect(
    applyArtifacts(
      [
        output,
        { ...artifact(join(chosen, "alias", "Page.tsx")), root: chosen },
      ],
      { check: false },
    ),
  ).rejects.toThrow("Salida duplicada");
});
