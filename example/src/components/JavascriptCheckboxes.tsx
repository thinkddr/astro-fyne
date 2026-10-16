// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useRef, useState } from "preact/hooks";

/** The same source exercises real DOM activation, native widgets and replay. */
export function JavascriptCheckboxes({
  observe,
}: {
  observe: (...values: any[]) => null;
}) {
  const [checked, setChecked] = useState(false);
  const [tick, setTick] = useState(0);
  const local = useRef<HTMLInputElement>(null);
  const record = (event: Event) =>
    observe(
      "checkbox",
      event.type,
      (event.currentTarget as HTMLInputElement).id,
      (event.currentTarget as HTMLInputElement).checked,
      (event.currentTarget as HTMLInputElement).value,
    );
  return (
    <section>
      <label id="js-check-label" for="js-check-controlled">
        Accept
      </label>
      <input
        id="js-check-controlled"
        type="checkbox"
        checked={checked}
        onClick={record}
        onInput={record}
        onChange={(event) => {
          record(event);
          setChecked(event.currentTarget.checked);
        }}
      />
      <input
        id="js-check-local"
        ref={local}
        type="checkbox"
        defaultChecked={true}
        onClick={record}
        onInput={record}
        onChange={record}
      />
      <input
        id="js-check-cancelled"
        type="checkbox"
        defaultChecked={true}
        onClick={(event) => {
          record(event);
          event.preventDefault();
        }}
        onInput={record}
        onChange={record}
      />
      <input
        id="js-check-disabled"
        type="checkbox"
        checked={true}
        disabled
        onChange={record}
      />
      <input
        id="js-check-readonly"
        type="checkbox"
        checked={true}
        onClick={record}
        onChange={record}
      />
      <button
        id="js-check-rerender"
        onClick={() => setTick((value) => value + 1)}
      >
        Refresh {tick}
      </button>
      <button id="js-check-programmatic" onClick={() => local.current!.click()}>
        Programmatic
      </button>
      <p id="js-check-value">{String(checked)}</p>
    </section>
  );
}
