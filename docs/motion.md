<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Astro Fyne contributors. -->

# Portable native motion

For automatic conversion of supported source CSS without manual target bindings,
see [CSS height animations](css-height-animations.md). The explicit motion API
below also supports geometry owned directly by a host.

`github.com/thinkddr/astro-fyne/native/motion` samples numeric keyframes and moves
real Fyne objects. The clip metadata and playback state can be serialized without
exporting a Go callback. This package establishes a bounded geometry contract;
it does not establish universal CSS support or pixel parity.

## Clip format

```json
{
  "schema": 1,
  "id": "slide",
  "tracks": [
    {
      "id": "panel-x",
      "target": "panel",
      "property": "x",
      "keyframes": [
        { "offset": 0, "value": 0 },
        { "offset": 1, "value": 120 }
      ]
    }
  ],
  "timing": {
    "durationMs": 1000,
    "delayMs": 100,
    "iterations": 1,
    "direction": "normal",
    "fill": "both",
    "easing": { "kind": "cubic-bezier", "points": [0.2, 0, 0, 1] }
  }
}
```

`NewClip(Spec)` validates and copies construction data. `ParseClip([]byte)` also
rejects duplicate, unknown, missing and incorrectly cased JSON fields.
`Clip.Spec()` returns a defensive copy, `Clip.Hash()` identifies the canonical
metadata, and JSON marshaling emits the clip above. The fingerprint uses the
versioned binary protocol described below, so Go and JavaScript do not depend
on the same JSON float notation or escaping.

Properties are `x`, `y`, `width` and `height`, in CSS pixels. Track and target IDs
use ASCII letters, digits, `_`, `.`, `:`, `/` and `-`, start with a letter or `_`,
and contain at most 256 characters. A clip has 1–1000 tracks and at most 10,000
keyframes. Every track needs strictly increasing offsets with explicit `0` and
`1` endpoints. Track IDs and target/property pairs must be unique.

Duration is nonnegative; delay may be negative. Iterations are finite and may be
zero or fractional. Duration, delay, active duration and sample time stay within
`1e12` milliseconds; iteration count is at most `1e9`. Values must fit finite
native `float32` geometry, with nonnegative dimensions. Unsupported opacity,
colors, group transforms, additive composition and implicit keyframe endpoints
produce diagnostics. Infinite repetition requires a further transport contract.

Directions are `normal`, `reverse`, `alternate` and `alternate-reverse`; fills are
`none`, `backwards`, `forwards` and `both`. Easing is `linear` or CSS
`cubic-bezier(x1,y1,x2,y2)`, with x coordinates in `[0,1]`. The curve is applied
separately within each keyframe interval. A Web Animations adapter must express
that as keyframe easing with linear effect easing. Out-of-range dimension
overshoot is diagnosed before any object changes.

## Native binding and playback

Parse a clip and bind its targets while already on Fyne's UI goroutine:

```go
clip, err := motion.ParseClip(clipJSON)
if err != nil {
    return err
}
binding, err := motion.BindFyne(clip, map[string]fyne.CanvasObject{
    "panel": panel,
}, motion.OwnGeometry)
if err != nil {
    return err
}
controller, err := motion.NewController(
    clip, motion.ClockFunc(time.Now), binding, motion.Direct,
)
if err != nil {
    return err
}
return controller.Seek(350)
```

Import `time`, `fyne.io/fyne/v2` and the motion package. `OwnGeometry` explicitly
asserts that no parent layout or other writer controls those objects' positions
or sizes while bound. IDs must resolve to distinct, nonnil native object
pointers. Binding copies the target map and captures original geometry.

Each applied sample starts from that original geometry and combines every track
for each target before calling `Move` and `Resize`. Inactive fills and `Cancel`
restore the underlying geometry. Invalid metadata, samples, target references,
states and rejected dispatches leave controller state and geometry unchanged.
These guarantees assume valid Fyne objects whose geometry methods do not panic;
arbitrary user implementations cannot provide rollback after a panic.

The controller provides:

