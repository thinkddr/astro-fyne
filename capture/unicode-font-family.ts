// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import {
  collectBrowserProvenance,
  verifyBrowserProvenance,
} from "./browser-provenance.ts";
import type { checkUnicodeFontFamilies } from "./unicode-font-family-check.ts";

const root = resolve(import.meta.dir, ".."),
  hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

async function json(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Unicode browser comparison timed out")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function captureUnicodeFontFamilies(output: string) {
  const entry = join(output, "browser-entry.ts");
  await writeFile(
    entry,
    'import {checkUnicodeFontFamilies} from "../../capture/unicode-font-family-check.ts";\n' +
      "Object.assign(globalThis,{afyUnicodeFontFamilyCheck:checkUnicodeFontFamilies});\n",
  );
  const built = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
  });
  await json(join(output, "browser-build.json"), {
    success: built.success,
    logs: built.logs.map((log) => ({ level: log.level, message: log.message })),
    entry: "browser-entry.ts",
    target: "browser",
    format: "esm",
  });
  assert.ok(built.success, "Unicode browser bundle failed");
  assert.equal(
    built.outputs.length,
    1,
    "expected one self-contained browser bundle",
  );
  const bundle = new Uint8Array(await built.outputs[0]!.arrayBuffer());
  await writeFile(join(output, "browser-policy.js"), bundle);
  const routes = new Map<string, { bytes: Uint8Array; mediaType: string }>([
    ["/policy.js", { bytes: bundle, mediaType: "text/javascript" }],
    [
      "/reference.json",
      {
        bytes: await readFile(join(output, "go-reference.json")),
        mediaType: "application/json",
      },
    ],
    [
      "/UnicodeData.txt",
      {
        bytes: await readFile(
          join(root, "third_party/unicode17/UnicodeData.txt"),
        ),
        mediaType: "text/plain; charset=utf-8",
      },
    ],
    [
      "/CaseFolding.txt",
      {
        bytes: await readFile(
          join(root, "third_party/unicode17/CaseFolding.txt"),
        ),
        mediaType: "text/plain; charset=utf-8",
      },
    ],
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname,
        route = routes.get(path);
      if (route)
        return new Response(new Uint8Array(route.bytes), {
          headers: {
            "Content-Type": route.mediaType,
            "Cache-Control": "no-store",
          },
        });
      if (path !== "/") return new Response("Not found", { status: 404 });
      return new Response(
        '<!doctype html><html><body><script type="module" src="/policy.js"></script></body></html>',
        {
          headers: {
            "Content-Type": "text/html",
            "Content-Security-Policy":
              "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'",
          },
        },
      );
    },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const errors: string[] = [];
  try {
    browser = await chromium.launch({ headless: true, timeout: 30_000 });
    const before = await collectBrowserProvenance(browser);
    await json(join(output, "browser-provenance-before.json"), before);
    const page = await browser.newPage(),
      responses: Promise<{
        path: string;
        status: number;
        bytes: number;
        hash: string;
      } | null>[] = [];
    page.setDefaultTimeout(30_000);
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (!routes.has(path)) return;
      responses.push(
        response.body().then(
          (bytes) => ({
            path,
            status: response.status(),
            bytes: bytes.length,
            hash: hash(bytes),
          }),
          (error) => {
            errors.push(String(error));
            return null;
          },
        ),
      );
    });
    await page.goto(server.url.href, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(
      () =>
        typeof (globalThis as unknown as { afyUnicodeFontFamilyCheck: unknown })
          .afyUnicodeFontFamilyCheck === "function",
    );
    const observed = await bounded(
      page.evaluate(async () => {
        const sources = await Promise.all(
          ["/reference.json", "/UnicodeData.txt", "/CaseFolding.txt"].map(
            async (path) => {
              const response = await fetch(path);
              if (!response.ok)
                throw new Error("Missing Unicode input: " + path);
              const bytes = new Uint8Array(await response.arrayBuffer()),
                digest = new Uint8Array(
                  await crypto.subtle.digest("SHA-256", bytes),
                );
              return {
                path,
                bytes: bytes.length,
                hash: [...digest]
                  .map((byte) => byte.toString(16).padStart(2, "0"))
                  .join(""),
                text: new TextDecoder("utf-8", {
                  fatal: true,
                  ignoreBOM: true,
                }).decode(bytes),
              };
            },
          ),
        );
        const checker = (
          globalThis as unknown as {
            afyUnicodeFontFamilyCheck: typeof checkUnicodeFontFamilies;
          }
        ).afyUnicodeFontFamilyCheck;
        return {
          result: checker(
            JSON.parse(sources[0]!.text),
            sources[1]!.text,
            sources[2]!.text,
          ),
          inputs: sources.map(({ text: _text, ...receipt }) => receipt),
        };
      }),
      180_000,
    );
    await json(join(output, "chromium-comparison.json"), observed);
    const received = (await Promise.all(responses)).filter(
      (row) => row !== null,
    );
    assert.equal(
      received.length,
      routes.size,
      "each actual browser input response must be retained once",
    );
    for (const [path, route] of routes) {
      const matches = received.filter((row) => row.path === path);
      assert.equal(matches.length, 1, "duplicate or absent browser input");
      assert.deepEqual(matches[0], {
        path,
        status: 200,
        bytes: route.bytes.length,
        hash: hash(route.bytes),
      });
    }
    for (const row of observed.inputs) {
      const expected = routes.get(row.path)!;
      assert.equal(row.hash, hash(expected.bytes));
      assert.equal(row.bytes, expected.bytes.length);
    }
    const after = await verifyBrowserProvenance(browser, before);
    await json(join(output, "browser-provenance-after.json"), after);
    await json(join(output, "browser.json"), {
      schema: 1,
      accepted: observed.result.accepted && errors.length === 0,
      browserVersion: browser.version(),
      processProvenanceHash: before.hash,
      sameBrowserProcessVerified: true,
      bundle: {
        file: "browser-policy.js",
        bytes: bundle.length,
        hash: hash(bundle),
      },
      responses: received,
      inputs: observed.inputs,
      comparison: observed.result,
      errors,
      renderingChecked: false,
      pixelPerfectVerified: false,
      fallbackFreeRenderingVerified: false,
      effectiveFontPolicyObserved: false,
    });
    assert.ok(
      observed.result.accepted,
      "Chromium Unicode policy differs; retained comparison JSON",
    );
    assert.deepEqual(errors, []);
    return observed.result;
  } catch (error) {
    await json(join(output, "browser-failure.json"), {
      schema: 1,
      accepted: false,
      error: String(error),
      errors,
      renderingChecked: false,
      pixelPerfectVerified: false,
    });
    throw error;
  } finally {
    try {
      await browser?.close();
    } finally {
      await server.stop(true);
    }
  }
}
