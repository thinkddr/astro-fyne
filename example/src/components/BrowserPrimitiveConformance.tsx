// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "preact/hooks";
import { PrimitiveConformance } from "./PrimitiveConformance";

const trace = {
  observations: [] as { prefix: string; previous: number }[],
  unexpectedCalls: [] as string[],
};

export function BrowserPrimitiveConformance({
  sourceHash,
}: {
  sourceHash: string;
}) {
  useEffect(() => {
    window.astroFyneBehaviorTrace = trace;
    document.documentElement.dataset.conformanceReady = "true";
    document.documentElement.dataset.conformanceSourceHash = sourceHash;
  }, []);
  return (
    <PrimitiveConformance
      t={(key) => {
        trace.observations.push({ prefix: key, previous: 0 });
        return key;
      }}
      observeObject={(record) => {
        trace.observations.push({
          prefix: `object:${record.z}|${record["2"]}|${record["1"]}`,
          previous: 0,
        });
      }}
    />
  );
}
