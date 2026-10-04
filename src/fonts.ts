// SPDX-License-Identifier: Apache-2.0
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { FontFace, FontResource } from "./ir.ts";

const maxBytes = 20 * 1024 * 1024;
const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");

export function validateFontFaces(value: unknown): asserts value is FontFace[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16)
    throw new Error("fonts necesita entre 1 y 16 caras TrueType explícitas.");
  const keys = new Set<string>();
  const families = new Map<string, string>();
  for (const face of value) {
    if (
      !face ||
      typeof face !== "object" ||
      Array.isArray(face) ||
      Object.keys(face).some(
        (key) =>
          !["family", "weight", "style", "source", "webSrc"].includes(key),
      ) ||
      typeof face.family !== "string" ||
      !/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(face.family) ||
      face.family.trim() !== face.family ||
      ![400, 700].includes(face.weight) ||
      !["normal", "italic"].includes(face.style) ||
      typeof face.source !== "string" ||
      !face.source ||
      isAbsolute(face.source) ||
      /[\\\u0000]/.test(face.source) ||
      typeof face.webSrc !== "string" ||
      !/^\/(?!\/)[A-Za-z0-9_./-]+\.ttf$/i.test(face.webSrc) ||
      face.webSrc
        .split("/")
        .some((part: string) => part === "." || part === "..")
    )
      throw new Error(
        "Cara fonts inválida: family única, weight 400/700, style normal/italic, source relativa y webSrc /ruta.ttf explícitos.",
      );
    const key = `${face.family.toLowerCase()}:${face.weight}:${face.style}`;
    const spelling = families.get(face.family.toLowerCase());
    if (spelling && spelling !== face.family)
      throw new Error("La familia fonts debe usar una única capitalización.");
    families.set(face.family.toLowerCase(), face.family);
    if (keys.has(key)) throw new Error(`Cara fonts duplicada: ${key}`);
    keys.add(key);
  }
}

function checksum(bytes: Buffer, zeroAdjustment = false): number {
  let result = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    let word = 0;
    for (let byte = 0; byte < 4; byte++)
      word =
        (word * 256 +
          (zeroAdjustment && offset === 8
            ? 0
            : (bytes[offset + byte] ?? 0))) >>>
        0;
    result = (result + word) >>> 0;
  }
  return result;
}

/** Validate the SFNT container and declared static face. Native also parses glyph tables. */
export function inspectFont(
  bytes: Buffer,
  face: Pick<FontFace, "weight" | "style">,
): void {
  if (
    bytes.length < 12 ||
    bytes.length > maxBytes ||
    bytes.readUInt32BE(0) !== 0x00010000
  )
    throw new Error(
      "Font requiere un TrueType estático .ttf válido de hasta 20 MiB; WOFF, CFF y colecciones no están soportados.",
    );
  const count = bytes.readUInt16BE(4),
    end = 12 + 16 * count;
  if (!count || count > 256 || end > bytes.length)
    throw new Error("Directorio TrueType truncado o inválido.");
  const tables = new Map<string, Buffer>();
  const ranges: { start: number; end: number }[] = [];
  let previous = "";
  for (let index = 0; index < count; index++) {
    const position = 12 + index * 16,
      tag = bytes.toString("ascii", position, position + 4);
    const expected = bytes.readUInt32BE(position + 4),
      start = bytes.readUInt32BE(position + 8),
      size = bytes.readUInt32BE(position + 12);
    if (
      !/^[\x20-\x7e]{4}$/.test(tag) ||
      tag <= previous ||
      start % 4 ||
      start < end ||
      !size ||
      start + size > bytes.length
    )
      throw new Error(
        "Tabla TrueType duplicada, desordenada o fuera del archivo.",
      );
    previous = tag;
    const table = bytes.subarray(start, start + size);
    if (checksum(table, tag === "head") !== expected)
      throw new Error(`Checksum TrueType inválido: ${tag}.`);
    ranges.push({ start, end: start + size });
    tables.set(tag, table);
  }
  ranges.sort((a, b) => a.start - b.start);
  if (
    ranges.some(
      (range, index) => index > 0 && range.start < ranges[index - 1]!.end,
    )
  )
    throw new Error("Tablas TrueType superpuestas.");
  if (checksum(bytes) !== 0xb1b0afba)
    throw new Error("Checksum global TrueType inválido.");
  for (const [tag, minimum] of [
    ["head", 54],
    ["hhea", 36],
    ["maxp", 32],
    ["OS/2", 78],
    ["cmap", 4],
    ["name", 6],
    ["loca", 2],
    ["glyf", 1],
    ["hmtx", 4],
  ] as const)
    if ((tables.get(tag)?.length ?? 0) < minimum)
      throw new Error(`Falta tabla TrueType válida: ${tag}.`);
  if (
    ["fvar", "gvar", "CFF ", "CFF2", "SVG ", "CBDT", "sbix", "COLR"].some(
      (tag) => tables.has(tag),
    )
  )
    throw new Error(
      "Fuente variable o con glifos de color requiere un backend específico.",
    );
  const head = tables.get("head")!,
    os2 = tables.get("OS/2")!,
    maxp = tables.get("maxp")!,
    hhea = tables.get("hhea")!;
  const units = head.readUInt16BE(18),
    glyphs = maxp.readUInt16BE(4),
    metrics = hhea.readUInt16BE(34),
    locationFormat = head.readInt16BE(50);
  if (
    head.readUInt32BE(12) !== 0x5f0f3cf5 ||
    units < 16 ||
    units > 16384 ||
    !glyphs ||
    !metrics ||
    metrics > glyphs ||
    ![0, 1].includes(locationFormat) ||
    tables.get("hmtx")!.length < metrics * 4 + (glyphs - metrics) * 2 ||
    tables.get("loca")!.length < (glyphs + 1) * (locationFormat ? 4 : 2)
  )
    throw new Error("Métricas o índices TrueType inválidos.");
  let last = 0;
  const loca = tables.get("loca")!,
    glyfSize = tables.get("glyf")!.length;
  for (let index = 0; index <= glyphs; index++) {
    const offset = locationFormat
      ? loca.readUInt32BE(index * 4)
      : loca.readUInt16BE(index * 2) * 2;
    if (offset < last || offset > glyfSize)
      throw new Error("Índice de glifo TrueType fuera del archivo.");
    last = offset;
  }
  const selection = os2.readUInt16BE(62);
  if (
    os2.readUInt16BE(4) !== face.weight ||
    Boolean(selection & 1) !== (face.style === "italic") ||
    Boolean(selection & 512)
  )
    throw new Error(
      "weight/style declarados no coinciden con la cara TrueType; no se sintetizan estilos.",
    );
}

