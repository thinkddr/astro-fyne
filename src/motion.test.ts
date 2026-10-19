// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";
import {
  createMotionSampler,
  motionHash,
  motionKeyframes,
  sampleMotion,
  validateMotion,
  validateMotionState,
  type MotionSpec,
  type MotionState,
} from "./motion.ts";

function fixture(): MotionSpec {
  return {
    schema: 1,
    id: "move",
    tracks: [
      {
        id: "horizontal",
        target: "panel",
        property: "x",
        keyframes: [
          { offset: 0, value: 0 },
          { offset: 1, value: 100 },
        ],
      },
    ],
    timing: {
      durationMs: 1000,
      delayMs: 0,
      iterations: 1,
      direction: "normal",
      fill: "both",
      easing: { kind: "linear" },
    },
  };
}

test("portable fingerprint matches the independent native IEEE-754 vector", async () => {
  const vector: MotionSpec = {
    schema: 1,
    id: "fingerprint",
    tracks: [
      {
        id: "fraction",
        target: "panel",
        property: "x",
        keyframes: [
          { offset: -0, value: -0 },
          { offset: 0.5, value: Number.MIN_VALUE },
          { offset: 1, value: 1e20 },
        ],
      },
    ],
    timing: {
      durationMs: 1000,
      delayMs: -0,
      iterations: 2.5,
      direction: "alternate-reverse",
      fill: "backwards",
      easing: { kind: "cubic-bezier", points: [0, -0, 1, 1] },
    },
  };
  const expected =
    "10fdd690d1ddb8c751f7cd998256407cad7bef25d5eaa9ff81afc96d37e4b416";
  expect(await motionHash(vector)).toBe(expected);
  expect(await motionHash(JSON.parse(JSON.stringify(vector)))).toBe(expected);
  vector.tracks[0]!.keyframes[1]!.value = 0;
  expect(await motionHash(vector)).not.toBe(expected);
});

test("timing applies fractional iterations, fill and alternating directions", () => {
  const spec = fixture();
  Object.assign(spec.timing, {
    delayMs: 100,
    iterations: 2.5,
    direction: "alternate",
  });
  for (const [time, value] of [
    [0, 0],
    [100, 0],
    [600, 50],
    [1100, 100],
    [1600, 50],
    [2100, 0],
    [2600, 50],
    [3000, 50],
  ])
    expect(sampleMotion(spec, time!).values[0]!.value).toBeCloseTo(value!, 10);
  for (const [direction, expected] of [
    ["normal", 25],
    ["reverse", 75],
    ["alternate", 75],
    ["alternate-reverse", 25],
  ] as const) {
    spec.timing.direction = direction;
    expect(sampleMotion(spec, 1350).values[0]!.value).toBeCloseTo(expected, 10);
  }
  spec.timing.direction = "normal";
  spec.timing.iterations = 1;
  spec.timing.delayMs = -250;
  expect(sampleMotion(spec, 0).values[0]!.value).toBe(25);
  expect(sampleMotion(spec, 750).values[0]!.value).toBe(100);
});

test("inactive fills never retain the previous animated frame", () => {
  for (const fill of ["none", "backwards", "forwards", "both"] as const) {
    const spec = fixture();
    Object.assign(spec.timing, { delayMs: 100, fill });
    expect(sampleMotion(spec, 99).active).toBe(
      fill === "backwards" || fill === "both",
    );
    expect(sampleMotion(spec, 1100).active).toBe(
      fill === "forwards" || fill === "both",
    );
    if (fill === "none") expect(sampleMotion(spec, 1100).values).toEqual([]);
  }
  const spec = fixture();
  Object.assign(spec.timing, { durationMs: 0, delayMs: 50 });
  expect(sampleMotion(spec, 49).values[0]!.value).toBe(0);
  expect(sampleMotion(spec, 50).values[0]!.value).toBe(100);
  spec.timing.iterations = 0;
  expect(sampleMotion(spec, 50).values[0]!.value).toBe(0);
});

