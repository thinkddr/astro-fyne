// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "preact/hooks";
import { KeyedConformance } from "./KeyedConformance";

export function BrowserKeyedConformance() {
  useEffect(() => {
    document.documentElement.dataset.keyedReady = "true";
  }, []);
  return <KeyedConformance />;
}
