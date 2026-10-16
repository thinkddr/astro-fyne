// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export function JavascriptHierarchy() {
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const caption = useRef<Text | null>(null);
  const [result, setResult] = useState("ready");
  useLayoutEffect(() => {
    const input = document.createElement("input");
    input.id = "js-hierarchy-input";
    input.defaultValue = "initial";
    const text = document.createTextNode("caption");
    host.current!.appendChild(input);
    host.current!.appendChild(text);
    field.current = input;
    caption.current = text;
    return () => {
      input.remove();
      text.remove();
      field.current = null;
      caption.current = null;
    };
  }, []);

  const perform = (
    operation: "text-append" | "text-reference" | "valid-text",
  ) => {
    const input = field.current!;
    const text = caption.current!;
    let error = "none";
    let returned = false;
    try {
      if (operation === "valid-text")
        returned = host.current!.insertBefore(text, input) === text;
      else if (operation === "text-reference")
        returned =
          text.insertBefore(input, document.createElement("span")) === input;
      else returned = text.appendChild(input) === input;
    } catch (failure) {
      error = (failure as Error).name;
    }
    setResult(
      JSON.stringify({
        operation,
        error,
        returned,
        same: document.getElementById("js-hierarchy-input") === input,
        attached: input.parentNode === host.current,
        value: input.value,
        defaultValue: input.defaultValue,
        textChildren: text.childNodes.length,
        order: Array.from(host.current!.childNodes).map((child) =>
          child === input ? "input" : child === text ? "caption" : "unexpected",
        ),
      }),
    );
  };

  return (
    <section id="js-hierarchy-root">
      <div id="js-hierarchy-host" ref={host} />
      <button
        id="js-hierarchy-text-append"
        onClick={() => perform("text-append")}
      >
        Reject text parent
      </button>
      <button
        id="js-hierarchy-text-reference"
        onClick={() => perform("text-reference")}
      >
        Reject text parent before reference
      </button>
      <button
        id="js-hierarchy-valid-text"
        onClick={() => perform("valid-text")}
      >
        Insert text into element
      </button>
      <p id="js-hierarchy-result">{result}</p>
    </section>
  );
}
