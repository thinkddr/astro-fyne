// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export default function JavascriptPointers({
  observe,
}: {
  observe: (...values: unknown[]) => null;
}) {
  const root = useRef<HTMLDivElement>(null),
    padding = useRef<HTMLDivElement>(null),
    dynamic = useRef<HTMLSpanElement>(null),
    moving = useRef<HTMLSpanElement>(null),
    left = useRef<HTMLDivElement>(null),
    right = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0),
    [active, setActive] = useState(true);
  function record(label: string, event: Event) {
    const target = event.target as HTMLElement,
      current = event.currentTarget as HTMLElement;
    observe(
      label,
      event.type,
      target.id,
      current.id,
      event.eventPhase,
      event.defaultPrevented,
    );
  }
  useLayoutEffect(() => {
    const entries = [
      [root.current!, "root"],
      [padding.current!, "padding"],
    ] as const;
    const cleanup: (() => void)[] = [];
    for (const [node, name] of entries)
      for (const capture of [true, false]) {
        const listener = (event: Event) =>
          record(`${name}-${capture ? "capture" : "bubble"}`, event);
        node.addEventListener("click", listener, capture);
        cleanup.push(() =>
          node.removeEventListener("click", listener, capture),
        );
      }
    return () => cleanup.forEach((dispose) => dispose());
  }, []);
  useLayoutEffect(() => {
    if (!active) return;
    const target = dynamic.current!,
      listener = (event: Event) => record("dynamic", event);
    target.addEventListener("click", listener);
    return () => target.removeEventListener("click", listener);
  }, [active]);
  const line = { display: "block", height: "28px" };
  return (
    <div id="pointer-root" ref={root} style={{ padding: "12px" }}>
      <div
        id="pointer-padding"
        ref={padding}
        style={{ padding: "12px", height: "76px", background: "#e9edf1" }}
      >
        <span id="pointer-silent" style={line}>
          Listener-free target
        </span>
      </div>
      <p
        id="pointer-text"
        style={{ margin: 0, height: "28px" }}
        onClick={(event) => {
          record("text", event);
          setCount((value) => value + 1);
        }}
      >
        Click plain text
      </p>
      <div id="pointer-raw" style={{ height: "28px" }}>
        Raw text in a container
      </div>
      <span
        id="pointer-stop"
        style={line}
        onClick={(event) => {
          event.stopPropagation();
          record("stop", event);
        }}
      >
        Stop propagation
      </span>
      <span
        id="pointer-immediate"
        style={line}
        ref={(node) => {
          if (node && !(node as any)._afyBound) {
            (node as any)._afyBound = true;
            node.addEventListener("click", (event) => {
              event.stopImmediatePropagation();
              record("immediate", event);
            });
            node.addEventListener("click", (event) =>
              record("unreachable", event),
            );
          }
        }}
      >
        Stop immediate propagation
      </span>
      <span id="pointer-dynamic" ref={dynamic} style={line}>
        Optional listener
      </span>
      <button
        id="pointer-toggle"
        onClick={(event) => {
          record("toggle", event);
          setActive((value) => !value);
        }}
      >
        Toggle listener
      </button>
      <div id="pointer-left" ref={left}>
        <span id="pointer-moving" ref={moving} style={line}>
          Retained moving target
        </span>
      </div>
      <div id="pointer-right" ref={right} />
      <button
        id="pointer-reparent"
        onClick={(event) => {
          record("reparent", event);
          const target = moving.current!;
          (target.parentNode === left.current
            ? right.current!
            : left.current!
          ).appendChild(target);
        }}
      >
        Move target
      </button>
      <input
        id="pointer-input"
        defaultValue="editable"
        onClick={(event) => record("input", event)}
      />
      <textarea
        id="pointer-textarea"
        defaultValue="editable"
        onClick={(event) => record("textarea", event)}
      />
      <label
        id="pointer-label"
        for="pointer-check"
        onClick={(event) => record("label", event)}
      >
        Activate checkbox
      </label>
      <input
        id="pointer-check"
        type="checkbox"
        onClick={(event) => record("checkbox", event)}
        onInput={(event) => record("checkbox-input", event)}
        onChange={(event) => record("checkbox-change", event)}
      />
      <input
        id="pointer-cancel"
        type="checkbox"
        onClick={(event) => {
          event.preventDefault();
          record("cancel", event);
        }}
        onInput={(event) => record("unreachable", event)}
        onChange={(event) => record("unreachable", event)}
      />
      <button
        id="pointer-disabled"
        disabled
        onClick={(event) => record("unreachable", event)}
      >
        Disabled blocker
      </button>
      <p id="pointer-count" style={{ margin: 0, height: "28px" }}>
        {count}
      </p>
    </div>
  );
}
