// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

function number(value, minimum, maximum) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    throw new Error("Motion: numeric value exceeds the supported range");
  return value;
}
function easingValue(easing, progress) {
  if (easing.kind === "linear" || progress === 0 || progress === 1)
    return progress;
  const [x1, y1, x2, y2] = easing.points;
  const axis = (t, a, b) => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 52; i++) {
    const mid = (lo + hi) / 2;
    if (axis(mid, x1, x2) < progress) lo = mid;
    else hi = mid;
  }
  return axis((lo + hi) / 2, y1, y2);
}

/** Internal engine: callers must validate and own the clip before sampling. */
export function createValidatedMotionSampler(clip) {
  return (timeMs) => {
    number(timeMs, -1e12, 1e12);
    const { timing } = clip,
      before = timeMs < timing.delayMs,
      after = timeMs >= timing.delayMs + timing.durationMs * timing.iterations;
    if (
      (before && !["backwards", "both"].includes(timing.fill)) ||
      (after && !["forwards", "both"].includes(timing.fill))
    )
      return { active: false, progress: 0, values: [] };
    let position = 0;
    if (after) position = timing.iterations;
    else if (!before && timing.durationMs > 0)
      position = (timeMs - timing.delayMs) / timing.durationMs;
    let iteration = Math.floor(position),
      progress = position - Math.floor(position);
    if (after && progress === 0 && position > 0) {
      iteration--;
      progress = 1;
    }
    let reversed = ["reverse", "alternate-reverse"].includes(timing.direction);
    if (
      ["alternate", "alternate-reverse"].includes(timing.direction) &&
      iteration % 2 === 1
    )
      reversed = !reversed;
    if (reversed) progress = 1 - progress;
    return {
      active: true,
      progress,
      values: clip.tracks.map((track) => {
        let index = track.keyframes.findIndex(
          (frame) => frame.offset >= progress,
        );
        if (index === 0) index = 1;
        if (index < 0) index = track.keyframes.length - 1;
        const a = track.keyframes[index - 1],
          b = track.keyframes[index],
          local = (progress - a.offset) / (b.offset - a.offset),
          result =
            a.value + (b.value - a.value) * easingValue(timing.easing, local);
        number(
          result,
          track.property === "width" || track.property === "height"
            ? 0
            : -3.4028234663852886e38,
          3.4028234663852886e38,
        );
        return {
          track: track.id,
          target: track.target,
          property: track.property,
          value: result,
        };
      }),
    };
  };
}
