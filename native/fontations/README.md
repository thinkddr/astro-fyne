<!-- SPDX-License-Identifier: Apache-2.0 -->

# Optional native text provider

This development package supplies native-shaped text to Fyne's software painter.
It is enabled by `atf_fontations` on Linux ARM64 with CGo, and requires the fork's
`canvas.Text.Layout` API in the published `v2.8.1-sytue.19` replacement. The
default backend loads no native engine. Hosted provider checks use the committed
production module with readonly resolution, without a temporary local Fyne
replacement. They retain and verify the actual downloaded ZIP, module checksums,
tag/commit identity and twelve pinned source files before and after the build.
Adopting `.19` changes the prior `.18` dependency; the adopted module files must
remain unchanged during each hosted build. The provider's seven-row glyph and
strict pixel comparisons remain mandatory, separate from release verification.

`NewBackend` takes an absolute shared-library path, explicit `Policy` and a map
of font families/faces. Each `LicensedFont` supplies a `Resource` and its `License`
resource. The backend copies their bytes before opening the native font engines.
Keep it open while its views measure or paint, then call `Close`. Retrieve fresh
copies of font notices with `FontNotices`; distributing the compiled engine also
requires its retained upstream notices.

The backend implements `webui.Backend` and `webui.TextValidator`. Pass it to a
generated widget or `webui.NewView` using the existing backend parameter. `Shape`
returns an immutable `Line`; `Snapshot` returns fresh Go copies of its metrics
and glyph records. Native run handles are freed immediately after copying.
`Text` and `PlaceText` attach that line to a real Fyne `canvas.Text`. Paints pack
the accumulated clipped NRGBA backdrop with its actual stride, keep the original
logical origin, and use a separate physical offset in the native painter. Caller
rows change only after a successful native paint.

This is a software provider. Fyne's GL painter rejects supplied layouts explicitly.
Use the public `fyne.io/fyne/v2/driver/software` canvas for the current profile.
Inspect `Backend.Error` and each text object's `TextLayoutError`; failures do not
draw default glyphs. Successful metric queries do not hide earlier paint errors.

The initial native profile is bounded:

- One licensed static TrueType face per family/weight/style; weight 400/700 and
  normal/italic, without implicit fallback or variable fonts.
- One nowrap line, at most 4,096 UTF-8 bytes/glyphs, containing ASCII plus combining
  acute/diaeresis. Font size is `(0,256]` and line height `(0,1024]` logical pixels.
- Nonempty text requires opaque solid ink and opacity 1. Empty lines retain font
  metrics and paint no pixels. A visible semitransparent editor placeholder is
  unsupported and reports an error.
- Physical scales 1/2, opaque RGBA8 backdrops, clipped axes at most 4,096 pixels
  and physical destination offsets in `[-4096,4096]`.
- Nonzero destination offsets use native glyph masks. Path/drawable rendering
  and rejected-mask bitmap fallback report an error before caller pixel changes.
  The zero-offset full-surface painter retains its existing behavior.

Single-line editors use the existing native editing engine. Multiline editing,
contextual caret mapping, generated-widget visual parity, reverse-conversion
typography, GPU rendering and universal 1:1 conversion remain unverified.

For responsive border-box inputs, the optional `webui.EditorLineStyler` interface
separates the authored outer style from the internal text line. This provider
follows the pinned Chromium plain-input rule: where that rule selects a normal
line height, it derives the height from native font ascent, descent and leading.
Text, caret, selection and hit testing use the same internal line style. Other
backends keep their existing behavior. This does not establish auto-height input
layout, clipped editor lines or focused rendering parity.

The additive [`input-editor-metrics.json`](../../input-editor-metrics.json)
profile checks six fixed input boxes at scales 1 and 2, including retained authored
line heights and fractional font sizes. Hosted checks compare actual UA editor
boxes and whole-frame pixels at zero tolerance. Browser measurements remain
evidence and never become native layout inputs.

The hosted generated-controls gate injects this backend into the ordinary
`NewResponsiveControls` constructor. It keeps the original source, font and
21 interaction actions, captures all 22 DPR 1 frames, and compares complete
images at zero RGBA tolerance. The retained text layouts and binary/source
bindings are separate from the seven-row provider evidence. See
[`test-controls-remote.sh`](../../ci/text-engine-probe/test-controls-remote.sh)
for the hosted invocation; no browser measurements enter the native layout.

The canonical C ABI lives in [`cabi`](cabi/). Its hosted source build, compiler
receipts, notices and strict transport/rendering checks are documented in
[`ci/text-engine-probe`](../../ci/text-engine-probe/README.md). Run builds and tests
on a hosted machine as required by [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
