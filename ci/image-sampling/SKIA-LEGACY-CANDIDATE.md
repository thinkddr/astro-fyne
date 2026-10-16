<!-- SPDX-License-Identifier: Apache-2.0 -->

# Isolated legacy-floor sampling candidate

This proposal has not been built, formatted or run locally. It changes the
software enlargement sampler only. The original same-size PNG prepass proposal
remains a separate, unapplied experiment: the retained hosted corpus already
shows that the current prepass preserves its effective premultiplied RGBA8
samples. No decoder or source-lifecycle change is needed to test this sampler.

For an isolated `skia-legacy` variant, start with the public Fyne
`v2.8.1-sytue.16` module, apply `fyne-smooth-image-enlargement.patch`, copy
`skia_legacy_enlargement.go.proposed` and
`skia_legacy_enlargement_test.go.proposed` into
`internal/painter/software/` without the `.proposed` suffix, then apply
`fyne-skia-legacy-enlargement.patch`. Do not apply the lowp companion or the
original-PNG prepass companion. Retain `LICENSE-Fyne.txt` and
`LICENSE-Skia.txt`. Record source hashes before and after remote formatting.

The helper accepts only uniform physical enlargement factors 2 and 4, zero-origin
NRGBA8 or opaque RGBA8, and output dimensions at most 16384 per axis and 64 Mi
pixels. Other types, partial-alpha RGBA with already lost straight RGB, mixed
factors, reductions and other scale factors decline to the ordinary bilinear
candidate. It premultiplies NRGBA8 channels to RGBA8 using nearest division by
255, accumulates all four bilinear Q4-by-Q4 weights, and floors each filtered
premultiplied RGB channel and alpha independently with `>>8`. It retains the
premultiplied output as `image.RGBA`. No horizontal pass is rounded first.

## Pinned primary-source basis

Chromium `153.0.8010.12` pins Skia
`9d07e5bad9e3e21da2426946e589daa647218271`.

- [SkBitmapProcState_opts.h](https://github.com/google/skia/blob/9d07e5bad9e3e21da2426946e589daa647218271/src/opts/SkBitmapProcState_opts.h),
  blob `19592b7dd3d00e8f9437d583c9fd4f2cacb1a344`, lines 38–41 extracts
  four-bit interpolation weights. The NEON implementation at lines 438–475
  accumulates four premultiplied 8-bit pixels and uses `vshrn_n_u16(...,8)`
  without rounding. The portable implementation at lines 479–511 uses the same
  weights and final `>>8`; SSE2 also truncates at this stage. The helper uses
  exact Q4 pixel-center coordinates for factors 2 and 4, so these cases have no
  extra fractional-weight quantization or floating-point reciprocal.
- [SkColorPriv.h](https://github.com/google/skia/blob/9d07e5bad9e3e21da2426946e589daa647218271/src/core/SkColorPriv.h),
  blob `c3242e4c978a8eb6decb8fc4c40d7e83d11d7b82`, lines 121–132 uses
  `SkMulDiv255Round` for 8-bit premultiplication. Lines 145–159 implements
  premultiplied source-over; on opaque white, its destination term is exactly
  `255-alpha`, so the resulting RGB is `premultipliedRGB+255-alpha`.
- [Blink image_frame.h](https://github.com/chromium/chromium/blob/153.0.8010.12/third_party/blink/renderer/platform/image-decoders/image_frame.h),
  blob `92351c43b6b65523ed55608e69ff9fef024eb4c0`, lines 231–245 uses
  8-bit nearest premultiplication; the default flag is true at line 338.
- [Chromium skia/BUILD.gn](https://github.com/chromium/chromium/blob/153.0.8010.12/skia/BUILD.gn),
  blob `1c58dd668bc45b9f180672bada7838b671bef031`, line 69 defines
  `SK_ENABLE_LEGACY_SHADERCONTEXT`.
- [SkImageShader.cpp](https://github.com/google/skia/blob/9d07e5bad9e3e21da2426946e589daa647218271/src/shaders/SkImageShader.cpp),
  blob `33afb61475263b156f2c5f323d1f8ca4f0f37dd8`, lines 215–277 permits
  legacy contexts only for compatible premultiplied/opaque N32 images, sampling,
  tiling, matrix and color-space conditions. Compilation of this path does not
  establish that any individual browser draw selected it.

## Independent evidence and remaining gate

The first hosted ARM64 Chromium corpus rejected both prior candidates. A separate
exact rational model of the retained original resources and browser PNGs matches
all six image boxes when it uses nearest input premultiplication, exact
pixel-center bilinear weights, independently floored premultiplied RGB/alpha, then
opaque-white composition. The same model with nearest final filtering reproduces
the actual lowp candidate pixels exactly. This narrows the new hypothesis without
changing source images, offsets, tolerances, expected screenshots or any failing
initial candidate.

[Hosted run 38890512586](https://github.com/thinkddr/astro-fyne/actions/runs/38890512586)
compiled and tested this implementation at converter commit
`78c51dd119e2756769a9bcb06e37e0511b0fe946`. All six complete forward, inverse
and reconstructed-native frames passed with zero changed pixels at DPR 1 and 2.
Unit tests, native race tests, source/resource checks and provenance checks passed.
The production dependency remains unchanged; this evidence applies to the
isolated experimental renderer and its retained corpus. Arbitrary backgrounds, nonuniform/fractional enlargement,
JPEG, ICC/color management, SVG, GPU renderers and other platforms remain outside
this experiment's evidence.
