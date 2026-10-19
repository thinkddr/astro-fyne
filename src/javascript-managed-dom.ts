// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import {
  validJavascriptText,
  validateJavascriptZeroHeight,
} from "./javascript-data.ts";
import type { JavascriptFrame } from "./javascript-types.ts";

const tags = new Set(
  "div main section header footer aside article nav ul ol li p h1 h2 h3 h4 h5 h6 span label button a input textarea".split(
    " ",
  ),
);
const attributes = new Set(
  "id class type placeholder aria-label for href value checked disabled".split(
    " ",
  ),
);
const pixelStyles = new Set(
  "width height padding paddingTop paddingRight paddingBottom paddingLeft gap fontSize borderWidth borderRadius margin".split(
    " ",
  ),
);
const stringStyles = new Set(
  "background backgroundColor color borderColor fontFamily fontStyle textAlign whiteSpace display flexDirection borderStyle".split(
    " ",
  ),
);
const asciiLower = (value: string) =>
  value.replace(/[A-Z]/g, (character) => character.toLowerCase());
type Plan = Map<string, { frame: JavascriptFrame; styles: [string, string][] }>;
type Dispatch = (
  uid: string,
  type: "click" | "input" | "change",
  value?: string,
) => boolean | void;

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`JavaScript DOM frame: ${message}`);
}

/** Validate the entire next tree before creating or changing its visible DOM. */
export function prepareJavascriptDOM(
  frames: JavascriptFrame[],
  previousTags: ReadonlyMap<string, string> = new Map(),
): Plan {
  const plan: Plan = new Map();
  const visit = (children: JavascriptFrame[], depth: number) => {
    requireValue(
      Array.isArray(children) && depth <= 100,
      "invalid children or tree depth",
    );
    for (const frame of children) {
      requireValue(
        frame !== null && typeof frame === "object" && !Array.isArray(frame),
        "invalid node",
      );
      requireValue(
        typeof frame.uid === "string" &&
          frame.uid.length > 0 &&
          !plan.has(frame.uid),
        "missing or duplicate UID",
      );
      requireValue(plan.size < 100000, "tree exceeds its node limit");
      requireValue(
        frame.tag === "#text" || tags.has(frame.tag),
        `unsupported element ${frame.tag}`,
      );
      requireValue(
        !previousTags.has(frame.uid) ||
          previousTags.get(frame.uid) === frame.tag,
        `UID ${frame.uid} changed its element type`,
      );
      validJavascriptText(frame.uid);
      if (frame.text !== undefined) {
        requireValue(typeof frame.text === "string", "text must be a string");
        validJavascriptText(frame.text);
      }
      const styles: [string, string][] = [];
      plan.set(frame.uid, { frame, styles });
      if (frame.tag === "#text") {
        requireValue(
          typeof frame.text === "string" &&
            frame.attrs === undefined &&
            frame.style === undefined &&
            frame.children === undefined,
          "text nodes must contain only text",
        );
        continue;
      }
      const attrs = frame.attrs ?? {};
      requireValue(
        typeof attrs === "object" && !Array.isArray(attrs),
        "attributes must be a record",
      );
      for (const [name, value] of Object.entries(attrs)) {
        requireValue(
          (attributes.has(name) || name.startsWith("data-")) &&
            !/[\0\t\n\f\r /=>]/.test(name) &&
            name === asciiLower(name),
          `unsupported attribute ${name}`,
        );
        requireValue(
          typeof value === "string",
          `attribute ${name} must be a string`,
        );
        validJavascriptText(value);
      }
      if (frame.tag === "input")
        requireValue(
          ["", "text", "checkbox"].includes(asciiLower(attrs.type ?? "")),
          "unsupported input type",
        );
      for (const name of ["value", "disabled", "checked"] as const) {
        if (frame[name] !== undefined)
          requireValue(
            typeof frame[name] === (name === "value" ? "string" : "boolean"),
            `invalid ${name}`,
          );
      }
      if (frame.value !== undefined) validJavascriptText(frame.value);
      const properties = frame.style ?? {};
      requireValue(
        typeof properties === "object" && !Array.isArray(properties),
        "styles must be a record",
      );
      for (const [name, value] of Object.entries(properties)) {
        requireValue(
          pixelStyles.has(name) ||
            stringStyles.has(name) ||
            name === "fontWeight" ||
            name === "lineHeight",
          `unsupported CSS property ${name}`,
        );
        requireValue(
          typeof value === "string" ||
            (typeof value === "number" && Number.isFinite(value) && value >= 0),
          `invalid CSS value ${name}`,
        );
        if (typeof value === "string") validJavascriptText(value);
        if (stringStyles.has(name))
          requireValue(
            typeof value === "string",
            `CSS ${name} requires a string`,
          );
        const cssName = name.replace(
          /[A-Z]/g,
          (character) => "-" + character.toLowerCase(),
        );
        styles.push([
          cssName,
          typeof value === "number" && pixelStyles.has(name)
            ? `${value}px`
            : String(value),
        ]);
      }
      requireValue(
        frame.events === undefined ||
          (Array.isArray(frame.events) &&
            frame.events.every(
              (event) =>
                typeof event === "string" &&
                /^(click|input|change)(true|false)$/.test(event),
            )),
        "unsupported event binding",
      );
      const nested = frame.children ?? [];
      validateJavascriptZeroHeight(frame);
      if (
        [
          "p",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "span",
          "label",
          "button",
          "a",
          "textarea",
        ].includes(frame.tag)
      )
        requireValue(
          Array.isArray(nested) &&
            nested.every((child) => child?.tag === "#text"),
          `rich children of ${frame.tag} require an adapter`,
        );
      visit(nested, depth + 1);
    }
  };
  visit(frames, 0);
  return plan;
}

