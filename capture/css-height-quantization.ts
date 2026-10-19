// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "playwright";

const chromiumSourceCommit = "971a7443b0c9b0a9b2860529b33331b76077ec62";
const viewport = { width: 320, height: 240 };
const elementIds = [
  "quantization-root",
  "quantization-panel",
  "quantization-sibling-0",
  "quantization-sibling-1",
  "quantization-sibling-2",
];
type ProbeCase = {
  id: string;
  height: string;
  animation?: { from: string; to: string; easing: string };
  times: number[];
};
const cases: ProbeCase[] = [
  ...["20.0156249", "20.015625", "20.0156251"].map((height, index) => ({
    id: `static-sixty-fourth-${index}`,
    height,
    times: [0],
  })),
  ...["20.0078124", "20.0078125", "20.0078126"].map((height, index) => ({
    id: `static-one-hundred-twenty-eighth-${index}`,
    height,
    times: [0],
  })),
  {
    id: "linear-decimal-endpoints",
    height: "20.01",
    animation: { from: "20.01", to: "20.02", easing: "linear" },
    times: [0, 250, 500, 750, 1000],
  },
  {
    id: "bezier-symmetric-boundary",
    height: "20",
    animation: {
      from: "20",
      to: "20.03125",
      easing: "cubic-bezier(.42,0,.58,1)",
    },
    times: [0, 250, 499.9999, 500, 500.0001, 750, 1000],
  },
  {
    id: "bezier-asymmetric-decimal-endpoints",
    height: "20.01",
    animation: {
      from: "20.01",
      to: "20.02",
      easing: "cubic-bezier(.25,.1,.25,1)",
    },
    times: [0, 250, 499.9999, 500, 500.0001, 750, 1000],
  },
];
const digest = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

function source(item: ProbeCase) {
  const animation = item.animation;
  const css = `html,body{margin:0;padding:0;border:0;background:#ffffff;}
main,section{display:block;margin:0;padding:0;border:0;}
#quantization-root{background:#ffffff;}
#quantization-panel{height:${item.height}px;background:#2468ac;${animation ? `animation:quantization-height 1000ms ${animation.easing} 0ms 1 normal both;` : ""}}
#quantization-sibling-0{height:20.01px;background:#c65432;}
#quantization-sibling-1{height:20.02px;background:#5d932c;}
#quantization-sibling-2{height:20.0156249px;background:#8e5ab8;}
${animation ? `@keyframes quantization-height{from{height:${animation.from}px;}to{height:${animation.to}px;}}\n` : ""}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${item.id}</title><style id="quantization-source">${css}</style></head>
<body><main id="quantization-root"><section id="quantization-panel"></section><section id="quantization-sibling-0"></section><section id="quantization-sibling-1"></section><section id="quantization-sibling-2"></section></main></body></html>
`;
  return { css, html };
}