test("CSS cubic Bezier inversion applies within each keyframe interval", () => {
  const spec = fixture();
  spec.timing.easing = { kind: "cubic-bezier", points: [0, 0, 0, 1] };
  spec.tracks[0]!.keyframes = [
    { offset: 0, value: 0 },
    { offset: 0.5, value: 50 },
    { offset: 1, value: 100 },
  ];
  expect(sampleMotion(spec, 62.5).values[0]!.value).toBeCloseTo(25, 10);
  expect(sampleMotion(spec, 562.5).values[0]!.value).toBeCloseTo(75, 10);
  const keyframes = motionKeyframes(spec, "horizontal");
  expect(keyframes).toEqual([
    { offset: 0, left: "0px", easing: "cubic-bezier(0,0,0,1)" },
    { offset: 0.5, left: "50px", easing: "cubic-bezier(0,0,0,1)" },
    { offset: 1, left: "100px", easing: "cubic-bezier(0,0,0,1)" },
  ]);
});

test("sampler owns its metadata and returned values", () => {
  const input = fixture(),
    sampler = createMotionSampler(input);
  input.tracks[0]!.keyframes[1]!.value = 900;
  const first = sampler(500);
  first.values[0]!.value = 800;
  expect(sampler(500).values[0]!.value).toBe(50);
});

test("unsupported and ambiguous motion metadata is rejected", () => {
  const changes = [
    (spec: any) =>
      (spec.timing.easing = { kind: "cubic-bezier", points: [0, , 1, 1] }),
    (spec: any) => (spec.schema = 2),
    (spec: any) => (spec.id = "bad id"),
    (spec: any) => (spec.extra = true),
    (spec: any) => (spec.timing.durationMs = -1),
    (spec: any) => (spec.timing.delayMs = NaN),
    (spec: any) => (spec.timing.iterations = Infinity),
    (spec: any) => (spec.timing.iterations = -1),
    (spec: any) => (spec.timing.easing = { kind: "linear", points: null }),
    (spec: any) =>
      (spec.timing.easing = { kind: "cubic-bezier", points: [-1, 0, 0, 1] }),
    (spec: any) => (spec.tracks[0].property = "opacity"),
    (spec: any) => (spec.tracks[0].keyframes[0].offset = 0.1),
    (spec: any) =>
      spec.tracks[0].keyframes.splice(1, 0, { offset: 0, value: 20 }),
    (spec: any) => spec.tracks.push(structuredClone(spec.tracks[0])),
    (spec: any) => {
      const track = structuredClone(spec.tracks[0]);
      track.id = "other";
      spec.tracks.push(track);
    },
    (spec: any) => {
      spec.tracks[0].property = "width";
      spec.tracks[0].keyframes[0].value = -1;
    },
  ];
  for (const change of changes) {
    const spec = fixture();
    change(spec);
    expect(() => validateMotion(spec)).toThrow();
  }
  expect(() => sampleMotion(fixture(), NaN)).toThrow();
  const spec = fixture();
  spec.tracks[0]!.property = "width";
  spec.timing.easing = { kind: "cubic-bezier", points: [0.3, -5, 0.7, -5] };
  expect(() => sampleMotion(spec, 500)).toThrow();
});

test("portable state preserves required finite time and explicit identity", () => {
  const state: MotionState = {
    schema: 1,
    clipId: "move",
    clipHash: "a".repeat(64),
    currentTimeMs: 350,
    playbackRate: -2,
    playState: "paused",
  };
  expect(validateMotionState(state)).toEqual(state);
  for (const change of [
    { clipHash: "bad" },
    { currentTimeMs: null },
    { currentTimeMs: NaN },
    { playbackRate: Infinity },
    { playState: "idle" },
    { extra: true },
  ])
    expect(() => validateMotionState({ ...state, ...change })).toThrow();
  expect(
    validateMotionState({ ...state, playState: "idle", currentTimeMs: null })
      .currentTimeMs,
  ).toBeNull();
});
