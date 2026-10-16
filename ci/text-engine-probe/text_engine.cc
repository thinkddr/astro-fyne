// SPDX-License-Identifier: Apache-2.0 AND BSD-3-Clause
// Copyright 2026 Astro Fyne contributors.
// Font-table action selection follows Blink, Copyright 2016 The Chromium Authors.
// Preserve the pinned Chromium LICENSE included in the remote source notices.
// Experimental native renderer; see README.md for its declared policy and scope.
#include "text_engine.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkColorSpace.h"
#include "include/core/SkData.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontArguments.h"
#include "include/core/SkFontMetrics.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkStrikeRef.h"
#include "include/core/SkSurface.h"
#include "include/core/SkSurfaceProps.h"
#include "include/ports/SkTypeface_fontations.h"
#include "opentype-sanitiser.h"
#include "ots-memory-stream.h"
#include <hb.h>
#include <hb-ot.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

static_assert(SK_R32_SHIFT == 16 && SK_G32_SHIFT == 8 && SK_B32_SHIFT == 0 && SK_A32_SHIFT == 24,
              "The declared Linux Skia public color-order definitions must match");
static_assert(kN32_SkColorType == kBGRA_8888_SkColorType,
              "The declared Linux native N32 surface must be BGRA8888");
#ifndef SK_CPU_LENDIAN
#error "The declared native text probe requires little-endian pixels"
#endif

