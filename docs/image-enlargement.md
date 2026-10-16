<!-- SPDX-License-Identifier: Apache-2.0 -->

# Image enlargement experiment

This hosted experiment compares the current Fyne painter with isolated
enlargement candidates. It does not change the production Fyne dependency,
publish a fork tag or establish general browser/native pixel parity.

## Corpus

`ImageEnlargementConformance.tsx` is an authored, source-only Flexbox component.
The compiler generates one native widget, which uses the same canvas and image
objects first at DPR 1 and then at DPR 2. Browser measurements are comparison
evidence; they are never applied as native layout declarations.

The viewport is 160 × 80 CSS pixels. Three original 16 × 16 PNGs are displayed
at 32 × 32 CSS pixels, at (16,16), (64,16) and (112,16), over opaque white.
Physical screenshots are 160 × 80 and 320 × 160 pixels respectively.

The images are original procedural assets licensed under Apache-2.0:

- `example/public/images/enlargement-even.png` uses RGB multiples of 64 to
  isolate the interpolation kernel.
- `example/public/images/enlargement-odd.png` includes odd RGB values and
  adjacent columns with channel values 1 and 3, exposing rounding differences.
- `example/public/images/enlargement-alpha.png` includes varying alpha and
  colored transparent pixels, exposing premultiplication and blending errors.

All three images remain in every frame. Native code embeds the original PNG
bytes; exported scenes retain those resources rather than replacing them with
enlarged or composited images. Capture checks served resource digests, decode,
natural dimensions, image rectangles and device scale. Source, scenario,
resource and screenshot hashes bind the evidence to its inputs.

## Run a variant

From the repository root in the hosted Linux CI environment:

```sh
bash ci/image-enlargement.sh baseline
bash ci/image-enlargement.sh bilinear
bash ci/image-enlargement.sh skia-lowp
bash ci/image-enlargement.sh skia-legacy
```

Use a separate clean job for each variant. The wrapper prepares the compiler,
browser and native captures, retains comparison artifacts and reports failures.
The experiment is intended for hosted CI; it is not part of the ordinary demo
startup or a requirement to build an unrelated application.

In GitHub Actions, select **image-enlargement-experiment**, then **Run workflow**
on the desired revision. Choose `all` (the default) or one named variant. The
workflow is `.github/workflows/image-enlargement.yml`. It also runs for the dedicated
experiment branch and matching pull-request paths, selecting the current
`skia-legacy` candidate. A manual `all` run also retains the older candidates.
Matrix jobs run independently,
so one failed variant does not cancel the remaining captures.

Download the `image-enlargement-<variant>-<revision>` artifact from the run.
Evidence lives under `artifacts/image-enlargement/<variant>`, including each
`scale-1`/`scale-2` frame, comparison JSON, phase logs and `summary.json`.
Artifacts upload even when strict comparisons fail. A baseline mismatch remains
a failed job; it is not converted into an expected-success result.

The variants use isolated temporary Fyne source and a separate Go module file:

- `baseline` retains the published `.16` software painter.
- `bilinear` changes Smooth image enlargement to the Go bilinear kernel while
  preserving reduction, raster objects, Pixels and Fastest behavior.
- `skia-lowp` additionally tries the pinned Skia CPU low-precision arithmetic
  for the bounded uniform physical factors 2 and 4, original NRGBA8 or opaque
  RGBA8 sources, image alpha 1 and no rounded clipping. Other cases retain the
  bilinear candidate.

- `skia-legacy` tries the pinned Skia legacy Q4 linear sampler, with separate
  floor quantization of premultiplied RGB and alpha. It uses the same bounded
  physical factors and image types, without bypassing the existing image prepass.

The Skia-derived candidates are experimental. Chromium can select a different
CPU or GPU path, and matching kernel names does not establish identical channel
rounding or alpha arithmetic. The job records resolved dependency/tool versions,
source and patch identities instead of assuming the fork's declared transitive
dependency versions are the ones used by the converter.

## Required comparisons

At both DPRs, compare complete RGBA8 frames with zero channel tolerance and zero
different-pixel allowance: six required comparisons per variant.

| Direction                                         | Reference             | Actual                 |
| ------------------------------------------------- | --------------------- | ---------------------- |
| Original Astro/Preact → generated native Fyne     | `web.png`             | `generated-native.png` |
| Original native Fyne → generated web              | `original-native.png` | `inverse-web.png`      |
| Exported native scene → reconstructed native Fyne | `original-native.png` | `scene-native.png`     |

The source test also checks raw-native/generated-native equality and requires an
unmeasured responsive snapshot. The reconstruction test checks original resource
bytes and geometry. Existing natural-size bitmap profiles remain separate.

A failing baseline demonstrates the discrepancy. A candidate passes only when
every required comparison succeeds, including odd RGB and alpha. Retain the
original PNGs, diff images, comparison JSON and logs for failed variants; do not
drop a case, hide text or alpha, substitute pixels or relax tolerances to obtain
a green result. File, provenance, dimension and execution errors are failures too.

This profile covers integer placement, opaque white composition and exact
physical enlargement factors 2 and 4. It does not certify other scales, fractional
origins, reduction, arbitrary backgrounds, JPEG/color profiles, rounded image
clips, typography or universal CSS compatibility.

## First hosted result

[Run 38888890141](https://github.com/thinkddr/astro-fyne/actions/runs/38888890141)
compared commit `856e00559d977a7d87f4dd0ce4071d8f85a618f0` on hosted ARM64.
All generation, provenance, native race tests and candidate unit-test phases
passed. All six comparisons per variant produced valid strict results.

| Variant   | Different pixels, DPR 1 | Different pixels, DPR 2 | Largest channel error |
| --------- | ----------------------: | ----------------------: | --------------------: |
| Baseline  |                   2,797 |                  11,140 |                    52 |
| Bilinear  |                   1,321 |                   6,333 |                     2 |
| Skia lowp |                   1,460 |                   7,378 |                     1 |

Forward and inverse comparisons had the same counts. Native scene reconstruction
was exact at both DPRs for all three variants. Both candidates failed the
zero-tolerance browser/native gate; neither is certified or adopted by this
experiment. The artifacts retain every mismatch for further investigation.
