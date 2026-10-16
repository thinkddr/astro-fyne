// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export function JavascriptInsertion() {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const [result, setResult] = useState("ready");

  useLayoutEffect(() => {
    const input = document.createElement("input");
    input.id = "js-insert-input";
    input.defaultValue = "initial";
    const anchor = document.createElement("span");
    anchor.id = "js-insert-anchor";
    anchor.textContent = "anchor";
    left.current!.appendChild(input);
    left.current!.appendChild(anchor);
    field.current = input;
    return () => {
      input.remove();
      anchor.remove();
      field.current = null;
    };
  }, []);

  const perform = (operation: "invalid" | "move" | "foreign-self" | "self") => {
    const input = field.current!;
    let error = "none";
    let returned = false;
    try {
      const parent =
        operation === "invalid" || operation === "foreign-self"
          ? right.current!
          : left.current!;
      const before =
        operation === "invalid"
          ? document.createElement("span")
          : operation === "move"
            ? null
            : input;
      returned = parent.insertBefore(input, before) === input;
    } catch (failure) {
      error = (failure as Error).name;
    }
    const order = (parent: HTMLDivElement) =>
      Array.from(parent.childNodes).map((node) => (node as HTMLElement).id);
    setResult(
      JSON.stringify({
        operation,
        error,
        returned,
        same: document.getElementById("js-insert-input") === input,
        parent: (input.parentNode as HTMLElement | null)?.id ?? null,
        value: input.value,
        defaultValue: input.defaultValue,
        left: order(left.current!),
        right: order(right.current!),
      }),
    );
  };

  return (
    <section id="js-insert-root">
      <div id="js-insert-left" ref={left} />
      <div id="js-insert-right" ref={right} />
      <button id="js-insert-invalid" onClick={() => perform("invalid")}>
        Invalid reference
      </button>
      <button id="js-insert-move" onClick={() => perform("move")}>
        Move within parent
      </button>
      <button
        id="js-insert-foreign-self"
        onClick={() => perform("foreign-self")}
      >
        Foreign self reference
      </button>
      <button id="js-insert-self" onClick={() => perform("self")}>
        Valid self reference
      </button>
      <p id="js-insert-result">{result}</p>
    </section>
  );
}
