//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontations

import (
	"fmt"
	"image"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	webui "github.com/thinkddr/astro-fyne/native"
)

// Line is a Go-owned immutable shape result. It retains its owning backend,
// never a native run. The backend must remain open while it measures or paints.
type Line struct {
	backend *Backend
	font *fontEntry
	text string
	style webui.Style
	metrics Metrics
	glyphs []Glyph
}

var _ canvas.TextLayout = (*Line)(nil)

// Shape copies the native run's metrics and glyphs and immediately frees it.
func (b *Backend) Shape(text string, s webui.Style) (*Line, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return nil, b.rememberLocked(ErrClosed)
	}
	font, err := b.fontLocked(s, text == "")
	if err != nil {
		return nil, b.rememberLocked(err)
	}
	if err := validateText(text); err != nil {
		return nil, b.rememberLocked(err)
	}
	metrics, glyphs, err := b.library.shape(font.native, text, s.FontSize, s.LineHeight, b.policy)
	if err != nil {
		return nil, b.rememberLocked(err)
	}
	if err := validateSnapshot(text, metrics, glyphs); err != nil {
		return nil, b.rememberLocked(err)
	}
	// Keep only shaping settings. Do not retain the caller's mutable Flex pointer.
	style := webui.Style{FontFamily: s.FontFamily, FontSize: s.FontSize, LineHeight: s.LineHeight, FontWeight: s.FontWeight, FontStyle: s.FontStyle}
	return &Line{backend: b, font: font, text: text, style: style, metrics: metrics, glyphs: glyphs}, nil
}

// Snapshot returns a copy suitable for evidence or inspection. Mutating its
// glyphs cannot alter a line; copied data remains available after Close.
func (l *Line) Snapshot() Snapshot {
	return Snapshot{Text: l.text, FontSize: l.style.FontSize, LineHeight: l.style.LineHeight,
		SourceFontSHA256: l.font.sourceHash, EffectiveFontSHA256: l.font.effectiveHash,
		Policy: l.backend.policy, Metrics: l.metrics, Glyphs: append([]Glyph{}, l.glyphs...)}
}

// Metrics returns the authoritative line box and native line baseline.
func (l *Line) Metrics() (fyne.Size, float32, error) {
	l.backend.mu.Lock()
	defer l.backend.mu.Unlock()
	if l.backend.closed {
		return fyne.Size{}, 0, l.backend.rememberLocked(ErrClosed)
	}
	return fyne.NewSize(l.metrics.Advance, l.style.LineHeight), l.metrics.Baseline, nil
}

// PaintSoftware sends only copied glyph records to the region painter. It packs
// the true backdrop using the destination stride and commits rows only on success.
func (l *Line) PaintSoftware(destination *image.NRGBA, context canvas.TextPaintContext) error {
	l.backend.mu.Lock()
	defer l.backend.mu.Unlock()
	if l.backend.closed {
		return l.backend.rememberLocked(ErrClosed)
	}
	if len(l.glyphs) == 0 {
		// No glyph paint or native surface observation occurs for an empty line.
		_, err := checkedRegion(destination, context)
		return l.backend.rememberLocked(err)
	}
	err := paintClipped(destination, context, func(region paintRegion) error {
		return l.backend.library.paint(l.font.native, l.glyphs, l.style.FontSize, l.style.LineHeight, l.backend.policy,
			region.pixels, region.width, region.height, region.scale, region.origin.X, region.origin.Y,
			region.rgb, region.x, region.y)
	})
	return l.backend.rememberLocked(err)
}

func validateSnapshot(text string, metrics Metrics, glyphs []Glyph) error {
	if !finite(metrics.Advance) || metrics.Advance < 0 || !finite(metrics.Ascent) || !finite(metrics.Descent) || !finite(metrics.Leading) || !finite(metrics.Baseline) ||
		len(glyphs) > 4096 || (text == "" && len(glyphs) != 0) || (text != "" && len(glyphs) == 0) {
		return fmt.Errorf("fontations: invalid native line metrics or glyph count")
	}
	for _, glyph := range glyphs {
		if glyph.ID == 0 || glyph.ID > 65535 || uint64(glyph.ClusterUTF8) >= uint64(len(text)) || !finite(glyph.NominalAdvance) || !finite(glyph.X) || !finite(glyph.Y) {
			return fmt.Errorf("fontations: invalid native glyph/cluster/position")
		}
	}
	return nil
}
