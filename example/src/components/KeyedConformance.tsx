// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useState } from "preact/hooks";

function ConditionalEditor({ label, seed }: { label: string; seed: string }) {
  const [count, setCount] = useState(0);
  const [text, setText] = useState(seed);
  return (
    <section id={`${label}-branch`}>
      <p id={`${label}-branch-count`}>{count}</p>
      <p id={`${label}-branch-text`}>{text}</p>
      <p id={`${label}-branch-label`}>{seed}</p>
      <button
        id={`${label}-branch-increment`}
        type="button"
        onClick={() => setCount((previous) => previous + 1)}
      >
        Increment branch
      </button>
      <input
        id={`${label}-branch-input`}
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
      />
    </section>
  );
}

function KeyedRow({ label, inputId }: { label: string; inputId: string }) {
  const [count, setCount] = useState(0);
  const [text, setText] = useState(label);
  const [alternate, setAlternate] = useState(false);
  return (
    <section id={`${label}-row`}>
      <p id={`${label}-value`}>{count}</p>
      <p id={`${label}-text`}>{text}</p>
      <button
        id={`${label}-increment`}
        type="button"
        onClick={() => setCount((previous) => previous + 1)}
      >
        Increment
      </button>
      <input
        id={inputId}
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
      />
      <button
        id={`${label}-branch-toggle`}
        type="button"
        onClick={() => setAlternate((previous) => !previous)}
      >
        Alternate compatible component branch
      </button>
      {alternate ? (
        <ConditionalEditor label={label} seed="alternate" />
      ) : (
        <ConditionalEditor label={label} seed="initial" />
      )}
    </section>
  );
}

export function KeyedConformance() {
  const [reversed, setReversed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [revision, setRevision] = useState(0);
  const [renamed, setRenamed] = useState(false);
  const a = { id: `a/${revision}`, label: "a" };
  const b = { id: "b", label: "b" };
  const items = visible ? (reversed ? [b, a] : [a, b]) : [b];
  const [primitives, setPrimitives] = useState(["x", "y"]);
  return (
    <main id="keyed-conformance">
      <button
        id="reorder"
        type="button"
        onClick={() => setReversed((previous) => !previous)}
      >
        Reorder
      </button>
      <button
        id="change-input-id"
        type="button"
        onClick={() => setRenamed((previous) => !previous)}
      >
        Change A DOM id
      </button>
      <button
        id="toggle-a"
        type="button"
        onClick={() => setVisible((previous) => !previous)}
      >
        Unmount or remount A
      </button>
      <button
        id="change-key"
        type="button"
        onClick={() => setRevision((previous) => previous + 1)}
      >
        Change A identity
      </button>
      <div id="keyed-list">
        {items.map((item) => (
          <KeyedRow
            key={item.id}
            label={item.label}
            inputId={
              item.label === "a"
                ? renamed
                  ? "a-renamed-input"
                  : "a-input"
                : "b-input"
            }
          />
        ))}
      </div>
      <button
        id="swap-primitives"
        type="button"
        onClick={() => setPrimitives(["y", "x"])}
      >
        Swap primitive keys
      </button>
      <div id="primitive-list">
        {primitives.map((item) => (
          <p key={item} id={`${item}-primitive`}>
            {item}
          </p>
        ))}
      </div>
    </main>
  );
}
