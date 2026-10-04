// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// scene-fixture exports a genuine laid-out native tree and its software frame for
// the remote Fyne -> scene -> Astro differential gate. No page-sized raster is
// used as a substitute for the object tree: the only image is a 16x16 bitmap.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	"github.com/thinkddr/astro-fyne/native/reverse"
)

func main() {
	out := flag.String("out", "", "write scene.json and native.png in this directory; otherwise print the scene")
	flag.Parse()
	if err := run(*out); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(out string) error {
	a := test.NewApp()
	defer a.Quit()
	background := canvas.NewRectangle(color.NRGBA{R: 255, G: 255, B: 255, A: 255})
	background.Resize(fyne.NewSize(320, 240))
	box := canvas.NewRectangle(color.NRGBA{R: 36, G: 116, B: 238, A: 255})
	box.Move(fyne.NewPos(24, 30))
	box.Resize(fyne.NewSize(128, 64))
	pixels := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			c := color.NRGBA{R: 238, G: 80, B: 36, A: 255}
			if (x/4+y/4)%2 == 0 {
				c = color.NRGBA{R: 36, G: 200, B: 100, A: 255}
			}
			pixels.SetNRGBA(x, y, c)
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, pixels); err != nil {
		return err
	}
	bitmap := canvas.NewImageFromResource(fyne.NewStaticResource("fixture.png", encoded.Bytes()))
	bitmap.Move(fyne.NewPos(200, 30))
	bitmap.Resize(fyne.NewSize(16, 16))
	root := container.NewWithoutLayout(background, box, bitmap)
	root.Resize(fyne.NewSize(320, 240))
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(root)
	scene, err := reverse.Export(root, reverse.Options{Viewport: reverse.Viewport{Width: 320, Height: 240, Scale: 1}, Canvas: c, IDs: map[fyne.CanvasObject]string{root: "native-scene", background: "background", box: "box", bitmap: "bitmap"}})
	if err != nil {
		return err
	}
	jsonBytes, err := json.MarshalIndent(scene, "", "  ")
	if err != nil {
		return err
	}
	jsonBytes = append(jsonBytes, '\n')
	if out == "" {
		_, err = os.Stdout.Write(jsonBytes)
		return err
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(out, "scene.json"), jsonBytes, 0644); err != nil {
		return err
	}
	var frame bytes.Buffer
	if err := png.Encode(&frame, c.Capture()); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(out, "native.png"), frame.Bytes(), 0644)
}
