// SPDX-License-Identifier: BSD-3-Clause
// Copyright 2018 Google LLC.
// Copyright 2026 Fyne contributors.
//
// The fixed-point interpolation is derived from Skia's SkBitmapProcState_opts.h
// at 9d07e5bad9e3e21da2426946e589daa647218271. Retain LICENSE-Skia.txt and
// LICENSE-Fyne.txt when distributing this experimental candidate.

package software

import (
	"image"
	"image/color"
)

// skiaLegacyEnlargement implements the bounded legacy four-tap RGBA8 arithmetic.
// It does not establish which Skia stage Chromium selects for an individual draw.
// This sampling-only candidate leaves the caller's existing source lifecycle intact.
func skiaLegacyEnlargement(source image.Image, width, height int) (*image.RGBA, bool) {
	if source == nil || width <= 0 || height <= 0 || width > 16384 || height > 16384 || width > (64*1024*1024)/height {
		return nil, false
	}
	var load func(int, int) color.RGBA
	switch pixels := source.(type) {
	case *image.NRGBA:
		if pixels == nil {
			return nil, false
		}
		load = func(x, y int) color.RGBA {
			pixel := pixels.NRGBAAt(x, y)
			return color.RGBA{
				R: skiaLegacyPremultiply8(pixel.R, pixel.A),
				G: skiaLegacyPremultiply8(pixel.G, pixel.A),
				B: skiaLegacyPremultiply8(pixel.B, pixel.A),
				A: pixel.A,
			}
		}
	case *image.RGBA:
		if pixels == nil || !pixels.Opaque() {
			return nil, false
		}
		load = pixels.RGBAAt
	default:
		return nil, false
	}
	bounds := source.Bounds()
	if bounds.Min != (image.Point{}) || bounds.Dx() <= 0 || bounds.Dy() <= 0 || width%bounds.Dx() != 0 || height%bounds.Dy() != 0 {
		return nil, false
	}
	factor := width / bounds.Dx()
	if (factor != 2 && factor != 4) || height/bounds.Dy() != factor {
		return nil, false
	}
	premultiplied := image.NewRGBA(bounds)
	for y := 0; y < bounds.Dy(); y++ {
		for x := 0; x < bounds.Dx(); x++ {
			premultiplied.SetRGBA(x, y, load(x, y))
		}
	}
	clamp := func(index, maximum int) int {
		if index < 0 {
			return 0
		}
		if index >= maximum {
			return maximum - 1
		}
		return index
	}
	result := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		sy, wy := skiaLegacyCoordinate(y, factor)
		y0, y1 := clamp(sy, bounds.Dy()), clamp(sy+1, bounds.Dy())
		for x := 0; x < width; x++ {
			sx, wx := skiaLegacyCoordinate(x, factor)
			x0, x1 := clamp(sx, bounds.Dx()), clamp(sx+1, bounds.Dx())
			tl, tr := premultiplied.RGBAAt(x0, y0), premultiplied.RGBAAt(x1, y0)
			bl, br := premultiplied.RGBAAt(x0, y1), premultiplied.RGBAAt(x1, y1)
			result.SetRGBA(x, y, color.RGBA{
				R: skiaLegacyChannel(tl.R, tr.R, bl.R, br.R, wx, wy),
				G: skiaLegacyChannel(tl.G, tr.G, bl.G, br.G, wx, wy),
				B: skiaLegacyChannel(tl.B, tr.B, bl.B, br.B, wx, wy),
				A: skiaLegacyChannel(tl.A, tr.A, bl.A, br.A, wx, wy),
			})
		}
	}
	return result, true
}

func skiaLegacyPremultiply8(channel, alpha uint8) uint8 {
	return uint8((uint32(channel)*uint32(alpha) + 127) / 255)
}

func skiaLegacyCoordinate(destination, factor int) (int, uint32) {
	// Q4 source coordinate: 16 * ((d + 0.5) / factor - 0.5).
	// Factors 2 and 4 make this integer expression exact, including edge samples.
	q := (int64(2*destination+1)*8)/int64(factor) - 8
	return int(q >> 4), uint32(q & 15)
}

func skiaLegacyChannel(tl, tr, bl, br uint8, wx, wy uint32) uint8 {
	// Skia's NEON/scalar paths accumulate all four Q4*Q4 weights before >>8.
	// Do not round a horizontal intermediate or add a final half-unit bias.
	return uint8((uint32(tl)*(16-wx)*(16-wy) +
		uint32(tr)*wx*(16-wy) +
		uint32(bl)*(16-wx)*wy +
		uint32(br)*wx*wy) >> 8)
}
