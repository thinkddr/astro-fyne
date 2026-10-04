// SPDX-License-Identifier: Apache-2.0

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { crc32, inflateSync } from "node:zlib";
import type { BitmapResource } from "./ir.ts";

const maxBytes = 20 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

function dimensions(width: number, height: number) {
  if (
    !width ||
    !height ||
    width > 16_384 ||
    height > 16_384 ||
    width * height > 64 * 1024 * 1024
  )
    throw new Error(
      "Bitmap fuera del límite: 16384 px por lado y 64 megapíxeles.",
    );
  return { width, height };
}

/** PNG validates its compressed pixels; JPEG metadata still requires native full decoding. */
function metadata(bytes: Buffer, extension: string) {
  if (extension === ".png") {
    if (
      bytes.length < 33 ||
      !bytes.subarray(0, 8).equals(pngSignature) ||
      bytes.toString("ascii", 12, 16) !== "IHDR" ||
      bytes.readUInt32BE(8) !== 13
    )
      throw new Error("El recurso .png no contiene una cabecera PNG válida.");
    if (bytes[24] !== 8 || ![2, 6].includes(bytes[25]!))
      throw new Error("PNG requiere 8 bits y formato RGB o RGBA en stage 01.");
    const size = dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    if (bytes[26] !== 0 || bytes[27] !== 0 || ![0, 1].includes(bytes[28]!))
      throw new Error(
        "PNG usa un método inválido de compresión, filtrado o entrelazado.",
      );
    const data: Buffer[] = [];
    let closedData = false;
    let palette = false;
    let transparency = false;
    let ended = false;
    for (let offset = 8; offset < bytes.length;) {
      if (offset + 12 > bytes.length) throw new Error("PNG truncado.");
      const length = bytes.readUInt32BE(offset);
      const end = offset + length + 12;
      if (length > 0x7fffffff || end > bytes.length)
        throw new Error("PNG truncado o longitud de bloque inválida.");
      const kind = bytes.toString("latin1", offset + 4, offset + 8);
      if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(kind))
        throw new Error("PNG contiene un tipo de bloque inválido.");
      if (
        crc32(bytes.subarray(offset + 4, end - 4)) !==
        bytes.readUInt32BE(end - 4)
      )
        throw new Error(`PNG CRC inválido en ${kind}.`);
      if (kind === "IHDR" && offset !== 8)
        throw new Error("PNG contiene un IHDR duplicado o fuera de orden.");
      if (kind === "acTL")
        throw new Error(
          "PNG animado requiere un recurso nativo animado; stage 01 admite imágenes estáticas.",
        );
      if (kind === "eXIf")
        throw new Error("PNG con EXIF requiere orientación nativa explícita.");
      if (["iCCP", "gAMA", "cHRM"].includes(kind))
        throw new Error(
          `PNG ${kind} requiere gestión de color nativa explícita.`,
        );
      if (kind === "IDAT") {
        if (closedData)
          throw new Error("PNG requiere bloques IDAT consecutivos.");
        data.push(bytes.subarray(offset + 8, end - 4));
      } else if (data.length) closedData = true;
      if (kind === "PLTE") {
        if (
          palette ||
          transparency ||
          data.length ||
          length === 0 ||
          length > 768 ||
          length % 3
        )
          throw new Error("PNG contiene PLTE inválido o fuera de orden.");
        palette = true;
      }
      if (kind === "tRNS") {
        if (transparency || data.length || bytes[25] !== 2 || length !== 6)
          throw new Error("PNG contiene tRNS inválido o fuera de orden.");
        // Go uses low bytes; PNG 3 also requires masking unused high bits.
        // Require canonical 8-bit samples until decoder-version parity is proven,
        // preserving the source bytes instead of silently rewriting transparency.
        for (let sample = offset + 8; sample < end - 4; sample += 2)
          if (bytes.readUInt16BE(sample) > 255)
            throw new Error(
              "PNG tRNS RGB8 requiere muestras canónicas 0..255 en stage 01.",
            );
        transparency = true;
      }
      if (kind === "IEND") {
        ended = true;
        if (length !== 0 || end !== bytes.length)
          throw new Error("PNG contiene datos adicionales tras IEND.");
        if (!data.length) throw new Error("PNG sin datos IDAT.");
        break;
      }
      if (/^[A-Z]/.test(kind) && !["IHDR", "PLTE", "IDAT"].includes(kind))
        throw new Error(`PNG contiene un bloque crítico desconocido: ${kind}.`);
      offset = end;
    }
    if (!ended) throw new Error("PNG sin cierre IEND.");

    // https://www.w3.org/TR/png-3/ defines these Adam7 pass starts/strides. Empty
    // reduced images emit no scanlines. Non-interlaced images have a single pass.
    const passes =
      bytes[28] === 0
        ? [[0, 0, 1, 1]]
        : [
            [0, 0, 8, 8],
            [4, 0, 8, 8],
            [0, 4, 4, 8],
            [2, 0, 4, 4],
            [0, 2, 2, 4],
            [1, 0, 2, 2],
            [0, 1, 1, 2],
          ];
    const pixelBytes = bytes[25] === 2 ? 3 : 4;
    const scans = passes.flatMap(([x, y, dx, dy]) => {
      const width = Math.max(0, Math.ceil((size.width - x!) / dx!));
      const height = Math.max(0, Math.ceil((size.height - y!) / dy!));
      return width && height
        ? [{ rows: height, length: 1 + width * pixelBytes }]
        : [];
    });
    const expected = scans.reduce(
      (sum, scan) => sum + scan.rows * scan.length,
      0,
    );
    const compressed = Buffer.concat(data);
    let decoded: Buffer;
    try {
      // Node's public info option exposes consumed input but its Buffer overload
      // omits that return type. No private zlib engine fields are consulted.
      const result = inflateSync(compressed, {
        maxOutputLength: expected,
        info: true,
      }) as unknown as {
        buffer: Buffer;
        engine: { bytesWritten: number };
      };
      if (result.engine.bytesWritten !== compressed.length)
        throw new Error("datos adicionales tras el stream zlib");
      decoded = result.buffer;
    } catch (error) {
      throw new Error(
        `PNG contiene datos IDAT inválidos o descompresión fuera del límite: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (decoded.length !== expected)
      throw new Error("PNG no contiene la longitud exacta de sus scanlines.");
    let offset = 0;
    for (const scan of scans)
      for (let row = 0; row < scan.rows; row++, offset += scan.length)
        if (decoded[offset]! > 4)
          throw new Error("PNG contiene un filtro de scanline inválido.");
    // Every RGB/RGBA8 sample byte is valid. The five lossless PNG filters always
    // reconstruct bytes modulo 256, so exact rows plus legal filters suffice;
    // native image/png remains the independent decoding/rendering oracle.
    return {
      mediaType: "image/png" as const,
      ...size,
    };
  }
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216)
    throw new Error(
      "El recurso .jpg/.jpeg no contiene una cabecera JPEG válida.",
    );
  let size: { width: number; height: number } | undefined;
  for (let offset = 2; offset < bytes.length;) {
    if (bytes[offset++] !== 255) throw new Error("Marcador JPEG inválido.");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === undefined) throw new Error("JPEG truncado.");
    if (marker === 218 || marker === 217) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) throw new Error("JPEG truncado.");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length)
      throw new Error("Segmento JPEG truncado.");
    if (
      marker === 225 &&
      bytes.toString("ascii", offset + 2, offset + 8) === "Exif\u0000\u0000"
    )
      throw new Error(
        "JPEG con EXIF requiere orientación nativa explícita; retira EXIF o normaliza el bitmap.",
      );
    if (
      marker === 226 &&
      bytes.toString("ascii", offset + 2, offset + 14) === "ICC_PROFILE\u0000"
    )
      throw new Error(
        "JPEG con perfil ICC requiere gestión de color nativa explícita.",
      );
    if (
      marker === 238 &&
      bytes.toString("ascii", offset + 2, offset + 7) === "Adobe"
    )
      throw new Error("JPEG Adobe requiere gestión de color nativa explícita.");
    if ([192, 193, 194].includes(marker)) {
      if (length < 8 || bytes[offset + 2] !== 8)
        throw new Error("JPEG requiere profundidad de 8 bits.");
      size = dimensions(
        bytes.readUInt16BE(offset + 5),
        bytes.readUInt16BE(offset + 3),
      );
    } else if (
      marker >= 192 &&
      marker <= 207 &&
      ![196, 200, 204].includes(marker)
    )
      throw new Error(
        "La codificación JPEG requiere un decoder nativo adicional.",
      );
    offset += length;
  }
  if (!size) throw new Error("JPEG sin dimensiones válidas.");
  if (bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
    throw new Error("JPEG sin cierre EOI.");
  return { mediaType: "image/jpeg" as const, ...size };
}

/** Shared PNG data validation and JPEG metadata validation for source or scene bytes. */
export function inspectBitmap(bytes: Uint8Array, mediaType: string) {
  if (bytes.byteLength > maxBytes)
    throw new Error("El recurso bitmap supera 20 MiB.");
  if (!["image/png", "image/jpeg"].includes(mediaType))
    throw new Error("Bitmap solo admite image/png e image/jpeg en stage 01.");
  return metadata(
    Buffer.from(bytes),
    mediaType === "image/png" ? ".png" : ".jpg",
  );
}

async function publicDirectory(source: string, explicit?: string) {
  if (explicit) {
    const directory = resolve(explicit);
    if (!(await stat(directory).catch(() => undefined))?.isDirectory())
      throw new Error(`Directorio public ausente: ${directory}`);
    return directory;
  }
  for (let directory = dirname(source); ; directory = dirname(directory)) {
    const candidate = resolve(directory, "public");
    if ((await stat(candidate).catch(() => undefined))?.isDirectory())
      return candidate;
    if (dirname(directory) === directory) break;
  }
  throw new Error(
    "No se encuentra public de Astro; configura publicDir explícitamente.",
  );
}

function contained(directory: string, path: string) {
  const suffix = relative(directory, path);
  return (
    suffix !== ".." &&
    !suffix.startsWith("../") &&
    !suffix.startsWith("..\\") &&
    !isAbsolute(suffix)
  );
}

/** Resolve literal local files. URL-root paths belong to public, not the OS root. */
export async function loadBitmap(
  src: string,
  source: string,
  root: string,
  publicDir?: string,
  projectSource = source,
): Promise<BitmapResource> {
  if (
    !src ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(src) ||
    src.startsWith("//") ||
    /[?#%\\\u0000]/.test(src)
  )
    throw new Error(
      "img src necesita una ruta local literal PNG/JPEG sin URL, query, fragmento ni escapes.",
    );
  const extension = extname(src).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(extension))
    throw new Error("img solo admite archivos PNG y JPEG locales en stage 01.");
  let path: string;
  if (src.startsWith("/")) {
    const directory = await publicDirectory(projectSource, publicDir);
    path = resolve(directory, `.${src}`);
    if (!contained(directory, path))
      throw new Error("img src sale del directorio public.");
    const canonical = await realpath(path).catch(() => undefined);
    if (!canonical) throw new Error(`Recurso bitmap ausente: ${src}`);
    if (!contained(await realpath(directory), canonical))
      throw new Error("img src enlaza fuera del directorio public.");
  } else {
    path = resolve(dirname(source), src);
    const canonical = await realpath(path).catch(() => undefined);
    if (!canonical) throw new Error(`Recurso bitmap ausente: ${src}`);
  }
  const info = await stat(path);
  if (!info.isFile())
    throw new Error(`El recurso bitmap no es un archivo: ${src}`);
  if (info.size > maxBytes) throw new Error("El recurso bitmap supera 20 MiB.");
  const bytes = await readFile(path);
  if (bytes.length > maxBytes)
    throw new Error("El recurso bitmap supera 20 MiB.");
  const name = relative(root, path).replaceAll("\\", "/");
  const digest = hash(bytes);
  return {
    name: `bitmap_${hash(name + ":" + digest).slice(0, 24)}`,
    path: name,
    hash: digest,
    content: bytes.toString("base64"),
    srcs: [src],
    ...inspectBitmap(bytes, extension === ".png" ? "image/png" : "image/jpeg"),
  };
}
