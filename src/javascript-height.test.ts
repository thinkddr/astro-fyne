// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleJavascript, validateJavascriptArchive } from "./javascript.ts";
import { compileJavascriptCSS } from "./javascript-css.ts";
import { createMotionSampler, type MotionSpec } from "./motion.ts";
import type { JavascriptAPI, JavascriptArchive } from "./javascript-types.ts";

const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);
const source = join(
  import.meta.dir,
  "../example/src/components/JavascriptCSSHeight.tsx",
);
function mount(
  archive: JavascriptArchive,
  calls: unknown[][] = [],
): JavascriptAPI {
  const factory = eval("(" + archive.code + ")");
  const api = factory((kind: string, name: string, args: string) => {
    if (kind === "now") return 1000;
    if (kind === "random") return 0.25;
    if (kind !== "action") throw new Error("Unexpected host boundary");
    calls.push([name, ...JSON.parse(args)]);
    return null;
  }, archive) as JavascriptAPI;
  api.flush();
  for (const event of archive.events) {
    api.replay(event);
    api.flush();
  }
  api.finishReplay();
  return api;
}
const height = (api: JavascriptAPI) =>
  Number(
    String(api.snapshot()[0]!.children![0]!.style!.height).replace(/px$/, ""),
  );
const frames = "@keyframes grow{from{height:20px}to{height:100px}}";
async function documentCSS(
  css: string,
  use: (doc: any, root: any, panel: any, sibling: any) => void,
) {
  const dir = await mkdtemp(join(tmpdir(), "afy-height-css-"));
  try {
    const path = join(dir, "style.css");
    await writeFile(path, css);
    const packet = await compileJavascriptCSS(path, () => {}),
      doc = createDocument();
    doc.installCSS(packet);
    const root = doc.document.createElement("main"),
      panel = doc.document.createElement("section"),
      sibling = doc.document.createElement("section");
    root.id = "root";
    panel.id = "panel";
    sibling.id = "sibling";
    root.appendChild(panel);
    root.appendChild(sibling);
    doc.root.appendChild(root);
    use(doc, root, panel, sibling);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("source CSS height uses a per-instance schema2 timeline and exact checkpoint continuation", async () => {
  const archive = await bundleJavascript(source);
  expect(archive.schema).toBe(2);
  expect(archive.animation).toEqual({
    schema: 1,
    timeMs: 0,
    playState: "running",
  });
  const api = mount(archive),
    other = mount(archive),
    times = [0, 100, 350, 600, 1100, 1350, 1600, 2100],
    values = [20, 20, 40, 60, 100, 80, 60, 20];
  let checkpoint: JavascriptArchive | undefined;
  times.forEach((time, index) => {
    api.advanceAnimations!(time);
    expect(height(api)).toBeCloseTo(values[index]!, 8);
    if (time === 350) checkpoint = api.export();
  });
  expect(api.animationState!().playState).toBe("finished");
  const downgraded = { ...archive, schema: 1 as const };
  delete downgraded.animation;
  expect(() => mount(downgraded)).toThrow(/compiled animation ABI/);
  expect(other.animationState!().timeMs).toBe(0);
  const restored = mount(await validateJavascriptArchive(checkpoint!));
  expect(height(restored)).toBeCloseTo(40, 8);
  restored.advanceAnimations!(600);
  expect(height(restored)).toBeCloseTo(60, 8);
  expect(api.animationState!().timeMs).toBe(2100);
  expect(restored.export().stylesheets).toEqual(archive.stylesheets);
  expect(() =>
    mount({
      ...checkpoint!,
      animation: { ...checkpoint!.animation!, playState: "finished" },
    }),
  ).toThrow("end time");
  for (const invalid of [NaN, Infinity, -1, 599, 1e12 + 1])
    expect(() => restored.advanceAnimations!(invalid)).toThrow(/monotonically/);
  expect(restored.export().animation!.timeMs).toBe(600);
  restored.advanceAnimations!(700);
  expect(height(restored)).toBeCloseTo(68, 8);
}, 60_000);
test("paused checkpoints retain a sampled frame and explicit seeks while play resumes independently", async () => {
  const api = mount(await bundleJavascript(source));
  api.advanceAnimations!(350);
  api.pauseAnimations!();
  const paused = api.export(),
    copy = mount(paused);
  expect(copy.animationState!().playState).toBe("paused");
  copy.advanceAnimations!(600);
  expect(copy.animationState!().playState).toBe("paused");
  expect(height(copy)).toBeCloseTo(60, 8);
  copy.playAnimations!();
  expect(copy.animationState!().playState).toBe("running");
  expect(api.animationState!().timeMs).toBe(350);
}, 60_000);
test("explicit pointer events record monotonic CSS time and replay the identical frame", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afy-height-events-"));
  try {
    const css =
      "\ufeff#panel{height:20px;animation:grow 1000ms linear both}\r\n#sibling{height:24px}\r\n" +
      frames +
      "\r\n";
    await writeFile(join(dir, "style.css"), css);
    await writeFile(
      join(dir, "Panel.tsx"),
      'import "./style.css";export default function Panel(){return <main><section id="panel"/><section id="sibling"/></main>}',
    );
    const archive = await bundleJavascript(join(dir, "Panel.tsx")),
      api = mount(archive);
    expect(archive.stylesheets![0]!.text).toBe(css);
    api.advanceAnimations!(250);
    api.dispatch({ node: api.snapshot()[0]!.children![0]!.uid, type: "click" });
    api.flush();
    const saved = api.export();
    expect(saved.events[0]!.timeMs).toBe(250);
    const restored = mount(await validateJavascriptArchive(saved));
    expect(height(restored)).toBeCloseTo(40, 8);
    expect(restored.export().frame).toEqual(saved.frame);
    for (const timeMs of [undefined, null, -1, 251])
      await expect(
        validateJavascriptArchive({
          ...saved,
          events: [{ ...saved.events[0], timeMs }],
        }),
      ).rejects.toThrow(/event|time/);
    await expect(
      validateJavascriptArchive({
        ...saved,
        events: [
          { ...saved.events[0], timeMs: 250 },
          { ...saved.events[0], timeMs: 249 },
        ],
      }),
    ).rejects.toThrow(/event|time/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
test("nonanimated archives keep schema1 without timeline fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afy-height-legacy-"));
  try {
    await writeFile(
      join(dir, "Static.tsx"),
      "export default function Static(){return <div/>}",
    );
    const archive = await bundleJavascript(join(dir, "Static.tsx"));
    expect(archive.schema).toBe(1);
    expect(Object.hasOwn(archive, "animation")).toBe(false);
    expect(Object.hasOwn(mount(archive), "advanceAnimations")).toBe(false);
    expect(() =>
      mount({
        ...archive,
        schema: 2,
        animation: { schema: 1, timeMs: 0, playState: "running" },
      }),
    ).toThrow(/compiled animation ABI/);
    await expect(
      validateJavascriptArchive({ ...archive, animation: null }),
    ).rejects.toThrow(/animation|schema/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
test("CSS height cascade retains duplicate endpoints and normal important declarations", async () => {
  await documentCSS(
    "#panel{height:12px;animation:grow 1000ms linear both}#sibling{height:24px}@keyframes grow{0%,50%{height:20px}50%{height:70px}to{height:100px}}",
    (doc) => {
      doc.snapshot();
      doc.advanceAnimations(500);
      expect(doc.snapshot()[0].children[0].style.height).toBe("70px");
      doc.advanceAnimations(750);
      expect(doc.snapshot()[0].children[0].style.height).toBe("85px");
    },
  );
  await documentCSS(
    "#panel{height:12px!important;animation:grow 1000ms linear both}#sibling{height:24px}@keyframes grow{0%,50%{height:20px}50%{height:60px}to{height:100px}}",
    (doc) => {
      doc.snapshot();
      doc.advanceAnimations(500);
      expect(doc.snapshot()[0].children[0].style.height).toBe("12px");
    },
  );
  await documentCSS(
    "#panel{height:12px;animation:grow 1000ms linear both}#sibling{height:24px}" +
      frames,
    (doc) => {
      doc.snapshot();
      doc.advanceAnimations(500);
      expect(doc.snapshot()[0].children[0].style.height).toBe("60px");
    },
  );
  await documentCSS(
    "#panel{height:12px;animation-name:NONE}#sibling{height:24px}",
    (doc) => {
      expect(doc.snapshot()[0].children[0].style.height).toBe("12px");
    },
  );
});
test("CSS height compiler diagnoses unsupported grammar instead of dropping motion", async () => {
  for (const css of [
    "@keyframes grow{50%{height:20px}to{height:100px}}",
    "@keyframes grow{from{height:0px}to{height:100px}}",
    "@keyframes grow{from{height:1e-50px}to{height:100px}}",
    "@keyframes grow{from{height:20px}to{height:1000001px}}",
    "@keyframes grow{from{height:20%}to{height:100px}}",
    "@keyframes grow{from{height:auto}to{height:100px}}",
    "@keyframes grow{from{height:20px;opacity:.5}to{height:100px}}",
    "@keyframes grow{from{height:20px!important}to{height:100px}}",
    "@keyframes grow{from{height:20px;animation-timing-function:linear}to{height:100px}}",
    "#panel{animation:grow 1s infinite}" + frames,
    "#panel{animation:grow 1s,other 1s}" + frames,
    "#panel{animation:grow 1s steps(2)}" + frames,
    "#panel{animation:grow 1s cubic-bezier(.2,-1,.8,2)}" + frames,
    "#panel{animation:grow 1s paused}" + frames,
    "#panel{animation-timeline:scroll()}" + frames,
    "@layer layer{@keyframes grow{from{height:20px}to{height:100px}}}",
  ])
    await expect(documentCSS(css, () => {})).rejects.toThrow(
      /CSS height|adapter/,
    );
});
test("animation shorthand gives iteration and timing keywords precedence over matching keyframe names", async () => {
  for (const keyword of ["infinite", "step-start", "step-end"]) {
    const namedFrames = frames.replace("grow", keyword);
    await expect(
      documentCSS(
        `#panel{height:20px;animation:${keyword} 1s}#sibling{height:24px}` +
          namedFrames,
        () => {},
      ),
    ).rejects.toThrow(
      keyword === "infinite" ? /infinite repetition/ : /timing/,
    );
    await documentCSS(
      `#panel{height:20px;animation-name:${keyword};animation-duration:1s;animation-timing-function:linear;animation-fill-mode:both}#sibling{height:24px}` +
        namedFrames,
      (doc) => {
        doc.snapshot();
        doc.advanceAnimations(500);
        expect(doc.snapshot()[0].children[0].style.height).toBe("60px");
      },
    );
    await documentCSS(
      `#panel{height:20px;animation:1s linear ${keyword === "infinite" ? "2 " : ""}${keyword} both}#sibling{height:24px}` +
        namedFrames,
      (doc) => {
        doc.snapshot();
        doc.advanceAnimations(500);
        expect(doc.snapshot()[0].children[0].style.height).toBe("60px");
      },
    );
  }
});
test("CSS height runtime rejects incompatible layout and target changes before exporting another frame", async () => {
  for (const extra of [
    "#root{width:300px}",
    "#root{padding:1px}",
    "#root{display:flex}",
    "#panel{margin:1px}",
    "#panel{width:10px}",
    "#sibling{padding:1px}",
    "body{padding:10px}",
    "#astro-fyne-root{height:10px}",
    "html{background:red}",
    "#sibling{height:1000000px}",
  ])
    await expect(
      documentCSS(
        "#panel{height:20px;animation:grow 1s linear both}#sibling{height:24px}" +
          frames +
          extra,
        (doc) => doc.snapshot(),
      ),
    ).rejects.toThrow(/CSS height/);
  await documentCSS(
    "#panel{height:20px;animation:grow 1s linear both}#sibling{height:24px}" +
      frames,
    (doc, _root, panel) => {
      doc.snapshot();
      panel.style.height = "30px";
      expect(() => doc.snapshot()).toThrow(/remount/);
    },
  );
  await documentCSS(
    "#panel{height:20px}#panel.active{animation:grow 1s linear both}#sibling{height:24px}" +
      frames,
    (doc, _root, panel) => {
      doc.snapshot();
      panel.className = "active";
      expect(() => doc.snapshot()).toThrow(/remount/);
    },
  );
  await documentCSS(
    "#panel{height:20px;animation:grow 1s linear both}#sibling{height:24px}" +
      frames,
    (doc, root) => {
      doc.snapshot();
      root.appendChild(doc.document.createElement("section"));
      expect(() => doc.snapshot()).toThrow(/CSS height/);
    },
  );
  await documentCSS(
    "#panel{height:20px;animation:grow 1s linear both}#sibling{height:24px}" +
      frames,
    (doc, _root, _panel, sibling) => {
      doc.snapshot();
      sibling.style.height = "25px";
      expect(() => doc.snapshot()).toThrow(/remount/);
    },
  );
  await documentCSS(
    "#panel{height:20px;animation:grow 1s linear both}#sibling{height:24px}" +
      frames,
    (doc, _root, panel) => {
      panel.addEventListener("click", () => {});
      expect(() => doc.snapshot()).toThrow(/container event adapter/);
    },
  );
});
test("shared motion sampling preserves delay, interval easing and all four direction goldens", () => {
  const goldens = {
    normal: [20, 20, 40, 60, 20, 60, 100],
    reverse: [100, 100, 80, 60, 100, 60, 20],
    alternate: [20, 20, 40, 60, 100, 60, 20],
    "alternate-reverse": [100, 100, 80, 60, 20, 60, 100],
  };
  for (const direction of [
    "normal",
    "reverse",
    "alternate",
    "alternate-reverse",
  ] as const) {
    const spec: MotionSpec = {
      schema: 1,
      id: "height",
      tracks: [
        {
          id: "panel",
          target: "panel",
          property: "height",
          keyframes: [
            { offset: 0, value: 20 },
            { offset: 0.5, value: 60 },
            { offset: 1, value: 100 },
          ],
        },
      ],
      timing: {
        durationMs: 1000,
        delayMs: 100,
        iterations: 2,
        direction,
        fill: "both",
        easing: { kind: "cubic-bezier", points: [0.42, 0, 0.58, 1] },
      },
    };
    const sample = createMotionSampler(spec);
    for (const [index, time] of [0, 100, 350, 600, 1100, 1600, 2100].entries())
      expect(sample(time).values[0]!.value).toBeCloseTo(
        goldens[direction][index]!,
        8,
      );
  }
});
