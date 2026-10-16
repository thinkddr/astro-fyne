// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
class Arithmetic {
  #factor = 2;
  total(values: number[]) {
    return values.reduce((sum, value) => sum + value * this.#factor, 0);
  }
}
export const total = (values: number[]) => new Arithmetic().total(values);
