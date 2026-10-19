// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useState } from "preact/hooks";
import "./catalogue-counter.css";

export default function CatalogueCounter({
  observe,
}: {
  observe: (count: number) => void;
}) {
  const [count, setCount] = useState(0);
  return (
    <section
      id="catalogue-card"
      class="catalogue-card"
      data-active={count > 0 ? "true" : "false"}
    >
      <span id="catalogue-count">{count}</span>
      <button
        id="catalogue-increment"
        onClick={() => {
          setCount((value) => value + 1);
          observe(count + 1);
        }}
      >
        Increment
      </button>
    </section>
  );
}
