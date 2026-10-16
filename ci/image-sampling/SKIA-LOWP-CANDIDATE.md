# Unverified fixed-profile image arithmetic candidate

This candidate is separate from the ordinary bilinear proposal. Neither candidate
has been built or run locally. No converter or Fyne dependency is changed by these
staging files, and no Chromium arithmetic path is certified from source inspection.

`skia_lowp_enlargement.go.proposed` is a Go translation of the pinned Skia CPU
low-precision sampling arithmetic, with independent analytical test vectors in
`skia_lowp_enlargement_test.go.proposed`. Retain both `LICENSE-Skia.txt` and the
existing `LICENSE-Fyne.txt` when copying or distributing these files.

The helper deliberately accepts only uniform physical enlargement factors 2 and
4, original zero-origin NRGBA8 pixels or opaque RGBA8 pixels, and positive output
dimensions bounded to 16384 per axis and 64 Mi pixels. It declines partially
transparent RGBA inputs because their original straight RGB bytes cannot be
recovered from an already quantized premultiplied image. It also declines mixed
axis factors, reduction, other image types and other scale factors. There is no
JPEG, ICC, fractional-origin or general color-management claim.

The translation premultiplies original NRGBA8 channels to RGBA8 before filtering.
It retains premultiplied output as `image.RGBA`, avoiding the current intermediate
straight-alpha NRGBA8 conversion. It implements the pinned source's Q16 sample
coordinate, Q15 signed rounded multiply, horizontal intermediate precision, and
vertical final `+0x80` rounding. No color tolerance or screenshot-derived offset
is used.

For an isolated third hosted variant, first apply the original
`fyne-smooth-image-enlargement.patch`, copy the proposed helper and test into
`internal/painter/software/` without the `.proposed` suffix, then apply
`fyne-skia-lowp-enlargement.patch`. The latter only opts into the helper for the
ordinary Smooth-image branch when image alpha is 1 and corner radius is 0. Other
experimental profiles retain the simple bilinear candidate. Do not combine the
two candidate outputs or replace existing fixtures to manufacture a passing run.

All current strict profiles use opaque white background. Final compositing onto
other backgrounds remains a separate arithmetic question: the helper intentionally
does not replace Fyne's Go `draw.Over` compositor. Skia's low-precision blending
also has platform-dependent accurate/approximate division paths. A sampling match
alone does not establish equivalent arbitrary-background compositing.

## Concrete predictions to test independently

- A uniform row with opaque channels 1 then 3 enlarged 2 times has an interior
  channel value of 1.5. The current Go bilinear path's 16-bit expansion and final
  byte truncation produce 1. The Skia low-precision source arithmetic produces 2.
  These are source-derived predictions, not observed Chromium pixels.
- A low-alpha constant channel 127 at alpha 1 premultiplies to channel 0 in RGBA8;
  channel 128 at alpha 1 premultiplies to 1. Preserve both sides of that threshold.
- Colored alpha-0 pixels must contribute no color. Interpolating original straight
  RGB first would create a fringe and should fail the retained RGBA fixture.
- The 2D odd-channel test prevents an implementation from rounding horizontal
  interpolation to 8 bits before the vertical pass.
- Original 16 by 16 resources must remain unchanged while their boxes are 32 CSS
  pixels. DPR 1 and 2 therefore exercise physical factors 2 and 4 with independent
  original Chromium frames, original Fyne scenes, generated Fyne objects and
  inverse-browser frames.

Root's corpus now retains a literal 1-to-3 vertical column pair in the odd PNG.
Keep the odd and alpha images as strict zero-tolerance gates. A green even-channel
isolator is insufficient, and a failing candidate remains experimental.

## Exact source identity

Chromium tag `153.0.8010.12` pins Skia commit
`9d07e5bad9e3e21da2426946e589daa647218271` in `DEPS`.

- [Skia low-precision arithmetic](https://github.com/google/skia/blob/9d07e5bad9e3e21da2426946e589daa647218271/src/opts/SkRasterPipeline_opts.h),
  blob `44a67c910a1557e385f4bcb0c58ee3ae921b2240`: `scaled_mult` at
  lines 6037–6061; `bilerp_clamp_8888` at lines 7077–7210. The helper's
  `(a*b+16384)>>15` signed-rounded multiply agrees with the pinned x86
  `PMULHRSW`, ARM64/NEON `vqrdmulhq_s16` and scalar paths for its bounded
  inputs. Interpolation widths remain within ±32640, excluding the exceptional
  `a=b=-32768` pair where ARM's saturation can differ. The common horizontal
  and vertical rounding stages are unchanged across these paths. Factors 2 and
  4 also make the restricted Q16 coordinate products exact. These arithmetic
  facts do not establish that hosted ARM64 Chromium selects this CPU stage;
  high-precision or GPU paths remain possible and require the original pixel
  oracle.
- [Skia image shader](https://github.com/google/skia/blob/9d07e5bad9e3e21da2426946e589daa647218271/src/shaders/SkImageShader.cpp),
  blob `33afb61475263b156f2c5f323d1f8ca4f0f37dd8`, lines 692–733:
  the fast stage is conditional on color format, tile mode, mipmap mode and mapped
  bounds. A high-precision or GPU path can instead be selected.
- [Skia RGBA8 premultiplication](https://github.com/google/skia/blob/9d07e5bad9e3e21da2426946e589daa647218271/src/codec/SkCodecPriv.h),
  blob `c321fb77c0aee2e2063fd00e0beb482e9151c479`, lines 294–311.
- [Blink image frame](https://github.com/chromium/chromium/blob/153.0.8010.12/third_party/blink/renderer/platform/image-decoders/image_frame.h),
  blob `92351c43b6b65523ed55608e69ff9fef024eb4c0`, lines 231–245 and 338:
  8-bit channel premultiplication and its default flag. This does not by itself
  prove the actual decoder path for a hosted screenshot.
- [Chromium filter policy](https://github.com/chromium/chromium/blob/153.0.8010.12/cc/paint/paint_flags.cc),
  blob `29f01e0d67f2593f0cc737a13bd0cf1a8ce7f007`, lines 178–209:
  Medium/Low can select linear filtering with different mipmap modes.
- [Go bilinear implementation](https://github.com/golang/image/blob/v0.24.0/draw/impl.go),
  blob `fcd19943c4136cd32f7dc89445c5d3283201e6f5`, lines 5800–5825
  and 6173–6218: premultiplied 16-bit channel expansion and float intermediates.
  [Kernel construction](https://github.com/golang/image/blob/v0.24.0/draw/scale.go)
  uses pixel-center sampling and `ftou` rounds in the 16-bit range.

The fork's declared `x/image` version is v0.24.0, while the inspected converter
`native/go.mod` selects v0.46.0 through MVS. The cached v0.46.0 implementation
retains the relevant arithmetic. Hosted evidence must record the actual resolved
module list and source bytes for each variant rather than infer its version from
the fork's own `go.mod`.
