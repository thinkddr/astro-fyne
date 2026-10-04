// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "preact/hooks";
import { PrimitiveConformance } from "./PrimitiveConformance";

export function BrowserPrimitiveConformance({
  sourceHash,
}: {
  sourceHash: string;
}) {
  useEffect(() => {
    window.astroFyneBehaviorTrace = { observations: [], unexpectedCalls: [] };
    document.documentElement.dataset.conformanceReady = "true";
    document.documentElement.dataset.conformanceSourceHash = sourceHash;
  }, []);
  return <PrimitiveConformance />;
}
