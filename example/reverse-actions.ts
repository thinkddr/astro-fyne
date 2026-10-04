// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// This is an explicit browser host contract, not a translation of Go callbacks.
const trace: { events: { action: string; value?: string }[] } = { events: [] };
if (typeof window !== "undefined") {
  (
    window as unknown as { astroFyneReverseBehaviorTrace: typeof trace }
  ).astroFyneReverseBehaviorTrace = trace;
  document.documentElement.dataset.reverseSceneActionsReady = "true";
}

function valueEvent(action: string, value?: string) {
  if (typeof value !== "string")
    throw new Error(`Reverse host action ${action} requires its native value`);
  trace.events.push({ action, value });
}

export const actions = {
  input: (value?: string) => valueEvent("input", value),
  commit: (value?: string) => valueEvent("commit", value),
  tap: () => {
    trace.events.push({ action: "tap" });
  },
};
