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
      "Bitmap exceeds the limit: 16384 px per side and 64 megapixels.",
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
      throw new Error("The .png resource has no valid PNG header.");
    if (bytes[24] !== 8 || ![2, 6].includes(bytes[25]!))
      throw new Error("PNG requires 8-bit RGB or RGBA in stage 01.");
    const size = dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    if (bytes[26] !== 0 || bytes[27] !== 0 || ![0, 1].includes(bytes[28]!))
      throw new Error(
        "PNG uses an invalid compression, filter or interlace method.",
      );
    const data: Buffer[] = [];
    let closedData = false;
    let palette = false;
    let transparency = false;
    let ended = false;
    for (let offset = 8; offset < bytes.length;) {
      if (offset + 12 > bytes.length) throw new Error("Truncated PNG.");
      const length = bytes.readUInt32BE(offset);
      const end = offset + length + 12;
      if (length > 0x7fffffff || end > bytes.length)
        throw new Error("Truncated PNG or invalid chunk length.");
      const kind = bytes.toString("latin1", offset + 4, offset + 8);
      if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(kind))
        throw new Error("PNG contains an invalid chunk type.");
      if (
        crc32(bytes.subarray(offset + 4, end - 4)) !==
        bytes.readUInt32BE(end - 4)
      )
        throw new Error(`Invalid PNG CRC in ${kind}.`);
      if (kind === "IHDR" && offset !== 8)
        throw new Error("PNG contains a duplicate or misplaced IHDR.");
      if (kind === "acTL")
        throw new Error(
          "Animated PNG needs a native animation adapter; stage 01 supports static images.",
        );
      if (kind === "eXIf")
        throw new Error("PNG with EXIF requires explicit native orientation.");
      if (["iCCP", "gAMA", "cHRM"].includes(kind))
        throw new Error(
          `PNG ${kind} requires explicit native color management.`,
        );
      if (kind === "IDAT") {
        if (closedData)
          throw new Error("PNG requires consecutive IDAT chunks.");
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
          throw new Error("PNG contains invalid or misplaced PLTE.");
        palette = true;
      }
      if (kind === "tRNS") {
        if (transparency || data.length || bytes[25] !== 2 || length !== 6)
          throw new Error("PNG contains invalid or misplaced tRNS.");
        // Require 8-bit samples to avoid decoder differences in unused high bits.
        for (let sample = offset + 8; sample < end - 4; sample += 2)
          if (bytes.readUInt16BE(sample) > 255)
            throw new Error(
              "PNG tRNS RGB8 requires canonical samples in 0..255 in stage 01.",
            );
        transparency = true;
      }
      if (kind === "IEND") {
        ended = true;
        if (length !== 0 || end !== bytes.length)
          throw new Error("PNG contains extra data after IEND.");
        if (!data.length) throw new Error("PNG has no IDAT data.");
        break;
      }
      if (/^[A-Z]/.test(kind) && !["IHDR", "PLTE", "IDAT"].includes(kind))
        throw new Error(`PNG contains an unknown critical chunk: ${kind}.`);
      offset = end;
    }
    if (!ended) throw new Error("PNG has no IEND.");

    // Adam7 pass starts/strides: https://www.w3.org/TR/png-3/
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
      // The Buffer overload omits the public info option's return type.
      const result = inflateSync(compressed, {
        maxOutputLength: expected,
        info: true,
      }) as unknown as {
        buffer: Buffer;
        engine: { bytesWritten: number };
      };
      if (result.engine.bytesWritten !== compressed.length)
        throw new Error("extra data after the zlib stream");
      decoded = result.buffer;
    } catch (error) {
      throw new Error(
        `PNG contains invalid IDAT data or decompression exceeds the limit: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (decoded.length !== expected)
      throw new Error("PNG scanline length does not match its dimensions.");
    let offset = 0;
    for (const scan of scans)
      for (let row = 0; row < scan.rows; row++, offset += scan.length)
        if (decoded[offset]! > 4)
          throw new Error("PNG contains an invalid scanline filter.");
    // Legal filters and exact row lengths validate RGB/RGBA8 samples.
    // Native image/png independently decodes the resource.
    return {
      mediaType: "image/png" as const,
      ...size,
    };
  }
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216)
    throw new Error("The .jpg/.jpeg resource has no valid JPEG header.");
  let size: { width: number; height: number } | undefined;
  for (let offset = 2; offset < bytes.length;) {
    if (bytes[offset++] !== 255) throw new Error("Invalid JPEG marker.");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === undefined) throw new Error("Truncated JPEG.");
    if (marker === 218 || marker === 217) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) throw new Error("Truncated JPEG.");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length)
      throw new Error("Segmento Truncated JPEG.");
    if (
      marker === 225 &&
      bytes.toString("ascii", offset + 2, offset + 8) === "Exif\u0000\u0000"
    )
      throw new Error(
        "JPEG with EXIF requires explicit native orientation; remove EXIF or normalize the bitmap.",
      );
    if (
      marker === 226 &&
      bytes.toString("ascii", offset + 2, offset + 14) === "ICC_PROFILE\u0000"
    )
      throw new Error(
        "JPEG with an ICC profile requires explicit native color management.",
      );
    if (
      marker === 238 &&
      bytes.toString("ascii", offset + 2, offset + 7) === "Adobe"
    )
      throw new Error("JPEG Adobe requires explicit native color management.");
    if ([192, 193, 194].includes(marker)) {
      if (length < 8 || bytes[offset + 2] !== 8)
        throw new Error("JPEG requires 8-bit depth.");
      size = dimensions(
        bytes.readUInt16BE(offset + 5),
        bytes.readUInt16BE(offset + 3),
      );
    } else if (
      marker >= 192 &&
      marker <= 207 &&
      ![196, 200, 204].includes(marker)
    )
      throw new Error("This JPEG encoding requires another native decoder.");
    offset += length;
  }
  if (!size) throw new Error("JPEG has no valid dimensions.");
  if (bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
    throw new Error("JPEG has no EOI.");
  return { mediaType: "image/jpeg" as const, ...size };
}

/** Shared PNG data validation and JPEG metadata validation for source or scene bytes. */
export function inspectBitmap(bytes: Uint8Array, mediaType: string) {
  if (bytes.byteLength > maxBytes)
    throw new Error("Bitmap resource exceeds 20 MiB.");
  if (!["image/png", "image/jpeg"].includes(mediaType))
    throw new Error(
      "Bitmap supports only image/png and image/jpeg in stage 01.",
    );
  return metadata(
    Buffer.from(bytes),
    mediaType === "image/png" ? ".png" : ".jpg",
  );
}

async function publicDirectory(source: string, explicit?: string) {
  if (explicit) {
    const directory = resolve(explicit);
    if (!(await stat(directory).catch(() => undefined))?.isDirectory())
      throw new Error(`Missing public directory: ${directory}`);
    return directory;
  }
  for (let directory = dirname(source); ; directory = dirname(directory)) {
    const candidate = resolve(directory, "public");
    if ((await stat(candidate).catch(() => undefined))?.isDirectory())
      return candidate;
    if (dirname(directory) === directory) break;
  }
  throw new Error(
    "Astro public directory not found; set publicDir explicitly.",
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
      "img src requires a literal local PNG/JPEG path without a URL, query, fragment or escapes.",
    );
  const extension = extname(src).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(extension))
    throw new Error("img supports only local PNG and JPEG files in stage 01.");
  let path: string;
  if (src.startsWith("/")) {
    const directory = await publicDirectory(projectSource, publicDir);
    path = resolve(directory, `.${src}`);
    if (!contained(directory, path))
      throw new Error("img src escapes the public directory.");
    const canonical = await realpath(path).catch(() => undefined);
    if (!canonical) throw new Error(`Missing bitmap resource: ${src}`);
    if (!contained(await realpath(directory), canonical))
      throw new Error("img src symlink points outside the public directory.");
  } else {
    path = resolve(dirname(source), src);
    const canonical = await realpath(path).catch(() => undefined);
    if (!canonical) throw new Error(`Missing bitmap resource: ${src}`);
  }
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Bitmap resource is not a file: ${src}`);
  if (info.size > maxBytes) throw new Error("Bitmap resource exceeds 20 MiB.");
  const bytes = await readFile(path);
  if (bytes.length > maxBytes)
    throw new Error("Bitmap resource exceeds 20 MiB.");
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
