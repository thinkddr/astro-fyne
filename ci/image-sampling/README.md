<!-- SPDX-License-Identifier: Apache-2.0 -->

# Experimental Smooth image enlargement

This directory holds experimental patch proposals for isolated hosted CI.
It is not a published release or a pixel-parity certification.

The original source was read from the public
`v2.8.1-sytue.16` tag; `source-pin.json` records its exact blob and content digests.
The converter currently resolves Fyne through that tag. Fork source and the patch
remain under the fork's BSD 3-Clause terms; see `LICENSE-Fyne.txt`.

## Concrete discrepancy

`internal/painter/image.go` first reduces each physical axis to at most the
source bitmap dimension. It intentionally leaves enlargement for the driver.
The software driver's `drawPixels` then uses Catmull-Rom for Smooth images.
The fork's GL image path uses linear texture filtering for Smooth.

Chromium 153.0.8010.12 defaults to Medium interpolation, or Low under its
low-quality feature. Both use Skia linear filtering during enlargement.
This supports changing the interpolation kernel; it does not establish identical
sample quantization, premultiplied-alpha arithmetic or final rounding.

## Candidate scope

Apply `fyne-smooth-image-enlargement.patch` to the exact tagged source in a
temporary hosted-CI checkout. Do not overwrite the existing tag.

The private image draw call opts into bilinear filtering only when Smooth is
selected, neither physical axis shrinks, and at least one axis enlarges.
The image pre-reduction stage, exact-size path, Pixels, Fastest, invalid-mode
fallback, raster draw path, clipping and public `ScaleMode` are unchanged.

The proposal does not change the shared painter's reduction policy. Mixed-axis
resize already has a separate pre-reduction stage, and is not certified by the
initial corpus. Rounded image clips, fractional origins, noninteger factors,
JPEG decoder differences and arbitrary color profiles also remain outside it.

`image_enlargement_test.go.proposed` is a proposed native regression test to copy
to `internal/painter/software/image_enlargement_test.go` in that temporary
checkout. Its four opaque samples come from the pixel-center linear equation,
not a captured browser image. It also exercises unchanged Pixels and Fastest.
It has not been compiled or run.

## Remote evidence required

The companion corpus is defined in `image-enlargement.json` and
`image-enlargement-scenario.json` at the repository root:

- One source-only native widget and a 160 by 80 CSS pixel browser viewport.
- Three original 16 by 16 PNGs displayed at 32 by 32 CSS pixels at integer
  coordinates (16,16), (64,16) and (112,16), over opaque white.
- RGB values in multiples of 64 isolate the interpolation kernel; a separate
  odd-channel RGB pattern exposes rounding; RGBA includes colored transparent
  pixels and alpha values 0, 1, 17, 63, 127, 191, 254 and 255.
- DPR 1 and DPR 2, with real browser decode and served-byte SHA-256 checks.
  Native must embed and export the identical original resource bytes.
- Source geometry is never replaced by browser measurements. Capture rectangles
  are an independent oracle and source/scenario/resource/screenshot digests bind
  all comparisons to their actual inputs.

First run the untouched `.16` dependency to establish a real failing baseline.
Then apply the candidate in the hosted checkout and repeat the identical corpus.
Every complete forward browser/native frame and every native/inverse-browser
frame must pass the existing strict RGBA8 comparator with zero tolerance.
Odd RGB or alpha failures remain failures; a better even-channel isolator alone
is insufficient. Save all original PNGs, diff PNGs, metrics and environment
versions for both runs. Preserve the existing natural-size bitmap corpus.

Run the fork's regression suite remotely too. Existing software image masters
with enlargement (default, Smooth, alpha and stretch) are expected review points;
review their actual changes individually. Do not batch-replace masters to make
the candidate green. A production release/tag requires successful reviewed
evidence, rather than the kernel-selection argument alone.

## Primary sources

- [Fyne software image painting](https://github.com/thinkddr/fyne/blob/v2.8.1-sytue.16/internal/painter/software/draw.go)
- [Fyne image pre-reduction](https://github.com/thinkddr/fyne/blob/v2.8.1-sytue.16/internal/painter/image.go)
- [Fyne GL filtering](https://github.com/thinkddr/fyne/blob/v2.8.1-sytue.16/internal/painter/gl/gl_core.go)
- [Chromium default interpolation](https://github.com/chromium/chromium/blob/153.0.8010.12/third_party/blink/renderer/platform/graphics/graphics_context_types.cc)
- [Chromium sampling policy](https://github.com/chromium/chromium/blob/153.0.8010.12/cc/paint/paint_flags.cc)
- [Go image interpolators, pinned fork dependency](https://github.com/golang/image/blob/v0.24.0/draw/scale.go)
