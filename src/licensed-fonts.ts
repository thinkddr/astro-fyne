// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { loadFonts, validateFontFaces } from "./fonts.ts";
import { parseJSONSource } from "./json-source.ts";
import type { FontFace } from "./ir.ts";
import type {
  CatalogueFontFace,
  CatalogueResource,
} from "./catalogue-types.ts";

const textLimit = 1024 * 1024;
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
type Entry = Omit<FontFace, "webSrc"> & {
  license: string;
  hash?: string;
  licenseHash?: string;
};
function fail(message: string): never {
  throw new Error(`Font manifest: ${message}`);
}
function fields(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected an object with schema, kind and faces");
  const record = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => ![...required, ...optional].includes(key))
  )
    fail(`unknown or missing fields; expected ${required.join(", ")}`);
  return record;
}
function localPath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(value) ||
    /[\\\0]/.test(value)
  )
    fail("font and license paths must be local relative paths");
}
async function readText(path: string, label: string) {
  const info = await stat(path);
  if (!info.isFile() || info.size > textLimit)
    fail(`${label} requires a regular UTF-8 file up to 1 MiB`);
  const bytes = await readFile(path);
  if (bytes.length > textLimit) fail(`${label} exceeds 1 MiB`);
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      ),
      hash: hash(bytes),
    };
  } catch {
    fail(`${label} requires valid UTF-8`);
  }
}

/** Load exact licensed local faces without changing scene font manifests. */
export async function loadLicensedFonts(file: string) {
  const input = resolve(file),
    root = dirname(input),
    manifest = await readText(input, "manifest"),
    document = fields(
      parseJSONSource(
        manifest.text,
        fail,
        textLimit,
        "JSON requires valid text within 1MiB",
      ),
      ["schema", "kind", "faces"],
    );
  if (document.schema !== 1 || document.kind !== "astro-fyne-font-manifest")
    fail('use schema 1 and kind "astro-fyne-font-manifest" for source input');
  if (
    !Array.isArray(document.faces) ||
    !document.faces.length ||
    document.faces.length > 16
  )
    fail("faces requires 1 to 16 explicit TrueType faces");
  const entries = document.faces.map((value) => {
    const face = fields(
      value,
      ["family", "weight", "style", "source", "license"],
      ["hash", "licenseHash"],
    );
    localPath(face.source);
    localPath(face.license);
    for (const key of ["hash", "licenseHash"])
      if (
        Object.hasOwn(face, key) &&
        (typeof face[key] !== "string" || !/^[a-f0-9]{64}$/.test(face[key]))
      )
        fail(`${key} must be a lowercase SHA-256 digest`);
    return face as unknown as Entry;
  });
  const faces = entries.map(({ family, weight, style, source }, index) => ({
    family,
    weight,
    style,
    source,
    webSrc: `/astro-fyne-font-${index}.ttf`,
  }));
  validateFontFaces(faces);
  const canonicalRoot = await realpath(root),
    licenses = new Map<string, Awaited<ReturnType<typeof readText>>>(),
    inputPaths = new Set([input]);
  for (const entry of entries) {
    const source = resolve(root, entry.source),
      path = resolve(root, entry.license);
    for (const [label, input] of [
      ["font", source],
      ["license", path],
    ] as const) {
      const canonical = await realpath(input),
        suffix = relative(canonicalRoot, canonical);
      if (
        suffix === ".." ||
        suffix.startsWith(`..${sep}`) ||
        isAbsolute(suffix)
      )
        fail(`${label} path or symlink escapes the manifest directory`);
    }
    if (!licenses.has(path))
      licenses.set(path, await readText(path, "license"));
    const license = licenses.get(path)!;
    if (!license.text.trim() || license.text.includes("\0"))
      fail("license text is empty or contains NUL");
    if (entry.licenseHash && entry.licenseHash !== license.hash)
      fail("license digest mismatch");
    inputPaths.add(path);
    inputPaths.add(source);
  }
  const loaded = await loadFonts(faces, root),
    resources: CatalogueResource[] = [],
    fontFaces: CatalogueFontFace[] = [],
    resourceBytes = new Map<string, { content: string; license: string }>(),
    bindings: {
      family: string;
      weight: number;
      style: string;
      hash: string;
      licenseHash: string;
    }[] = [];
  for (const font of loaded) {
    const entry = entries.find(
        (entry) =>
          entry.family === font.family &&
          entry.weight === font.weight &&
          entry.style === font.style,
      )!,
      license = licenses.get(resolve(root, entry.license))!;
    if (entry.hash && entry.hash !== font.hash) fail("font digest mismatch");
    const previous = resourceBytes.get(font.hash);
    if (previous && previous.content !== font.content)
      fail("equal font digests require identical font bytes");
    if (previous && previous.license !== license.text)
      fail("equal font bytes require identical license bytes");
    const resource = `fonts/${font.hash}.ttf`;
    if (!previous) {
      resources.push({
        name: resource,
        mediaType: "font/ttf",
        hash: font.hash,
        content: font.content,
        license: license.text,
      });
      resourceBytes.set(font.hash, {
        content: font.content,
        license: license.text,
      });
    }
    fontFaces.push({
      id: `face${fontFaces.length}`,
      family: font.family,
      weight: font.weight,
      style: font.style,
      resource,
      hash: font.hash,
    });
    bindings.push({
      family: font.family,
      weight: font.weight,
      style: font.style,
      hash: font.hash,
      licenseHash: license.hash,
    });
  }
  return {
    resources,
    fontFaces,
    inputPaths: [...inputPaths].sort(),
    manifestHash: manifest.hash,
    bindings,
  };
}
