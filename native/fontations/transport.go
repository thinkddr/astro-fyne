//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontations

import (
	"fmt"
	"image"
	"image/color"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
)

type paintRegion struct {
	pixels               []byte
	width, height, scale uint32
	x, y                 int32
	origin               fyne.Position
	rgb                  uint32
}

func paintClipped(destination *image.NRGBA, context canvas.TextPaintContext, paint func(paintRegion) error) error {
	clip, err := checkedRegion(destination, context)
	if err != nil {
		return err
	}
	rgb, err := opaqueRGB(context.Color)
	if err != nil {
		return err
	}
	if clip.Empty() {
		return nil
	}
	width, height := clip.Dx(), clip.Dy()
	rowBytes := width * 4
	rows := make([]int, height)
	packed := make([]byte, rowBytes*height)
	for row := 0; row < height; row++ {
		offset := destination.PixOffset(clip.Min.X, clip.Min.Y+row)
		if offset < 0 || offset > len(destination.Pix) || rowBytes > len(destination.Pix)-offset {
			return fmt.Errorf("fontations: destination rows are outside the pixel buffer")
		}
		rows[row] = offset
		copy(packed[row*rowBytes:(row+1)*rowBytes], destination.Pix[offset:offset+rowBytes])
	}
	for i := 3; i < len(packed); i += 4 {
		if packed[i] != 255 {
			return fmt.Errorf("fontations: region backdrop must be truly opaque RGBA8")
		}
	}
	region := paintRegion{pixels: packed, width: uint32(width), height: uint32(height), scale: uint32(context.Scale),
		x: int32(clip.Min.X), y: int32(clip.Min.Y), origin: context.Origin, rgb: rgb}
	if err := paint(region); err != nil {
		return err
	}
	for i := 3; i < len(packed); i += 4 {
		if packed[i] != 255 {
			return fmt.Errorf("fontations: native output lost opaque alpha")
		}
	}
	for row, offset := range rows {
		copy(destination.Pix[offset:offset+rowBytes], packed[row*rowBytes:(row+1)*rowBytes])
	}
	return nil
}

func opaqueRGB(ink color.Color) (uint32, error) {
	if ink == nil {
		return 0, fmt.Errorf("fontations: require an explicit opaque text color")
	}
	r, g, b, a := ink.RGBA()
	if a != 65535 || r > 65535 || g > 65535 || b > 65535 || r%257 != 0 || g%257 != 0 || b%257 != 0 {
		return 0, fmt.Errorf("fontations: nonopaque or non-RGBA8 text colors are unsupported")
	}
	return (r>>8)<<16 | (g>>8)<<8 | b>>8, nil
}

func checkedRegion(destination *image.NRGBA, context canvas.TextPaintContext) (image.Rectangle, error) {
	if destination == nil || !finite(context.Origin.X) || !finite(context.Origin.Y) || (context.Scale != 1 && context.Scale != 2) {
		return image.Rectangle{}, fmt.Errorf("fontations: require a destination, finite logical origin and scale 1 or 2")
	}
	clip := context.Clip.Intersect(destination.Bounds())
	if clip.Empty() {
		return clip, nil
	}
	width, height := clip.Dx(), clip.Dy()
	if width <= 0 || height <= 0 || width > 4096 || height > 4096 || clip.Min.X < -4096 || clip.Min.X > 4096 || clip.Min.Y < -4096 || clip.Min.Y > 4096 {
		return image.Rectangle{}, fmt.Errorf("fontations: clipped regions require axes 1..4096 and offsets -4096..4096")
	}
	bufferWidth, bufferHeight := destination.Rect.Dx(), destination.Rect.Dy()
	if bufferWidth <= 0 || bufferHeight <= 0 || bufferWidth > len(destination.Pix)/4 || destination.Stride < bufferWidth*4 ||
		bufferHeight-1 > (len(destination.Pix)-bufferWidth*4)/destination.Stride {
		return image.Rectangle{}, fmt.Errorf("fontations: invalid NRGBA bounds, stride or pixel length")
	}
	return clip, nil
}
