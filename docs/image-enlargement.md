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
bash ci/image-enlargement.sh native-legacy
```

Use a separate clean job for each variant. The wrapper prepares the compiler,
browser and native captures, retains comparison artifacts and reports failures.
The experiment is intended for hosted CI; it is not part of the ordinary demo
startup or a requirement to build an unrelated application.

In GitHub Actions, select **image-enlargement-experiment**, then **Run workflow**
on the desired revision. Choose `all` (the default) or one named variant. The
workflow is `.github/workflows/image-enlargement.yml`. It also runs for the dedicated
experiment branch and matching pull-request paths, selecting the current
`native-legacy` candidate. A manual `all` run includes all five variants.
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
  Declined helper profiles retain the broader bilinear experiment.
- `native-legacy` applies that helper directly to the original `.16` painter,
  preserving its CatmullRom fallback whenever the helper declines. It does not
  apply the broad bilinear patch. The call is limited to Smooth Image objects,
  alpha 1 and radius 0; Raster, Pixels and Fastest keep their existing routes.

The helper's source type, zero-origin and factor checks apply to the buffer
returned by Fyne's existing image prepass. That prepass can normalize other
original image types and origins to NRGBA. These checks do not promise that every
original 16-bit, premultiplied or offset image stays on the old sampling path.
The retained browser corpus uses the original PNG8 resources described above.

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

## Validated legacy sampler

[Run 38890512586](https://github.com/thinkddr/astro-fyne/actions/runs/38890512586)
compiled and tested the `skia-legacy` candidate at
`78c51dd119e2756769a9bcb06e37e0511b0fe946`. All six full-frame comparisons
passed with zero changed pixels: forward conversion, inverse conversion and native
reconstruction, each at DPR 1 and 2. Candidate unit tests, native race tests and
source/resource/provenance checks also passed.

This validates the retained software-renderer profile, including odd RGB and
alpha. The production dependency remains unchanged; the result applies to the
isolated patched renderer. The candidate still uses the broader bilinear fallback
outside its bounded helper, so this result does not validate that fallback or
universal conversion. The original failing variants remain available.

## Bounded variant under validation

`native-legacy` separates the successful helper from the experiment's broad
bilinear fallback. Its direct patch input is the published `.16` source blob
`a18ecf51a6d397236468bc2dfec58ebc4d765115`, also present in the neutral public
fork base `2236726ac36e11116c689dc64b0890d91be8ced6`.
`ci/image-sampling/native-legacy-pin.json` binds the patch, original and final
source, unchanged helper inputs, licenses and new routing tests by SHA-256.
The wrapper also verifies that remote formatting reproduces the previously
tested helper bytes. The minimal variant needs its own hosted proof; the earlier
successful run does not establish a result for a different patch.

Automatic runs select this variant on the dedicated enlargement branches and
matching pull requests. Its ARM64 job retains the six strict frame comparisons
and runs helper, declined-profile and real Image/Raster routing tests. The latter
constructs actual Fyne objects and checks Raster samples against the original
CatmullRom kernel. Declined-profile tests compare the renderer with the image
opt-in enabled and disabled, without copying the implementation into an oracle.

A separate `ubuntu-24.04` x86 job uses the canonical fork fixture platform and
runs these complete packages with the race detector and `ci,migrated_fynedo`
tags, without a test-name filter:

```text
./internal/painter/software ./internal/painter ./canvas
```

It runs once under the converter-resolved module graph, including x/image
v0.46.0, and once under the fork's own resolved graph. The actual selected versions
are recorded before and after both runs; the fork's declared version is not
assumed to be the final MVS selection. In a hosted x86 environment, this mode is:

```sh
ASTRO_FYNE_IMAGE_REGRESSIONS_ONLY=1 bash ci/image-enlargement.sh native-legacy
```

This mode exits before browser generation and writes `regression-summary.json`,
not a synthetic six-comparison result. Its separate artifact includes module and
checksum files, graph inventories, complete package logs, formatted sources and
every failed fixture with its hash under `fork-failed-fixtures/`. Both module
graphs run even if one fails. The x86 choice matches existing fixture provenance;
it does not weaken the ARM64 browser/native comparisons or excuse failed tests.

Keep existing image, Raster, Pixels, Fastest, alpha and clipping goldens unchanged
for the first run. Review any changed fixture individually against its real
source, physical size and sampling route. An unexpected change outside the new
route is a regression to diagnose, not a reason to refresh a whole directory.
No dependency adoption, tag publication or broader parity claim follows from
adding this validation lane.
