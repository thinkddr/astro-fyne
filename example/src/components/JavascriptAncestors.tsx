// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useLayoutEffect, useRef, useState } from "preact/hooks";

type Operation =
  | "self-append"
  | "ancestor-append"
  | "ancestor-reference"
  | "cross-parent"
  | "same-parent"
  | "move-back"
  | "valid-self";
type Nodes = {
  outer: HTMLDivElement;
  inner: HTMLDivElement;
  right: HTMLDivElement;
  input: HTMLInputElement;
  leftAnchor: HTMLSpanElement;
  rightAnchor: HTMLSpanElement;
};

export function JavascriptAncestors() {
  const mount = useRef<HTMLDivElement>(null);
  const nodes = useRef<Nodes | null>(null);
  const [result, setResult] = useState("ready");

  useLayoutEffect(() => {
    const outer = document.createElement("div");
    outer.id = "js-ancestor-outer";
    const inner = document.createElement("div");
    inner.id = "js-ancestor-inner";
    const right = document.createElement("div");
    right.id = "js-ancestor-right";
    const input = document.createElement("input");
    input.id = "js-ancestor-input";
    input.defaultValue = "initial";
    const leftAnchor = document.createElement("span");
    leftAnchor.id = "js-ancestor-left-anchor";
    const rightAnchor = document.createElement("span");
    rightAnchor.id = "js-ancestor-right-anchor";
    inner.appendChild(input);
    inner.appendChild(leftAnchor);
    outer.appendChild(inner);
    right.appendChild(rightAnchor);
    mount.current!.appendChild(outer);
    mount.current!.appendChild(right);
    nodes.current = { outer, inner, right, input, leftAnchor, rightAnchor };
    return () => {
      outer.remove();
      right.remove();
      nodes.current = null;
    };
  }, []);

  const perform = (operation: Operation) => {
    const { outer, inner, right, input, leftAnchor, rightAnchor } =
      nodes.current!;
    let error = "none";
    let returned = false;
    try {
      if (operation === "self-append")
        returned = outer.appendChild(outer) === outer;
      else if (operation === "ancestor-append")
        returned = inner.appendChild(outer) === outer;
      else if (operation === "ancestor-reference")
        returned =
          inner.insertBefore(outer, document.createElement("span")) === outer;
      else if (operation === "cross-parent")
        returned = right.insertBefore(input, rightAnchor) === input;
      else if (operation === "same-parent")
        returned = right.appendChild(input) === input;
      else if (operation === "move-back")
        returned = inner.insertBefore(input, leftAnchor) === input;
      else returned = inner.insertBefore(input, input) === input;
    } catch (failure) {
      error = (failure as Error).name;
    }
    const order = (parent: HTMLDivElement) =>
      Array.from(parent.childNodes).map((child) => (child as HTMLElement).id);
    setResult(
      JSON.stringify({
        operation,
        error,
        returned,
        same: document.getElementById("js-ancestor-input") === input,
        outerAttached: outer.parentNode === mount.current,
        innerAttached: inner.parentNode === outer,
        parent: (input.parentNode as HTMLElement | null)?.id ?? null,
        value: input.value,
        defaultValue: input.defaultValue,
        rawValue: input.getAttribute("value"),
        mount: order(mount.current!),
        outer: order(outer),
        inner: order(inner),
        right: order(right),
      }),
    );
  };

  return (
    <section id="js-ancestor-root">
      <div id="js-ancestor-host" ref={mount} />
      <button
        id="js-ancestor-self-append"
        onClick={() => perform("self-append")}
      >
        Reject self append
      </button>
      <button
        id="js-ancestor-append"
        onClick={() => perform("ancestor-append")}
      >
        Reject ancestor append
      </button>
      <button
        id="js-ancestor-reference"
        onClick={() => perform("ancestor-reference")}
      >
        Reject ancestor before reference
      </button>
      <button id="js-ancestor-cross" onClick={() => perform("cross-parent")}>
        Move across parents
      </button>
      <button id="js-ancestor-reorder" onClick={() => perform("same-parent")}>
        Reorder within parent
      </button>
      <button id="js-ancestor-back" onClick={() => perform("move-back")}>
        Return edited input
      </button>
      <button id="js-ancestor-valid-self" onClick={() => perform("valid-self")}>
        Retain valid self reference
      </button>
      <p id="js-ancestor-result">{result}</p>
    </section>
  );
}
