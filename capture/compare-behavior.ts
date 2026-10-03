// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
const [browserPath, nativePath] = process.argv.slice(2);
if (!browserPath || !nativePath)
  throw new Error("Usage: compare-behavior.ts BROWSER.json NATIVE.json");
const browser = JSON.parse(await readFile(browserPath, "utf8"));
const native = JSON.parse(await readFile(nativePath, "utf8"));
if (!isDeepStrictEqual(browser, native)) {
  process.stderr.write(
    `Browser trace:\n${JSON.stringify(browser, null, 2)}\nNative trace:\n${JSON.stringify(native, null, 2)}\n`,
  );
  throw new Error("Browser and generated native behavior differ");
}
process.stdout.write(
  JSON.stringify({ schema: 1, exact: true, frames: browser.frames.length }) +
    "\n",
);
