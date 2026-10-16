//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

#include "loader.h"
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct atf_loader {
  void* handle;
  const char* (*error)(void);
  size_t (*abi_size)(uint32_t);
  atf_engine* (*open)(const uint8_t*, size_t);
  void (*close)(atf_engine*);
  const uint8_t* (*effective)(const atf_engine*, size_t*);
  atf_run* (*shape)(atf_engine*, const uint8_t*, size_t, float, float, const atf_policy*);
  void (*free_run)(atf_run*);
  int (*metrics)(const atf_run*, atf_metrics*);
  int (*glyphs)(const atf_run*, atf_glyph*, size_t);
  int (*paint)(atf_engine*, const atf_glyph*, size_t, float, float, const atf_policy*,
               uint8_t*, size_t, uint32_t, uint32_t, uint32_t, float, float, uint32_t, int32_t, int32_t);
};

static void message(char* output, size_t capacity, const char* text) {
  if (output && capacity) snprintf(output, capacity, "%s", text ? text : "Native text call failed");
}

static int symbol(void* handle, const char* name, void* output, size_t size,
                  char* error, size_t capacity) {
  dlerror();
  void* address = dlsym(handle, name);
  const char* failure = dlerror();
  if (failure || !address || size != sizeof(address)) {
    message(error, capacity, failure ? failure : "Unsupported function-pointer ABI");
    return 0;
  }
  memcpy(output, &address, size);
  return 1;
}

atf_loader* atf_loader_open(const char* path, char* error, size_t capacity) {
  atf_loader* loader = calloc(1, sizeof(*loader));
  if (!loader) { message(error, capacity, "Could not allocate library loader"); return NULL; }
  loader->handle = dlopen(path, RTLD_LOCAL | RTLD_NOW);
  if (!loader->handle) { message(error, capacity, dlerror()); free(loader); return NULL; }
#define LOAD(field, name) if (!symbol(loader->handle, name, &loader->field, sizeof(loader->field), error, capacity)) goto failure
  LOAD(error, "atf_error"); LOAD(abi_size, "atf_abi_size");
  LOAD(open, "atf_open"); LOAD(close, "atf_close"); LOAD(effective, "atf_effective_font");
  LOAD(shape, "atf_shape"); LOAD(free_run, "atf_free_run"); LOAD(metrics, "atf_run_metrics");
  LOAD(glyphs, "atf_copy_glyphs"); LOAD(paint, "atf_paint_snapshot_region");
#undef LOAD
  if (loader->abi_size(1) != sizeof(atf_policy) || loader->abi_size(2) != sizeof(atf_glyph) ||
      loader->abi_size(3) != sizeof(atf_metrics) || loader->abi_size(4) != sizeof(atf_surface_metadata)) {
    message(error, capacity, "Native text ABI structure sizes differ from the checked header");
    goto failure;
  }
  return loader;
failure:
  dlclose(loader->handle);
  free(loader);
  return NULL;
}

int atf_loader_close(atf_loader* loader, char* error, size_t capacity) {
  if (!loader) return 1;
  int result = dlclose(loader->handle);
  if (result != 0) message(error, capacity, dlerror());
  free(loader);
  return result == 0;
}

atf_engine* atf_loader_font_open(atf_loader* loader, const uint8_t* data, size_t length,
                                char* error, size_t capacity) {
  atf_engine* engine = loader->open(data, length);
  if (!engine) message(error, capacity, loader->error());
  return engine;
}

void atf_loader_font_close(atf_loader* loader, atf_engine* engine) { loader->close(engine); }

const uint8_t* atf_loader_effective(atf_loader* loader, atf_engine* engine, size_t* length,
                                   char* error, size_t capacity) {
  const uint8_t* data = loader->effective(engine, length);
  if (!data) message(error, capacity, loader->error());
  return data;
}

int atf_loader_shape(atf_loader* loader, atf_engine* engine, const uint8_t* text, size_t length,
                      float font_css, float line_height_css, const atf_policy* policy,
                      atf_metrics* metrics, atf_glyph* glyphs, size_t glyph_capacity,
                      char* error, size_t capacity) {
  atf_run* run = loader->shape(engine, text, length, font_css, line_height_css, policy);
  if (!run) { message(error, capacity, loader->error()); return 0; }
  int success = loader->metrics(run, metrics);
  if (!success) message(error, capacity, loader->error());
  if (success && metrics->glyph_count > glyph_capacity) {
    message(error, capacity, "Native glyph output exceeds the bounded Go buffer");
    success = 0;
  }
  if (success && !loader->glyphs(run, glyphs, metrics->glyph_count)) {
    message(error, capacity, loader->error());
    success = 0;
  }
  loader->free_run(run);
  return success;
}

int atf_loader_paint(atf_loader* loader, atf_engine* engine, const atf_glyph* glyphs, size_t count,
                      float font_css, float line_height_css, const atf_policy* policy,
                      uint8_t* rgba, size_t length, uint32_t width, uint32_t height, uint32_t scale,
                      float x, float y, uint32_t rgb, int32_t destination_x, int32_t destination_y,
                      char* error, size_t capacity) {
  int success = loader->paint(engine, glyphs, count, font_css, line_height_css, policy,
    rgba, length, width, height, scale, x, y, rgb, destination_x, destination_y);
  if (!success) message(error, capacity, loader->error());
  return success;
}
