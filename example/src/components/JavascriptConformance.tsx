// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createContext } from "preact";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "preact/hooks";

let moduleCount = 0;
const Context = createContext(3);
class Arithmetic {
  #factor = 2;
  total(values: number[]) {
    return values.reduce((sum, value) => sum + value * this.#factor, 0);
  }
}
function useArithmetic(count: number, rows: string[]) {
  return useMemo(
    () => new Arithmetic().total([count, ...rows.map((_, index) => index)]),
    [count, rows],
  );
}
function Child({ label }: { label: string }) {
  const amount = useContext(Context);
  const [count, setCount] = useState(() => amount);
  return (
    <section>
      <p id={`js-${label}-count`}>{count}</p>
      <button
        id={`js-${label}-increment`}
        onClick={() => setCount((value) => value + 1)}
      >
        Child increment
      </button>
    </section>
  );
}

/** Requires real JS: module mutation, private fields, closures, custom hooks and reducers. */
export function JavascriptConformance({
  observe,
  initial = 1,
}: {
  observe: (...values: any[]) => null;
  initial?: number;
}) {
  const [count, setCount] = useState(() => initial);
  const [name, dispatch] = useReducer(
    (state: string, value: string) => value.toUpperCase(),
    "ASTRO",
  );
  const [rows, setRows] = useState(["a", "b"]);
  const [show, setShow] = useState(true);
  const history = useRef<string[]>([]);
  const direct = useRef<HTMLButtonElement>(null);
  const total = useArithmetic(count, rows);
  const [graph] = useState(() => {
    const value: { self?: unknown; lookup: Map<string, number> } = {
      lookup: new Map([["answer", 42]]),
    };
    value.self = value;
    return value;
  });
  const increment = useCallback(() => {
    moduleCount++;
    history.current.push(`click-${moduleCount}`);
    setCount((value) => value + 1);
    setCount((value) => value + 1);
    observe(
      "closure",
      count,
      moduleCount,
      history.current.length,
      Math.random(),
      Date.now(),
    );
  }, [count, observe]);
  useLayoutEffect(() => {
    history.current.push("layout");
    observe("layout", count);
  }, [count]);
  useEffect(() => {
    observe("effect", count);
    return () => {
      observe("cleanup", count);
    };
  }, [count]);
  useLayoutEffect(() => {
    direct.current!.onclick = () => observe("property", direct.current!.id);
    return () => {
      direct.current!.onclick = null;
    };
  }, [observe]);
  return (
    <main
      style={{ padding: 12, gap: 8 }}
      onClickCapture={() => observe("capture")}
      onClick={() => observe("bubble")}
    >
      <p id="js-count">{count}</p>
      <p id="js-standard">
        {String(
          Date.prototype.constructor === Date &&
            globalThis.JSON === JSON &&
            globalThis.Map === Map &&
            Object.hasOwn(Math, "random") &&
            Object.getPrototypeOf(Math) === Object.prototype &&
            new Date(0) instanceof Date &&
            Object.prototype.toString.call(Date.prototype) ===
              "[object Object]",
        )}
      </p>
      <p id="js-data">{`${graph === graph.self}|${graph.lookup.get("answer")}|${Object.is(-0, 0)}|${Number.isNaN(NaN)}`}</p>
      <p id="js-name">{name}</p>
      <p id="js-total">{total}</p>
      <p id="js-module">{moduleCount}</p>
      <p id="js-history">{history.current.join("|")}</p>
      <button id="js-increment" onClick={increment}>
        Increment twice
      </button>
      <input
        id="js-input"
        value={name}
        onInput={(event) => dispatch(event.currentTarget.value)}
        onChange={(event) =>
          observe("controlled-change", event.currentTarget.value)
        }
      />
      <section
        onInput={(event) =>
          observe(
            "uncontrolled-input",
            (event.target as HTMLInputElement).value,
          )
        }
        onChange={(event) =>
          observe(
            "uncontrolled-change",
            (event.target as HTMLInputElement).value,
          )
        }
      >
        <input id="js-uncontrolled" defaultValue="seed" />
      </section>
      <button id="js-direct" ref={direct}>
        Direct handler
      </button>
      <button id="js-programmatic" onClick={() => direct.current!.click()}>
        Programmatic click
      </button>
      <button
        id="js-reorder"
        onClick={() => setRows((values) => [...values].reverse())}
      >
        Reorder
      </button>
      <button id="js-toggle" onClick={() => setShow((value) => !value)}>
        Toggle
      </button>
      <Context.Provider value={3}>
        {rows.map((label) => (
          <Child key={label} label={label} />
        ))}
        {show && <Child label="optional" />}
      </Context.Provider>
    </main>
  );
}
