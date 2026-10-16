// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export function JavascriptTextContent() {
  const host = useRef<HTMLDivElement>(null);
  const nodes = useRef<{
    guard: HTMLDivElement;
    input: HTMLInputElement;
    caption: Text;
    label: HTMLParagraphElement;
    pristine: HTMLTextAreaElement;
    dirty: HTMLTextAreaElement;
    texts: Text[];
  } | null>(null);
  const [result, setResult] = useState("ready");
  useLayoutEffect(() => {
    const guard = document.createElement("div");
    guard.id = "js-textcontent-guard";
    const input = document.createElement("input");
    input.id = "js-textcontent-input";
    input.defaultValue = "initial";
    const caption = document.createTextNode("caption");
    guard.appendChild(input);
    guard.appendChild(caption);
    host.current!.appendChild(guard);
    const label = document.createElement("p");
    label.id = "js-textcontent-text";
    const pristine = document.createElement("textarea");
    pristine.id = "js-textcontent-pristine";
    const dirty = document.createElement("textarea");
    dirty.id = "js-textcontent-dirty";
    const texts = [label, pristine, dirty].map((parent) => {
      const text = document.createTextNode("seed");
      parent.appendChild(text);
      host.current!.appendChild(parent);
      return text;
    });
    nodes.current = { guard, input, caption, label, pristine, dirty, texts };
    return () => {
      for (const parent of [guard, label, pristine, dirty]) parent.remove();
      nodes.current = null;
    };
  }, []);
  const perform = (
    operation: "null" | "undefined" | "number" | "symbol" | "parent-symbol",
  ) => {
    const { guard, input, caption, label, pristine, dirty, texts } =
      nodes.current!;
    const value =
      operation === "null"
        ? null
        : operation === "undefined"
          ? undefined
          : operation === "number"
            ? 42
            : Symbol("rejected");
    const targets =
      operation === "parent-symbol" ? [guard, label, pristine, dirty] : texts;
    const errors = targets.map((target) => {
      try {
        Reflect.set(target, "textContent", value);
        return "none";
      } catch (failure) {
        return (failure as Error).name;
      }
    });
    setResult(
      JSON.stringify({
        operation,
        errors,
        same: [label, pristine, dirty].every(
          (parent, index) =>
            parent.firstChild === texts[index] &&
            parent.childNodes.length === 1,
        ),
        text: { data: texts[0]!.data, textContent: label.textContent },
        pristine: {
          data: texts[1]!.data,
          textContent: pristine.textContent,
          defaultValue: pristine.defaultValue,
          value: pristine.value,
        },
        dirty: {
          data: texts[2]!.data,
          textContent: dirty.textContent,
          defaultValue: dirty.defaultValue,
          value: dirty.value,
        },
        guard: {
          same:
            guard.firstChild === input &&
            input.nextSibling === caption &&
            caption.nextSibling === null,
          parent: input.parentNode === guard,
          defaultValue: input.defaultValue,
          rawValue: input.getAttribute("value"),
          value: input.value,
          textContent: guard.textContent,
        },
      }),
    );
  };
  return (
    <section id="js-textcontent-root">
      <div id="js-textcontent-host" ref={host} />
      <button id="js-textcontent-null" onClick={() => perform("null")}>
        Clear textContent with null
      </button>
      <button
        id="js-textcontent-undefined"
        onClick={() => perform("undefined")}
      >
        Clear textContent with undefined
      </button>
      <button id="js-textcontent-number" onClick={() => perform("number")}>
        Convert numeric textContent
      </button>
      <button id="js-textcontent-symbol" onClick={() => perform("symbol")}>
        Reject symbolic Text content
      </button>
      <button
        id="js-textcontent-parent-symbol"
        onClick={() => perform("parent-symbol")}
      >
        Reject symbolic Element content
      </button>
      <p id="js-textcontent-result">{result}</p>
    </section>
  );
}
