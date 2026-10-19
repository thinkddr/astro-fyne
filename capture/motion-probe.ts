// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { createWebMotionController } from "../src/motion-web.ts";
import type { MotionSpec, MotionSample, MotionState } from "../src/motion.ts";

export type Geometry = { x: number; y: number; width: number; height: number };
export interface MotionProbeCase {
  name: string;
  spec: MotionSpec;
  targets: Record<string, Geometry>;
  samples: {
    timeMs: number;
    sample: MotionSample;
    geometry: Record<string, Geometry>;
  }[];
  controls: {
    operation: string;
    advanceMs: number;
    value?: number;
    restoreState?: MotionState;
    state: MotionState;
    sample: MotionSample;
    geometry: Record<string, Geometry>;
  }[];
}

const settle = () =>
  new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  );
function mount(item: MotionProbeCase) {
  const stage = document.createElement("div");
  stage.style.cssText =
    "position:absolute;left:0;top:0;width:1024px;height:768px;margin:0;padding:0;border:0";
  const targets = new Map<string, HTMLElement>();
  for (const [id, g] of Object.entries(item.targets)) {
    const element = document.createElement("div");
    element.dataset.target = id;
    element.style.cssText = `position:absolute;box-sizing:border-box;left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px;margin:0;padding:0;border:0;min-width:0;min-height:0;max-width:none;max-height:none`;
    stage.appendChild(element);
    targets.set(id, element);
  }
  document.body.appendChild(stage);
  return { stage, targets };
}
function geometry(targets: Map<string, HTMLElement>) {
  return Object.fromEntries(
    [...targets].map(([id, element]) => {
      const css = getComputedStyle(element);
      return [
        id,
        {
          x: Number.parseFloat(css.left),
          y: Number.parseFloat(css.top),
          width: Number.parseFloat(css.width),
          height: Number.parseFloat(css.height),
        },
      ];
    }),
  );
}

async function runCase(item: MotionProbeCase) {
  const { stage, targets } = mount(item);
  let now = 0;
  const controller = await createWebMotionController(item.spec, targets, {
    ownGeometry: true,
    now: () => now,
  });
  const samples = [],
    controls = [];
  try {
    for (const sample of item.samples) {
      controller.seek(sample.timeMs);
      await settle();
      samples.push({
        timeMs: sample.timeMs,
        sample: controller.sample(),
        geometry: geometry(targets),
      });
    }
    controller.cancel();
    for (const step of item.controls) {
      now += step.advanceMs;
      switch (step.operation) {
        case "play":
          controller.play();
          break;
        case "tick":
          controller.tick();
          break;
        case "pause":
          controller.pause();
          break;
        case "rate":
          controller.setPlaybackRate(step.value!);
          break;
        case "reverse":
          controller.reverse();
          break;
        case "seek":
          controller.seek(step.value!);
          break;
        case "finish":
          controller.finish();
          break;
        case "cancel":
          controller.cancel();
          break;
        case "restore":
          controller.restoreState(step.restoreState);
          break;
        default:
          throw new Error(`Unsupported control operation ${step.operation}`);
      }
      await settle();
      controls.push({
        operation: step.operation,
        state: controller.state(),
        sample: controller.sample(),
        geometry: geometry(targets),
      });
    }
    const beforeFailure = {
      state: controller.state(),
      geometry: geometry(targets),
    };
    const rejected: string[] = [];
    for (const [name, run] of [
      ["nonfinite-seek", () => controller.seek(NaN)],
      ["nonfinite-rate", () => controller.setPlaybackRate(Infinity)],
      [
        "foreign-state",
        () =>
          controller.restoreState({
            ...controller.state(),
            clipHash: "0".repeat(64),
          }),
      ],
    ] as const) {
      try {
        run();
      } catch {
        rejected.push(name);
      }
    }
    const afterFailure = {
      state: controller.state(),
      geometry: geometry(targets),
    };
    controller.close();
    await settle();
    const closedGeometry = geometry(targets);
    let closedTickRejected = false;
    try {
      controller.tick();
    } catch {
      closedTickRejected = true;
    }
    return {
      name: item.name,
      samples,
      controls,
      beforeFailure,
      afterFailure,
      rejected,
      closedGeometry,
      closedTickRejected,
      remainingAnimations: [...targets.values()].reduce(
        (sum, element) => sum + element.getAnimations().length,
        0,
      ),
    };
  } finally {
    controller.close();
    stage.remove();
  }
}

async function independence(item: MotionProbeCase) {
  const first = mount(item),
    second = mount(item);
  const a = await createWebMotionController(item.spec, first.targets, {
    ownGeometry: true,
    now: () => 0,
  });
  const b = await createWebMotionController(item.spec, second.targets, {
    ownGeometry: true,
    now: () => 0,
  });
  try {
    a.seek(250);
    b.seek(750);
    await settle();
    const before = geometry(first.targets),
      other = geometry(second.targets);
    b.seek(0);
    await settle();
    return {
      first: before,
      second: other,
      firstAfterOtherSeek: geometry(first.targets),
    };
  } finally {
    a.close();
    b.close();
    first.stage.remove();
    second.stage.remove();
  }
}

async function constraintRejections(item: MotionProbeCase) {
  const results = [];
  for (const [name, property, value] of [
    ["min-width", "minWidth", "100px"],
    ["min-height", "minHeight", "100px"],
    ["max-width", "maxWidth", "10px"],
    ["max-height", "maxHeight", "10px"],
    ["padding", "padding", "20px"],
    ["border", "border", "20px solid black"],
    ["margin", "margin", "10px"],
    ["transform", "transform", "translateX(10px)"],
    ["translate", "translate", "10px"],
    ["rotate", "rotate", "10deg"],
    ["scale", "scale", "2"],
    ["existing-animation", "opacity", "1"],
  ] as const) {
    const { stage, targets } = mount(item);
    const element = targets.get(name === "max-width" ? "other" : "panel")!;
    element.style[property] = value;
    let existing: Animation | undefined;
    let controller:
      Awaited<ReturnType<typeof createWebMotionController>> | undefined;
    try {
      if (name === "existing-animation") {
        existing = element.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 1000,
          fill: "both",
        });
        existing.pause();
        existing.currentTime = 0;
      }
      await settle();
      const before = {
        geometry: geometry(targets),
        css: element.style.cssText,
        animations: [...targets.values()].map(
          (target) => target.getAnimations().length,
        ),
      };
      let rejected = false,
        diagnostic = "";
      try {
        controller = await createWebMotionController(item.spec, targets, {
          ownGeometry: true,
          now: () => 0,
        });
      } catch (error) {
        rejected = true;
        diagnostic = error instanceof Error ? error.message : String(error);
      }
      const after = {
        geometry: geometry(targets),
        css: element.style.cssText,
        animations: [...targets.values()].map(
          (target) => target.getAnimations().length,
        ),
      };
      results.push({ name, rejected, diagnostic, before, after });
    } finally {
      controller?.close();
      existing?.cancel();
      stage.remove();
    }
  }
  return results;
}

export const motionProbe = {
  async run(cases: MotionProbeCase[]) {
    document.body.style.margin = "0";
    const results = [];
    for (const item of cases) results.push(await runCase(item));
    return {
      schema: 1,
      cases: results,
      independence: await independence(cases[0]!),
      constraintRejections: await constraintRejections(cases[0]!),
    };
  },
};

declare global {
  interface Window {
    afyMotionProbe: typeof motionProbe;
  }
}
window.afyMotionProbe = motionProbe;
