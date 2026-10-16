// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export function JavascriptCharacterData() {
  const host = useRef<HTMLDivElement>(null);
  const nodes = useRef<{
    label: HTMLParagraphElement;
    pristine: HTMLTextAreaElement;
    dirty: HTMLTextAreaElement;
    texts: Text[];
  } | null>(null);
  const [result, setResult] = useState("ready");
  useLayoutEffect(() => {
    const label = document.createElement("p");
    label.id = "js-data-text";
    const pristine = document.createElement("textarea");
    pristine.id = "js-data-pristine";
    const dirty = document.createElement("textarea");
    dirty.id = "js-data-dirty";
    const texts = [label, pristine, dirty].map((parent) => {
      const text = document.createTextNode("seed");
      parent.appendChild(text);
      host.current!.appendChild(parent);
      return text;
    });
    nodes.current = { label, pristine, dirty, texts };
    return () => {
      for (const parent of [label, pristine, dirty]) parent.remove();
      nodes.current = null;
    };
  }, []);
  const perform = (operation: "null" | "undefined" | "number" | "symbol") => {
    const { label, pristine, dirty, texts } = nodes.current!;
    const value =
      operation === "null"
        ? null
        : operation === "undefined"
          ? undefined
          : operation === "number"
            ? 42
            : Symbol("rejected");
    const errors = texts.map((text) => {
      try {
        Reflect.set(text, "data", value);
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
        createdNull: document.createTextNode(null as unknown as string).data,
      }),
    );
  };
  return (
    <section id="js-data-root">
      <div id="js-data-host" ref={host} />
      <button id="js-data-null" onClick={() => perform("null")}>
        Clear CharacterData with null
      </button>
      <button id="js-data-undefined" onClick={() => perform("undefined")}>
        Convert undefined CharacterData
      </button>
      <button id="js-data-number" onClick={() => perform("number")}>
        Convert numeric CharacterData
      </button>
      <button id="js-data-symbol" onClick={() => perform("symbol")}>
        Reject symbolic CharacterData
      </button>
      <p id="js-data-result">{result}</p>
    </section>
  );
}
