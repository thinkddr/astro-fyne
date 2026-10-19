// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createValidatedMotionSampler } from "./motion-sample.js";

export interface MotionKeyframe {
  offset: number;
  value: number;
}
export interface MotionTrack {
  id: string;
  target: string;
  property: "x" | "y" | "width" | "height";
  keyframes: MotionKeyframe[];
}
export interface MotionEasing {
  kind: "linear" | "cubic-bezier";
  points?: number[];
}
export interface MotionTiming {
  durationMs: number;
  delayMs: number;
  iterations: number;
  direction: "normal" | "reverse" | "alternate" | "alternate-reverse";
  fill: "none" | "backwards" | "forwards" | "both";
  easing: MotionEasing;
}
export interface MotionSpec {
  schema: 1;
  id: string;
  tracks: MotionTrack[];
  timing: MotionTiming;
}
export interface MotionState {
  schema: 1;
  clipId: string;
  clipHash: string;
  currentTimeMs: number | null;
  playbackRate: number;
  playState: "idle" | "running" | "paused" | "finished";
}

export interface MotionValue {
  track: string;
  target: string;
  property: MotionTrack["property"];
  value: number;
}
export interface MotionSample {
  active: boolean;
  progress: number;
  values: MotionValue[];
}

const identifier = /^[A-Za-z_][A-Za-z0-9_.:/-]{0,255}$/;
const float32Maximum = 3.4028234663852886e38;
function fail(message: string): never {
  throw new Error(`Motion: ${message}`);
}
function fields(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected an object");
  const result = value as Record<string, unknown>;
  if (
    required.some((name) => !Object.hasOwn(result, name)) ||
    Object.keys(result).some(
      (name) => ![...required, ...optional].includes(name),
    )
  )
    fail("unknown or missing fields");
  return result;
}
function number(value: unknown, limit: number, minimum = -limit) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > limit
  )
    fail("numeric value exceeds the supported range");
  return value;
}
function id(value: unknown) {
  if (typeof value !== "string" || !identifier.test(value)) fail("invalid ID");
  return value;
}

export function validateMotion(value: unknown): MotionSpec {
  const clip = fields(value, ["schema", "id", "tracks", "timing"]);
  if (clip.schema !== 1) fail("unknown schema");
  id(clip.id);
  const timing = fields(clip.timing, [
    "durationMs",
    "delayMs",
    "iterations",
    "direction",
    "fill",
    "easing",
  ]);
  const duration = number(timing.durationMs, 1e12, 0),
    delay = number(timing.delayMs, 1e12),
    iterations = number(timing.iterations, 1e9, 0);
  if (
    duration * iterations > 1e12 ||
    Math.abs(delay + duration * iterations) > 1e12
  )
    fail("effect duration exceeds the supported timeline");
  if (
    !["normal", "reverse", "alternate", "alternate-reverse"].includes(
      timing.direction as string,
    ) ||
    !["none", "backwards", "forwards", "both"].includes(timing.fill as string)
  )
    fail("unsupported direction or fill");
  const easing = fields(timing.easing, ["kind"], ["points"]);
  if (easing.points !== undefined && !Array.isArray(easing.points))
    fail("easing points require an array");
  const points = (easing.points ?? []) as unknown[];
  if (easing.kind === "linear") {
    if (points.length) fail("linear easing has no control points");
  } else if (easing.kind === "cubic-bezier" && points.length === 4) {
    for (const point of points) number(point, 1e6);
    if (
      (points[0] as number) < 0 ||
      (points[0] as number) > 1 ||
      (points[2] as number) < 0 ||
      (points[2] as number) > 1
    )
      fail("cubic-bezier x coordinates must be in [0,1]");
  } else fail("unsupported easing");
  if (
    !Array.isArray(clip.tracks) ||
    !clip.tracks.length ||
    clip.tracks.length > 1000
  )
    fail("clip requires 1..1000 tracks");
  const ids = new Set<string>(),
    properties = new Set<string>();
  let count = 0;
  for (const value of clip.tracks) {
    const track = fields(value, ["id", "target", "property", "keyframes"]);
    const trackId = id(track.id),
      target = id(track.target);
    if (ids.has(trackId)) fail("duplicate track ID");
    ids.add(trackId);
    if (!["x", "y", "width", "height"].includes(track.property as string))
      fail("property requires a native adapter");
    const property = `${target}\0${track.property}`;
    if (properties.has(property)) fail("duplicate target property");
    properties.add(property);
    if (
      !Array.isArray(track.keyframes) ||
      track.keyframes.length < 2 ||
      (count += track.keyframes.length) > 10000
    )
      fail("track needs explicit endpoints within 10000 total keyframes");
    let previous = -1;
    for (const value of track.keyframes) {
      const frame = fields(value, ["offset", "value"]);
      const offset = number(frame.offset, 1, 0);
      if (offset <= previous) fail("keyframe offsets must increase");
      previous = offset;
      number(
        frame.value,
        float32Maximum,
        track.property === "width" || track.property === "height"
          ? 0
          : -float32Maximum,
      );
    }
    if (track.keyframes[0].offset !== 0 || track.keyframes.at(-1).offset !== 1)
      fail("keyframes require explicit 0/1 endpoints");
  }
  return structuredClone(value) as MotionSpec;
}

