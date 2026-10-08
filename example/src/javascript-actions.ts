// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

declare global {
  interface Window {
    afyJavascriptEvents: unknown[][];
  }
}
export const actions = {
  observe(...args: unknown[]) {
    (window.afyJavascriptEvents ??= []).push(args);
    return null;
  },
};
