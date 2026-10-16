<!-- SPDX-License-Identifier: Apache-2.0 -->

# Hosted native Fontations experiment

This diagnostic builds a native Fontations, HarfBuzz, Skia and OTS pipeline and
compares it with the original Astro typography page. The first complete hosted
render has matching total advances and baselines but still differs in pixels.
Existing fonts, fixtures, browser settings and reference pixels are unchanged.

The workflow is `.github/workflows/native-fontations-text.yml`. It runs on pushes
to the isolated `codex/native-fontations-text` branch and supports manual dispatch
once registered on the default branch. Its timeout is 45 minutes. Run the build
on a hosted Linux ARM64 machine, following [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Concrete commands

On the hosted Linux ARM runner:

```sh
bash ci/text-engine-probe/build-remote.sh --resolve --work "$RUNNER_TEMP/native-text"
bash ci/text-engine-probe/build-remote.sh --build --work "$RUNNER_TEMP/native-text"
python3 ci/text-engine-probe/driver.py --source-root "$GITHUB_WORKSPACE" \
  --library "$RUNNER_TEMP/native-text/evidence/libastro_fyne_text_experiment.so" \
  --policy ci/text-engine-probe/policy.json \
  --out artifacts/native-fontations-text/native
```

The workflow also captures the original Astro seven-row page at both DPRs,
validates its required browser-provenance sidecar, builds the existing strict
PNG comparator with read-only production modules, and compares both complete
frames. Every pixel mismatch returns a failed job. Artifacts upload on failure;
there is no expected-mismatch exemption or tolerance reduction.

The `--resolve` step is automatic source resolution, not a human approval gate.
It downloads only the necessary source repositories and four Chromium-vendored
crate trees. No Chromium browser tree/build is required for this native probe.
The later Skia dependency-sync step downloads its declared build dependencies
on the hosted runner. Resolution or compilation failures must be retained as
failures; the scripts do not create substitute pixels.

## Dependency reconciliation

Pinned Chromium `971a7443b0c9b0a9b2860529b33331b76077ec62`
(153.0.8010.12) selects:

| Component                | Exact source or version                               |
| ------------------------ | ----------------------------------------------------- |
| Skia                     | `9d07e5bad9e3e21da2426946e589daa647218271`            |
| HarfBuzz                 | `dfdc088c4d7c5d31dd5b13070b919b51f6c21ea8`            |
| OTS                      | `46bea9879127d0ff1c6601b078e2ce98e83fcd33`            |
| Skrifa                   | Chromium-vendored 0.44.0                              |
| read-fonts               | Chromium-vendored 0.41.0                              |
| font-types               | Chromium-vendored 0.12.2                              |
| cxx runtime              | Chromium-vendored 1.0.199                             |
| cxx-build host generator | Published 1.0.199, not Chromium's removed placeholder |

Skia's standalone Cargo file instead requests Skrifa 0.43.2/read-fonts 0.40.1.
Using it unchanged would not reproduce Chromium's Fontations dependency
selection. The resolver therefore copies the actual four Chromium-vendored
source trees, verifies every file's Git blob identity against its immutable
parent tree, records SHA-256s, and uses explicit Cargo path patches. It copies
the exact Rust CXX bridge from the pinned Skia tree and selects the features
listed by Chromium's GN files for the three font crates.

The standalone host/build dependency graph is **not** claimed to be Chromium's
entire GN graph. The committed `Cargo.lock` is the actual hosted standalone
resolution, retained and verified in [run 38909746057](https://github.com/thinkddr/astro-fyne/actions/runs/38909746057).
Its SHA-256 is `7b4f8f8ae78aab9edf28cadbdd6a51c34704fe9b8124ce46b1fb02790336e801`.
Resolution checks metadata with `--locked`; compilation also uses `--locked`.
The Chromium lock remains separate comparison evidence. Dependency changes need
a new real hosted resolution and review of that lock and its notices.

The build uses GN for CPU-only base Skia with Fontations disabled, then compiles
the exact Fontations CXX/Rust bridge using Cargo/cxx against that same base.
`SKIA_INCLUDE_ROOT` supplies real Skia headers; `CFG.include_prefix = ""`
preserves `src/ports/fontations/src/ffi.rs.h`, the path required by the pinned
private header. Both C++ compilations use `-fno-rtti` to match GN's base classes;
exceptions remain enabled for the C ABI's caught errors. All native C++ uses
the installed Clang/libstdc++ consistently. Tool versions, actual compiler
hashes, GN hash, link map and linked-library inventory are retained. This is
a declared hosted toolchain profile, not an immutable container-image claim.

The resolver also materializes Chromium's exact CXX forwarding header and its
already verified vendor header at their original relative paths. The assembly
include root reaches dependency builds through Cargo's `CXXFLAGS`.

This standalone profile explicitly sets `skia_use_partition_alloc=false`.
GN and external C++ leave `SK_USE_PARTITION_ALLOC` undefined and select Skia's
supported no-op raw pointer/reference implementation. Chromium's PartitionAlloc
and BackupRefPtr protection are not part of this profile. Font source, shaping,
hinting, gamma and paint requests are unchanged by this allocator choice.
The build retains actual GN commands and checks that the observed missing
PartitionAlloc symbols are absent from the rebuilt Skia archive.

HarfBuzz is built without FreeType, ICU, Graphite or platform shapers for this
bounded Latin/OT case. OTS is the pinned sanitizer with Blink's table-action
selection, using installed zlib/WOFF2 support whose actual versions are logged.
The original source is uncompressed static TrueType; this does not certify
WOFF/WOFF2 equivalence. No system font manager or font fallback is used.

## Native pipeline and ABI

`atf_open` sanitizes the original bytes through OTS, retains the result and
calls `SkTypeface_Make_Fontations` explicitly. Failure does not fall back to
FreeType or a theme font. The driver saves the effective font and reports raw
and sanitized font/table hashes, so sanitizer changes are visible.

`atf_shape` constructs a CSS-sized `SkFont` and cached strike. HarfBuzz's parent
font supplies OpenType functions; the child overrides advances and extents
using that strike, as in Blink's relevant path. HarfBuzz positions are 16.16,
with the corresponding post-shape rounding when `SkFont.isSubpixel()` is false.
This preserves pinned Blink's float conversion before signed rounding, including
ties away from zero; computing the division in double first can give a different
answer near larger 16.16 ties. The final conversion remains range checked.
The same immutable run is reused at DPR 1 and 2. Actual glyph IDs, nominal
advances, contextual advances/offsets and UTF-8 clusters are retained.

`atf_paint` paints glyphs directly with `SkCanvas::drawGlyphs` into an already
opaque RGBA8/sRGB software destination with declared surface properties. It
does not rasterize a browser image or use measured glyph positions. DPR is
applied to the paint CTM, not the shaping size. The C ABI provides native run
metrics; the line baseline uses the current converter backend's rounded
ascent/descent and floored half-leading formula. This derives an origin from
native metrics and original line-box coordinates; it is not calibrated from
the browser's marker. A discrepancy remains visible in the complete frame.

The prototype is intentionally limited to the current ASCII + combining acute
and diaeresis samples, one static face, horizontal LTR, language `en`, OT
shaping and no fallback. It is not complete Blink itemization, font selection,
CSS line layout, bidi, Unicode editing, variation-selector or color-font support.

## Native policy versus browser proof

`policy.json` declares `headless-host-fontconfig-rgb-independent-positioning`.
It uses one guarded host-query/source profile, with no parameter search:

- Full hinting follows the pinned headless default and renderer override.
- Anti-aliasing, RGB order, embedded bitmaps and auto-hint requests follow the
  standalone host's actual empty Fontconfig query and the pinned Blink/GFX mapping.
- Gamma 1.2 and contrast 0.2 follow Chromium's Linux build configuration.
- Subpixel positioning and linear metrics remain independently disabled;
  baseline snap remains enabled. Browser-global cached device scale is unobserved.

[Run 38916428319](https://github.com/thinkddr/astro-fyne/actions/runs/38916428319)
observed `antialias=1`, `autohint=0`, `embeddedbitmap=1`, `hinting=1`,
`hintstyle=1` and `rgba=1`, each present with a successful property result.
The next run must reproduce those typed values before using this request policy.
The observer binds its report to the exact policy bytes; the strict comparator
requires that binding and current observer/source identities. A changed query
fails rather than silently selecting a different policy.

The pinned [Blink mapping](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/platform/fonts/web_font_render_style.cc#L93-L113)
selects subpixel AA for anti-aliasing plus subpixel rendering, and the
[GFX mapping](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/ui/gfx/font_render_params.cc#L12-L28)
maps RGB to horizontal RGB geometry. Web-font construction uses an empty family;
the platform path then retains default render preferences. The bitmap request
also agrees with the pinned platform's default bitmap-avoidance flag.

Gamma and contrast come from the pinned Linux
[build configuration](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/skia/BUILD.gn#L112-L118).
`LegacyDisplayGlobals` initializes these values from the compile macros; its
setter changes them only on Windows. These are declared source/host-query
requests, not observations of the browser's effective font policy. The browser
can disable LCD through `ComputeSurfaceProps(false)`, and its actual linked
Fontconfig, LinuxUi settings, cached scale and renderer preferences remain
unobserved. Native scaler masks and pre-blend application also remain unverified.

The first complete render used `headless-full-independent-remainder`, with
SkSurfaceProps public defaults: gamma 0 (the sRGB sentinel), contrast 0.5,
grayscale AA, unknown geometry and bitmaps disabled. Its original failure and
unchanged observer/control outputs remain retained. No pixel gain is inferred
from a source-derived request change. Linux does not define Android's
`SK_GAMMA_APPLY_TO_A8`; the scaler can ignore or alter requests according to
its mask and flags.

Pinned Fontations `onFilterRec` collapses Full to Normal for non-LCD masks.
That applied to the original grayscale request; neither the new RGB request nor
its metadata proves that LCD survives the actual draw path. No origin, advance,
mask, gamma or contrast is chosen by minimizing reference-image error. See the
observed [browser run](https://github.com/thinkddr/astro-fyne/actions/runs/38902460924),
pinned [headless default](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/headless/public/headless_browser.h#L136-L138),
[renderer override](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/headless/lib/browser/headless_web_contents_impl.cc#L458-L462)
and [Fontations filter](https://github.com/google/skia/blob/9d07e5bad9e3e21da2426946e589daa647218271/src/ports/SkTypeface_fontations.cpp#L310-L330).

This is **not asserted to be Chromium's effective policy**. Proving that would
require separate observation of renderer preferences, OTS output, SkFont flags,
shaping, scaler masks, surface properties and the compositor. Instrumented and
uninstrumented browser builds would also need strict comparisons with the
original binary. Reports keep `browserEffectivePolicyVerified: false`.

## Proof and limitations

`probe-pin.json` freezes the existing probe, fixture and original font digests.
The driver has no reference-image or browser-metrics input. It writes a native
PNG and metrics for each scale and always labels this a diagnostic. `compare.py`
checks the same original-source identities and current PNG digests before
invoking the existing strict comparator. Complete reference/native/diff PNGs,
zero-tolerance results, effective font, metrics and policy remain artifacts.
Both reports must contain exactly two frames, with distinct integer scales 1
and 2. The comparator's actual decoded PNG width and height must match the
declared CSS viewport times its scale, as must both screenshot identities.

This first experiment is a standalone native renderer. It does **not** prove
Fyne widgets, controls, inverse conversion, caret geometry, GL/GPU parity,
arbitrary backgrounds or a production backend. Only after an actual build and
an improvement in an original failing frame should the opt-in real Fyne engine
hook be implemented. Measurement, paint, editor caret/hit-testing and clusters
must share one shaped run. Existing `canvas.Text` and real widget/event trees
must remain; mounting these whole-frame PNGs as widgets is prohibited.

## Notices and precise remaining blockers

The resolver copies the actual pinned Skia, HarfBuzz, OTS and Chromium license
files and each resolved Cargo package's root license/notice files. Original
source headers are preserved. `collect-notices.py` additionally retains the
fetched source trees' nested notices, Cargo package notices, installed Linux
copyright texts and referenced common licenses with SHA-256s. This is labelled
a broad notice superset, not an exact linked-package inventory. The actual
link map and dynamic-library inventory are separate evidence. The font's actual
`LICENSE-NotoSans.txt` is kept with the artifact. The adapted table-action
selection retains Chromium's BSD notice. Review the actual collected files
before promoting this experimental binary into a distributed runtime.

Rust evidence includes actual `rustc -vV`, its source commit, compiler SHA-256,
sysroot, target-library directory and hashes of installed runtime libraries.
The collector copies installed `share/doc/rust` notices recursively, including
`licenses/` and the generated `COPYRIGHT-library.html` or `COPYRIGHT.html` that
covers standard-library dependencies. If short root notices are missing, their
exact bytes come from official Rust source at the observed compiler commit;
these supplement the installed distribution's generated notices. The collector
fails if those generated dependency notices are absent, rather than replacing
them with a short MIT/Apache label. No Rust version or notice is invented.

[Run 38906332429](https://github.com/thinkddr/astro-fyne/actions/runs/38906332429)
resolved real sources and built Skia/HarfBuzz, then exposed OTS's missing Google
Test build dependency. [Run 38908188798](https://github.com/thinkddr/astro-fyne/actions/runs/38908188798)
also built OTS, then exposed Chromium's CXX include layout requirement.
[Run 38909746057](https://github.com/thinkddr/astro-fyne/actions/runs/38909746057)
compiled Fontations/CXX and the C ABI source, then failed at final linking on
PartitionAlloc dependencies. These failures and actual dependency locks remain
retained; no rendering was reached by those runs.

[Run 38912083896](https://github.com/thinkddr/astro-fyne/actions/runs/38912083896)
completed that clean build, linked and loaded the real ABI, collected notices
and painted all seven source rows at both DPRs. All seven total advances and
baselines matched the observed DOM and Canvas metrics. The complete-frame
comparisons still failed: 3,924 changed pixels at DPR 1 and 8,860 at DPR 2,
with maximum channel differences of 125 and 144. The browser PNGs were
byte-identical to the prior observed oracle. Equal total advances and baselines
do not establish equal glyph positions, outlines, masks or compositing.

The hosted diagnostic observes the system's actual empty Fontconfig query
with `observe-fontconfig.py`. It follows the pinned Chromium substitution
sequence, retains loaded configuration bytes and the bound shared-library hash,
and verifies those inputs stayed unchanged during the query. Sixteen exact
Chromium source files are retained with Git-blob and SHA-256 pins. The observer
does not select a family through `FcFontMatch` or apply a native policy itself;
it verifies the declared profile expectations before the driver uses that policy. Its separate process cannot reveal the browser's linked library,
startup configuration, LinuxUi defaults, cached device scale, renderer
preferences or effective SkFont/scaler/surface. Those remain unobserved.

[Run 38916428319](https://github.com/thinkddr/astro-fyne/actions/runs/38916428319)
retained 38 loaded configuration files and one directory listing. Both original
browser PNGs, both native PNGs and all native metrics remained identical to the
first complete render. The observer therefore caused no output change in this
bounded control. It does not prove browser-internal policy.

Remaining boundaries include strict pixel equality, per-glyph browser internals,
actual Fyne integration and editing behavior. Compilation and this diagnostic
never establish widget parity.

Before treating browser policy as reproduced, complete
the instrumentation or explicitly retain the independent-policy qualification.
These are technical completeness conditions, not human approval locks.
