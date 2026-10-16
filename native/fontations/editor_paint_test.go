//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontations

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"reflect"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/test"
)

func TestEditorPaintRoundsGlobalLineTopBeforeBaselineAndDeviceScale(t *testing.T) {
	test.NewTempApp(t)
	b := openTestBackend(t)
	style := backendTestStyle()
	style.LineHeight = 19
	text := b.Text("Hgx", style)
	original := text.Layout.(*Line)
	snapshot := original.Snapshot()
	b.PlaceEditorText(text, style, 1.25, 6.5)
	editor, ok := text.Layout.(*Line)
	if !ok || editor == original || original.editorLineTopSnap || !editor.editorLineTopSnap ||
		!reflect.DeepEqual(snapshot, original.Snapshot()) || !reflect.DeepEqual(snapshot, editor.Snapshot()) ||
		text.Position() != fyne.NewPos(1.25, 6.5) || text.Size() != fyne.NewSize(snapshot.Metrics.Advance, 19) {
		t.Fatal("editor mode mutated the original shape, snapshot or logical geometry")
	}
	for _, scale := range []float32{1, 2} {
		for _, item := range []struct {
			name    string
			top     float32
			rounded float32
		}{
			{"below positive half", 31.0 / 64, 0},
			{"positive half", 32.0 / 64, 1},
			{"above positive half", 33.0 / 64, 1},
			{"above negative half", -31.0 / 64, 0},
			{"negative half", -32.0 / 64, 0},
			{"below negative half", -33.0 / 64, -1},
			{"negative one half", -1.5, -1},
		} {
			t.Run(fmt.Sprintf("%s/scale-%g", item.name, scale), func(t *testing.T) {
				base := transportImage(image.Rect(-4, -4, 148, 76))
				destination := base.SubImage(image.Rect(-2, -2, 140, 70)).(*image.NRGBA)
				expected := transportImage(base.Bounds())
				before := bytes.Clone(base.Pix)
				clip := image.Rect(5, -1, 130, 65)
				context := canvas.TextPaintContext{Origin: fyne.NewPos(8.25, item.top), Scale: scale, Clip: clip, Color: color.NRGBA{R: 17, G: 35, B: 43, A: 255}}
				if err := editor.PaintSoftware(destination, context); err != nil {
					t.Fatal(err)
				}
				context.Origin.Y = item.rounded
				if err := original.PaintSoftware(expected, context); err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(base.Pix, expected.Pix) {
					t.Fatal("editor paint differs from the source-derived global CSS top before baseline and scale")
				}
				changed := 0
				for y := base.Rect.Min.Y; y < base.Rect.Max.Y; y++ {
					for x := base.Rect.Min.X; x < base.Rect.Max.X; x++ {
						offset := base.PixOffset(x, y)
						if !bytes.Equal(before[offset:offset+4], base.Pix[offset:offset+4]) {
							changed++
							if !image.Pt(x, y).In(clip) {
								t.Fatalf("editor paint changed pixels outside the actual physical clip at %d,%d", x, y)
							}
						}
					}
				}
				if changed == 0 {
					t.Fatal("test did not exercise actual native glyph painting")
				}
				if scale == 2 && item.top == 0.5 {
					unsnapped := transportImage(base.Bounds())
					context.Origin.Y = item.top
					if err := original.PaintSoftware(unsnapped, context); err != nil {
						t.Fatal(err)
					}
					if bytes.Equal(base.Pix, unsnapped.Pix) {
						t.Fatal("half-CSS-pixel control did not distinguish pre-scale line-top rounding")
					}
				}
			})
		}
	}
	if text.Position() != fyne.NewPos(1.25, 6.5) || !reflect.DeepEqual(snapshot, editor.Snapshot()) {
		t.Fatal("painting changed logical placement or immutable glyph evidence")
	}
}