namespace {
thread_local std::string error;
thread_local atf_surface_metadata last_surface{};
thread_local bool has_surface = false;
void require(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
struct ProbeOTS final : ots::OTSContext {
  ots::TableAction GetTableAction(uint32_t tag) override {
    // Same actions as Blink 153 WebFontDecoder for these tags. Remaining tags
    // use OTS defaults. This does not reproduce Blink's separate error strings.
    switch (tag) {
      case OTS_TAG('C','B','D','T'): case OTS_TAG('C','B','L','C'):
      case OTS_TAG('C','O','L','R'): case OTS_TAG('C','P','A','L'):
      case OTS_TAG('C','F','F','2'): case OTS_TAG('s','b','i','x'):
      case OTS_TAG('S','T','A','T'): case OTS_TAG('B','A','S','E'):
      case OTS_TAG('G','D','E','F'): case OTS_TAG('G','P','O','S'):
      case OTS_TAG('G','S','U','B'): case OTS_TAG('a','v','a','r'):
      case OTS_TAG('c','v','a','r'): case OTS_TAG('f','v','a','r'):
      case OTS_TAG('g','v','a','r'): case OTS_TAG('H','V','A','R'):
      case OTS_TAG('M','V','A','R'): case OTS_TAG('V','V','A','R'):
        return ots::TABLE_ACTION_PASSTHRU;
      default: return ots::TABLE_ACTION_DEFAULT;
    }
  }
};
bool bounded_text(const uint8_t* text, size_t length) {
  // Deliberately diagnostic rather than silently forcing arbitrary scripts to Latn.
  for (size_t i = 0; i < length; ++i) {
    if (text[i] >= 0x20 && text[i] <= 0x7e) continue;
    if (text[i] == 0xcc && i + 1 < length &&
        (text[i + 1] == 0x81 || text[i + 1] == 0x88)) { ++i; continue; }
    return false;
  }
  return true;
}
hb_position_t fixed(float value) {
  const double scaled = static_cast<double>(value) * 65536.0;
  require(std::isfinite(scaled) && scaled >= INT32_MIN && scaled <= INT32_MAX,
          "Skia metric exceeds 16.16 range");
  return static_cast<hb_position_t>(scaled);
}
int32_t round_position(int32_t value) {
  if ((value & 0xffff) == 0) return value;
  // Blink converts to float before division; double-first differs near larger ties.
  return fixed(std::round(static_cast<float>(value) / 65536.0f));
}
void validate(const atf_policy& policy) {
  require(policy.hinting <= 3 && policy.edging <= 2 && policy.pixel_geometry <= 2,
          "Unsupported font or surface enum");
  require(policy.auto_hint <= 1 && policy.embedded_bitmaps <= 1 &&
          policy.subpixel <= 1 && policy.linear_metrics <= 1 && policy.baseline_snap <= 1,
          "Invalid policy boolean");
  require(std::isfinite(policy.contrast) && policy.contrast >= 0 && policy.contrast <= 1 &&
          std::isfinite(policy.gamma) && policy.gamma >= 0 && policy.gamma < 4,
          "Invalid mask gamma/contrast");
}
}

struct atf_engine {
  sk_sp<SkData> effective;
  sk_sp<SkTypeface> face;
};
struct atf_run {
  SkFont font;
  SkStrikeRef strike;
  atf_policy policy;
  atf_metrics metrics{};
  std::vector<atf_glyph> glyphs;
  std::vector<SkGlyphID> ids;
  std::vector<SkPoint> positions;
  bool invalid_metric = false;
  explicit atf_run(SkFont font_, atf_policy policy_)
    : font(std::move(font_)), strike(font.makeStrikeRef()), policy(policy_) {}
};

namespace {
hb_position_t advance(hb_font_t*, void* data, hb_codepoint_t glyph, void*) {
  auto& run = *static_cast<atf_run*>(data);
  try {
    require(glyph <= 0xffff, "Glyph exceeds Skia glyph range");
    float width = run.strike.getWidth(static_cast<SkGlyphID>(glyph));
    if (!run.font.isSubpixel()) width = std::round(width);
    return fixed(width);
  } catch (...) { run.invalid_metric = true; return 0; }
}
hb_bool_t extents(hb_font_t*, void* data, hb_codepoint_t glyph,
                  hb_glyph_extents_t* target, void*) {
  auto& run = *static_cast<atf_run*>(data);
  try {
    require(glyph <= 0xffff, "Glyph exceeds Skia glyph range");
    auto box = run.font.getBounds(static_cast<SkGlyphID>(glyph), nullptr);
    if (!run.font.isSubpixel()) box.set(box.roundOut());
    target->x_bearing = fixed(box.left()); target->y_bearing = fixed(-box.top());
    target->width = fixed(box.width()); target->height = fixed(-box.height());
    return true;
  } catch (...) { run.invalid_metric = true; return false; }
}
}

extern "C" {
const char* atf_error() { return error.c_str(); }
size_t atf_abi_size(uint32_t type) {
  return type == 1 ? sizeof(atf_policy) : type == 2 ? sizeof(atf_glyph) :
    type == 3 ? sizeof(atf_metrics) : type == 4 ? sizeof(atf_surface_metadata) : 0;
}
int atf_last_surface_metadata(atf_surface_metadata* metadata, size_t size) {
  if (!metadata || size != sizeof(*metadata)) { error = "Invalid surface metadata output/size"; return 0; }
  if (!has_surface) { error = "No successful native surface metadata"; return 0; }
  *metadata = last_surface;
  return 1;
}
void atf_surface_defaults(float* contrast, float* gamma) {
  SkSurfaceProps defaults;
  if (contrast) *contrast = defaults.textContrast();
  if (gamma) *gamma = defaults.textGamma();
}
atf_engine* atf_open(const uint8_t* original, size_t length) {
  try {
    require(original && length > 0 && length <= 128u * 1024u * 1024u, "Invalid original font");
    ots::ExpandingMemoryStream output(length, 128u * 1024u * 1024u);
    ProbeOTS sanitizer;
    require(sanitizer.Process(&output, original, length), "OTS rejected source font");
    require(output.Tell() > 0, "OTS emitted an empty font");
    auto engine = std::make_unique<atf_engine>();
    engine->effective = SkData::MakeWithCopy(output.get(), static_cast<size_t>(output.Tell()));
    engine->face = SkTypeface_Make_Fontations(engine->effective, SkFontArguments());
    require(engine->face != nullptr, "Fontations rejected OTS output");
    return engine.release();
  } catch (const std::exception& failure) { error = failure.what(); return nullptr; }
}
void atf_close(atf_engine* engine) { delete engine; }
const uint8_t* atf_effective_font(const atf_engine* engine, size_t* length) {
  if (!engine || !length) { error = "Missing effective font arguments"; return nullptr; }
  *length = engine->effective->size();
  return static_cast<const uint8_t*>(engine->effective->data());
}
atf_run* atf_shape(atf_engine* engine, const uint8_t* utf8, size_t length,
                  float font_css, float line_height_css, const atf_policy* policy) {
  try {
    require(engine && utf8 && policy && length > 0 && length <= 4096,
            "Invalid shape arguments");
    require(bounded_text(utf8, length), "This probe supports ASCII plus acute/diaeresis marks only");
    require(std::isfinite(font_css) && font_css > 0 && font_css <= 256 &&
            std::isfinite(line_height_css) && line_height_css > 0 && line_height_css <= 1024,
            "Invalid CSS font size/line height");
    validate(*policy);
    SkFont font(engine->face, font_css);
    font.setHinting(static_cast<SkFontHinting>(policy->hinting));
    font.setForceAutoHinting(policy->auto_hint); font.setEmbeddedBitmaps(policy->embedded_bitmaps);
    font.setSubpixel(policy->subpixel); font.setLinearMetrics(policy->linear_metrics);
    font.setBaselineSnap(policy->baseline_snap);
    font.setEdging(static_cast<SkFont::Edging>(policy->edging));
    auto run = std::make_unique<atf_run>(font, *policy);
    using Blob = std::unique_ptr<hb_blob_t, decltype(&hb_blob_destroy)>;
    using Face = std::unique_ptr<hb_face_t, decltype(&hb_face_destroy)>;
    using Font = std::unique_ptr<hb_font_t, decltype(&hb_font_destroy)>;
    using Funcs = std::unique_ptr<hb_font_funcs_t, decltype(&hb_font_funcs_destroy)>;
    using Buffer = std::unique_ptr<hb_buffer_t, decltype(&hb_buffer_destroy)>;
    Blob blob(hb_blob_create(static_cast<const char*>(engine->effective->data()),
      static_cast<unsigned>(engine->effective->size()), HB_MEMORY_MODE_DUPLICATE, nullptr, nullptr), hb_blob_destroy);
    Face face(hb_face_create(blob.get(), 0), hb_face_destroy);
    Font parent(hb_font_create(face.get()), hb_font_destroy);
    hb_ot_font_set_funcs(parent.get());
    Font shaped(hb_font_create_sub_font(parent.get()), hb_font_destroy);
    Funcs funcs(hb_font_funcs_create(), hb_font_funcs_destroy);
    hb_font_funcs_set_glyph_h_advance_func(funcs.get(), advance, nullptr, nullptr);
    hb_font_funcs_set_glyph_extents_func(funcs.get(), extents, nullptr, nullptr);
    hb_font_set_funcs(shaped.get(), funcs.get(), run.get(), nullptr);
    hb_font_set_scale(shaped.get(), fixed(font_css), fixed(font_css));
    hb_font_set_ptem(shaped.get(), font_css);
    Buffer buffer(hb_buffer_create(), hb_buffer_destroy);
    hb_buffer_add_utf8(buffer.get(), reinterpret_cast<const char*>(utf8), static_cast<int>(length), 0, static_cast<int>(length));
    hb_buffer_set_direction(buffer.get(), HB_DIRECTION_LTR);
    hb_buffer_set_script(buffer.get(), HB_SCRIPT_LATIN);
    hb_buffer_set_language(buffer.get(), hb_language_from_string("en", -1));
    const char* shapers[] = {"ot", nullptr};
    require(hb_shape_full(shaped.get(), buffer.get(), nullptr, 0, shapers), "HarfBuzz OT shaping failed");
    require(!run->invalid_metric && hb_buffer_allocation_successful(buffer.get()), "Invalid shaping metric/allocation");
    unsigned count = 0;
    auto* info = hb_buffer_get_glyph_infos(buffer.get(), &count);
    auto* pos = hb_buffer_get_glyph_positions(buffer.get(), nullptr);
    require(count > 0 && count <= 4096, "Invalid shaped glyph count");
    float pen_x = 0, pen_y = 0;
    for (unsigned i = 0; i < count; ++i) {
      require(info[i].codepoint > 0 && info[i].codepoint <= 0xffff, "Missing or unsupported glyph");
      auto p = pos[i];
      if (!font.isSubpixel()) {
        p.x_advance = round_position(p.x_advance); p.y_advance = round_position(p.y_advance);
        p.x_offset = round_position(p.x_offset); p.y_offset = round_position(p.y_offset);
      }
      const float x = pen_x + p.x_offset / 65536.0f;
      const float y = -(pen_y + p.y_offset / 65536.0f);
      const auto id = static_cast<SkGlyphID>(info[i].codepoint);
      run->ids.push_back(id); run->positions.push_back(SkPoint::Make(x, y));
      run->glyphs.push_back({id, info[i].cluster, p.x_advance, p.y_advance,
        p.x_offset, p.y_offset, run->strike.getWidth(id), x, y});
      pen_x += p.x_advance / 65536.0f; pen_y += p.y_advance / 65536.0f;
    }
    SkFontMetrics metrics;
    font.getMetrics(&metrics);
    require(std::isfinite(pen_x) && std::isfinite(metrics.fAscent) &&
            std::isfinite(metrics.fDescent) && std::isfinite(metrics.fLeading),
            "Non-finite native font/run metric");
    const float ascent = std::round(-metrics.fAscent), descent = std::round(metrics.fDescent);
    // Preserve native/backend.go PlaceText's existing formula; never fit to DOM markers.
    const float baseline = std::floor((line_height_css - ascent - descent) / 2) + ascent;
    run->metrics = {pen_x, -metrics.fAscent, metrics.fDescent, metrics.fLeading, baseline, count};
    return run.release();
  } catch (const std::exception& failure) { error = failure.what(); return nullptr; }
}
void atf_free_run(atf_run* run) { delete run; }
int atf_run_metrics(const atf_run* run, atf_metrics* metrics) {
  if (!run || !metrics) { error = "Missing run metrics arguments"; return 0; }
  *metrics = run->metrics; return 1;
}
int atf_copy_glyphs(const atf_run* run, atf_glyph* glyphs, size_t count) {
  if (!run || !glyphs || count != run->glyphs.size()) { error = "Glyph output size mismatch"; return 0; }
  std::copy(run->glyphs.begin(), run->glyphs.end(), glyphs); return 1;
}
int atf_paint(const atf_run* run, uint8_t* rgba, size_t length,
              uint32_t width, uint32_t height, uint32_t scale,
              float line_x_css, float line_y_css, uint32_t foreground_rgb) {
  try {
    require(run && rgba && width > 0 && height > 0 && width <= 4096 && height <= 4096 &&
            length == static_cast<size_t>(width) * height * 4 && (scale == 1 || scale == 2) &&
            std::isfinite(line_x_css) && std::isfinite(line_y_css) && foreground_rgb <= 0xffffff,
            "Invalid opaque paint destination/origin");
    for (size_t i = 3; i < length; i += 4) require(rgba[i] == 255, "LCD probe requires a truly opaque destination");
    const auto geometry = run->policy.pixel_geometry == 1 ? kRGB_H_SkPixelGeometry :
      run->policy.pixel_geometry == 2 ? kBGR_H_SkPixelGeometry : kUnknown_SkPixelGeometry;
    const SkSurfaceProps props(0, geometry, run->policy.contrast, run->policy.gamma);
    const auto info = SkImageInfo::Make(static_cast<int>(width), static_cast<int>(height),
      kRGBA_8888_SkColorType, kOpaque_SkAlphaType, SkColorSpace::MakeSRGB());
    const auto native_info = info.makeColorType(kN32_SkColorType);
    const size_t row_bytes = static_cast<size_t>(width) * 4;
    auto surface = SkSurfaces::Raster(native_info, row_bytes, &props);
    require(surface != nullptr, "Could not allocate native N32 destination");
    auto* canvas = surface->getCanvas();
    require(canvas->writePixels(info, rgba, row_bytes, 0, 0), "Could not convert RGBA input to N32");
    canvas->scale(static_cast<float>(scale), static_cast<float>(scale));
    SkPaint paint; paint.setColor(0xff000000u | foreground_rgb);
    canvas->drawGlyphs({run->ids.data(), run->ids.size()},
      {run->positions.data(), run->positions.size()},
      SkPoint::Make(line_x_css, line_y_css + run->metrics.baseline_css), run->font, paint);
    std::vector<uint8_t> output(length);
    require(surface->readPixels(info, output.data(), row_bytes, 0, 0),
            "Could not convert native N32 output to RGBA");
    for (size_t i = 3; i < length; i += 4) require(output[i] == 255, "Native output lost opaque alpha");
    const auto actual = surface->imageInfo();
    const auto& actual_props = surface->props();
    SkPixmap actual_pixels;
    require(surface->peekPixels(&actual_pixels) && actual_pixels.rowBytes() == row_bytes &&
            actual.colorType() == kN32_SkColorType && actual.alphaType() == kOpaque_SkAlphaType &&
            actual.colorSpace() && actual.colorSpace()->isSRGB() &&
            actual.width() == static_cast<int>(width) && actual.height() == static_cast<int>(height),
            "Native surface differs from the declared N32 contract");
    const auto* first = static_cast<const uint8_t*>(actual_pixels.addr());
    const atf_surface_metadata observed{
      SK_R32_SHIFT, SK_G32_SHIFT, SK_B32_SHIFT, SK_A32_SHIFT, 1,
      static_cast<uint32_t>(kN32_SkColorType), static_cast<uint32_t>(kRGBA_8888_SkColorType),
      static_cast<uint32_t>(kBGRA_8888_SkColorType),
      static_cast<uint32_t>(info.colorType()), static_cast<uint32_t>(actual.colorType()),
      static_cast<uint32_t>(info.alphaType()), static_cast<uint32_t>(actual.alphaType()),
      static_cast<uint32_t>(info.colorSpace() && info.colorSpace()->isSRGB()),
      static_cast<uint32_t>(actual.colorSpace() && actual.colorSpace()->isSRGB()),
      static_cast<uint32_t>(actual.width()), static_cast<uint32_t>(actual.height()),
      static_cast<uint32_t>(row_bytes), static_cast<uint32_t>(actual_pixels.rowBytes()),
      static_cast<uint32_t>(actual_props.pixelGeometry()), first[0], first[1], first[2], first[3],
      actual_props.textContrast(), actual_props.textGamma()
    };
    std::memcpy(rgba, output.data(), length);
    last_surface = observed;
    has_surface = true;
    return 1;
  } catch (const std::exception& failure) { error = failure.what(); return 0; }
}
}
