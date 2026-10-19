<!-- SPDX-License-Identifier: Apache-2.0 -->

# Reverse responsive Flexbox

The declarative source compiler accepts `row-reverse` and `column-reverse` in
the existing single-line responsive contract. Children, native objects, callback
bindings and navigation keep source order. Reversal changes their main-axis
coordinates inside the content box; padding sides and cross-axis alignment remain
physical and unchanged.

Use a full-width, fixed-height root and explicit pixel bases, pixel minima and
border-box sizing. Uniform solid borders and asymmetric padding are supported.
RTL, vertical writing, wrapping, auto/negative margins and per-side borders
remain unsupported. The JavaScript DOM adapter uses its separate legacy layout
path and continues to reject reverse directions.

The native Go API distinguishes logical `start`/`end` from flex-relative
`flex-start`/`flex-end`. The compiler and portable scenes retain their existing
six justify choices: the flex pair, center, between, around and evenly.

For overflowing `space-around` and `space-evenly` groups, the native engine
matches the observed LTR, horizontal, no-wrap Chromium profile: the group falls
back to physical start. This also follows the pinned Chromium 153
[physical-offset implementation](https://github.com/chromium/chromium/blob/153.0.8010.12/third_party/blink/renderer/core/layout/flex/flex_layout_algorithm.cc#L1648).
It does not establish behavior for unsupported writing modes.

`reverse.Export` with `PreserveLayout: true` retains these declarations in schema 2. Astro and reconstructed native widgets resize from that same document without
new measurements. A default schema-1 export freezes the actual current positions.

The `reverse-flex conformance` workflow runs `bash ci/reverse-flex.sh` remotely.
Its one original source fixture covers both directions, all six justify choices,
weighted growth/shrinkage, partial growth, decoration floors, asymmetric padding,
uniform borders, negative free space and nested reverse layouts. One widget and one schema-2 document
resize through five widths/returns and a DPR-2 frame. The gate requires 18 exact
full-frame comparisons: original Chromium/native, native/inverse Astro, and
native/reconstructed native for each of six frames. Geometry's existing 1/64 CSS
pixel check never relaxes the independent zero-RGBA pixel requirement.

Actual browser element handles and native object pointers must survive resize.
Coordinate-based pointer hits and source-order navigation must invoke the fixed
action sequence in the original and reconstructed paths. Screenshots describe
unfocused empty rectangles/buttons, so they establish no typography or focus-ring
pixel claim. Multiline, scroll overflow and arbitrary Fyne layout algorithms need
separate contracts and evidence.

Artifacts retain every comparison and phase, the single exported scene, generated
source, browser/native geometry and behavior, and hosted Go formatting output.
Missing frames, stale source/scenario identities or failed comparisons fail the
workflow. No browser measurement is used as native layout input.
