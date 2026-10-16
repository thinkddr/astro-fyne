// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
// Experimental ABI; not a production Fyne text engine.
#ifndef ASTRO_FYNE_TEXT_EXPERIMENT_H
#define ASTRO_FYNE_TEXT_EXPERIMENT_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct atf_engine atf_engine;
typedef struct atf_run atf_run;
typedef struct {
  // Hinting: 0=None, 1=Slight, 2=Normal, 3=Full. Edging: 0=alias, 1=AA, 2=LCD.
  uint32_t hinting, auto_hint, embedded_bitmaps, subpixel, linear_metrics, edging, baseline_snap;
  // Pixel geometry: 0=unknown, 1=horizontal RGB, 2=horizontal BGR.
  uint32_t pixel_geometry;
  float contrast, gamma;
} atf_policy;
typedef struct {
  uint32_t glyph, cluster_utf8;
  int32_t x_advance_16_16, y_advance_16_16, x_offset_16_16, y_offset_16_16;
  float nominal_advance_css, x_css, y_css;
} atf_glyph;
typedef struct {
  float advance_css, ascent_css, descent_css, leading_css, baseline_css;
  uint32_t glyph_count;
} atf_metrics;
typedef struct {
  uint32_t r32_shift, g32_shift, b32_shift, a32_shift, cpu_little_endian;
  uint32_t n32_color_type, rgba_color_type, bgra_color_type;
  uint32_t external_color_type, internal_color_type;
  uint32_t external_alpha_type, internal_alpha_type, external_srgb, internal_srgb;
  uint32_t width, height, external_row_bytes, internal_row_bytes, pixel_geometry;
  uint32_t internal_first_b, internal_first_g, internal_first_r, internal_first_a;
  float contrast, gamma;
} atf_surface_metadata;

// Error text is thread-local, valid until the next failing call on that thread.
const char* atf_error(void);
size_t atf_abi_size(uint32_t type); // 1=policy, 2=glyph, 3=metrics, 4=surface metadata.
void atf_surface_defaults(float* contrast, float* gamma);
// Actual surface and consumer macro values from the last successful paint on
// this thread. This does not expose or certify scaler/glyph mask internals.
int atf_last_surface_metadata(atf_surface_metadata* metadata, size_t size);
// Open always runs the pinned OTS sanitizer before making the Fontations face.
atf_engine* atf_open(const uint8_t* original, size_t length);
void atf_close(atf_engine* engine);
// Borrowed sanitized bytes are valid while the engine is alive.
const uint8_t* atf_effective_font(const atf_engine* engine, size_t* length);
// Static single-face Latin/combining probe only. No fallback or bidi segmentation.
atf_run* atf_shape(atf_engine* engine, const uint8_t* utf8, size_t length,
                  float font_css, float line_height_css, const atf_policy* policy);
void atf_free_run(atf_run* run);
int atf_run_metrics(const atf_run* run, atf_metrics* metrics);
int atf_copy_glyphs(const atf_run* run, atf_glyph* glyphs, size_t count);
// Paint through private native N32 storage, converting to/from opaque RGBA8.
// Failed calls leave caller bytes unchanged. Origin is a native line-box origin,
// not an origin copied from browser measurements. Scale is 1/2.
int atf_paint(const atf_run* run, uint8_t* rgba, size_t length,
              uint32_t width, uint32_t height, uint32_t scale,
              float line_x_css, float line_y_css, uint32_t foreground_rgb);
#ifdef __cplusplus
}
#endif
#endif
