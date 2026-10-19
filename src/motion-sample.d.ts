// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import type { MotionSample, MotionSpec } from "./motion.ts";

export function createValidatedMotionSampler(
  clip: MotionSpec,
): (timeMs: number) => MotionSample;
