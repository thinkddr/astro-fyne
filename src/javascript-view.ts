// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { h, Component, createRef, type RefObject, type Ref } from "preact";
import {
  useRef,
  useState,
  useLayoutEffect,
  useImperativeHandle,
} from "preact/hooks";
import { ManagedJavascriptDOM } from "./javascript-managed-dom.ts";
import type {
  JavascriptActions,
  JavascriptAPI,
  JavascriptArchive,
  JavascriptFactory,
  JavascriptFrame,
  JavascriptAnimationState,
} from "./javascript-types.ts";

export interface JavascriptHandle {
  exportJavascript(): JavascriptArchive;
  advanceAnimations?(timeMs: number): void;
  pauseAnimations?(): void;
  playAnimations?(): void;
  animationState?(): JavascriptAnimationState;
}
export interface JavascriptAnimationOptions {
  manual?: boolean;
  now?: () => number;
}
export interface JavascriptProps {
  actions?: JavascriptActions;
  ref?: Ref<JavascriptHandle>;
  animation?: JavascriptAnimationOptions;
}
const emptyActions: JavascriptActions = {};
const animationNow = () => performance.now();

/** Render the same Preact program's native DOM representation in an Astro island. */
export function createJavascriptComponent(
  factory: JavascriptFactory,
  archive: JavascriptArchive,
) {
  function JavascriptProgram(
    input: JavascriptProps & { handle: RefObject<JavascriptHandle> },
  ) {
    const context = useRef<{
      api: JavascriptAPI;
      actions: JavascriptActions;
      mounted: boolean;
      dirty: boolean;
      error?: unknown;
      dom?: ManagedJavascriptDOM;
      generation: number;
      manualAnimations: boolean;
      now: () => number;
      frame?: number;
      anchorClock?: number;
      anchorTime: number;
      lastClock?: number;
    }>();
    if (!context.current) {
      const actions = input.actions ?? emptyActions;
      for (const name of archive.actions)
        if (
          !Object.hasOwn(actions, name) ||
          typeof actions[name] !== "function"
        )
          throw new Error(`JavaScript program needs action ${name}`);
      const api = factory((kind, name, args) => {
        if (kind === "now") return Date.now();
        if (kind === "random") return Math.random();
        if (kind === "action") return actions[name]!(...JSON.parse(args));
        throw new Error("Unknown JavaScript host boundary");
      }, archive);
      api.flush();
      for (const event of archive.events) {
        api.replay(event);
        api.flush();
      }
      api.finishReplay();
      context.current = {
        api,
        actions,
        mounted: false,
        dirty: false,
        generation: 0,
        manualAnimations: input.animation?.manual ?? false,
        now: input.animation?.now ?? animationNow,
        anchorTime: archive.animation?.timeMs ?? 0,
      };
    }
    const ctx = context.current;
    if (
      (input.animation?.manual ?? false) !== ctx.manualAnimations ||
      (input.animation?.now ?? animationNow) !== ctx.now
    )
      throw new Error(
        "Animation clock ownership must stay stable; remount to replace it",
      );
    if ((input.actions ?? emptyActions) !== ctx.actions)
      throw new Error(
        "JavaScript action bindings must stay stable; remount to replace them",
      );
    const [frames, setFrames] = useState(() => ctx.api.snapshot());
    const wrapper = useRef<HTMLDivElement>(null);
    function clock() {
      const now = ctx.now();
      if (
        !Number.isFinite(now) ||
        (ctx.lastClock !== undefined && now < ctx.lastClock)
      )
        throw new Error("Animation clock must be finite and monotonic");
      ctx.lastClock = now;
      return now;
    }
    function anchor(sampledClock?: number) {
      ctx.anchorTime = ctx.api.animationState!().timeMs;
      ctx.anchorClock = sampledClock ?? clock();
    }
    function advanceClock() {
      if (
        ctx.manualAnimations ||
        ctx.api.animationState?.().playState !== "running"
      )
        return;
      const now = clock();
      if (ctx.anchorClock === undefined) {
        ctx.anchorTime = ctx.api.animationState!().timeMs;
        ctx.anchorClock = now;
      }
      ctx.api.advanceAnimations!(ctx.anchorTime + now - ctx.anchorClock!);
      return now;
    }
    function changed(task: () => void) {
      ctx.dirty = true;
      ctx.generation++;
      try {
        task();
        setFrames(ctx.api.snapshot());
      } catch (error) {
        ctx.error = error;
        throw error;
      }
    }
    function schedule() {
      if (
        ctx.manualAnimations ||
        ctx.frame !== undefined ||
        !ctx.mounted ||
        ctx.error ||
        ctx.api.animationState?.().playState !== "running"
      )
        return;
      ctx.frame = requestAnimationFrame(() => {
        ctx.frame = undefined;
        if (!ctx.mounted || ctx.error) return;
        if (ctx.dirty) {
          schedule();
          return;
        }
        changed(advanceClock);
      });
    }
    useLayoutEffect(() => {
      const generation = ctx.generation;
      try {
        if (!wrapper.current) throw new Error("Missing JavaScript DOM wrapper");
        ctx.dom ??= new ManagedJavascriptDOM(
          wrapper.current,
          dispatch,
          (error) => {
            ctx.error = error;
            if (ctx.frame !== undefined) cancelAnimationFrame(ctx.frame);
            ctx.frame = undefined;
          },
        );
        ctx.dom.commit(frames);
        ctx.dirty = ctx.generation !== generation;
        ctx.mounted = true;
        if (archive.schema === 2 && !ctx.manualAnimations) {
          if (ctx.anchorClock === undefined) anchor();
          schedule();
        }
      } catch (error) {
        ctx.error = error;
        ctx.mounted = false;
        if (ctx.frame !== undefined) cancelAnimationFrame(ctx.frame);
        ctx.frame = undefined;
        throw error;
      }
    });
    useLayoutEffect(
      () => () => {
        ctx.mounted = false;
        if (ctx.frame !== undefined) cancelAnimationFrame(ctx.frame);
        ctx.frame = undefined;
        ctx.dom?.dispose();
        ctx.api.dispose();
      },
      [],
    );
    useImperativeHandle(input.handle, () => ({
      exportJavascript() {
        ctx.dom?.validate();
        if (!ctx.mounted || ctx.dirty || ctx.error)
          throw new Error("Export requires a valid committed JavaScript frame");
        if (
          document.activeElement &&
          document.activeElement !== document.body &&
          document.activeElement !== document.documentElement
        )
          throw new Error(
            "Clear focus before exporting; caret/selection are not portable state",
          );
        const check = (frames: JavascriptFrame[]) => {
          for (const frame of frames) {
            const element = ctx.dom?.element(frame.uid);
            if (frame.tag !== "#text" && !element)
              throw new Error("Missing committed JavaScript DOM element");
            if (
              element instanceof HTMLInputElement &&
              element.type === "checkbox" &&
              element.checked !== frame.checked
            )
              throw new Error(
                `Commit checkbox state before exporting: ${frame.attrs?.id} DOM=${element.checked} frame=${frame.checked}`,
              );
            if (
              (element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement) &&
              element.value !== frame.value
            )
              throw new Error("Commit editor values before exporting");
            check(frame.children ?? []);
          }
        };
        check(frames);
        return ctx.api.export();
      },
      ...(archive.schema === 2
        ? {
            animationState: () => ctx.api.animationState!(),
            advanceAnimations(timeMs: number) {
              const state = ctx.api.animationState!();
              if (
                !Number.isFinite(timeMs) ||
                timeMs < state.timeMs ||
                timeMs > 1e12
              )
                throw new Error(
                  "Animation time must advance monotonically within 1e12ms",
                );
              changed(() => ctx.api.advanceAnimations!(timeMs));
              if (!ctx.manualAnimations) anchor();
            },
            pauseAnimations() {
              changed(() => {
                advanceClock();
                ctx.api.pauseAnimations!();
              });
              if (ctx.frame !== undefined) cancelAnimationFrame(ctx.frame);
              ctx.frame = undefined;
            },
            playAnimations() {
              let sampledClock: number | undefined;
              changed(() => {
                sampledClock = advanceClock();
                ctx.api.playAnimations!();
              });
              if (
                !ctx.manualAnimations &&
                ctx.api.animationState!().playState === "running"
              )
                anchor(sampledClock);
            },
          }
        : {}),
    }));
    const dispatch = (
      uid: string,
      type: "click" | "input" | "change",
      value?: string,
    ) => {
      ctx.dirty = true;
      ctx.generation++;
      try {
        if (archive.schema === 2) advanceClock();
        const prevented = ctx.api.dispatch({
          node: uid,
          type,
          ...(value === undefined ? {} : { value }),
        });
        ctx.api.flush();
        setFrames(ctx.api.snapshot());
        return prevented;
      } catch (error) {
        ctx.error = error;
        throw error;
      }
    };
    return h("div", { "data-afy-javascript": archive.codeHash, ref: wrapper });
  }
  return class JavascriptProgramComponent
    extends Component<JavascriptProps>
    implements JavascriptHandle
  {
    private handle = createRef<JavascriptHandle>();
    exportJavascript(): JavascriptArchive {
      if (!this.handle.current)
        throw new Error("Export requires a mounted JavaScript program");
      return this.handle.current.exportJavascript();
    }
    advanceAnimations(timeMs: number) {
      if (!this.handle.current?.advanceAnimations)
        throw new Error("Program has no mounted CSS animation clock");
      this.handle.current.advanceAnimations(timeMs);
    }
    pauseAnimations() {
      if (!this.handle.current?.pauseAnimations)
        throw new Error("Program has no mounted CSS animation clock");
      this.handle.current.pauseAnimations();
    }
    playAnimations() {
      if (!this.handle.current?.playAnimations)
        throw new Error("Program has no mounted CSS animation clock");
      this.handle.current.playAnimations();
    }
    animationState() {
      if (!this.handle.current?.animationState)
        throw new Error("Program has no mounted CSS animation clock");
      return this.handle.current.animationState();
    }
    render() {
      return h(JavascriptProgram, { ...this.props, handle: this.handle });
    }
  };
}
