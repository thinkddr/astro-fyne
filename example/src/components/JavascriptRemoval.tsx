// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export function JavascriptRemoval() {
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const caption = useRef<Text | null>(null);
  const [result, setResult] = useState("ready");
  useLayoutEffect(() => {
    const input = document.createElement("input");
    input.id = "js-removal-input";
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
    operation: "foreign" | "detached" | "text-parent" | "valid",
  ) => {
    const input = field.current!,
      text = caption.current!;
    let error = "none",
      returned = false,
      detached = false;
    try {
      if (operation === "foreign")
        returned = document.createElement("div").removeChild(input) === input;
      else if (operation === "detached") {
        const child = document.createElement("span");
        returned = host.current!.removeChild(child) === child;
      } else if (operation === "text-parent")
        returned = text.removeChild(input) === input;
      else {
        const removed = host.current!.removeChild(input);
        returned = removed === input;
        detached = removed.parentNode === null;
        host.current!.insertBefore(removed, text);
      }
    } catch (failure) {
      error = (failure as Error).name;
    }
    setResult(
      JSON.stringify({
        operation,
        error,
        returned,
        detached,
        same: document.getElementById("js-removal-input") === input,
        attached: input.parentNode === host.current,
        value: input.value,
        defaultValue: input.defaultValue,
        rawValue: input.getAttribute("value"),
        textChildren: text.childNodes.length,
        order: Array.from(host.current!.childNodes).map((child) =>
          child === input ? "input" : child === text ? "caption" : "unexpected",
        ),
      }),
    );
  };
  return (
    <section id="js-removal-root">
      <div id="js-removal-host" ref={host} />
      <button id="js-removal-foreign" onClick={() => perform("foreign")}>
        Reject foreign removal
      </button>
      <button id="js-removal-detached" onClick={() => perform("detached")}>
        Reject detached removal
      </button>
      <button
        id="js-removal-text-parent"
        onClick={() => perform("text-parent")}
      >
        Reject Text-parent removal
      </button>
      <button id="js-removal-valid" onClick={() => perform("valid")}>
        Remove and reattach edited input
      </button>
      <p id="js-removal-result">{result}</p>
    </section>
  );
}
