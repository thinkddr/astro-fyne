// SPDX-License-Identifier: BSD-3-Clause
// Copyright 2026 Fyne contributors.
// Distributed under the BSD 3-Clause license in LICENSE-Fyne.txt.

package software_test

import (
	"image"
	"image/color"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/internal/painter/software"
	"fyne.io/fyne/v2/test"
	"golang.org/x/image/draw"
)

func TestSkiaLegacyScopeImageAndRasterRouting(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	source.SetNRGBA(0, 0, color.NRGBA{R: 64, G: 64, B: 64, A: 255})
	source.SetNRGBA(1, 0, color.NRGBA{R: 192, G: 192, B: 192, A: 255})
	img := canvas.NewImageFromImage(source)
	img.FillMode, img.ScaleMode = canvas.ImageFillStretch, canvas.ImageScaleSmooth
	imageCanvas := test.NewCanvas()
	imageCanvas.SetPadded(false)
	imageCanvas.SetContent(img)
	imageCanvas.Resize(fyne.NewSize(4, 2))
	imageOutput := software.NewPainter().Paint(imageCanvas)
	if imageOutput.Bounds() != image.Rect(0, 0, 4, 2) {
		t.Fatalf("unexpected image bounds: %v", imageOutput.Bounds())
	}
	for y := 0; y < 2; y++ {
		for x, level := range []uint8{64, 96, 160, 192} {
			want := color.NRGBA{R: level, G: level, B: level, A: 255}
			if got := color.NRGBAModel.Convert(imageOutput.At(x, y)).(color.NRGBA); got != want {
				t.Fatalf("image sample (%d,%d): got %v, want %v", x, y, got, want)
			}
		}
	}
	raster := canvas.NewRaster(func(_, _ int) image.Image { return source })
	raster.ScaleMode = canvas.ImageScaleSmooth
	rasterCanvas := test.NewCanvas()
	rasterCanvas.SetPadded(false)
	rasterCanvas.SetContent(raster)
	rasterCanvas.Resize(fyne.NewSize(4, 2))
	rasterOutput := software.NewPainter().Paint(rasterCanvas)
	wantRaster := image.NewNRGBA(image.Rect(0, 0, 4, 2))
	draw.CatmullRom.Scale(wantRaster, wantRaster.Bounds(), source, source.Bounds(), draw.Over, nil)
	if rasterOutput.Bounds() != wantRaster.Bounds() {
		t.Fatalf("unexpected Raster bounds: %v", rasterOutput.Bounds())
	}
	same := true
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			if got, want := color.NRGBAModel.Convert(rasterOutput.At(x, y)).(color.NRGBA), wantRaster.NRGBAAt(x, y); got != want {
				t.Fatalf("Raster sample (%d,%d): got %v, want original CatmullRom %v", x, y, got, want)
			}
			if color.NRGBAModel.Convert(imageOutput.At(x, y)) != color.NRGBAModel.Convert(rasterOutput.At(x, y)) {
				same = false
			}
		}
	}
	if same {
		t.Fatal("image and Raster profiles unexpectedly used the same sampling result")
	}
}
