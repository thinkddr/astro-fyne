// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import {
  createMotionSampler,
  motionHash,
  motionKeyframes,
  validateMotion,
  validateMotionState,
  type MotionSpec,
  type MotionSample,
  type MotionState,
} from "./motion.ts";

export interface WebMotionOptions {
  ownGeometry: true;
  now: () => number;
}

/** Real Web Animations effects driven exclusively by a portable injected clock. */
export class WebMotionController {
  readonly #clip: MotionSpec;
  readonly #hash: string;
  #now: (() => number) | undefined;
  readonly #sample: (timeMs: number) => MotionSample;
  readonly #end: number;
  #animations: Animation[] = [];
  #raw: MotionState;
  #anchor = 0;
  #closed = false;

  private constructor(
    clip: MotionSpec,
    hash: string,
    targets: ReadonlyMap<string, HTMLElement>,
    options: WebMotionOptions,
  ) {
    this.#clip = clip;
    this.#hash = hash;
    this.#now = options.now;
    this.#sample = createMotionSampler(clip);
    this.#end = Math.max(
      0,
      clip.timing.delayMs + clip.timing.durationMs * clip.timing.iterations,
    );
    this.#raw = {
      schema: 1,
      clipId: clip.id,
      clipHash: hash,
      currentTimeMs: null,
      playbackRate: 1,
      playState: "idle",
    };
    const { timing } = clip;
    try {
      for (const track of clip.tracks) {
        const element = targets.get(track.target)!;
        const effect = new KeyframeEffect(
          element,
          motionKeyframes(clip, track.id),
          {
            duration: timing.durationMs,
            delay: timing.delayMs,
            iterations: timing.iterations,
            direction: timing.direction,
            fill: timing.fill,
            easing: "linear",
            composite: "replace",
          },
        );
        this.#animations.push(
          new Animation(effect, element.ownerDocument.timeline),
        );
      }
    } catch (error) {
      for (const animation of this.#animations) {
        animation.cancel();
        animation.effect = null;
      }
      throw error;
    }
  }

  static async create(
    value: unknown,
    supplied: ReadonlyMap<string, HTMLElement> | Record<string, HTMLElement>,
    options: WebMotionOptions,
  ): Promise<WebMotionController> {
    if (options?.ownGeometry !== true || typeof options.now !== "function")
      throw new Error(
        "Motion: explicit geometry ownership and a clock are required",
      );
    if (typeof Animation !== "function" || typeof KeyframeEffect !== "function")
      throw new Error("Motion: Web Animations API is required");
    const clip = validateMotion(value);
    const targets = new Map<string, HTMLElement>();
    const objects = new Set<HTMLElement>();
    const read =
      typeof (supplied as ReadonlyMap<string, HTMLElement>)?.get === "function"
        ? (name: string) =>
            (supplied as ReadonlyMap<string, HTMLElement>).get(name)
        : (name: string) =>
            Object.hasOwn(supplied, name)
              ? (supplied as Record<string, HTMLElement>)[name]
              : undefined;
    for (const track of clip.tracks) {
      if (targets.has(track.target)) continue;
      const element = read(track.target);
      if (!(element instanceof HTMLElement) || objects.has(element))
        throw new Error(
          `Motion: missing, invalid or aliased target ${track.target}`,
        );
      const style = getComputedStyle(element);
      if (style.position !== "absolute" || style.boxSizing !== "border-box")
        throw new Error(
          "Motion: targets require position:absolute and box-sizing:border-box",
        );
      if (
        style.minWidth !== "0px" ||
        style.minHeight !== "0px" ||
        style.maxWidth !== "none" ||
        style.maxHeight !== "none"
      )
        throw new Error(
          "Motion: min/max sizing requires a native motion adapter",
        );
      for (const property of [
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "borderTopWidth",
        "borderRightWidth",
        "borderBottomWidth",
        "borderLeftWidth",
        "marginTop",
        "marginRight",
        "marginBottom",
        "marginLeft",
      ] as const)
        if (style[property] !== "0px")
          throw new Error(
            "Motion: padding, borders and margins require a native motion adapter",
          );
      if (
        style.transform !== "none" ||
        style.translate !== "none" ||
        style.rotate !== "none" ||
        style.scale !== "none" ||
        style.offsetPath !== "none" ||
        element.getAnimations().length !== 0
      )
        throw new Error(
          "Motion: transforms and existing animation effects require a native motion adapter",
        );
      for (const property of ["left", "top", "width", "height"] as const) {
        const text = style[property],
          numeric = Number.parseFloat(text);
        if (
          !text.endsWith("px") ||
          !Number.isFinite(numeric) ||
          Math.abs(numeric) > 3.4028234663852886e38 ||
          ((property === "width" || property === "height") && numeric < 0)
        )
          throw new Error("Motion: targets need finite used pixel geometry");
      }
      objects.add(element);
      targets.set(track.target, element);
    }
    const ownedOptions = { ownGeometry: true as const, now: options.now };
    return new WebMotionController(
      clip,
      await motionHash(clip),
      targets,
      ownedOptions,
    );
  }

  spec(): MotionSpec {
    return structuredClone(this.#clip);
  }

  #clock(): number {
    if (!this.#now) throw new Error("Motion: controller is closed");
    const now = this.#now();
    if (!Number.isFinite(now)) throw new Error("Motion: clock must be finite");
    return now;
  }

  #present(now: number): MotionState {
    const state = structuredClone(this.#raw);
    if (state.playState !== "running") return state;
    if (now < this.#anchor) throw new Error("Motion: clock moved backwards");
    let current =
      state.currentTimeMs! + (now - this.#anchor) * state.playbackRate;
    if (!Number.isFinite(current) || Math.abs(current) > 1e12)
      throw new Error("Motion: clock exceeded the supported timeline");
    if (state.playbackRate > 0 && current >= this.#end) {
      current = this.#end;
      state.playState = "finished";
    } else if (state.playbackRate < 0 && current <= 0) {
      current = 0;
      state.playState = "finished";
    }
    state.currentTimeMs = current;
    return state;
  }

  #validateState(value: unknown): MotionState {
    const state = validateMotionState(value);
    if (state.clipId !== this.#clip.id || state.clipHash !== this.#hash)
      throw new Error("Motion: state belongs to a different clip");
    const time = state.currentTimeMs,
      rate = state.playbackRate;
    if (
      time !== null &&
      state.playState === "running" &&
      ((rate > 0 && time >= this.#end) || (rate < 0 && time <= 0))
    )
      throw new Error("Motion: running state is outside its playback boundary");
    if (
      time !== null &&
      state.playState === "finished" &&
      ((rate > 0 && time !== this.#end) ||
        (rate < 0 && time !== 0) ||
        (rate === 0 && time !== 0 && time !== this.#end))
    )
      throw new Error("Motion: finished state is not at its playback boundary");
    return state;
  }

  #apply(state: MotionState): void {
    const previous = this.#animations.map((animation) => animation.currentTime);
    try {
      for (const animation of this.#animations) {
        if (state.currentTimeMs === null) animation.cancel();
        else {
          animation.pause();
          animation.currentTime = state.currentTimeMs;
        }
      }
    } catch (error) {
      for (const [index, animation] of this.#animations.entries()) {
        const time = previous[index] ?? null;
        if (time === null) animation.cancel();
        else {
          animation.pause();
          animation.currentTime = time;
        }
      }
      throw error;
    }
  }

  #change(
    transform: (state: MotionState) => MotionState,
    resetClock = false,
  ): void {
    if (this.#closed) throw new Error("Motion: controller is closed");
    const now = resetClock ? this.#anchor : this.#clock();
    const current = resetClock
      ? structuredClone(this.#raw)
      : this.#present(now);
    const next = this.#validateState(transform(current));
    if (next.currentTimeMs !== null) this.#sample(next.currentTimeMs);
    this.#apply(next);
    this.#raw = structuredClone(next);
    this.#anchor = now;
  }

  state(): MotionState {
    if (this.#closed) throw new Error("Motion: controller is closed");
    return this.#present(this.#clock());
  }
  sample(): MotionSample {
    const state = this.state();
    return state.currentTimeMs === null
      ? { active: false, progress: 0, values: [] }
      : this.#sample(state.currentTimeMs);
  }
  tick(): void {
    this.#change((state) => state);
  }
  seek(timeMs: number): void {
    this.#change((state) => ({
      ...state,
      currentTimeMs: timeMs,
      playState: "paused",
    }));
  }
  #start(state: MotionState): MotionState {
    const end = this.#end;
    if (
      state.currentTimeMs === null ||
      (state.playbackRate > 0 &&
        (state.currentTimeMs < 0 || state.currentTimeMs >= end))
    )
      state.currentTimeMs = 0;
    if (
      state.playbackRate < 0 &&
      (state.currentTimeMs === null ||
        state.currentTimeMs <= 0 ||
        state.currentTimeMs > end)
    )
      state.currentTimeMs = end;
    state.playState = "running";
    if (end === 0 && state.playbackRate !== 0) {
      state.currentTimeMs = 0;
      state.playState = "finished";
    }
    return state;
  }
  play(): void {
    this.#change((state) =>
      state.playState === "running" ? state : this.#start(state),
    );
  }
  pause(): void {
    this.#change((state) => ({
      ...state,
      playState: state.currentTimeMs === null ? "idle" : "paused",
    }));
  }
  reverse(): void {
    this.#change((state) => {
      if (state.playbackRate === 0)
        throw new Error("Motion: cannot reverse a zero playback rate");
      state.playbackRate = -state.playbackRate;
      return this.#start(state);
    });
  }
  cancel(): void {
    this.#change(
      (state) => ({ ...state, currentTimeMs: null, playState: "idle" }),
      true,
    );
  }
  finish(): void {
    this.#change((state) => {
      if (state.playbackRate === 0)
        throw new Error("Motion: cannot finish a zero playback rate");
      return {
        ...state,
        currentTimeMs: state.playbackRate < 0 ? 0 : this.#end,
        playState: "finished",
      };
    });
  }
  setPlaybackRate(rate: number): void {
    this.#change((state) => {
      state.playbackRate = rate;
      const time = state.currentTimeMs;
      if (time !== null) {
        if (
          state.playState === "finished" &&
          ((rate > 0 && time < this.#end) || (rate < 0 && time > 0))
        )
          state.playState = "running";
        if (state.playState === "running" && rate > 0 && time >= this.#end) {
          state.currentTimeMs = this.#end;
          state.playState = "finished";
        } else if (state.playState === "running" && rate < 0 && time <= 0) {
          state.currentTimeMs = 0;
          state.playState = "finished";
        }
      }
      return state;
    });
  }
  restoreState(state: unknown): void {
    const copied = this.#validateState(state);
    this.#change(() => copied);
  }
  close(): void {
    if (this.#closed) return;
    this.cancel();
    for (const animation of this.#animations) animation.effect = null;
    this.#animations = [];
    this.#now = undefined;
    this.#closed = true;
  }
}

export const createWebMotionController = WebMotionController.create;
