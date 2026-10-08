// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { useState } from "preact/hooks";

interface Seed {
  value: number;
  self: Seed | null;
}

/** Roundtrip identity, cyclic data, special numbers and batches with no net change. */
export function PortableConformance({
  seed,
  inspect,
}: {
  seed: Seed;
  inspect: (stored: Seed, seed: Seed) => void;
}) {
  const [count, setCount] = useState(0);
  const [other, setOther] = useState(0);
  const [stored, setStored] = useState(seed);
  const [numbers, setNumbers] = useState([
    Number("-0"),
    Number("NaN"),
    Number("Infinity"),
    Number("-Infinity"),
  ]);
  return (
    <main>
      <p id="portable-count">{count}</p>
      <p id="portable-other">{other}</p>
      <p id="portable-value">{stored.value}</p>
      <p id="portable-chain-value">{stored.self?.value ?? -1}</p>
      <p id="portable-special">{`${1 / numbers[0]!}|${numbers[1]}|${numbers[2]}|${numbers[3]}`}</p>
      <button id="portable-inspect" onClick={() => inspect(stored, seed)}>
        Inspect identity
      </button>
      <button
        id="portable-noop"
        onClick={() => {
          setCount((previous) => previous + 1);
          setCount((previous) => previous - 1);
          setOther(other + 1);
          setOther(other);
        }}
      >
        No net change
      </button>
      <button
        id="portable-advance"
        onClick={() =>
          setStored((previous) => ({
            value: previous.value + 1,
            self: previous,
          }))
        }
      >
        Advance chain
      </button>
      <button
        id="portable-swap"
        onClick={() => setNumbers([0, numbers[1]!, numbers[3]!, numbers[2]!])}
      >
        Swap special numbers
      </button>
    </main>
  );
}
