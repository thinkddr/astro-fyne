//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontations

/*
#cgo CFLAGS: -std=c11
#cgo LDFLAGS: -ldl
#include <stdlib.h>
#include "loader.h"
*/
import "C"

import (
	"bytes"
	"fmt"
	"unsafe"
)

type nativeLibrary struct{ handle *C.atf_loader }
type nativeFont struct{ handle *C.atf_engine }

func nativeError(operation string, message *[1024]C.char) error {
	text := C.GoString(&message[0])
	if text == "" {
		text = "native call failed without an error message"
	}
	return fmt.Errorf("fontations: %s: %s", operation, text)
}

func openLibrary(path string) (*nativeLibrary, error) {
	name := C.CString(path)
	defer C.free(unsafe.Pointer(name))
	var message [1024]C.char
	handle := C.atf_loader_open(name, &message[0], C.size_t(len(message)))
	if handle == nil {
		return nil, nativeError("load library", &message)
	}
	return &nativeLibrary{handle: handle}, nil
}

func (l *nativeLibrary) close() error {
	var message [1024]C.char
	ok := C.atf_loader_close(l.handle, &message[0], C.size_t(len(message)))
	l.handle = nil
	if ok == 0 {
		return nativeError("close library", &message)
	}
	return nil
}

func bytePointer(data []byte) *C.uint8_t {
	if len(data) == 0 {
		return nil
	}
	return (*C.uint8_t)(unsafe.Pointer(&data[0]))
}

func (l *nativeLibrary) openFont(data []byte) (*nativeFont, []byte, error) {
	var message [1024]C.char
	handle := C.atf_loader_font_open(l.handle, bytePointer(data), C.size_t(len(data)), &message[0], C.size_t(len(message)))
	if handle == nil {
		return nil, nil, nativeError("open font", &message)
	}
	var length C.size_t
	effective := C.atf_loader_effective(l.handle, handle, &length, &message[0], C.size_t(len(message)))
	if effective == nil || length == 0 || length > 20*1024*1024 {
		C.atf_loader_font_close(l.handle, handle)
		if effective == nil {
			return nil, nil, nativeError("read effective font", &message)
		}
		return nil, nil, fmt.Errorf("fontations: effective font requires 1..20MiB")
	}
	frozen := bytes.Clone(unsafe.Slice((*byte)(unsafe.Pointer(effective)), int(length)))
	return &nativeFont{handle: handle}, frozen, nil
}

func (l *nativeLibrary) closeFont(font *nativeFont) {
	if font.handle != nil {
		C.atf_loader_font_close(l.handle, font.handle)
		font.handle = nil
	}
}

func nativePolicy(p Policy) C.atf_policy {
	return C.atf_policy{
		hinting: C.uint32_t(p.Hinting), auto_hint: C.uint32_t(p.AutoHint), embedded_bitmaps: C.uint32_t(p.EmbeddedBitmaps),
		subpixel: C.uint32_t(p.Subpixel), linear_metrics: C.uint32_t(p.LinearMetrics), edging: C.uint32_t(p.Edging),
		baseline_snap: C.uint32_t(p.BaselineSnap), pixel_geometry: C.uint32_t(p.PixelGeometry),
		contrast: C.float(p.Contrast), gamma: C.float(p.Gamma),
	}
}

func (l *nativeLibrary) shape(font *nativeFont, text string, size, height float32, policy Policy) (Metrics, []Glyph, error) {
	buffer := make([]C.atf_glyph, 4096)
	var metrics C.atf_metrics
	var message [1024]C.char
	p := nativePolicy(policy)
	data := []byte(text)
	ok := C.atf_loader_shape(l.handle, font.handle, bytePointer(data), C.size_t(len(data)), C.float(size), C.float(height), &p,
		&metrics, &buffer[0], C.size_t(len(buffer)), &message[0], C.size_t(len(message)))
	if ok == 0 {
		return Metrics{}, nil, nativeError("shape line", &message)
	}
	count := uint32(metrics.glyph_count)
	if count > 4096 {
		return Metrics{}, nil, fmt.Errorf("fontations: invalid native glyph count %d", count)
	}
	result := Metrics{Advance: float32(metrics.advance_css), Ascent: float32(metrics.ascent_css), Descent: float32(metrics.descent_css), Leading: float32(metrics.leading_css), Baseline: float32(metrics.baseline_css)}
	glyphs := make([]Glyph, int(count))
	for i := range glyphs {
		g := buffer[i]
		glyphs[i] = Glyph{ID: uint32(g.glyph), ClusterUTF8: uint32(g.cluster_utf8),
			XAdvance: int32(g.x_advance_16_16), YAdvance: int32(g.y_advance_16_16), XOffset: int32(g.x_offset_16_16), YOffset: int32(g.y_offset_16_16),
			NominalAdvance: float32(g.nominal_advance_css), X: float32(g.x_css), Y: float32(g.y_css)}
	}
	return result, glyphs, nil
}

func (l *nativeLibrary) paint(font *nativeFont, glyphs []Glyph, size, height float32, policy Policy, pixels []byte,
	width, rows, scale uint32, x, y float32, rgb uint32, destinationX, destinationY int32) error {
	buffer := make([]C.atf_glyph, len(glyphs))
	for i, g := range glyphs {
		buffer[i] = C.atf_glyph{glyph: C.uint32_t(g.ID), cluster_utf8: C.uint32_t(g.ClusterUTF8),
			x_advance_16_16: C.int32_t(g.XAdvance), y_advance_16_16: C.int32_t(g.YAdvance), x_offset_16_16: C.int32_t(g.XOffset), y_offset_16_16: C.int32_t(g.YOffset),
			nominal_advance_css: C.float(g.NominalAdvance), x_css: C.float(g.X), y_css: C.float(g.Y)}
	}
	var first *C.atf_glyph
	if len(buffer) > 0 {
		first = &buffer[0]
	}
	p := nativePolicy(policy)
	var message [1024]C.char
	ok := C.atf_loader_paint(l.handle, font.handle, first, C.size_t(len(buffer)), C.float(size), C.float(height), &p,
		bytePointer(pixels), C.size_t(len(pixels)), C.uint32_t(width), C.uint32_t(rows), C.uint32_t(scale),
		C.float(x), C.float(y), C.uint32_t(rgb), C.int32_t(destinationX), C.int32_t(destinationY), &message[0], C.size_t(len(message)))
	if ok == 0 {
		return nativeError("paint line snapshot", &message)
	}
	return nil
}
