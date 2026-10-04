// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { compile } from "./parser.ts";
import { emitGo, sourceHash } from "./emit.ts";
import { inspectBitmap, loadBitmap } from "./resources.ts";
import type { Node } from "./ir.ts";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "astro-fyne-resources-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function chunk(kind: string, body: Buffer) {
  const label = Buffer.from(kind, "ascii");
  const content = Buffer.concat([label, body]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(body.length);
  const suffix = Buffer.alloc(4);
  suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([prefix, content, suffix]);
}

function pngHeader(width = 2, height = 1, type = 6, interlace = 0) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = type;
  header[12] = interlace;
  return header;
}
function png(chunks: Buffer[]) {
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunks,
  ]);
}
function raster(raw: Buffer, header = pngHeader(), extra: Buffer[] = []) {
  return png([
    chunk("IHDR", header),
    ...extra,
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
/** A real, opaque 2x1 RGBA PNG without orientation or color-profile metadata. */
function bitmap(extra?: Buffer) {
  return png([
    chunk("IHDR", pngHeader()),
    ...(extra ? [extra] : []),
    chunk(
      "IDAT",
      deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 255])),
    ),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("PNG rejects missing pixels, bad chunk checksums, truncation and invalid chunk order", () => {
  const header = chunk("IHDR", pngHeader());
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 255]);
  const compressed = deflateSync(raw);
  const data = chunk("IDAT", compressed);
  const end = chunk("IEND", Buffer.alloc(0));
  const corrupted = bitmap();
  corrupted[corrupted.length - 1]! ^= 1;
  const badIDATCRC = Buffer.from(data);
  badIDATCRC[8]! ^= 1;
  const badHeaderCRC = Buffer.from(header);
  badHeaderCRC[11]! ^= 1;
  for (const [bytes, diagnostic] of [
    [png([header, end]), "has no IDAT data"],
    [png([header, data]), "has no IEND"],
    [corrupted, "CRC in IEND"],
    [png([header, badIDATCRC, end]), "CRC in IDAT"],
    [png([badHeaderCRC, data, end]), "CRC in IHDR"],
    [bitmap().subarray(0, bitmap().length - 1), "Truncated"],
    [png([header, header, data, end]), "duplicate or misplaced IHDR"],
    [png([data, header, end]), "valid PNG header"],
    [
      png([
        header,
        chunk("IDAT", compressed.subarray(0, 3)),
        chunk("tEXt", Buffer.from("Note\u0000valid")),
        chunk("IDAT", compressed.subarray(3)),
        end,
      ]),
      "consecutive IDAT",
    ],
    [
      png([header, data, chunk("PLTE", Buffer.from([0, 0, 0])), end]),
      "invalid or misplaced PLTE",
    ],
    [
      png([header, chunk("PLTE", Buffer.from([0])), data, end]),
      "invalid or misplaced PLTE",
    ],
    [
      png([header, chunk("tRNS", Buffer.alloc(6)), data, end]),
      "invalid or misplaced tRNS",
    ],
    [
      png([header, chunk("ABCD", Buffer.alloc(0)), data, end]),
      "unknown critical chunk",
    ],
    [
      png([header, chunk("abca", Buffer.alloc(0)), data, end]),
      "invalid chunk type",
    ],
    [png([header, data, chunk("IEND", Buffer.from([0]))]), "extra data"],
    [Buffer.concat([bitmap(), Buffer.from([0])]), "extra data"],
  ] as [Buffer, string][])
    expect(() => inspectBitmap(bytes, "image/png")).toThrow(diagnostic);
});

test("PNG inflates exactly the declared rows and rejects bombs, invalid filters and hidden zlib streams", () => {
  const header = chunk("IHDR", pngHeader());
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 255]);
  const compressed = deflateSync(raw);
  const end = chunk("IEND", Buffer.alloc(0));
  const badAdler = Buffer.from(compressed);
  badAdler[badAdler.length - 1]! ^= 1;
  for (const [bytes, diagnostic] of [
    [raster(raw.subarray(0, 8)), "scanline length does not match"],
    [raster(Buffer.concat([raw, Buffer.from([0])])), "exceeds the limit"],
    [raster(Buffer.alloc(1024 * 1024), pngHeader(1, 1)), "exceeds the limit"],
    [raster(Buffer.from([5, ...raw.subarray(1)])), "invalid scanline filter"],
    [raster(Buffer.from([255, ...raw.subarray(1)])), "invalid scanline filter"],
    [
      png([
        header,
        chunk("IDAT", compressed.subarray(0, compressed.length - 1)),
        end,
      ]),
      "invalid IDAT data",
    ],
    [png([header, chunk("IDAT", badAdler), end]), "invalid IDAT data"],
    [
      png([
        header,
        chunk("IDAT", Buffer.concat([compressed, Buffer.from([0, 1])])),
        end,
      ]),
      "extra data after the zlib stream",
    ],
    [
      png([
        header,
        chunk("IDAT", Buffer.concat([compressed, compressed])),
        end,
      ]),
      "extra data after the zlib stream",
    ],
  ] as [Buffer, string][])
    expect(() => inspectBitmap(bytes, "image/png")).toThrow(diagnostic);
  for (const index of [10, 11, 12]) {
    const ihdr = pngHeader();
    ihdr[index] = index === 12 ? 2 : 1;
    expect(() => inspectBitmap(raster(raw, ihdr), "image/png")).toThrow(
      "invalid compression",
    );
  }
});

