// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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
async function tree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name,
        file = join(path, entry.name);
      if (entry.isDirectory()) {
        files[`${name}/`] = "directory";
        await visit(file, `${name}/`);
      } else if (entry.isSymbolicLink()) {
        files[name] = `symlink:${await readlink(file)}`;
      } else files[name] = (await readFile(file)).toString("base64");
    }
  }
  await visit(root, "");
  return files;
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
  ).rejects.toThrow("file not owned by the generator");
  expect(await Bun.file(join(root, "a")).exists()).toBe(false);
  expect(await readFile(join(root, "b"), "utf8")).toBe("handwritten");
});

test("symlink destinations cannot replace handwritten targets", async () => {
  const root = await directory();
  await writeFile(join(root, "source"), "handwritten");
  await symlink(join(root, "source"), join(root, "output"));
  await expect(
    applyArtifacts([artifact(join(root, "output"))], { check: false }),
  ).rejects.toThrow("destination not owned by the generator");
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
  ).rejects.toThrow("Duplicate output");
  expect(await Bun.file(path).exists()).toBe(false);
  await applyArtifacts([item], { check: false });
  await applyArtifacts([item], { check: true });
  await writeFile(path, new Uint8Array([1, 2, 4]));
  await expect(applyArtifacts([item], { check: true })).rejects.toThrow(
    "out of date",
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
    "symlink points outside the selected directory",
  );
  expect(await Bun.file(join(root, "Page.tsx")).exists()).toBe(false);
  expect(await Bun.file(join(outside, "bitmap.png")).exists()).toBe(false);
  await writeFile(join(outside, "bitmap.png"), header);
  await expect(applyArtifacts([files[1]!], { check: true })).rejects.toThrow(
    "symlink points outside the selected directory",
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
  ).rejects.toThrow("Duplicate output");
});

test("protected generated CSS survives input and output aliases before any staging", async () => {
  const root = await directory(),
    actual = join(root, "actual"),
    chosen = join(root, "chosen"),
    source = join(actual, "App.fonts.css"),
    inputAlias = join(root, "input.css"),
    cssHeader = "/* Code generated by astro-fyne. DO NOT EDIT. */\n",
    original = cssHeader + '.source{font-family:"Source"}\r\n';
  await mkdir(actual);
  await symlink(actual, chosen);
  await writeFile(source, original);
  await symlink(source, inputAlias);
  const before = await tree(root);
  for (const withRoot of [false, true])
    for (const input of [source, inputAlias]) {
      const files = [
        {
          ...artifact(join(chosen, "new", "Page.tsx")),
          ...(withRoot ? { root: chosen } : {}),
        },
        {
          path: join(chosen, "App.fonts.css"),
          ...(withRoot ? { root: chosen } : {}),
          content: cssHeader + ".replacement{color:red}\n",
          isOwned: generatedText(cssHeader),
        },
      ];
      await expect(
        applyArtifacts(files, { check: false, protectedInputs: [input] }),
      ).rejects.toThrow("Output cannot replace a protected input");
      expect(await tree(root)).toEqual(before);
      expect(await readFile(source, "utf8")).toBe(original);
    }
});

test("protected lexical paths are snapshotted before the first await", async () => {
  const root = await directory(),
    source = join(root, "source.gen.go");
  await writeFile(source, header + "original\n");
  const before = await tree(root),
    protectedInputs = [relative(process.cwd(), source)],
    result = applyArtifacts(
      [
        artifact(join(root, "new", "Page.tsx")),
        artifact(source, header + "replacement\n"),
      ],
      { check: false, protectedInputs },
    );
  protectedInputs[0] = join(root, "unrelated");
  protectedInputs.length = 0;
  await expect(result).rejects.toThrow(
    "Output cannot replace a protected input",
  );
  expect(await tree(root)).toEqual(before);
});

test("freshness checks reject the same protected path even when its bytes already match", async () => {
  const root = await directory(),
    actual = join(root, "actual"),
    chosen = join(root, "chosen");
  await mkdir(actual);
  await symlink(actual, chosen);
  const source = join(actual, "source.gen.go"),
    ready = join(actual, "ready.gen.go");
  await writeFile(source, header);
  await writeFile(ready, header);
  const before = await tree(root);
  for (const check of [false, true]) {
    await expect(
      applyArtifacts(
        [artifact(ready), artifact(join(chosen, "source.gen.go"))],
        { check, protectedInputs: [source] },
      ),
    ).rejects.toThrow("Output cannot replace a protected input");
    expect(await tree(root)).toEqual(before);
  }
});

test("missing dangling and unresolvable protected inputs fail before output changes", async () => {
  const root = await directory(),
    missing = join(root, "missing.txt"),
    dangling = join(root, "dangling.txt"),
    regular = join(root, "regular.txt");
  await symlink(missing, dangling);
  await writeFile(regular, "Protected input.\r\n");
  const before = await tree(root);
  for (const input of [missing, dangling, join(regular, "child")])
    for (const check of [false, true]) {
      await expect(
        applyArtifacts([artifact(join(root, "new", "Page.tsx"))], {
          check,
          protectedInputs: [regular, input],
        }),
      ).rejects.toThrow("Protected input could not be resolved");
      expect(await tree(root)).toEqual(before);
    }
});

test("unrelated protected inputs allow rooted and rootless generation through aliases", async () => {
  const root = await directory(),
    actual = join(root, "actual"),
    chosen = join(root, "chosen"),
    source = join(root, "source.css");
  await mkdir(actual);
  await symlink(actual, chosen);
  await writeFile(source, "Original CSS.\r\n");
  for (const withRoot of [false, true]) {
    const name = withRoot ? "Rooted.tsx" : "Rootless.tsx",
      output = {
        ...artifact(join(chosen, "new", name)),
        ...(withRoot ? { root: chosen } : {}),
      };
    await applyArtifacts([output], {
      check: false,
      protectedInputs: [source],
    });
    expect(await readFile(join(actual, "new", name), "utf8")).toBe(header);
    const before = await tree(root);
    await applyArtifacts([output], {
      check: true,
      protectedInputs: [source],
    });
    expect(await tree(root)).toEqual(before);
    expect(await readFile(source, "utf8")).toBe("Original CSS.\r\n");
  }
});

test("protection checks do not turn destination symlinks into writable targets", async () => {
  const root = await directory(),
    source = join(root, "source.css"),
    target = join(root, "target.gen.go"),
    link = join(root, "linked.gen.go");
  await writeFile(source, "Unrelated protected input.\r\n");
  await writeFile(target, header + "original\n");
  await symlink(target, link);
  const before = await tree(root);
  for (const withRoot of [false, true]) {
    await expect(
      applyArtifacts(
        [
          artifact(join(root, "new", "Page.tsx")),
          {
            ...artifact(link, header + "replacement\n"),
            ...(withRoot ? { root } : {}),
          },
        ],
        { check: false, protectedInputs: [source] },
      ),
    ).rejects.toThrow("destination not owned by the generator");
    expect(await tree(root)).toEqual(before);
  }
});

test("input protection remains opt-in for existing generated files", async () => {
  const root = await directory(),
    source = join(root, "source.gen.go");
  await writeFile(source, header + "original\n");
  await applyArtifacts([artifact(source, header + "replacement\n")], {
    check: false,
  });
  expect(await readFile(source, "utf8")).toBe(header + "replacement\n");
});