export async function loadFonts(
  faces: FontFace[] | undefined,
  root: string,
): Promise<FontResource[]> {
  if (faces === undefined) return [];
  validateFontFaces(faces);
  const canonicalRoot = await realpath(root);
  const result: FontResource[] = [];
  const webSources = new Map<string, string>();
  let total = 0;
  for (const face of faces) {
    const path = resolve(root, face.source),
      canonical = await realpath(path);
    const suffix = relative(canonicalRoot, canonical);
    if (suffix === ".." || suffix.startsWith("../") || isAbsolute(suffix))
      throw new Error("Fuente fonts sale del proyecto mediante ruta o enlace.");
    if (extname(path).toLowerCase() !== ".ttf")
      throw new Error("fonts.source requiere .ttf estático.");
    const info = await stat(path);
    if (!info.isFile() || info.size > maxBytes)
      throw new Error("Fuente fonts ausente, no regular o mayor de 20 MiB.");
    const bytes = await readFile(path);
    inspectFont(bytes, face);
    total += bytes.length;
    if (total > 40 * 1024 * 1024)
      throw new Error("Las fuentes fonts superan 40 MiB en total.");
    const hash = digest(bytes),
      relativePath = relative(root, path).replaceAll("\\", "/");
    if (webSources.has(face.webSrc) && webSources.get(face.webSrc) !== hash)
      throw new Error(
        `fonts.webSrc ${face.webSrc} vincula archivos con hashes diferentes.`,
      );
    webSources.set(face.webSrc, hash);
    result.push({
      name: `font_${digest(`${face.family.toLowerCase()}:${face.weight}:${face.style}:${relativePath}:${hash}`).slice(0, 24)}`,
      path: relativePath,
      hash,
      content: bytes.toString("base64"),
      family: face.family,
      weight: face.weight,
      style: face.style,
      webSrc: face.webSrc,
    });
  }
  return result.sort(
    (a, b) =>
      a.family.toLowerCase().localeCompare(b.family.toLowerCase(), "en") ||
      a.weight - b.weight ||
      a.style.localeCompare(b.style, "en"),
  );
}

export function fontsCSS(fonts: FontResource[]): string {
  return (
    fonts
      .map(
        (face) =>
          `@font-face { font-family: "${face.family}"; font-weight: ${face.weight}; font-style: ${face.style}; font-display: block; src: url("${face.webSrc}") format("truetype"); }`,
      )
      .join("\n") + "\n"
  );
}
