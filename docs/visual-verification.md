<!-- SPDX-License-Identifier: Apache-2.0 -->

# Capture and verify a visual profile

A visual profile fixes the source revision, application state, viewport, device scale, theme,
font resources and rendering environment. The initial geometry scenario uses **320 × 240
CSS pixels at scale 1**, with solid rectangular boxes and no text. It exercises the complete
Astro CSS → browser measurement → generated Go → native capture → zero-difference path.

CI runs browser captures, native tests and builds in a pinned environment and keeps the evidence.

Run `bunx --no-install playwright install chromium` once to install the capture browser.

Start the example web preview in a separate terminal. From the project root,
generate the source manifests consumed by the behavior example pages before building:

```sh
bun src/cli.ts analyze --config conformance.json > artifacts-conformance-analysis.json
bun src/cli.ts analyze --config keyed-conformance.json > artifacts-keyed-analysis.json
bun src/cli.ts analyze --config primitive-conformance.json > artifacts-primitive-analysis.json
bunx astro build --root example
bunx astro preview --root example --host 127.0.0.1 --port 4321
```

From the project directory, while that preview is running:

```sh
bun src/cli.ts analyze --config visual.json --entry Geometry > /tmp/astro-fyne-analysis.json
task_source_hash="$(bun -e 'console.log((await Bun.file("/tmp/astro-fyne-analysis.json").json()).sourceHash)')"
bun capture/astro-fyne-capture.ts \
  --url http://127.0.0.1:4321/geometry \
  --out /tmp/astro-fyne-geometry --width 320 --height 240 --scale 1 \
  --state default --source-hash "$task_source_hash"
bun src/cli.ts generate --config visual.json --entry Geometry \
  --measurements /tmp/astro-fyne-geometry/measurements.json
```

`--selector` defaults to `#fyne-root`. Every element within that root needs a unique explicit
HTML `id`. Use `--ready-selector` for an application readiness signal. `--state` labels the
state already prepared by the URL and scenario; it does not execute interactions. Capture
waits for fonts and images, checks that the DOM and measurements remain stable, and records
root CSS custom properties as `tokens`. It writes `web.png` and `measurements.json`, including
source, DOM and screenshot hashes.

Image captures also require `--analysis PATH` pointing to the compiler's `analyze` result.
Capture checks the bytes of the response Chromium actually used against the compiler's
resource digest, plus its MIME type, literal URL and natural dimensions. The image scenario
in `image-visual.json` uses a local PNG at its natural size; its evidence is retained in
`artifacts/images` separately from the solid-box scenario.

`responsive-flex.json` exercises the source-only layout separately. CI keeps the same
native widget through five window sizes, then captures another device scale. Its Chromium
rectangles serve as a comparison oracle, not as native layout input. For each case, CI also
exports the already rendered Fyne scene, generates Astro + Preact from it, and compares that
web frame with the native image. These artifacts are retained under
`artifacts/responsive-flex`. The inverse output freezes that frame; it does not infer a
responsive algorithm from arbitrary Go code.

Capture the generated native geometry and compare the actual images:

```sh
cd native
ASTRO_FYNE_ARTIFACTS=/tmp/astro-fyne-geometry go test -count=1 ./generated -run '^TestCaptureMeasuredGeometry$'
go run ./visual/cmd/astro-fyne-compare \
  --reference /tmp/astro-fyne-geometry/web.png \
  --native /tmp/astro-fyne-geometry/native.png \
  --out /tmp/astro-fyne-geometry/diff.png
```

The default gate permits **zero channel difference and zero changed pixels**, including
alpha. It refuses different image dimensions and returns a failing exit code when pixels
differ. It rejects 16-bit PNGs instead of losing their low channel bits during comparison;
the gate compares channels represented at up to 8 bits. Animated PNGs and unsupported
color, precision, background or orientation metadata also fail instead of being ignored.
Its JSON result includes
`changedPixels`, `maxChannelDelta`, `bounds`, `exact` and
`accepted`. Optional tolerances must be selected explicitly; accepted images with differences
still report `exact: false`. Passing the geometry scenario certifies that scenario only.

The generator report always starts with `pixelPerfectVerified: false`. Generation and matching
bounding boxes do not establish visual equality. Keep the comparator result with both captures
and the measurement file as the evidence for a passing profile.

`visual-scale2.json` defines a separate geometry profile at scale 2. CI captures its
browser and native output at 640 × 480 physical pixels and compares all channels with
zero tolerance. It preserves the same 320 × 240 logical viewport; this profile does
not certify bitmap interpolation or typography at scale 2.

## Isolate native text differences

On a remote machine, start the example preview above, then run:

```sh
bash ci/typography.sh
```

The script compares the same seven text rows in Chromium, upstream Fyne 2.8.1 and
the public Fyne fork `v2.8.1-sytue.16`, at device scales 1 and 2. The shared
[probe](../typography-probe.json) includes kerning, ligatures, combining characters,
descenders and a fractional 14.5px font size. It uses the original font bytes and an
opaque white background. It does not align images after rendering or apply tolerances.

Evidence is retained in `artifacts/typography`:

| File                                       | Evidence                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `scale-*/web-text.json`                    | DOM Range rectangles, marker baselines, separate Canvas text metrics and applied settings             |
| `<variant>/scale-*/native-text.json`       | Actual native text positions, driver measurements, font digest and physical-origin derivation         |
| `<variant>/native-shaping.json`            | Real painter glyph IDs, clusters, signed 26.6 advances, offsets and extents for 42 text/H/space cases |
| `<variant>/fyne-module.json`               | Public dependency version and verified module checksums                                               |
| `<variant>/*-modules.jsonl`                | Resolved module versions for the native capture and painter trace                                     |
| `<variant>/scale-*/pixels.json`            | Unchanged strict browser/native pixel comparison                                                      |
| `upstream-versus-fork/scale-*/pixels.json` | Strict comparison of the two native captures                                                          |
| `summary.json`                             | Width and baseline deltas, shaping agreement and explicit pixel results                               |

The painter trace runs in a temporary copy of the exact downloaded Fyne module.
A test sidecar calls its real shaping kernel; the production kernel is unchanged.
The comparison requires the same non-Fyne dependencies and the same shaped glyph
records in both native variants. Their physical paint origins may differ because
the fork uses nearest-pixel placement and upstream uses ceiling placement.

DOM Range rectangles describe selection/advance boxes, not glyph ink. Measuring
prefixes on a Canvas reshapes each prefix independently; those widths are not
contextual per-glyph advances. Logical baselines, physical placement and raster
coverage are separate observations. Matching one does not establish the others.

These files remain `diagnosticOnly: true` and `pixelPerfectVerified: false`.
A valid diagnostic may contain a strict comparison with `accepted: false`; missing
captures, inconsistent identities or invalid comparison results fail CI. All
existing exact geometry and bitmap gates remain required independently.

Measured constructors declare the captured device scale. After assigning the widget to its
canvas, hosts must call `view.BindCanvas(window.Canvas())` and check `view.ValidateCanvas()`
before certifying or exporting it. A measured profile requires its exact logical viewport and
device scale; the runtime reports changes to either as errors.
