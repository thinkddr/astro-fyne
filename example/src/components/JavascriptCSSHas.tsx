// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import "./css-has.css";

export function JavascriptCSSHas({
  observe,
}: {
  observe: (...args: unknown[]) => void;
}) {
  const [active, setActive] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [moves, setMoves] = useState(0);
  const parent = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement | null>(null);
  const flag = active ? "flag" : "idle";
  useLayoutEffect(() => {
    observe("mount");
    const node = document.createElement("div");
    node.id = "has-marker";
    node.className = "flag";
    node.textContent = "Movable marker";
    holder.current!.appendChild(node);
    marker.current = node;
    return () => {
      node.parentNode?.removeChild(node);
      marker.current = null;
    };
  }, []);
  const move = () => {
    const node = marker.current!;
    (node.parentNode === holder.current
      ? parent.current
      : holder.current)!.appendChild(node);
    setMoves((value) => value + 1);
    observe("move", moves + 1);
  };
  return (
    <section id="has-root" data-active={String(active)}>
      <button
        id="has-toggle"
        onClick={() => {
          observe("active", !active);
          setActive((value) => !value);
        }}
      >
        Toggle flags
      </button>
      <button
        id="has-disable"
        onClick={() => {
          observe("disabled", !disabled);
          setDisabled((value) => !value);
        }}
      >
        Toggle disabled
      </button>
      <button id="has-move-button" onClick={move}>
        Move marker
      </button>
      <p id="has-moves">{moves}</p>
      <div id="has-desc" class="has-case">
        <div>
          <span class={flag}>Descendant</span>
        </div>
      </div>
      <div id="has-child" class="has-case">
        <span class={flag}>Child</span>
      </div>
      <div>
        <div id="has-adjacent" class="has-case">
          Adjacent anchor
        </div>
        <span class={flag}>Next sibling</span>
        <div id="has-reverse" class="has-case">
          Previous is not next
        </div>
      </div>
      <div>
        <div id="has-general" class="has-case">
          General sibling anchor
        </div>
        <span>Intervening sibling</span>
        <span class={flag}>Later sibling</span>
        <div id="has-no-follow" class="has-case">
          No following flag
        </div>
      </div>
      <div id="has-chain" class="has-case">
        <div class="branch">First branch</div>
        <div class="branch">
          <span class={flag}>Second branch</span>
        </div>
      </div>
      <div id="has-branch-search" class="has-case">
        <div class="branch">
          <span class="idle">Earlier nonmatch</span>
        </div>
        <div class="branch">
          <span class={flag}>Later matching branch</span>
        </div>
      </div>
      <div>
        <div id="has-sibling-chain" class="has-case">
          Sibling chain anchor
        </div>
        <div class="branch">
          <span class={flag}>Adjacent branch descendant</span>
        </div>
      </div>
      <div>
        <div id="has-sibling-search" class="has-case">
          Sibling search anchor
        </div>
        <div class="branch">
          <span class="idle">Earlier sibling nonmatch</span>
        </div>
        <div class="branch">
          <span class={flag}>Later sibling match</span>
        </div>
      </div>
      <div class="outside">
        <div id="has-anchor" class="has-case">
          <span class={flag}>Anchor boundary</span>
        </div>
        <div id="has-functional" class="has-case">
          <span class={flag}>Functional ancestor context</span>
        </div>
      </div>
      <div id="has-list" class="has-case">
        <span class={flag}>List</span>
      </div>
      <div id="has-not" class="has-case">
        <span class={flag}>Negation</span>
      </div>
      <div id="has-is" class="has-case">
        <span class={flag}>Matches any</span>
      </div>
      <div id="has-where" class="has-case">
        <span class={flag}>Where</span>
      </div>
      <div id="has-and" class="has-case">
        <span class={flag}>First condition</span>
        <span class="second">Second condition</span>
      </div>
      <div id="has-specificity" class="has-case has-specificity">
        <span class={flag}>Unmatched ID still contributes specificity</span>
      </div>
      <div id="has-is-specificity" class="has-case has-is-specificity">
        <span class={flag}>Nested is specificity</span>
      </div>
      <div id="has-where-specificity" class="has-case has-where-specificity">
        <span class={flag}>Where has zero specificity</span>
      </div>
      <div id="has-checked" class="has-case">
        <input
          id="has-checkbox"
          type="checkbox"
          checked={checked}
          onChange={(event) => {
            observe("checked", event.currentTarget.checked);
            setChecked(event.currentTarget.checked);
          }}
        />
      </div>
      <div id="has-disabled" class="has-case">
        <button id="has-disabled-child" disabled={disabled}>
          Child control
        </button>
      </div>
      <div id="has-move-desc" class="has-case">
        <div id="has-move" class="has-case" ref={parent}>
          <div id="has-holder" ref={holder} />
        </div>
      </div>
    </section>
  );
}
