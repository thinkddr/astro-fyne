// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { afterEach, beforeEach, expect, test } from "bun:test";
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
import { catalogueHash } from "./catalogue.ts";
import { loadLicensedFonts } from "./licensed-fonts.ts";

const regular = await readFile(
    new URL("../example/public/fonts/NotoSans-Regular.ttf", import.meta.url),
  ),
  bold = await readFile(
    new URL("../example/public/fonts/NotoSans-Bold.ttf", import.meta.url),
  ),
  license = Buffer.from(
    "\ufeff" +
      (
        await readFile(
          new URL(
            "../example/public/fonts/LICENSE-NotoSans.txt",
            import.meta.url,
          ),
          "utf8",
        )
      ).replace(/\r?\n/g, "\r\n"),
  ),
  face = {
    family: "Host",
    weight: 400,
    style: "normal",
    source: "regular.ttf",
    license: "OFL.txt",
  };
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "afy-licensed-fonts-"));
  await writeFile(join(directory, "regular.ttf"), regular);
  await writeFile(join(directory, "bold.ttf"), bold);
  await writeFile(join(directory, "OFL.txt"), license);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function manifest(faces: unknown[] = [face]) {
  const path = join(directory, "fonts.json");
  await writeFile(
    path,
    JSON.stringify({ schema: 1, kind: "astro-fyne-font-manifest", faces }) +
      "\r\n",
  );
  return path;
}

test("licensed manifests compute exact font and license hashes without manual pins", async () => {
  const path = await manifest([
      face,
      { ...face, weight: 700, source: "bold.ttf" },
    ]),
    loaded = await loadLicensedFonts(path);
  expect(loaded.fontFaces.map(({ weight }) => weight)).toEqual([400, 700]);
  expect(loaded.resources).toHaveLength(2);
  for (const [index, bytes] of [regular, bold].entries()) {
    const resource = loaded.resources[index]!;
    expect(resource.hash).toBe(catalogueHash(bytes));
    expect(Buffer.from(resource.content, "base64")).toEqual(bytes);
    expect(Buffer.from(resource.license)).toEqual(license);
    expect(loaded.bindings[index]!.licenseHash).toBe(catalogueHash(license));
  }
  expect(loaded.manifestHash).toBe(catalogueHash(await readFile(path)));
  expect(loaded.inputPaths).toEqual(
    [
      path,
      join(directory, "OFL.txt"),
      join(directory, "bold.ttf"),
      join(directory, "regular.ttf"),
    ].sort(),
  );
});

test("optional font and license pins validate exact raw bytes", async () => {
  const pinned = {
    ...face,
    hash: catalogueHash(regular),
    licenseHash: catalogueHash(license),
  };
  expect(
    (await loadLicensedFonts(await manifest([pinned]))).resources,
  ).toHaveLength(1);
  for (const [change, message] of [
    [{ hash: "0".repeat(64) }, "font digest mismatch"],
    [{ licenseHash: "0".repeat(64) }, "license digest mismatch"],
    [{ hash: "ABC" }, "lowercase SHA-256"],
    [{ licenseHash: "" }, "lowercase SHA-256"],
  ] as const)
    await expect(
      loadLicensedFonts(await manifest([{ ...pinned, ...change }])),
    ).rejects.toThrow(message);
});

test("same-byte aliases deduplicate only with identical license bytes", async () => {
  const alias = { ...face, family: "Alias" },
    loaded = await loadLicensedFonts(await manifest([face, alias]));
  expect(loaded.resources).toHaveLength(1);
  expect(loaded.fontFaces).toHaveLength(2);
  expect(loaded.fontFaces[0]!.resource).toBe(loaded.fontFaces[1]!.resource);
  await writeFile(
    join(directory, "other.txt"),
    Buffer.concat([license, Buffer.from("\r\n")]),
  );
  await expect(
    loadLicensedFonts(
      await manifest([face, { ...alias, license: "other.txt" }]),
    ),
  ).rejects.toThrow("equal font bytes require identical license bytes");
});

