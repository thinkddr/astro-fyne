//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontations

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"math"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
)

func transportImage(bounds image.Rectangle) *image.NRGBA {
	result := image.NewNRGBA(bounds)
	red := byte(17)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			result.SetNRGBA(x, y, color.NRGBA{R: red, G: 79, B: 87, A: 255})
			red++
		}
	}
	return result
}

func TestRegionTransportPreservesPhysicalOffsetLogicalOriginAndStride(t *testing.T) {
	for _, scale := range []float32{1, 2} {
		base := transportImage(image.Rect(10, 20, 30, 31))
		destination := base.SubImage(image.Rect(11, 21, 25, 30)).(*image.NRGBA)
		before := bytes.Clone(base.Pix)
		clip := image.Rect(12, 22, 20, 26)
		origin := fyne.NewPos(math.Float32frombits(0x43803fff), 14.5)
		context := canvas.TextPaintContext{Origin: origin, Scale: scale, Clip: clip, Color: color.NRGBA{R: 17, G: 35, B: 43, A: 255}}
		calls := 0
		err := paintClipped(destination, context, func(region paintRegion) error {
			calls++
			if region.width != 8 || region.height != 4 || region.scale != uint32(scale) || region.x != 12 || region.y != 22 || region.rgb != 0x11232b ||
				math.Float32bits(region.origin.X) != math.Float32bits(origin.X) || math.Float32bits(region.origin.Y) != math.Float32bits(origin.Y) {
				t.Fatalf("transport changed native request: %+v", region)
			}
			if len(region.pixels) != 8*4*4 || destination.Stride == 8*4 {
				t.Fatal("test did not exercise packed rows from a larger actual stride")
			}
			for y := 0; y < 4; y++ {
				for x := 0; x < 8; x++ {
					offset := (y*8+x)*4
					want := base.NRGBAAt(12+x, 22+y)
					if !bytes.Equal(region.pixels[offset:offset+4], []byte{want.R, want.G, want.B, want.A}) {
						t.Fatal("packed region was not the true per-row backdrop")
					}
					region.pixels[offset] ^= 0x5a
				}
			}
			return nil
		})
		if err != nil || calls != 1 {
			t.Fatalf("valid transport failed: %v, calls %d", err, calls)
		}
		for y := base.Rect.Min.Y; y < base.Rect.Max.Y; y++ {
			for x := base.Rect.Min.X; x < base.Rect.Max.X; x++ {
				offset := base.PixOffset(x, y)
				want := bytes.Clone(before[offset:offset+4])
				if image.Pt(x, y).In(clip) {
					want[0] ^= 0x5a
				}
				if !bytes.Equal(base.Pix[offset:offset+4], want) {
					t.Fatalf("transport corrupted region or outside bytes at %d,%d", x, y)
				}
			}
		}
	}
}

func TestRegionNativeFailureAndInvalidOutputNeverCommit(t *testing.T) {
	for _, fail := range []bool{true, false} {
		base := transportImage(image.Rect(0, 0, 8, 4))
		before := bytes.Clone(base.Pix)
		nativeFailure := errors.New("native paint rejected the request")
		context := canvas.TextPaintContext{Origin: fyne.NewPos(1.25, 2.5), Scale: 1, Clip: base.Bounds(), Color: color.Black}
		err := paintClipped(base, context, func(region paintRegion) error {
			region.pixels[0], region.pixels[3] = 241, 0
			if fail {
				return nativeFailure
			}
			return nil
		})
		if err == nil || !bytes.Equal(base.Pix, before) || (fail && !errors.Is(err, nativeFailure)) {
			t.Fatalf("failed/invalid native output committed: fail=%v error=%v", fail, err)
		}
	}
}

func TestUnsupportedRegionRequestsFailBeforeNativePaint(t *testing.T) {
	for _, tc := range []struct {
		name string
		change func(*image.NRGBA, *canvas.TextPaintContext)
	}{
		{"scale", func(_ *image.NRGBA, c *canvas.TextPaintContext) { c.Scale = 1.5 }},
		{"origin", func(_ *image.NRGBA, c *canvas.TextPaintContext) { c.Origin.X = float32(math.NaN()) }},
		{"text alpha", func(_ *image.NRGBA, c *canvas.TextPaintContext) { c.Color = color.NRGBA{A: 128} }},
		{"text precision", func(_ *image.NRGBA, c *canvas.TextPaintContext) { c.Color = color.RGBA64{R: 1, A: 65535} }},
		{"backdrop alpha", func(d *image.NRGBA, _ *canvas.TextPaintContext) { d.Pix[3] = 254 }},
		{"stride", func(d *image.NRGBA, _ *canvas.TextPaintContext) { d.Stride = 0 }},
		{"pixel length", func(d *image.NRGBA, _ *canvas.TextPaintContext) { d.Pix = d.Pix[:7] }},
		{"offset", func(d *image.NRGBA, c *canvas.TextPaintContext) { d.Rect = image.Rect(4097, 0, 4105, 4); c.Clip = d.Rect }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			destination := transportImage(image.Rect(0, 0, 8, 4))
			context := canvas.TextPaintContext{Scale: 1, Clip: destination.Bounds(), Color: color.Black}
			tc.change(destination, &context)
			before := bytes.Clone(destination.Pix)
			calls := 0
			err := paintClipped(destination, context, func(paintRegion) error { calls++; return nil })
			if err == nil || calls != 0 || !bytes.Equal(destination.Pix, before) {
				t.Fatalf("unsupported request reached paint or changed bytes: %v, calls %d", err, calls)
			}
		})
	}
}