- `Sample()` reads a sample without changing native objects; `Clip.Sample(ms)`
  samples a specified time without a controller.
- `Seek(ms)` pauses at the specified time, including before delay or after the
  active interval.
- `Play()`, `Pause()`, `Reverse()` and `SetPlaybackRate(rate)` control playback.
  Playback rate may be zero or negative and must be finite within `±1e6`.
- `Tick()` applies the current injected-clock sample. `Finish()` reaches the
  playback boundary; finishing or reversing a zero rate is an error.
- `Cancel()` returns to idle and restores original geometry.
- `State()` and `RestoreState(state)` transport playback. `ParseState([]byte)`
  strictly validates its JSON envelope.
- `Close()` restores original geometry, releases the controller's binding and
  host clock/dispatcher callbacks, and
  rejects future ticks. It is idempotent and still works after a clock fault.

Mutations run through a required synchronous dispatcher. `motion.Direct` is for
callers already on Fyne's UI goroutine, or controllers without native bindings.
A host dispatching from another goroutine must synchronously run the supplied
task on the UI goroutine and return its error. It may reject before execution;
it must not execute asynchronously, execute twice, or report failure after a
successful task. The controller does not hold its mutex while waiting for that
dispatcher.

A host may use `fyne.Animation` to schedule `Tick()`. Its callback does not define
portable behavior: the clip, clock and controller do. Stop the host scheduler
before closing the controller. Hosts choose reduced-motion policy explicitly;
this package neither reads platform settings nor silently changes authored timing.

The browser adapter admits absolute, border-box targets with explicit used pixel
geometry, zero min-width/min-height, no max-width/max-height, and zero padding,
border widths and margins. Transforms, individual translate/rotate/scale, motion
paths and existing animation effects require another adapter. These constraints
must remain true for the binding's lifetime: CSS constraints can otherwise clamp
an animated border-box size or offset its painted position. Unsupported targets
are rejected before creating any new effects; their styles and caller-owned
animations remain untouched.

## Playback transport

The clip fingerprint starts with UTF-8 `astro-fyne-motion:1` and a NUL byte.
Strings use a uint32 big-endian UTF-8 byte length followed by those bytes;
counts are uint32 big-endian; numbers are IEEE-754 float64 bits in big-endian
order, with both signs of zero encoded as positive zero. Fields appear in this
order: clip ID; duration, delay, iterations; direction, fill, easing kind; easing
point count and points; track count; then each track's ID, target, property,
keyframe count, and each offset/value pair. The fingerprint is SHA-256 of those
bytes. Schema 1 is encoded by the versioned prefix. This is a semantic numeric
fingerprint; exact source CSS and other resources retain separate byte digests.

```json
{
  "schema": 1,
  "clipId": "slide",
  "clipHash": "<canonical clip SHA-256>",
  "currentTimeMs": 350,
  "playbackRate": 1,
  "playState": "paused"
}
```

Idle states have a null current time. Running, paused and finished states have a
finite current time. Restoration requires the exact clip ID and hash, applies its
current sample, and anchors running playback to the new clock. Time spent between
export and import does not advance the animation. A finished state must be at its
playback boundary. Clock reversal and excessive time produce diagnostics.

## Evidence and provenance

Remote Go tests cover delay, fractional iterations, alternating directions,
fill modes, zero duration, zero iterations, per-interval Bézier easing,
pause/resume/reversal, state transport across clocks, and actual Fyne geometry.
They also check immutable metadata, strict JSON, explicit ownership, missing
targets, failures before mutation and cleanup after clock failure. These are
deterministic geometry and state checks; they do not replace strict image gates.

The cubic Bézier inversion approach reuses the general bisection design from
Sytue's native UI movement work, with the maintainer's authorization. This
implementation uses independent portable types, float64 arithmetic and 52
bisection steps. It includes no private imports, branded tokens, fonts, assets,
services or source headers. CSS timing follows the
[CSS Animations timing contract](https://www.w3.org/TR/css-animations-1/)
and exposes an explicit subset of
[Web Animations playback](https://www.w3.org/TR/web-animations-1/).
