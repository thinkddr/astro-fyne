// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { h, Component, createRef, type RefObject, type Ref } from "preact";
import {
  useRef,
  useState,
  useLayoutEffect,
  useImperativeHandle,
} from "preact/hooks";
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
      refs: Map<string, HTMLElement>;
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
        refs: new Map(),
      };
    }
    const ctx = context.current;
    if ((input.actions ?? emptyActions) !== ctx.actions)
      throw new Error(
        "JavaScript action bindings must stay stable; remount to replace them",
      );
    const [frames, setFrames] = useState(() => ctx.api.snapshot());
    useLayoutEffect(() => {
      ctx.dirty = false;
      ctx.mounted = true;
    });
    useLayoutEffect(
      () => () => {
        ctx.mounted = false;
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
            const element = ctx.refs.get(frame.uid);
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
      frame: JavascriptFrame,
      type: "click" | "input" | "change",
      value?: string,
    ) => {
      ctx.dirty = true;
      try {
        ctx.api.dispatch({
          node: frame.uid,
          type,
          ...(value === undefined ? {} : { value }),
        });
        ctx.api.flush();
        setFrames(ctx.api.snapshot());
      } catch (error) {
        ctx.error = error;
        throw error;
      }
    };
    const render = (frame: JavascriptFrame): any => {
      if (frame.tag === "#text") return frame.text;
      const props: Record<string, any> = {
        ...frame.attrs,
        style: frame.style,
        key: frame.uid,
        "data-afy-js": frame.uid,
        ref: (element: HTMLElement | null) => {
          if (element) ctx.refs.set(frame.uid, element);
          else ctx.refs.delete(frame.uid);
        },
      };
      if (frame.tag === "button" || frame.tag === "a")
        props.onClick = (event: Event) => {
          event.preventDefault();
          dispatch(frame, "click");
        };
      if (frame.tag === "input" || frame.tag === "textarea") {
        props.value = frame.value;
        props.disabled = frame.disabled;
        props.onInput = (event: Event) =>
          dispatch(
            frame,
            "input",
            (event.currentTarget as HTMLInputElement).value,
          );
        props.onChange = (event: Event) =>
          dispatch(
            frame,
            "change",
            (event.currentTarget as HTMLInputElement).value,
          );
      } else if (frame.tag === "button") props.disabled = frame.disabled;
      return h(frame.tag, props, ...(frame.children ?? []).map(render));
    };
    return h(
      "div",
      { "data-afy-javascript": archive.codeHash },
      ...frames.map(render),
    );
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