type Entry = {
  node: HTMLElement | Text;
  tag: string;
  attributes: Set<string>;
  style: string;
  listeners: [string, EventListener][];
};

/** Preact owns the wrapper; this map owns its nodes across every virtual parent. */
export class ManagedJavascriptDOM {
  private entries = new Map<string, Entry>();
  private current: Plan = new Map();
  private targets = new WeakMap<EventTarget, string>();
  private fault?: { error: unknown };
  private click: EventListener = (event) => {
    try {
      this.validate();
      const target = event.target;
      const uid = target && this.targets.get(target);
      if (!uid || this.entries.get(uid)?.node !== target)
        throw new Error(
          "JavaScript DOM pointer: wrapper background or foreign nodes require a root pointer adapter",
        );
      this.event(uid, event);
    } catch (error) {
      this.fault = { error };
      this.onError(error);
      throw error;
    }
  };
  constructor(
    private wrapper: HTMLElement,
    private dispatch: Dispatch,
    private onError: (error: unknown) => void = () => {},
  ) {
    wrapper.addEventListener("click", this.click);
  }

  validate() {
    if (this.fault) throw this.fault.error;
  }

  element(uid: string): HTMLElement | undefined {
    const entry = this.entries.get(uid);
    return entry && entry.tag !== "#text"
      ? (entry.node as HTMLElement)
      : undefined;
  }

