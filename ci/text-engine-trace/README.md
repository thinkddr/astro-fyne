<!-- SPDX-License-Identifier: Apache-2.0 -->

# Passive native N32 scaler trace

This isolated hosted diagnostic starts from the unchanged control at
`c6b061a414ef251eb487020c9ed5b00e870d5018`. It keeps that control's guarded
Linux N32 transfer, R32=16 compile definitions, host-query RGB requests,
gamma/contrast, seven-row source, original font and DPRs 1/2. It reuses the
trace-only implementation from `0e9925f4f62f342ce93aa70efd7ab61fb17d3589`,
adapting only copied-source selection, driver labels and evidence guards to the
current N32 control. No original policy or source is replaced.

The three patches add stderr observations and select a copied scaler source.
They change no requests, hinting decisions, metrics, glyphs, placement, masks,
gamma, contrast or pixels. The Skia source remains under its BSD notice in
[LICENSE-Skia.txt](LICENSE-Skia.txt); its existing copyright header is preserved.
The driver/build scaffolding is Apache-2.0.

## Build and evidence

The branch-specific `native-n32-passive-scaler-trace` workflow resolves and
builds the existing control through `ci/text-engine-probe/build-remote.sh`.
`source-pin.json` binds the original inputs, original and copied-source hashes,
three patches and notice. All original control inputs are checked before build.
Distributed patches use zero-context unified diffs to avoid space-only context
lines. Original proposal patch hashes are retained separately; exact pre/post
source hashes are checked around each `patch --fuzz=0` application.

`prepare.py` copies the control Cargo assembly without build outputs, patches
only that copy's build script/driver, and patches the exact scaler source in a
separate copied directory. Cargo builds into a fresh target directory. The
second final link uses byte-identical copied engine/header sources and the
unchanged Skia, HarfBuzz and OTS archives. The primary checkouts and original Cargo assembly
remain unchanged, with before/after file inventories. Control binary, archives,
Cargo lock, request policy, tool binaries and Rust compiler identity are checked
again after the run. Actual command logs, Cargo graphs, locks, binary hashes,
source inventories and original upstream notices are retained.
Source inventories exclude `.git`, `out`, `target` and `__pycache__`; generated
Skia headers in `out` are not individually inventoried. The same native archives
and generated-header directory are reused, and archive hashes/commands remain
bound in the evidence.

Both variants use the unchanged `surface-build.py` compile wrapper/verifier.
Actual GN, four named Cargo CXX consumers and final C ABI receipts must retain
the current R32=16 guard. Each surface contract is independently bound to its
actual library, compiler, raw receipts, selected commands and original/copied
build script plus unchanged engine/header bytes. The copied scaler's source
path/hash and diagnostic compile define are also checked. The shared Skia
source is read through a trace-directory symlink, never patched in place.

The original N32 transfer/failed-call controls run against both libraries before
browser work, and their reports must match except the verified library hash.
The original and instrumented drivers then run before browser work. Native
reports must match exactly except `libraryHash`, `driverHash` and
`surfaceBuildContractHash`, each independently verified before exclusion. All
metrics, glyphs, clusters, advances, offsets, origins, font-table hashes,
effective-font bytes, requests and frame metadata, including every one of the
14 actual surface observations, remain part of equality.

Both reports must retain the current typed request policy and its actual
float32 native requests. Early neutrality does not require a later Fontconfig
sidecar. Full comparison independently requires the current observer/source
pins, source-manifest hash, request-policy hash and six typed host properties;
missing or mismatched evidence fails without suppressing the six pixel outcomes.

Two full-frame control/trace comparisons at zero channel/pixel tolerance run
before browser capture. The unchanged original Astro source is then captured,
and all six distinct comparison slots are retained:

| Direction                                    | DPRs |
| -------------------------------------------- | ---- |
| Uninstrumented control → instrumented native | 1, 2 |
| Original Chromium → uninstrumented control   | 1, 2 |
| Original Chromium → instrumented native      | 1, 2 |

Missing or malformed evidence produces an explicit invalid result. All
comparison failures accumulate; a known browser mismatch remains a failed job
and cannot skip either neutrality gate. Complete metrics or pixels changing
invalidates the passive-instrumentation evidence. No crop, mask, fitting,
tolerance or reference-guided policy adjustment is used.

## Reading the raw trace

`ATF_DRIVER` records bracket existing shape/paint calls. `ATF_SCALER` records
show typeface filtering before/after, the constructor's existing hinting branch,
final context scale/linear-metrics/pre-blend eligibility, and each actual image
generation's glyph ID, mask/source format, dimensions, row stride and packed
subpixel coordinates. Record dumps include flags, transform, text size,
luminance and quantized gamma/contrast. Nonzero raw gamma uses units of 1/64;
zero is the sRGB sentinel. Contrast uses units of 1/255.

The logged auto-hint control is the computed local value. Only the Slight,
Normal and Full `make_hinting_instance` paths consume it; mono and unhinted
paths do not. It is not an observation of Rust's eventual native/autohint
fallback. Likewise pre-blend applicability is eligibility, not proof that a
downstream LUT was applied. Cached strikes can span samples, and pointer strings
are process-local correlation tokens. Multi-line raw stderr is retained rather
than relabeled as a per-row JSON glyph trace.

Compilation and passive equivalence do not establish browser pixel parity,
effective browser policy, or a Fyne widget/editor integration. Reports retain
`diagnosticOnly: true`, `pixelPerfectVerified: false` and
`browserEffectivePolicyVerified: false`.

Primary sources:

- [Pinned scaler implementation](https://github.com/google/skia/blob/9d07e5bad9e3e21da2426946e589daa647218271/src/ports/SkTypeface_fontations.cpp)
- [Scaler record and quantization](https://github.com/google/skia/blob/9d07e5bad9e3e21da2426946e589daa647218271/src/core/SkScalerContext.h)
- [Actual mask generation](https://github.com/google/skia/blob/9d07e5bad9e3e21da2426946e589daa647218271/src/core/SkScalerContext.cpp)
