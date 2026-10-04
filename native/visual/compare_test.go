// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Sytue. Licensed under Apache-2.0.

package visual

import (
	"image"
	"image/color"
	"testing"
)

func TestOneChangedPixelRejectsParity(t *testing.T) {
	web := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	native := image.NewNRGBA(web.Bounds())
	initial, _, err := Compare(web, native, Tolerance{})
	if err != nil || !initial.Accepted || !initial.Exact {
		t.Fatalf("identical captures should pass: %+v, %v", initial, err)
	}
	// A single changed channel must fail without implicit thresholds.
	native.SetNRGBA(2, 1, color.NRGBA{R: 1})
	r, diff, err := Compare(web, native, Tolerance{})
	if err != nil {
		t.Fatal(err)
	}
	if r.Accepted || r.Exact || r.ChangedPixels != 1 || r.PixelsOverTolerance != 1 || r.MaxChannelDelta != 1 {
		t.Fatalf("one changed channel should fail: %+v", r)
	}
	if r.Bounds == nil || *r.Bounds != (Bounds{MinX: 2, MinY: 1, MaxX: 3, MaxY: 2}) {
		t.Fatalf("incorrect change bounds: %+v", r.Bounds)
	}
	if diff.NRGBAAt(2, 1) != (color.NRGBA{R: 255, B: 255, A: 255}) || diff.NRGBAAt(0, 0).A != 0 {
		t.Fatal("the diff should mark the change and leave other pixels transparent")
	}
}

func TestExplicitToleranceDoesNotClaimEquality(t *testing.T) {
	web := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	native := image.NewNRGBA(web.Bounds())
	native.SetNRGBA(0, 0, color.NRGBA{A: 2})
	native.SetNRGBA(1, 0, color.NRGBA{A: 5})
	for _, tc := range []struct {
		name      string
		tolerance Tolerance
		accepted  bool
		over      uint64
	}{
		{"exact", Tolerance{}, false, 2},
		{"channel", Tolerance{Channel: 2}, false, 1},
		{"one pixel", Tolerance{Channel: 2, Pixels: 1}, true, 1},
		{"all channels", Tolerance{Channel: 5}, true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, _, err := Compare(web, native, tc.tolerance)
			if err != nil || r.Exact || r.Accepted != tc.accepted || r.ChangedPixels != 2 || r.PixelsOverTolerance != tc.over {
				t.Fatalf("incorrect result: %+v, %v", r, err)
			}
		})
	}
}

func TestDifferentDimensionsAreNotNormalized(t *testing.T) {
	_, _, err := Compare(image.NewNRGBA(image.Rect(0, 0, 2, 2)), image.NewNRGBA(image.Rect(0, 0, 1, 2)), Tolerance{Channel: 255, Pixels: 10})
	if err == nil {
		t.Fatal("explicit tolerance must not resize captures")
	}
}

func TestImageOriginsAndAlphaChannel(t *testing.T) {
	web := image.NewNRGBA(image.Rect(5, 7, 7, 8))
	native := image.NewNRGBA(image.Rect(-2, -3, 0, -2))
	web.SetNRGBA(6, 7, color.NRGBA{A: 255})
	native.SetNRGBA(-1, -3, color.NRGBA{A: 254})
	r, _, err := Compare(web, native, Tolerance{})
	if err != nil || r.Accepted || r.ChangedPixels != 1 || r.MaxChannelDelta != 1 || r.Bounds == nil || r.Bounds.MinX != 1 {
		t.Fatalf("comparison must retain alpha and image origins: %+v, %v", r, err)
	}
}

func Test16BitChannelsAreNotSilentlyReduced(t *testing.T) {
	web := image.NewNRGBA64(image.Rect(0, 0, 1, 1))
	native := image.NewNRGBA64(web.Bounds())
	web.SetNRGBA64(0, 0, color.NRGBA64{R: 0x0101, A: 0xffff})
	native.SetNRGBA64(0, 0, color.NRGBA64{R: 0x0102, A: 0xffff})
	// Both reds reduce to 1 in 8 bits: reject the format before losing the difference.
	r, diff, err := Compare(web, native, Tolerance{})
	if err == nil || r.Exact || r.Accepted || diff != nil {
		t.Fatalf("reduced capture must not be certified: %+v, %v", r, err)
	}
	for _, capture := range []image.Image{
		image.NewRGBA64(web.Bounds()), image.NewGray16(web.Bounds()), image.NewAlpha16(web.Bounds()),
		image.NewUniform(color.NRGBA64{R: 1, A: 0xffff}),
	} {
		if _, _, err := Compare(capture, capture, Tolerance{}); err == nil {
			t.Fatalf("16-bit model was accepted: %T", capture)
		}
	}
}