test("PNG accepts RGB/RGBA8 legal filters, split IDAT and nonempty Adam7 passes", () => {
  for (const type of [2, 6])
    for (let filter = 0; filter <= 4; filter++) {
      const raw = Buffer.alloc(type === 2 ? 4 : 5, 17);
      raw[0] = filter;
      expect(
        inspectBitmap(raster(raw, pngHeader(1, 1, type)), "image/png"),
      ).toEqual({ mediaType: "image/png", width: 1, height: 1 });
    }
  const compressed = deflateSync(
    Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 255]),
  );
  expect(
    inspectBitmap(
      png([
        chunk("IHDR", pngHeader()),
        chunk("IDAT", Buffer.alloc(0)),
        chunk("IDAT", compressed.subarray(0, 3)),
        chunk("IDAT", compressed.subarray(3)),
        chunk("IEND", Buffer.alloc(0)),
      ]),
      "image/png",
    ),
  ).toMatchObject({ width: 2, height: 1 });
  // Adam7 1x1 emits only pass 1; 2x1 emits pass 1 and pass 6. At 3x3,
  // the five nonempty passes contain six rows and exactly 36 pixel bytes.
  for (const [width, height, rowLengths] of [
    [1, 1, [5]],
    [2, 1, [5, 5]],
    [3, 3, [5, 5, 9, 5, 5, 13]],
  ] as [number, number, number[]][]) {
    const raw = Buffer.concat(rowLengths.map((length) => Buffer.alloc(length)));
    expect(
      inspectBitmap(raster(raw, pngHeader(width, height, 6, 1)), "image/png"),
    ).toMatchObject({ width, height });
    expect(() =>
      inspectBitmap(
        raster(raw.subarray(0, raw.length - 1), pngHeader(width, height, 6, 1)),
        "image/png",
      ),
    ).toThrow("scanline length does not match");
  }
  const lastPassFilter = Buffer.alloc(42);
  lastPassFilter[29] = 255;
  expect(() =>
    inspectBitmap(raster(lastPassFilter, pngHeader(3, 3, 6, 1)), "image/png"),
  ).toThrow("invalid scanline filter");
  expect(
    inspectBitmap(raster(Buffer.alloc(8), pngHeader(2, 1, 2, 1)), "image/png"),
  ).toMatchObject({ width: 2, height: 1 });
  expect(
    inspectBitmap(
      raster(Buffer.from([0, 1, 2, 3]), pngHeader(1, 1, 2), [
        chunk("PLTE", Buffer.from([1, 2, 3])),
        chunk("tRNS", Buffer.from([0, 1, 0, 2, 0, 3])),
      ]),
      "image/png",
    ),
  ).toMatchObject({ width: 1, height: 1 });
});

test("RGB8 tRNS retains canonical boundary samples and rejects high bits in each channel", () => {
  const image = (samples: number[]) => {
    const transparent = Buffer.alloc(6);
    samples.forEach((sample, index) =>
      transparent.writeUInt16BE(sample, index * 2),
    );
    return raster(Buffer.from([0, 0, 0, 0]), pngHeader(1, 1, 2), [
      chunk("tRNS", transparent),
    ]);
  };
  for (const samples of [
    [0, 0, 0],
    [255, 255, 255],
    [0, 128, 255],
  ])
    expect(inspectBitmap(image(samples), "image/png")).toMatchObject({
      width: 1,
      height: 1,
    });
  for (const sample of [256, 512, 65535])
    for (let channel = 0; channel < 3; channel++) {
      const samples = [0, 0, 0];
      samples[channel] = sample;
      expect(() => inspectBitmap(image(samples), "image/png")).toThrow(
        "tRNS RGB8 requires canonical samples in 0..255",
      );
    }
});