/** Shared semantic fingerprint; numeric zero signs do not change geometry. */
export async function motionHash(value: unknown): Promise<string> {
  const clip = validateMotion(value),
    chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  const count = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, false);
    chunks.push(bytes);
  };
  const text = (value: string) => {
    const bytes = encoder.encode(value);
    count(bytes.length);
    chunks.push(bytes);
  };
  const number = (value: number) => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value === 0 ? 0 : value, false);
    chunks.push(bytes);
  };
  chunks.push(encoder.encode("astro-fyne-motion:1\0"));
  text(clip.id);
  number(clip.timing.durationMs);
  number(clip.timing.delayMs);
  number(clip.timing.iterations);
  text(clip.timing.direction);
  text(clip.timing.fill);
  text(clip.timing.easing.kind);
  count(clip.timing.easing.points?.length ?? 0);
  for (const value of clip.timing.easing.points ?? []) number(value);
  count(clip.tracks.length);
  for (const track of clip.tracks) {
    text(track.id);
    text(track.target);
    text(track.property);
    count(track.keyframes.length);
    for (const frame of track.keyframes) {
      number(frame.offset);
      number(frame.value);
    }
  }
  const bytes = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function motionEasingCSS(easing: MotionEasing): string {
  return easing.kind === "linear"
    ? "linear"
    : `cubic-bezier(${easing.points!.join(",")})`;
}

/** Preserve per-interval easing rather than applying it twice to the effect. */
export function motionKeyframes(value: unknown, trackId: string): Keyframe[] {
  const clip = validateMotion(value),
    track = clip.tracks.find((track) => track.id === trackId);
  if (!track) fail("missing track");
  const property =
    track.property === "x"
      ? "left"
      : track.property === "y"
        ? "top"
        : track.property;
  return track.keyframes.map((frame) => ({
    offset: frame.offset,
    [property]: `${frame.value}px`,
    easing: motionEasingCSS(clip.timing.easing),
  }));
}

export function motionEndTime(value: unknown): number {
  const { timing } = validateMotion(value);
  return Math.max(0, timing.delayMs + timing.durationMs * timing.iterations);
}

/** Own a validated copy once; each sample contains newly allocated values. */
export function createMotionSampler(
  value: unknown,
): (timeMs: number) => MotionSample {
  return createValidatedMotionSampler(validateMotion(value));
}

export function sampleMotion(value: unknown, timeMs: number): MotionSample {
  return createMotionSampler(value)(timeMs);
}

export function validateMotionState(value: unknown): MotionState {
  const state = fields(value, [
    "schema",
    "clipId",
    "clipHash",
    "currentTimeMs",
    "playbackRate",
    "playState",
  ]);
  if (state.schema !== 1) fail("unknown state schema");
  id(state.clipId);
  if (
    typeof state.clipHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(state.clipHash)
  )
    fail("state needs a lowercase SHA-256 fingerprint");
  number(state.playbackRate, 1e6);
  if (state.playState === "idle") {
    if (state.currentTimeMs !== null)
      fail("idle state cannot retain a current time");
  } else if (
    ["running", "paused", "finished"].includes(state.playState as string)
  ) {
    number(state.currentTimeMs, 1e12);
  } else fail("unsupported play state");
  return structuredClone(value) as MotionState;
}
