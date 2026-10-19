// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import {
  collectBrowserProvenance,
  verifyBrowserProvenance,
} from "./browser-provenance.ts";
import type {
  JavascriptArchive,
  JavascriptFrame,
} from "../src/javascript-types.ts";

type Step = { id: string; corner?: boolean; calls: number };
type Phase = {
  archives: JavascriptArchive[];
  calls: unknown[][];
};
declare global {
  interface Window {
    afyPointers: {
      ready(): boolean;
      calls(): unknown[][];
      clear(): void;
      export(): JavascriptArchive;
    };
  }
}

export function pointerArchiveState(archive: JavascriptArchive) {
  const byID = new Map<string, JavascriptFrame>(),
    parents = new Map<string, string>(),
    order: string[] = [];
  function walk(nodes: JavascriptFrame[], parent = "") {
    for (const node of nodes) {
      if (node.attrs?.id) {
        order.push(node.attrs.id);
        byID.set(node.attrs.id, node);
        parents.set(node.attrs.id, parent);
      }
      walk(node.children ?? [], node.attrs?.id ?? parent);
    }
  }
  walk(archive.frame ?? []);
  const text = (node: JavascriptFrame | undefined): string =>
    node?.tag === "#text"
      ? (node.text ?? "")
      : (node?.children ?? []).map(text).join("");
  return {
    order,
    count: text(byID.get("pointer-count")),
    checked: !!byID.get("pointer-check")?.checked,
    cancelled: !!byID.get("pointer-cancel")?.checked,
    input: byID.get("pointer-input")?.value,
    textarea: byID.get("pointer-textarea")?.value,
    movingParent: parents.get("pointer-moving"),
  };
}

