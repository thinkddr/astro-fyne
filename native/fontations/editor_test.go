//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontations

import (
	"errors"
	"math"
	"reflect"
	"testing"

	webui "github.com/thinkddr/astro-fyne/native"
)

func TestEditorNormalLineHeightUsesActualFontMetricsAndAuthoredHeight(t *testing.T) {
	b := openTestBackend(t)
	for _, item := range []struct {
		name                         string
		height, lineHeight, fontSize float32
		set, percent, normal         bool
	}{
		{"taller fixed box", 32, 20, 14, true, false, true},
		{"equal fixed box", 20, 20, 14, true, false, false},
		{"large authored line", 28, 28, 14, true, false, false},
		{"taller alternate box", 40, 28, 14, true, false, true},
		{"font size threshold", 0, 14, 14, false, false, true},
		{"fractional integer conversion", 20.5, 20.5, 14, true, false, true},
		{"auto box", 0, 20, 14, false, false, false},
		{"percentage box", 0, 20, 14, true, true, true},
		{"fractional font", 36, 22, 14.5, true, false, true},
	} {
		t.Run(item.name, func(t *testing.T) {
			style := backendTestStyle()
			style.Height, style.LineHeight, style.FontSize = item.height, item.lineHeight, item.fontSize
			style.Flex = &webui.FlexStyle{BoxSizing: "border-box", HeightSet: item.set}
			if item.percent {
				style.Flex.HeightPercent = webui.FlexValue(100)
			}
			before := style
			line, err := b.Shape("", style)
			if err != nil {
				t.Fatal(err)
			}
			metrics := line.Snapshot().Metrics
			expected := item.lineHeight
			if item.normal {
				expected = float32(math.Round(float64(metrics.Ascent)) + math.Round(float64(metrics.Descent)) + math.Round(float64(metrics.Leading)))
			}
			used, err := b.EditorLineStyle(style)
			if err != nil || used.LineHeight != expected || !reflect.DeepEqual(style, before) {
				t.Fatalf("used line box or authored style differs: got %v want %v error %v", used.LineHeight, expected, err)
			}
			used.LineHeight = style.LineHeight
			if !reflect.DeepEqual(used, style) {
				t.Fatal("normal editor metrics changed non-line-height source fields")
			}
		})
	}
}

func TestEditorLineStyleCannotHideFontOpacityOrClosedErrors(t *testing.T) {
	b := openTestBackend(t)
	style := backendTestStyle()
	style.Height, style.Flex = 32, &webui.FlexStyle{BoxSizing: "border-box", HeightSet: true}
	invalid := style
	invalid.Opacity = 0.5
	if _, err := b.EditorLineStyle(invalid); err == nil || b.Error() == nil {
		t.Fatal("normal metrics relaxed opaque text validation")
	}
	b.ClearError()
	invalid = style
	invalid.FontFamily = "Missing"
	if _, err := b.EditorLineStyle(invalid); err == nil || b.Error() == nil {
		t.Fatal("normal metrics used a fallback font")
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := b.EditorLineStyle(style); !errors.Is(err, ErrClosed) || !errors.Is(b.Error(), ErrClosed) {
		t.Fatal("normal metrics hid the closed backend error")
	}
}
