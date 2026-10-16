// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// image-enlargement-fixture exports real Fyne images and their original resources.
package main

import (
	"bytes"
	"crypto/sha256"
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
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/reverse"
)

type asset struct {
	ID string `json:"id"`
	Path string `json:"path"`
	Src string `json:"src"`
	Hash string `json:"hash"`
	MediaType string `json:"mediaType"`
	Width int `json:"width"`
	Height int `json:"height"`
	X int `json:"x"`
	Y int `json:"y"`
	RenderWidth int `json:"renderWidth"`
	RenderHeight int `json:"renderHeight"`
}
type corpus struct {
	Schema int `json:"schema"`
	Viewport struct { Width int `json:"width"`; Height int `json:"height"` } `json:"viewport"`
	Cases []struct { Name string `json:"name"`; Entry string `json:"entry"`; Scale int `json:"scale"` } `json:"cases"`
	Assets []asset `json:"assets"`
}

func hash(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }

func main() {
	root := flag.String("root", "..", "converter repository root")
	out := flag.String("out", "", "write scene.json, original-native.png and original-native.json")
	scale := flag.Int("scale", 1, "device scale, 1 or 2")
	flag.Parse()
	if err := run(*root, *out, *scale); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(root, out string, deviceScale int) error {
	if out == "" || (deviceScale != 1 && deviceScale != 2) {
		return fmt.Errorf("--out is required; --scale must be 1 or 2")
	}
	scenarioBytes, err := os.ReadFile(filepath.Join(root, "image-enlargement-scenario.json"))
	if err != nil { return err }
	wrapperBytes, err := os.ReadFile(filepath.Join(root, "example/src/pages/image-enlargement.astro"))
	if err != nil { return err }
	var scenario corpus
	decoder := json.NewDecoder(bytes.NewReader(scenarioBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&scenario); err != nil { return err }
	if scenario.Schema != 1 || scenario.Viewport.Width != 160 || scenario.Viewport.Height != 80 || len(scenario.Cases) != 2 || len(scenario.Assets) != 3 {
		return fmt.Errorf("enlargement corpus must contain three images at both device scales")
	}
	for i, item := range scenario.Cases {
		if item.Name != fmt.Sprintf("scale-%d", i+1) || item.Entry != "ImageEnlargement" || item.Scale != i+1 {
			return fmt.Errorf("unexpected enlargement case")
		}
	}
	a := test.NewApp()
	defer a.Quit()
	background := canvas.NewRectangle(color.White)
	background.Resize(fyne.NewSize(160, 80))
	objects := []fyne.CanvasObject{background}
	ids := map[fyne.CanvasObject]string{background: "images-background"}
	names := []string{"even", "odd", "alpha"}
	for i, item := range scenario.Assets {
		name := names[i]
		if item.ID != name+"-image" || item.Path != "example/public/images/enlargement-"+name+".png" || item.Src != "/images/enlargement-"+name+".png" || item.MediaType != "image/png" || item.Width != 16 || item.Height != 16 || item.X != 16+48*i || item.Y != 16 || item.RenderWidth != 32 || item.RenderHeight != 32 {
			return fmt.Errorf("unexpected %s image declaration", name)
		}
		content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(item.Path)))
		if err != nil { return err }
		if hash(content) != item.Hash { return fmt.Errorf("%s original bitmap hash differs", name) }
		resource := fyne.NewStaticResource(item.Path, content)
		size, err := webui.ValidateBitmap(resource)
		if err != nil || size != fyne.NewSize(16, 16) { return fmt.Errorf("invalid %s original bitmap: %v", name, err) }
		bitmap := canvas.NewImageFromResource(resource)
		bitmap.FillMode, bitmap.ScaleMode = canvas.ImageFillStretch, canvas.ImageScaleSmooth
		bitmap.Move(fyne.NewPos(float32(item.X), float32(item.Y)))
		bitmap.Resize(fyne.NewSize(32, 32))
		objects = append(objects, bitmap)
		ids[bitmap] = item.ID
	}
	rootObject := container.NewWithoutLayout(objects...)
	rootObject.Resize(fyne.NewSize(160, 80))
	ids[rootObject] = "native-images"
	c := software.NewCanvas()
	c.SetPadded(false)
	c.SetScale(float32(deviceScale))
	c.Resize(fyne.NewSize(160, 80))
	c.SetContent(rootObject)
	frame := c.Capture()
	if frame.Bounds() != image.Rect(0, 0, 160*deviceScale, 80*deviceScale) { return fmt.Errorf("unexpected physical canvas bounds: %v", frame.Bounds()) }
	scene, err := reverse.Export(rootObject, reverse.Options{Viewport: reverse.Viewport{Width: 160, Height: 80, Scale: float32(deviceScale)}, Canvas: c, IDs: ids})
	if err != nil { return err }
	if len(scene.Resources) != 3 { return fmt.Errorf("export lost original bitmap resources") }
	for i, resource := range scene.Resources {
		if resource.Hash != scenario.Assets[i].Hash || resource.Width != 16 || resource.Height != 16 || hash(resource.Content) != resource.Hash {
			return fmt.Errorf("export resampled or changed original bitmap bytes")
		}
	}
	var pixels bytes.Buffer
	if err := png.Encode(&pixels, frame); err != nil { return err }
	sceneBytes, err := json.MarshalIndent(scene, "", "  ")
	if err != nil { return err }
	sceneBytes = append(sceneBytes, '\n')
	metadata := map[string]any{"schema": 1, "case": fmt.Sprintf("scale-%d", deviceScale), "scenarioHash": hash(scenarioBytes), "wrapperHash": hash(wrapperBytes), "viewport": scene.Viewport, "screenshotHash": hash(pixels.Bytes()), "sceneFileHash": hash(sceneBytes), "resources": scenario.Assets, "visualVerified": false}
	metadataBytes, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil { return err }
	if err := os.MkdirAll(out, 0755); err != nil { return err }
	for name, data := range map[string][]byte{"scene.json": sceneBytes, "original-native.png": pixels.Bytes(), "original-native.json": append(metadataBytes, '\n')} {
		if err := os.WriteFile(filepath.Join(out, name), data, 0644); err != nil { return err }
	}
	return nil
}