function finiteObservation(value: unknown, path = "observation"): void {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must remain finite`);
    return;
  }
  if (value && typeof value === "object")
    for (const [name, child] of Object.entries(value))
      finiteObservation(child, `${path}.${name}`);
}

async function prepare(page: Page, animated: boolean, css: string) {
  await page.evaluate(
    async ({ animated, css }) => {
      if (document.getElementById("quantization-source")?.textContent !== css)
        throw new Error("Quantization probe changed its authored CSS bytes");
      const panel = document.getElementById("quantization-panel");
      if (!panel) throw new Error("Missing quantization panel");
      const animations = panel.getAnimations();
      if (animations.length !== (animated ? 1 : 0))
        throw new Error("Unexpected authored CSS animation inventory");
      if (animated) {
        const animation = animations[0];
        if (
          !(animation instanceof CSSAnimation) ||
          animation.animationName !== "quantization-height" ||
          !(animation.effect instanceof KeyframeEffect) ||
          animation.effect.target !== panel
        )
          throw new Error("Probe requires the authored CSSAnimation");
        animation.pause();
        await animation.ready;
        animation.currentTime = 0;
      }
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
    },
    { animated, css },
  );
}

async function observe(page: Page, timeMs: number, animated: boolean) {
  return page.evaluate(
    async ({ ids, timeMs, animated }) => {
      const panel = document.getElementById("quantization-panel");
      if (!panel) throw new Error("Missing quantization panel");
      const animations = panel.getAnimations();
      if (animations.length !== (animated ? 1 : 0))
        throw new Error("Authored animation inventory changed during capture");
      const animation = animations[0];
      if (animated) {
        if (!(animation instanceof CSSAnimation))
          throw new Error("Probe lost its authored CSSAnimation");
        animation.currentTime = timeMs;
      }
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
      if (
        animated &&
        (typeof animation?.currentTime !== "number" ||
          !Number.isFinite(animation.currentTime) ||
          animation.playState !== "paused")
      )
        throw new Error("CSS animation has no finite paused sample time");
      const nodes = Object.fromEntries(
        ids.map((id) => {
          const node = document.getElementById(id);
          if (!node) throw new Error(`Missing quantization node ${id}`);
          const rect = node.getBoundingClientRect();
          const css = getComputedStyle(node);
          return [
            id,
            {
              tag: node.localName,
              childElementCount: node.childElementCount,
              rect: {
                x: rect.x,
                y: rect.y,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left,
                width: rect.width,
                height: rect.height,
              },
              computed: {
                height: css.height,
                width: css.width,
                display: css.display,
                boxSizing: css.boxSizing,
                position: css.position,
                zoom: css.zoom,
                transform: css.transform,
                marginTop: css.marginTop,
                marginBottom: css.marginBottom,
                paddingTop: css.paddingTop,
                paddingBottom: css.paddingBottom,
                borderTopWidth: css.borderTopWidth,
                borderBottomWidth: css.borderBottomWidth,
                animationName: css.animationName,
                animationDuration: css.animationDuration,
                animationDelay: css.animationDelay,
                animationIterationCount: css.animationIterationCount,
                animationDirection: css.animationDirection,
                animationFillMode: css.animationFillMode,
                animationTimingFunction: css.animationTimingFunction,
                animationPlayState: css.animationPlayState,
              },
            },
          ];
        }),
      );
      const timing = animation?.effect?.getComputedTiming();
      const declared = animation?.effect?.getTiming();
      const visual = window.visualViewport;
      return {
        requestedTimeMs: timeMs,
        devicePixelRatio: window.devicePixelRatio,
        userAgent: navigator.userAgent,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        visualViewport: visual
          ? {
              width: visual.width,
              height: visual.height,
              scale: visual.scale,
              offsetLeft: visual.offsetLeft,
              offsetTop: visual.offsetTop,
              pageLeft: visual.pageLeft,
              pageTop: visual.pageTop,
            }
          : null,
        nodes,
        animation: animation
          ? {
              kind: animation.constructor.name,
              name: (animation as CSSAnimation).animationName,
              playState: animation.playState,
              pending: animation.pending,
              replaceState: animation.replaceState,
              currentTime: animation.currentTime,
              startTime: animation.startTime,
              timelineTime: animation.timeline?.currentTime ?? null,
              declared: declared
                ? {
                    delay: declared.delay,
                    endDelay: declared.endDelay,
                    fill: declared.fill,
                    iterationStart: declared.iterationStart,
                    iterations: declared.iterations,
                    duration: declared.duration,
                    direction: declared.direction,
                    easing: declared.easing,
                  }
                : null,
              computed: timing
                ? {
                    endTime: timing.endTime,
                    activeDuration: timing.activeDuration,
                    localTime: timing.localTime,
                    progress: timing.progress,
                    currentIteration: timing.currentIteration,
                    duration: timing.duration,
                  }
                : null,
              keyframes:
                animation.effect instanceof KeyframeEffect
                  ? animation.effect.getKeyframes()
                  : null,
            }
          : null,
      };
    },
    { ids: elementIds, timeMs, animated },
  );
}

/** Observe browser behavior without choosing a converter quantization rule. */
export async function captureCSSHeightQuantization(
  browser: Browser,
  out: string,
): Promise<void> {
  const directory = join(out, "css-height-quantization");
  await mkdir(directory, { recursive: true });
  const sources = [];
  for (const item of cases) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(item.times.length > 0);
    let previous = -1;
    for (const time of item.times) {
      assert.ok(
        Number.isFinite(time) && time >= 0 && time >= previous && time <= 1000,
      );
      previous = time;
    }
    const { css, html } = source(item);
    await writeFile(join(directory, `${item.id}.css`), css);
    await writeFile(join(directory, `${item.id}.html`), html);
    sources.push({
      ...item,
      css: {
        file: `${item.id}.css`,
        bytes: Buffer.byteLength(css),
        sha256: digest(css),
      },
      html: {
        file: `${item.id}.html`,
        bytes: Buffer.byteLength(html),
        sha256: digest(html),
      },
    });
  }
  const observations = [];
  for (const deviceScaleFactor of [1, 2]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor,
      colorScheme: "light",
      reducedMotion: "no-preference",
    });
    try {
      for (const item of cases) {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          const { css, html } = source(item);
          await page.setContent(html, { waitUntil: "load" });
          await prepare(page, !!item.animation, css);
          const samples = [];
          for (const [index, timeMs] of item.times.entries()) {
            const value = await observe(page, timeMs, !!item.animation);
            finiteObservation(value);
            assert.ok(value.devicePixelRatio > 0);
            assert.ok(value.visualViewport && value.visualViewport.scale > 0);
            const file = `${item.id}-dpr${deviceScaleFactor}-${index}.png`;
            const png = await page.screenshot({ path: join(directory, file) });
            assert.ok(png.byteLength >= 24);
            assert.ok(
              png
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
            );
            samples.push({
              ...value,
              image: {
                file,
                bytes: png.byteLength,
                sha256: digest(png),
                width: png.readUInt32BE(16),
                height: png.readUInt32BE(20),
              },
            });
          }
          assert.equal(samples.length, item.times.length);
          assert.deepEqual(errors, []);
          observations.push({
            id: item.id,
            requestedDeviceScaleFactor: deviceScaleFactor,
            samples,
          });
        } finally {
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
  }
  assert.equal(observations.length, cases.length * 2);
  const module = await readFile(new URL(import.meta.url));
  await writeFile(
    join(directory, "observations.json"),
    JSON.stringify(
      {
        schema: 1,
        kind: "astro-fyne-css-height-quantization-diagnostic",
        diagnostic: true,
        verified: false,
        pixelPerfectVerified: false,
        universalCSSVerified: false,
        quantizerSelected: false,
        chromiumSourceCommit,
        sourcePinPurpose:
          "Research reference; verify the browser revision against the hosted browser metadata.",
        browserVersion: browser.version(),
        viewport,
        probeSource: {
          file: "capture/css-height-quantization.ts",
          sha256: digest(module),
        },
        sources,
        observations,
        limitations: [
          "Source-derived quantization and zoom hypotheses are not asserted by this probe.",
          "These are authored CSS browser observations without a native comparison.",
          "Reported pixels and timing do not certify converter parity or a general sizing rule.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
}