test("manifest JSON diagnoses raw duplicates unknown fields and unsupported descriptors", async () => {
  const path = await manifest(),
    valid = await readFile(path, "utf8");
  for (const source of [
    valid.replace('"schema":1', '"schema":1,"schema":1'),
    valid.replace('"family":"Host"', '"family":"Host","\\u0066amily":"Alias"'),
    valid.replace('"schema":1', '"schema":1,"unknown":true'),
    valid.replace('"license":"OFL.txt"', '"license":"OFL.txt","unknown":true'),
    valid.replace('"family":"Host"', '"family":"\\ud800"'),
    JSON.stringify([face]),
  ]) {
    await writeFile(path, source);
    await expect(loadLicensedFonts(path)).rejects.toThrow();
  }
  for (const faces of [
    [face, face],
    [face, { ...face, family: "HOST", weight: 700 }],
    [{ ...face, weight: 600 }],
    [{ ...face, weight: 700 }],
    [{ ...face, style: "italic" }],
    [{ ...face, family: "Host, serif" }],
    Array.from({ length: 17 }, (_, index) => ({
      ...face,
      family: `Host${index}`,
    })),
  ])
    await expect(loadLicensedFonts(await manifest(faces))).rejects.toThrow();
});

test("font and license paths stay local including symlink targets", async () => {
  const nested = join(directory, "nested");
  await mkdir(nested);
  await writeFile(join(nested, "regular.ttf"), regular);
  await writeFile(join(nested, "OFL.txt"), license);
  await symlink(join(directory, "regular.ttf"), join(nested, "escape.ttf"));
  await symlink(join(directory, "OFL.txt"), join(nested, "escape.txt"));
  await symlink(join(nested, "regular.ttf"), join(nested, "local.ttf"));
  await symlink(join(nested, "OFL.txt"), join(nested, "local.txt"));
  const path = join(nested, "fonts.json");
  const save = async (entry: unknown) => {
    await writeFile(
      path,
      JSON.stringify({
        schema: 1,
        kind: "astro-fyne-font-manifest",
        faces: [entry],
      }),
    );
  };
  await save({ ...face, source: "local.ttf", license: "local.txt" });
  expect((await loadLicensedFonts(path)).resources[0]!.hash).toBe(
    catalogueHash(regular),
  );
  for (const change of [
    { source: "../regular.ttf" },
    { source: "escape.ttf" },
    { source: join(directory, "regular.ttf") },
    { source: "https://example.com/font.ttf" },
    { license: "../OFL.txt" },
    { license: "escape.txt" },
    { license: join(directory, "OFL.txt") },
    { license: "https://example.com/license.txt" },
  ]) {
    await save({ ...face, ...change });
    await expect(loadLicensedFonts(path)).rejects.toThrow();
  }
  await save({ ...face, source: "../regular.ttf", license: "missing.txt" });
  await expect(loadLicensedFonts(path)).rejects.toThrow(
    "font path or symlink escapes the manifest directory",
  );
});

test("malformed and oversized UTF-8 inputs never become replacement characters", async () => {
  const path = await manifest();
  await writeFile(path, Buffer.from([0xff]));
  await expect(loadLicensedFonts(path)).rejects.toThrow("valid UTF-8");
  await manifest();
  for (const bytes of [
    Buffer.from([0xff]),
    Buffer.from("OFL\0text"),
    Buffer.from(" \r\n"),
    Buffer.alloc(1024 * 1024 + 1, 65),
  ]) {
    await writeFile(join(directory, "OFL.txt"), bytes);
    await expect(loadLicensedFonts(path)).rejects.toThrow();
  }
  await writeFile(path, Buffer.alloc(1024 * 1024 + 1, 65));
  await expect(loadLicensedFonts(path)).rejects.toThrow("up to 1 MiB");
});
