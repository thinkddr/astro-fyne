// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

const record = (id: string) => () => {
  const host = window as Window & { reverseFlexEvents?: string[] };
  (host.reverseFlexEvents ??= []).push(id);
};
export const actions = {
  "action-a": record("action-a"),
  "action-b": record("action-b"),
  "action-c": record("action-c"),
};
