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
} from "./javascript-types.ts";

export interface JavascriptHandle {
  exportJavascript(): JavascriptArchive;
}
export interface JavascriptProps {
  actions?: JavascriptActions;
  ref?: Ref<JavascriptHandle>;
}
const emptyActions: JavascriptActions = {};

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
      };
    }
    const ctx = context.current;
    if ((input.actions ?? emptyActions) !== ctx.actions)
      throw new Error(
        "JavaScript action bindings must stay stable; remount to replace them",
      );
    const [frames, setFrames] = useState(() => ctx.api.snapshot());
    const wrapper = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const generation = ctx.generation;
      try {
        if (!wrapper.current) throw new Error("Missing JavaScript DOM wrapper");
        ctx.dom ??= new ManagedJavascriptDOM(wrapper.current, dispatch);
        ctx.dom.commit(frames);
        ctx.dirty = ctx.generation !== generation;
        ctx.mounted = true;
      } catch (error) {
        ctx.error = error;
        ctx.mounted = false;
        throw error;
      }
    });
    useLayoutEffect(
      () => () => {
        ctx.mounted = false;
        ctx.dom?.dispose();
        ctx.api.dispose();
      },
      [],
    );
    useImperativeHandle(input.handle, () => ({
      exportJavascript() {
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
    }));
    const dispatch = (
      uid: string,
      type: "click" | "input" | "change",
      value?: string,
    ) => {
      ctx.dirty = true;
      ctx.generation++;
      try {
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
    render() {
      return h(JavascriptProgram, { ...this.props, handle: this.handle });
    }
  };
}