export async function captureJavascriptPointers(base: string, out: string) {
  const scenario = JSON.parse(
      await readFile(join(out, "scenario.json"), "utf8"),
    ) as { prefix: Step[]; suffix: Step[]; follow: Step[] },
    native = JSON.parse(
      await readFile(join(out, "native-prepare.json"), "utf8"),
    ) as { prefix: Phase; suffix: Phase; follow: Phase };
  const browser = await chromium.launch({ headless: true }),
    records: unknown[] = [];
  try {
    const provenance = await collectBrowserProvenance(browser);
    await writeFile(
      join(out, "browser-provenance-before.json"),
      JSON.stringify(provenance, null, 2) + "\n",
    );
    async function mount(path: string) {
      const page = await browser.newPage({
          viewport: { width: 800, height: 1400 },
        }),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      assert.equal((await page.goto(new URL(path, base).href))?.ok(), true);
      await page.waitForFunction(() => !!window.afyPointers?.ready());
      await settle(page);
      await page.evaluate(() => {
        (window as any).afyPointerObjects = new Map(
          [...document.querySelectorAll('[id^="pointer-"]')].map((element) => [
            element.id,
            element,
          ]),
        );
      });
      return { page, errors };
    }
    async function settle(page: Page) {
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
    }
    async function state(page: Page) {
      return page.evaluate(() => {
        const refs = (window as any).afyPointerObjects as Map<string, Element>;
        for (const [id, node] of refs)
          if (document.getElementById(id) !== node)
            throw new Error(`Pointer interaction replaced ${id}`);
        return {
          order: [...document.querySelectorAll('[id^="pointer-"]')].map(
            (node) => node.id,
          ),
          count: document.getElementById("pointer-count")!.textContent,
          checked: (
            document.getElementById("pointer-check") as HTMLInputElement
          ).checked,
          cancelled: (
            document.getElementById("pointer-cancel") as HTMLInputElement
          ).checked,
          input: (document.getElementById("pointer-input") as HTMLInputElement)
            .value,
          textarea: (
            document.getElementById("pointer-textarea") as HTMLTextAreaElement
          ).value,
          movingParent:
            document.getElementById("pointer-moving")!.parentElement!.id,
        };
      });
    }
    async function perform(
      page: Page,
      label: string,
      steps: Step[],
      expected: Phase,
      managed: boolean,
    ) {
      await page.evaluate(() => window.afyPointers.clear());
      const states = [await state(page)],
        points: unknown[] = [];
      assert.deepEqual(states[0], pointerArchiveState(expected.archives[0]!));
      for (const [index, step] of steps.entries()) {
        const element = page.locator(`[id=${JSON.stringify(step.id)}]`),
          box = await element.boundingBox();
        assert.ok(box && box.width > 0 && box.height > 0);
        const point = {
          x: box.x + (step.corner ? 4 : box.width / 2),
          y: box.y + (step.corner ? 4 : box.height / 2),
        };
        const before = await page.evaluate(
          () => window.afyPointers.calls().length,
        );
        await page.mouse.click(point.x, point.y);
        await settle(page);
        await page.evaluate(() => {
          const active = document.activeElement;
          if (active instanceof HTMLElement) active.blur();
        });
        await settle(page);
        const effects = await page.evaluate(
          () => window.afyPointers.calls().length,
        );
        assert.equal(
          effects - before,
          step.calls,
          `${label}: ${step.id} effects`,
        );
        points.push({ id: step.id, box, point, effects: effects - before });
        states.push(await state(page));
        assert.deepEqual(
          states[index + 1],
          pointerArchiveState(expected.archives[index + 1]!),
          `${label}: ${step.id} native/browser state`,
        );
        if (managed) {
          const archive = await page.evaluate(() =>
            window.afyPointers.export(),
          );
          assert.deepEqual(
            archive.frame,
            expected.archives[index + 1]!.frame,
            `${label}: ${step.id} virtual frame`,
          );
          assert.deepEqual(
            archive.events,
            expected.archives[index + 1]!.events,
          );
          assert.deepEqual(
            archive.journal,
            expected.archives[index + 1]!.journal,
          );
        }
      }
      const calls = await page.evaluate(() => window.afyPointers.calls());
      assert.deepEqual(
        calls,
        expected.calls,
        `${label}: authored/native trace`,
      );
      const record = {
        label,
        states,
        points,
        calls,
        stableDOMObjects: states[0]!.order.length,
        actualCoordinateClicks: true,
      };
      records.push(record);
      return record;
    }
    const original = await mount("/javascript-pointer-roundtrip/original");
    await perform(
      original.page,
      "authored-prefix",
      scenario.prefix,
      native.prefix,
      false,
    );
    await perform(
      original.page,
      "authored-suffix",
      scenario.suffix,
      native.suffix,
      false,
    );
    await perform(
      original.page,
      "authored-follow",
      scenario.follow,
      native.follow,
      false,
    );
    assert.deepEqual(original.errors, []);
    await original.page.close();

    const managed = await mount("/javascript-pointer-roundtrip/restored");
    assert.deepEqual(
      await managed.page.evaluate(() => window.afyPointers.calls()),
      [],
      "hydration replayed effects",
    );
    await perform(
      managed.page,
      "generated-suffix",
      scenario.suffix,
      native.suffix,
      true,
    );
    const archive = await managed.page.evaluate(() =>
      window.afyPointers.export(),
    );
    await writeFile(
      join(out, "browser.javascript.json"),
      JSON.stringify(archive, null, 2) + "\n",
    );
    await perform(
      managed.page,
      "generated-follow",
      scenario.follow,
      native.follow,
      true,
    );
    assert.deepEqual(managed.errors, []);
    await managed.page.close();

    const rejections: { name: string; error: string }[] = [];
    for (const name of ["wrapper", "foreign"] as const) {
      const { page, errors } = await mount(
        "/javascript-pointer-roundtrip/restored",
      );
      const point = await page.evaluate((name) => {
        const wrapper = document.querySelector(
          "[data-afy-javascript]",
        ) as HTMLElement;
        wrapper.style.padding = "12px";
        if (name === "foreign") {
          const foreign = document.createElement("div");
          foreign.setAttribute(
            "data-afy-js",
            document
              .getElementById("pointer-root")!
              .getAttribute("data-afy-js")!,
          );
          foreign.style.height = "30px";
          wrapper.appendChild(foreign);
          const box = foreign.getBoundingClientRect();
          return { x: box.x + 4, y: box.y + 4 };
        }
        const box = wrapper.getBoundingClientRect();
        return { x: box.x + 4, y: box.y + 4 };
      }, name);
      await page.mouse.click(point.x, point.y);
      await settle(page);
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /root pointer adapter/);
      assert.deepEqual(
        await page.evaluate(() => window.afyPointers.calls()),
        [],
      );
      const exportRejected = await page.evaluate(() => {
        try {
          window.afyPointers.export();
          return false;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.includes("root pointer adapter")
          )
            throw error;
          return true;
        }
      });
      assert.equal(exportRejected, true, "pointer-faulted DOM was exported");
      rejections.push({ name, error: errors[0]! });
      await page.close();
    }
    const verified = await verifyBrowserProvenance(browser, provenance);
    await writeFile(
      join(out, "browser-provenance-after.json"),
      JSON.stringify(verified, null, 2) + "\n",
    );
    await writeFile(
      join(out, "browser.json"),
      JSON.stringify(
        {
          schema: 1,
          records,
          rejections,
          browserProvenanceHash: verified.hash,
          pixelPerfectVerified: false,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await browser.close();
  }
}
