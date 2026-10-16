// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

#ifndef ASTRO_FYNE_FONTATIONS_LOADER_H
#define ASTRO_FYNE_FONTATIONS_LOADER_H
#include "cabi/text_engine.h"

typedef struct atf_loader atf_loader;

atf_loader* atf_loader_open(const char* path, char* error, size_t capacity);
int atf_loader_close(atf_loader* loader, char* error, size_t capacity);
atf_engine* atf_loader_font_open(atf_loader* loader, const uint8_t* data, size_t length,
                                char* error, size_t capacity);
void atf_loader_font_close(atf_loader* loader, atf_engine* engine);
const uint8_t* atf_loader_effective(atf_loader* loader, atf_engine* engine, size_t* length,
                                   char* error, size_t capacity);
int atf_loader_shape(atf_loader* loader, atf_engine* engine, const uint8_t* text, size_t length,
                      float font_css, float line_height_css, const atf_policy* policy,
                      atf_metrics* metrics, atf_glyph* glyphs, size_t glyph_capacity,
                      char* error, size_t capacity);
int atf_loader_paint(atf_loader* loader, atf_engine* engine, const atf_glyph* glyphs, size_t count,
                      float font_css, float line_height_css, const atf_policy* policy,
                      uint8_t* rgba, size_t length, uint32_t width, uint32_t height, uint32_t scale,
                      float x, float y, uint32_t rgb, int32_t destination_x, int32_t destination_y,
                      char* error, size_t capacity);
#endif
