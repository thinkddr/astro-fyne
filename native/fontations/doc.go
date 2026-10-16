// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Package fontations provides an optional software text backend, enabled with
// atf_fontations on Linux ARM64 with CGo. The default build loads no native code.
//
// Hosts supply a shared library built from cabi with its upstream notices,
// licensed static fonts and an explicit policy. Close the backend after its
// views stop painting. Canvas objects retain immutable Go snapshots, not native
// run handles. Only ASCII and acute/diaeresis combining marks are supported;
// this backend does not provide bidi segmentation or font fallback. Painting
// requires opaque colors/backdrops at scale 1 or 2. Editor caret/selection
// behavior remains that of webui.NewEditor and is not a full-run cluster API.
package fontations