func TestEditorTextReuseResetsPaintModeAndRetainsVisibleErrors(t *testing.T) {
	test.NewTempApp(t)
	b := openTestBackend(t)
	style := backendTestStyle()
	text := b.Text("Hgx", style)
	original := text.Layout.(*Line)
	b.PlaceEditorText(text, style, 3.25, 6.5)
	editor := text.Layout.(*Line)
	b.PlaceText(text, style, 3.25, 6.5)
	ordinary := text.Layout.(*Line)
	if ordinary == editor || ordinary.editorLineTopSnap || !editor.editorLineTopSnap || original.editorLineTopSnap ||
		!reflect.DeepEqual(original.Snapshot(), ordinary.Snapshot()) {
		t.Fatal("ordinary text reuse leaked editor paint mode or mutated shared lines")
	}
	destination := transportImage(image.Rect(0, 0, 96, 48))
	expected := transportImage(destination.Bounds())
	context := canvas.TextPaintContext{Origin: fyne.NewPos(3.25, 6.5), Scale: 2, Clip: destination.Bounds(), Color: color.Black}
	if err := ordinary.PaintSoftware(destination, context); err != nil {
		t.Fatal(err)
	}
	if err := original.PaintSoftware(expected, context); err != nil || !bytes.Equal(destination.Pix, expected.Pix) {
		t.Fatal("ordinary reuse changed original native placement")
	}
	b.PlaceEditorText(text, style, 3.25, 6.5)
	if text.Layout.(*Line) == ordinary || !text.Layout.(*Line).editorLineTopSnap || ordinary.editorLineTopSnap {
		t.Fatal("returning to editor painting mutated ordinary layout")
	}
	text.Color = color.NRGBA{R: 17, G: 35, B: 43, A: 128}
	b.PlaceEditorText(text, style, 3.25, 6.5)
	if _, _, err := text.LayoutMetrics(); err == nil || text.Layout == nil || b.Error() == nil {
		t.Fatal("editor placement hid unsupported nonempty ink with fallback")
	}
	text.Color = color.Black
	b.ClearError()
	b.PlaceEditorText(text, style, 3.25, 6.5)
	line := text.Layout.(*Line)
	before := bytes.Clone(destination.Pix)
	context.Scale = 3
	if err := line.PaintSoftware(destination, context); err == nil || !bytes.Equal(before, destination.Pix) {
		t.Fatal("editor paint hid unsupported scale or committed pixels")
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	b.PlaceEditorText(text, style, 3.25, 6.5)
	if _, _, err := text.LayoutMetrics(); !errors.Is(err, ErrClosed) || text.Layout == nil {
		t.Fatal("closed editor placement lost its visible failed layout")
	}
	if err := line.PaintSoftware(destination, context); !errors.Is(err, ErrClosed) || !bytes.Equal(before, destination.Pix) {
		t.Fatal("closed editor paint changed pixels or its error")
	}
}

func TestEmptyEditorPaintRemainsCheckedNoop(t *testing.T) {
	test.NewTempApp(t)
	b := openTestBackend(t)
	style := backendTestStyle()
	text := b.Text("", style)
	b.PlaceEditorText(text, style, 1.25, -0.5)
	line := text.Layout.(*Line)
	destination := image.NewNRGBA(image.Rect(0, 0, 8, 4))
	before := bytes.Clone(destination.Pix)
	context := canvas.TextPaintContext{Origin: fyne.NewPos(1.25, -0.5), Scale: 2, Clip: destination.Bounds()}
	if err := line.PaintSoftware(destination, context); err != nil || !bytes.Equal(before, destination.Pix) || len(line.Snapshot().Glyphs) != 0 {
		t.Fatalf("empty editor line painted or required unused ink/backdrop: %v", err)
	}
	context.Scale = 3
	if err := line.PaintSoftware(destination, context); err == nil || !bytes.Equal(before, destination.Pix) {
		t.Fatal("empty editor line bypassed geometry checks")
	}
}
