// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { typographyHash } from "./typography.ts";

if (process.argv.length !== 4)
  throw new Error(
    "Usage: painter-package-inventory.ts GO_LIST_JSONL OUTPUT_JSON",
  );
const input = await readFile(process.argv[2]!, "utf8");
const packages = input
  .trim()
  .split(/\n(?=\{)/)
  .map((item) => JSON.parse(item));
const inventory = [];
const seen = new Set<string>();
for (const item of packages) {
  if (item.Error || item.DepsErrors || item.Incomplete)
    throw new Error("Go list returned an incomplete painter dependency");
  if (item.Standard) continue;
  if (
    !item.ImportPath ||
    seen.has(item.ImportPath) ||
    !isAbsolute(item.Dir) ||
    !item.Module?.Path
  )
    throw new Error(
      "Painter packages require unique imports and actual module directories",
    );
  seen.add(item.ImportPath);
  const names = [
    ...new Set<string>([
      ...(item.GoFiles ?? []),
      ...(item.CgoFiles ?? []),
      ...(item.CFiles ?? []),
      ...(item.CXXFiles ?? []),
      ...(item.MFiles ?? []),
      ...(item.HFiles ?? []),
      ...(item.SFiles ?? []),
      ...(item.SysoFiles ?? []),
      ...(item.EmbedFiles ?? []),
    ]),
  ].sort();
  if (!names.length) throw new Error("Painter package has no compiled files");
  const files = await Promise.all(
    names.map(async (name) => {
      const path = resolve(item.Dir, name);
      if (!path.startsWith(resolve(item.Dir) + sep))
        throw new Error("Painter source escaped its package directory");
      return { name, hash: typographyHash(await readFile(path)) };
    }),
  );
  const module = item.Module;
  inventory.push({
    importPath: item.ImportPath,
    module: {
      path: module.Path,
      version: module.Version ?? null,
      main: module.Main === true,
      replacement: module.Replace
        ? { path: module.Replace.Path, version: module.Replace.Version ?? null }
        : null,
    },
    files,
    sourceHash: typographyHash(JSON.stringify(files)),
  });
}
inventory.sort((a, b) => a.importPath.localeCompare(b.importPath, "en"));
if (
  !inventory.some(
    (item) => item.importPath === "fyne.io/fyne/v2/internal/painter",
  )
)
  throw new Error("The actual Fyne painter is missing from the inventory");
await writeFile(
  process.argv[3]!,
  JSON.stringify(
    {
      schema: 1,
      diagnosticOnly: true,
      pixelPerfectVerified: false,
      fileSelection:
        "Go list production compilation and embedding inputs; tests and unused module graph entries excluded",
      packages: inventory,
    },
    null,
    2,
  ) + "\n",
);