  private event(uid: string, event: Event) {
    this.validate();
    const frame = this.current.get(uid)?.frame;
    if (!frame) return;
    const checkbox =
      frame.tag === "input" &&
      asciiLower(frame.attrs?.type ?? "text") === "checkbox";
    if (event.type === "click") {
      if (frame.disabled) return;
      if (checkbox) {
        if (this.dispatch(uid, "click") === true) event.preventDefault();
      } else {
        const ownsDefault =
          frame.tag === "button" ||
          frame.tag === "a" ||
          (frame.tag === "label" && !!frame.attrs?.for);
        if (ownsDefault) event.preventDefault();
        if (this.dispatch(uid, "click") === true) event.preventDefault();
      }
    } else if (
      !checkbox &&
      (frame.tag === "input" || frame.tag === "textarea") &&
      (event.type === "input" || event.type === "change")
    ) {
      this.dispatch(
        uid,
        event.type,
        (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value,
      );
    }
  }

  commit(frames: JavascriptFrame[]) {
    this.validate();
    const plan = prepareJavascriptDOM(
      frames,
      new Map([...this.entries].map(([uid, entry]) => [uid, entry.tag])),
    );
    const document = this.wrapper.ownerDocument;
    for (const [uid, { frame }] of plan) {
      if (this.entries.has(uid)) continue;
      const node =
        frame.tag === "#text"
          ? document.createTextNode(frame.text!)
          : document.createElement(frame.tag);
      const entry: Entry = {
        node,
        tag: frame.tag,
        attributes: new Set(),
        style: "",
        listeners: [],
      };
      if (["input", "textarea"].includes(frame.tag)) {
        const listener: EventListener = (event) => this.event(uid, event);
        for (const type of ["input", "change"]) {
          node.addEventListener(type, listener);
          entry.listeners.push([type, listener]);
        }
      }
      this.entries.set(uid, entry);
      if (frame.tag !== "#text") this.targets.set(node, uid);
    }
    this.current = plan;
    const place = (parent: Node, children: JavascriptFrame[]) => {
      const wanted = new Set<Node>(
        children.map((frame) => this.entries.get(frame.uid)!.node),
      );
      let cursor = parent.firstChild;
      for (const frame of children) {
        while (cursor && !wanted.has(cursor)) cursor = cursor.nextSibling;
        const node = this.entries.get(frame.uid)!.node;
        if (node === cursor) cursor = node.nextSibling;
        else parent.insertBefore(node, cursor);
        if (frame.tag !== "#text") place(node, frame.children ?? []);
      }
    };
    place(this.wrapper, frames);
    const prune = (parent: Node, children: JavascriptFrame[]) => {
      const wanted = new Set<Node>(
        children.map((frame) => this.entries.get(frame.uid)!.node),
      );
      for (const node of Array.from(parent.childNodes))
        if (!wanted.has(node)) parent.removeChild(node);
    };
    prune(this.wrapper, frames);
    for (const { frame } of plan.values())
      if (frame.tag !== "#text")
        prune(this.entries.get(frame.uid)!.node, frame.children ?? []);
    for (const [uid, entry] of this.entries) {
      if (plan.has(uid)) continue;
      for (const [type, listener] of entry.listeners)
        entry.node.removeEventListener(type, listener);
      entry.node.parentNode?.removeChild(entry.node);
      this.entries.delete(uid);
    }
    for (const [uid, { frame, styles }] of plan) {
      const entry = this.entries.get(uid)!;
      if (frame.tag === "#text") {
        if (entry.node.nodeValue !== frame.text)
          entry.node.nodeValue = frame.text!;
        continue;
      }
      const element = entry.node as HTMLElement,
        attrs = frame.attrs ?? {};
      for (const name of entry.attributes)
        if (!Object.hasOwn(attrs, name)) element.removeAttribute(name);
      for (const [name, value] of Object.entries(attrs))
        if (element.getAttribute(name) !== value)
          element.setAttribute(name, value);
      entry.attributes = new Set(Object.keys(attrs));
      element.setAttribute("data-afy-js", uid);
      const style = JSON.stringify(styles);
      if (style !== entry.style) {
        element.style.cssText = "";
        for (const [name, value] of styles)
          element.style.setProperty(name, value);
        entry.style = style;
      }
    }
    // Defaults come from attributes/child text; live editor state is separate.
    for (const [uid, { frame }] of plan) {
      const element = this.element(uid);
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        if (element.value !== (frame.value ?? ""))
          element.value = frame.value ?? "";
        if (element.disabled !== !!frame.disabled)
          element.disabled = !!frame.disabled;
        if (
          element instanceof HTMLInputElement &&
          element.type === "checkbox" &&
          element.checked !== !!frame.checked
        )
          element.checked = !!frame.checked;
      } else if (
        element instanceof HTMLButtonElement &&
        element.disabled !== !!frame.disabled
      )
        element.disabled = !!frame.disabled;
    }
  }

  dispose() {
    this.wrapper.removeEventListener("click", this.click);
    this.current.clear();
    for (const entry of this.entries.values())
      for (const [type, listener] of entry.listeners)
        entry.node.removeEventListener(type, listener);
    this.entries.clear();
    this.wrapper.replaceChildren();
  }
}