async function file(path: string, bytes: string | Buffer) {
  const target = join(directory, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return target;
}

function images(nodes: Node[]): Extract<Node, { kind: "element" }>[] {
  return nodes.flatMap((node) => {
    if (node.kind === "element")
      return [...(node.tag === "img" ? [node] : []), ...images(node.children)];
    if (node.kind === "component" || node.kind === "each")
      return images(node.children);
    if (node.kind === "conditional")
      return [...images(node.yes), ...images(node.no)];
    return [];
  });
}

test("Astro public images produce native embedded resources with source hashes", async () => {
  const bytes = bitmap();
  await file("app/public/images/logo.png", bytes);
  const entry = await file(
    "app/src/pages/index.astro",
    `<main id="page"><img id="logo" src="/images/logo.png" alt="Logo" /></main>`,
  );
  const program = await compile(entry, undefined, { root: directory });
  const resource = program.resources![0]!;
  const digest = createHash("sha256").update(bytes).digest("hex");
  expect(resource).toMatchObject({
    path: "app/public/images/logo.png",
    hash: digest,
    mediaType: "image/png",
    width: 2,
    height: 1,
    srcs: ["/images/logo.png"],
  });
  expect(Buffer.from(resource.content, "base64")).toEqual(bytes);
  expect(program.sources).toContainEqual({ path: resource.path, hash: digest });
  const image = images(
    program.components.find((component) => component.name === program.entry)!
      .body,
  )[0]!;
  expect(image.imageResource).toBe(resource.name);
  const go = emitGo(program, { name: "Page", packageName: "generated" });
  expect(go).toContain('Kind: "image"');
  expect(go).toContain(`ImageResource: imagePage_${resource.name}`);
  expect(go).toContain('AccessibleLabel: webui.String("Logo")');
  expect(go).toContain("Style: webui.Style{Width: 2, Height: 1}");
  expect(go).toContain(
    'fyne.NewStaticResource("app/public/images/logo.png", []byte("\\x89\\x50\\x4e\\x47',
  );
  expect(go).toContain("func NewPageResources() map[string]fyne.Resource");
});

test("relative files and URL-root aliases deduplicate one bitmap resource", async () => {
  await file("public/images/logo.png", bitmap());
  const entry = await file(
    "src/Page.tsx",
    `export function Page() { return <main><img src="/images/logo.png" /><img src="../public/images/logo.png" /></main>; }`,
  );
  const program = await compile(entry, undefined, { root: directory });
  expect(program.resources).toHaveLength(1);
  expect(program.resources![0]!.srcs).toEqual([
    "../public/images/logo.png",
    "/images/logo.png",
  ]);
  const nodes = images(program.components[0]!.body);
  expect(nodes[0]!.imageResource).toBe(nodes[1]!.imageResource);
  expect(
    program.sources.filter((source) => source.path.endsWith("logo.png")),
  ).toHaveLength(1);
});

test("an explicit public directory works without executing Astro config", async () => {
  await file("assets/images/logo.png", bitmap());
  const entry = await file(
    "nested/Page.tsx",
    `export function Page() { return <img src="/images/logo.png" width="8" />; }`,
  );
  const program = await compile(entry, undefined, {
    root: directory,
    publicDir: "assets",
  });
  expect(program.resources![0]!.path).toBe("assets/images/logo.png");
  expect(emitGo(program, { name: "Page", packageName: "generated" })).toContain(
    "Style: webui.Style{Width: 8, Height: 4}",
  );
});

test("shared components resolve URL-root bitmaps from the Astro entry public directory", async () => {
  await file("app/public/logo.png", bitmap());
  await file(
    "shared/Logo.tsx",
    `export function Logo() { return <img src="/logo.png" />; }`,
  );
  const entry = await file(
    "app/src/Page.tsx",
    `import {Logo} from '../../shared/Logo'; export function Page() { return <Logo />; }`,
  );
  const program = await compile(entry, undefined, { root: directory });
  expect(program.resources![0]!.path).toBe("app/public/logo.png");
});

test("changed bitmap bytes invalidate the captured source manifest", async () => {
  const asset = await file("public/logo.png", bitmap());
  const entry = await file(
    "Page.tsx",
    `export function Page() { return <img src="/logo.png" />; }`,
  );
  const first = await compile(entry);
  await writeFile(
    asset,
    bitmap(chunk("tEXt", Buffer.from("Comment\u0000Changed"))),
  );
  const second = await compile(entry);
  expect(sourceHash(second)).not.toBe(sourceHash(first));
  expect(second.resources![0]!.hash).not.toBe(first.resources![0]!.hash);
});

test("missing bitmaps fail at the original JSX source location", async () => {
  await mkdir(join(directory, "public"));
  const entry = await file(
    "Page.tsx",
    `export function Page() {\n  return <img src="/missing.png" />;\n}`,
  );
  await expect(compile(entry)).rejects.toThrow(
    "Page.tsx:2:10: Missing bitmap resource: /missing.png",
  );
});

test("URL sources, unsupported formats, dynamic sources and srcset are rejected", async () => {
  for (const [markup, diagnostic] of [
    [
      '<img src="https://example.com/logo.png" />',
      "literal local PNG/JPEG path",
    ],
    ['<img src="data:image/png;base64,AAAA" />', "literal local PNG/JPEG path"],
    ['<img src="/logo.svg" />', "PNG and JPEG"],
    ['<img src="/logo.png?cache=1" />', "without a URL, query"],
    ["<img src={props.src} />", "literal local PNG/JPEG path"],
    ['<img src="/logo.png" srcSet="/logo2.png 2x" />', "srcSet requires"],
  ]) {
    const entry = await file(
      "Page.tsx",
      `export function Page(props) { return ${markup}; }`,
    );
    await expect(compile(entry)).rejects.toThrow(diagnostic!);
  }
});

test("public paths cannot traverse or follow a symlink outside public", async () => {
  const source = await file("Page.tsx", "export const Page = () => <main />;");
  const outside = await file("outside.png", bitmap());
  await mkdir(join(directory, "public"));
  await symlink(outside, join(directory, "public", "linked.png"));
  await expect(
    loadBitmap("/../outside.png", source, directory),
  ).rejects.toThrow("escapes the public directory");
  await expect(loadBitmap("/linked.png", source, directory)).rejects.toThrow(
    "symlink points outside the public directory",
  );
});

test("bitmap extension mismatches and unsupported metadata are explicit diagnostics", async () => {
  const entry = await file("Page.tsx", "export const Page = () => <main />;");
  await file("public/logo.png", Buffer.from("not a png"));
  await expect(loadBitmap("/logo.png", entry, directory)).rejects.toThrow(
    "valid PNG header",
  );
  await file("public/logo.png", bitmap(chunk("acTL", Buffer.alloc(8))));
  await expect(loadBitmap("/logo.png", entry, directory)).rejects.toThrow(
    "Animated PNG",
  );
  await file("public/logo.png", bitmap(chunk("gAMA", Buffer.alloc(4))));
  await expect(loadBitmap("/logo.png", entry, directory)).rejects.toThrow(
    "color management",
  );
  await file("public/logo.png", bitmap(chunk("eXIf", Buffer.alloc(4))));
  await expect(loadBitmap("/logo.png", entry, directory)).rejects.toThrow(
    "native orientation",
  );
});

test("PNG accepts only 8-bit RGB/RGBA until native color conversions are certified", async () => {
  const entry = await file("Page.tsx", "export const Page = () => <main />;");
  for (const [depth, format] of [
    [16, 6],
    [8, 0],
    [8, 3],
    [8, 4],
  ]) {
    const bytes = bitmap();
    bytes[24] = depth!;
    bytes[25] = format!;
    await file("public/logo.png", bytes);
    await expect(loadBitmap("/logo.png", entry, directory)).rejects.toThrow(
      "8-bit RGB or RGBA",
    );
  }
});

test("native images reject object-fit and clipping unsupported by the renderer", async () => {
  await file("public/logo.png", bitmap());
  for (const style of [
    "objectFit:'cover'",
    "objectPosition:'left top'",
    "borderRadius:4",
    "paddingTop:2",
    "width:0",
  ]) {
    const entry = await file(
      "Page.tsx",
      `export function Page() { return <img src="/logo.png" style={{${style}}} />; }`,
    );
    const program = await compile(entry);
    expect(() =>
      emitGo(program, { name: "Page", packageName: "generated" }),
    ).toThrow();
  }
});

test("embedding rejects tampered resource content instead of a misleading source hash", async () => {
  await file("public/logo.png", bitmap());
  const entry = await file(
    "Page.tsx",
    `export function Page() { return <img src="/logo.png" />; }`,
  );
  const program = await compile(entry);
  program.resources![0]!.content = Buffer.from("tampered").toString("base64");
  expect(() =>
    emitGo(program, { name: "Page", packageName: "generated" }),
  ).toThrow("bitmap bytes do not match their SHA-256 digest");
});
