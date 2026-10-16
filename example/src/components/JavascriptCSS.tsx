// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useState } from "preact/hooks";
import "./javascript-css.css";
export function JavascriptCSS() {
  const [mode, setMode] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <section class="css-theme" data-mode={mode ? "alt" : "base"}>
      <p id="css-count">{count}</p>
      <p id="css-cycle-self">Self cycle</p>
      <p id="css-cycle-mutual">Mutual cycle</p>
      <p id="css-cycle-fallback">Fallback dependency</p>
      <section class="css-cycle-parent">
        <p id="css-cycle-inherited">Inherited computed value</p>
      </section>
      <button
        id="css-increment"
        class={mode ? "css-button alt" : "css-button"}
        style={{ color: "#00ffff" }}
        onClick={() => setCount((value) => value + 1)}
      >
        Count
      </button>
      <button
        id="css-mode"
        class="css-button"
        onClick={() => setMode((value) => !value)}
      >
        Mode
      </button>
      <button id="css-disabled" class="css-button" disabled>
        Disabled
      </button>
    </section>
  );
}
