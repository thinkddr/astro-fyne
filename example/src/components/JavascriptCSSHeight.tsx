// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import "./javascript-css-height.css";

export default function JavascriptCSSHeight({
  eased = false,
}: {
  eased?: boolean;
}) {
  return (
    <main id="height-root">
      <section id="height-panel" className={eased ? "eased" : ""} />
      <section id="height-sibling" />
    </main>
  );
}
