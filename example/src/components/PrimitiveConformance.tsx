// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { useState } from "preact/hooks";

/** Real source expressions; type assertions leave JavaScript coercion unchanged. */
interface PrimitiveProps {
  t: (key: string) => string;
  observeObject: (value: Record<string, string>) => void;
}

export function PrimitiveConformance({ t, observeObject }: PrimitiveProps) {
  const [phase, setPhase] = useState(0);
  const [optionalState, setOptionalState] = useState<{ value: number } | null>(
    null,
  );
  const record = (
    phase % 2 === 0 ? null : { nested: { value: phase }, empty: null }
  ) as any;
  const missing = undefined as any;
  return (
    <main id="primitive-conformance">
      <button
        id="next-phase"
        type="button"
        onClick={() => {
          setPhase(phase + 1);
          setOptionalState((previous) => ({
            value: (previous?.value ?? 0) + 1,
          }));
        }}
      >
        Next phase
      </button>
      <button
        id="observe-order"
        type="button"
        onClick={() =>
          observeObject({ z: t("first"), "2": t("second"), "1": t("third") })
        }
      >
        Observe object initializer order
      </button>
      <p id="phase">{phase}</p>
      <p id="number-empty">{String(Number([]))}</p>
      <p id="number-null">{String(Number([null]))}</p>
      <p id="number-undefined">{String(Number([undefined]))}</p>
      <p id="number-single">{String(Number([phase]))}</p>
      <p id="number-nested">{String(Number([[phase]]))}</p>
      <p id="number-many">{String(Number([1, 2]))}</p>
      <p id="number-object">{String(Number({}))}</p>
      <p id="child-nan">{Number([1, 2])}</p>
      <p id="child-infinity">{Number("Infinity")}</p>
      <p id="child-negative-zero">{Number("-0")}</p>
      <p id="number-valueof">{String(Number({ valueOf: null }))}</p>
      <p id="unary-array">{String(+([phase] as any))}</p>
      <p id="subtract-array">{String(([phase] as any) - 2)}</p>
      <p id="multiply-array">{String(([phase] as any) * 2)}</p>
      <p id="plus-left-array">{([phase] as any) + 2}</p>
      <p id="plus-right-array">{2 + ([phase] as any)}</p>
      <p id="plus-arrays">{([1] as any) + ([phase] as any)}</p>
      <p id="plus-array-object">{([] as any) + ({} as any)}</p>
      <p id="plus-object-array">{({} as any) + ([phase] as any)}</p>
      <p id="less-arrays">{String(([2] as any) < ([10] as any))}</p>
      <p id="less-array-number">{String(([phase] as any) < 2)}</p>
      <p id="less-object">{String(({} as any) < 2)}</p>
      <p id="string-empty">{String([])}</p>
      <p id="string-nested">{String([null, [1, undefined, phase]])}</p>
      <p id="string-object">{String({})}</p>
      <p id="string-valueof">{String({ valueOf: null })}</p>
      <p id="own-tostring">{String({ toString: phase }.toString)}</p>
      <p id="missing-property">{String(({ present: phase } as any).missing)}</p>
      <p id="truth-empty-array">{String(Boolean([]))}</p>
      <p id="truth-empty-object">{String(Boolean({}))}</p>
      <p id="utf16-length">{String("A🙂B".length)}</p>
      <p id="utf16-order">{String("🙂" < "\uE000")}</p>
      <p id="optional-continuous">{String(record?.nested.value)}</p>
      <p id="optional-repeated">{String(record?.empty?.value)}</p>
      <p id="optional-lazy-key">{String(record?.[t("nested")].value)}</p>
      <p id="optional-lazy-tail">{String(record?.nested[t("value")])}</p>
      <p id="optional-array">{String([phase]?.[0])}</p>
      <p id="optional-empty-string">{String(""?.length)}</p>
      <p id="optional-false">{String((false as any)?.[t("false-key")])}</p>
      <p id="optional-zero">{String((0 as any)?.[t("zero-key")])}</p>
      <p id="optional-undefined">{String(missing?.[t("forbidden-key")])}</p>
      <p id="optional-base-once">{String(t("base-once")?.length)}</p>
      <p id="optional-grouped">{String(record?.nested?.value)}</p>
      <p id="optional-non-null">{String(record?.nested!.value)}</p>
      <p id="optional-updater">{String(optionalState?.value ?? "seed")}</p>
    </main>
  );
}
