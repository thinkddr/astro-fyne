// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package generated

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/visual"
)

func enlargementHash(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }

func TestSourceImageEnlargementKeepsOriginalResourcesAndNativePixels(t *testing.T) {
	out := os.Getenv("ASTRO_FYNE_IMAGE_ENLARGEMENT_ARTIFACTS")
	if out == "" { t.Skip("set ASTRO_FYNE_IMAGE_ENLARGEMENT_ARTIFACTS for the real enlargement corpus") }
	a := test.NewApp()
	t.Cleanup(a.Quit)
	scenarioBytes, err := os.ReadFile("../../image-enlargement-scenario.json")
	if err != nil { t.Fatal(err) }
	var scenario struct {
		Schema int `json:"schema"`
		Assets []struct { ID string `json:"id"`; Path string `json:"path"`; Hash string `json:"hash"`; X int `json:"x"`; Y int `json:"y"` } `json:"assets"`
	}
	if err := json.Unmarshal(scenarioBytes, &scenario); err != nil { t.Fatal(err) }
	if scenario.Schema != 1 || len(scenario.Assets) != 3 { t.Fatal("missing enlargement assets") }
	wrapperBytes, err := os.ReadFile("../../example/src/pages/image-enlargement.astro")
	if err != nil { t.Fatal(err) }
	widget, err := NewImageEnlargement(webui.Scope{}, webui.Actions{})
	if err != nil { t.Fatal(err) }
	view, resources, sourceHash := widget.View, NewImageEnlargementResources(), ImageEnlargementSourceHash
	if len(resources) != 3 { t.Fatal("source widget must retain exactly three original bitmaps") }
	target := software.NewCanvas()
	target.SetPadded(false)
	target.Resize(fyne.NewSize(160, 80))
	target.SetContent(widget)
	view.Resize(fyne.NewSize(160, 80))
	if err := view.BindCanvas(target); err != nil { t.Fatal(err) }
	objects := map[string]fyne.CanvasObject{}
	for _, asset := range scenario.Assets { objects[asset.ID] = view.Object(asset.ID) }
	for _, deviceScale := range []int{1, 2} {
		t.Run(fmt.Sprintf("scale-%d", deviceScale), func(t *testing.T) {
			target.SetScale(float32(deviceScale))
			target.Resize(fyne.NewSize(160, 80))
			view.Resize(fyne.NewSize(160, 80))
			capture := target.Capture()
			if capture.Bounds() != image.Rect(0, 0, 160*deviceScale, 80*deviceScale) { t.Fatalf("wrong physical enlargement bounds: %v", capture.Bounds()) }
			snapshot, err := view.Snapshot()
			if err != nil { t.Fatal(err) }
			if snapshot.Measured || !snapshot.Responsive || snapshot.Size != fyne.NewSize(160, 80) || snapshot.HasFocus { t.Fatal("source enlargement used measurements, lost responsive declarations or acquired focus") }
			for _, asset := range scenario.Assets {
				resource := resources[asset.Path]
				if resource == nil || enlargementHash(resource.Content()) != asset.Hash { t.Fatalf("compiled image %s does not embed the original bytes", asset.ID) }
				config, err := png.DecodeConfig(bytes.NewReader(resource.Content()))
				if err != nil || config.Width != 16 || config.Height != 16 { t.Fatalf("original image %s was resized: %+v %v", asset.ID, config, err) }
				imageObject := view.Object(asset.ID)
				if imageObject == nil || imageObject != objects[asset.ID] || imageObject.Position() != fyne.NewPos(float32(asset.X), float32(asset.Y)) || imageObject.Size() != fyne.NewSize(32, 32) { t.Fatalf("image %s remounted or lost its 32px source box", asset.ID) }
			}
			directory := filepath.Join(out, fmt.Sprintf("scale-%d", deviceScale))
			manifestBytes, err := os.ReadFile(filepath.Join(directory, "web-geometry.json"))
			if err != nil { t.Fatal(err) }
			var manifest struct { WrapperHash string `json:"wrapperHash"`; SourceHash string `json:"sourceHash"`; ScenarioHash string `json:"scenarioHash"`; ScreenshotHash string `json:"screenshotHash"`; Viewport struct { Width int `json:"width"`; Height int `json:"height"`; Scale int `json:"scale"` } `json:"viewport"`; Nodes map[string]struct { Parent *string `json:"parent"`; X float32 `json:"x"`; Y float32 `json:"y"`; Width float32 `json:"width"`; Height float32 `json:"height"` } `json:"nodes"` }
			if err := json.Unmarshal(manifestBytes, &manifest); err != nil { t.Fatal(err) }
			webBytes, err := os.ReadFile(filepath.Join(directory, "web.png"))
			if err != nil { t.Fatal(err) }
			if manifest.WrapperHash != enlargementHash(wrapperBytes) || manifest.SourceHash != sourceHash || manifest.ScenarioHash != enlargementHash(scenarioBytes) || manifest.ScreenshotHash != enlargementHash(webBytes) || manifest.Viewport.Width != 160 || manifest.Viewport.Height != 80 || manifest.Viewport.Scale != deviceScale { t.Fatal("source screenshot belongs to another frame") }
			if len(manifest.Nodes) != 4 { t.Fatal("browser geometry changed its source node inventory") }
			for _, asset := range scenario.Assets {
				observed, ok := manifest.Nodes[asset.ID]
				bitmap := view.Object(asset.ID)
				if !ok || observed.Parent == nil || *observed.Parent != "enlargement-root" || bitmap.Position() != fyne.NewPos(observed.X, observed.Y) || bitmap.Size() != fyne.NewSize(observed.Width, observed.Height) { t.Fatalf("native image %s differs from independent browser geometry", asset.ID) }
			}
			originalBytes, err := os.ReadFile(filepath.Join(directory, "original-native.png"))
			if err != nil { t.Fatal(err) }
			var original struct { WrapperHash string `json:"wrapperHash"`; ScenarioHash string `json:"scenarioHash"`; ScreenshotHash string `json:"screenshotHash"` }
			originalMetadata, err := os.ReadFile(filepath.Join(directory, "original-native.json"))
			if err != nil { t.Fatal(err) }
			if err := json.Unmarshal(originalMetadata, &original); err != nil { t.Fatal(err) }
			if original.WrapperHash != enlargementHash(wrapperBytes) || original.ScenarioHash != enlargementHash(scenarioBytes) || original.ScreenshotHash != enlargementHash(originalBytes) { t.Fatal("original native frame does not match its corpus evidence") }
			reference, err := png.Decode(bytes.NewReader(originalBytes))
			if err != nil { t.Fatal(err) }
			result, _, err := visual.Compare(reference, capture, visual.Tolerance{})
			if err != nil { t.Fatal(err) }
			resultBytes, err := json.MarshalIndent(result, "", "  ")
			if err != nil { t.Fatal(err) }
			if err := os.WriteFile(filepath.Join(directory, "original-generated-comparison.json"), append(resultBytes, '\n'), 0644); err != nil { t.Fatal(err) }
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, capture); err != nil { t.Fatal(err) }
			if err := os.WriteFile(filepath.Join(directory, "generated-native.png"), encoded.Bytes(), 0644); err != nil { t.Fatal(err) }
			if !result.Exact || !result.Accepted || result.ChangedPixels != 0 { t.Fatalf("generated native bitmap changed real Fyne pixels: %+v", result) }
		})
	}
}
