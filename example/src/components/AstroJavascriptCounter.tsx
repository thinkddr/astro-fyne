// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import {
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "preact/hooks";
export default function AstroJavascriptCounter({
  initial = 2,
  left,
  right,
}: {
  initial?: number;
  left?: { value: number };
  right?: { value: number };
}) {
  const [count, setCount] = useState(() => initial),
    [name, input] = useReducer(
      (_: string, next: string) => next.toUpperCase(),
      "ASTRO",
    );
  const history = useRef<number[]>([]);
  const total = useMemo(
    () => [count, 3].reduce((sum, value) => sum + value, 0),
    [count],
  );
  const increment = useCallback(() => {
    history.current.push(count);
    setCount((value) => value + 2);
  }, [count]);
  return (
    <section>
      <p id="astro-js-alias">{String(left === right)}</p>
      <p id="astro-js-count">{count}</p>
      <p id="astro-js-total">{total}</p>
      <p id="astro-js-history">{history.current.join(",")}</p>
      <p id="astro-js-name">{name}</p>
      <input
        id="astro-js-input"
        value={name}
        onInput={(event) => input(event.currentTarget.value)}
      />
      <button id="astro-js-increment" onClick={increment}>
        Increment
      </button>
    </section>
  );
}
