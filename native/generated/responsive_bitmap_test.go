// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
package generated

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
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
	"github.com/thinkddr/astro-fyne/native/reverse"
)

func TestGeneratedResponsiveBitmapResizesWithoutMeasurements(t *testing.T) {
	scenarioBytes, err := os.ReadFile("../../responsive-bitmap-scenario.json")
	if err != nil {
		t.Fatal(err)
	}
	var scenario flexScenario
	if err := decodeFlexJSON(scenarioBytes, &scenario); err != nil {
		t.Fatal(err)
	}
	widths := []int{224, 368, 512, 368, 224}
	caseNames := []string{"01-224", "02-368", "03-512", "04-368-return", "05-224-return"}
	ids := []string{"responsive-bitmap", "bitmap-left", "bitmap-image", "bitmap-right"}
	if scenario.Schema != 1 || len(scenario.Cases) != len(widths) || len(scenario.IDs) != len(ids) {
		t.Fatal("bitmap scenario is incomplete")
	}
	for index, id := range scenario.IDs {
		if id != ids[index] {
			t.Fatal("bitmap scenario changed its physical node inventory")
		}
	}
	for index, item := range scenario.Cases {
		if item != (flexViewportCase{caseNames[index], widths[index], 96, 1}) {
			t.Fatal("bitmap cases must remain unscaled, definite natural-size layout")
		}
	}
	scenarioDigest := sha256.Sum256(scenarioBytes)
	scenarioHash := hex.EncodeToString(scenarioDigest[:])
	resource := NewResponsiveBitmapResources()["example/public/images/local-image.png"]
	if resource == nil {
		t.Fatal("generated bitmap must embed the original local PNG")
	}
	config, err := png.DecodeConfig(bytes.NewReader(resource.Content()))
	if err != nil || config.Width != 16 || config.Height != 16 {
		t.Fatalf("invalid bitmap dimensions: %+v %v", config, err)
	}
	resourceDigest := sha256.Sum256(resource.Content())
	resourceHash := hex.EncodeToString(resourceDigest[:])
	out := os.Getenv("ASTRO_FYNE_RESPONSIVE_BITMAP_ARTIFACTS")
	if out != "" {
		if os.Getenv("ASTRO_FYNE_RESPONSIVE_BITMAP_SOURCE_HASH") != ResponsiveBitmapSourceHash {
			t.Fatal("bitmap source hash differs from browser analysis")
		}
		data, err := os.ReadFile(filepath.Join(out, "web-resource.json"))
		if err != nil {
			t.Fatal(err)
		}
		var served struct {
			Schema     int    `json:"schema"`
			SourceHash string `json:"sourceHash"`
			Path       string `json:"path"`
			Hash       string `json:"hash"`
			MediaType  string `json:"mediaType"`
			Width      int    `json:"width"`
			Height     int    `json:"height"`
			Src        string `json:"src"`
		}
		if err := decodeFlexJSON(data, &served); err != nil {
			t.Fatal(err)
		}
		if served.Schema != 1 || served.SourceHash != ResponsiveBitmapSourceHash || served.Path != "example/public/images/local-image.png" || served.Hash != resourceHash || served.MediaType != "image/png" || served.Width != 16 || served.Height != 16 || served.Src != "/images/local-image.png" {
			t.Fatal("PNG bytes actually served to Chromium differ from the native embedded resource")
		}
	}
	app := test.NewApp()
	t.Cleanup(app.Quit)
	view, err := NewResponsiveBitmap(webui.Scope{}, webui.Actions{})
	if err != nil {
		t.Fatal(err)
	}
	target := software.NewCanvas()
	target.SetPadded(false)
	target.SetScale(1)
	target.Resize(fyne.NewSize(224, 96))
	target.SetContent(view)
	if err := view.BindCanvas(target); err != nil {
		t.Fatal(err)
	}
	objects := map[string]fyne.CanvasObject{}
	for _, id := range ids {
		objects[id] = view.Object(id)
		if objects[id] == nil {
			t.Fatalf("bitmap node %q is absent", id)
		}
	}
	previous := map[int]map[string]flexRectangle{}
	for _, item := range scenario.Cases {
		t.Run(item.Name, func(t *testing.T) {
			// One canvas, widget and resource survive every resize and return.
			// Browser rectangles never become a style map in this test.
			size := fyne.NewSize(float32(item.Width), float32(item.Height))
			target.Resize(size)
			view.Resize(size)
			view.Refresh()
			capture := target.Capture()
			if capture.Bounds() != image.Rect(0, 0, item.Width, item.Height) {
				t.Fatalf("bitmap native physical size: %v", capture.Bounds())
			}
			snapshot, err := view.Snapshot()
			if err != nil {
				t.Fatal(err)
			}
			if snapshot.Measured || snapshot.Size != size || snapshot.HasFocus {
				t.Fatal("bitmap must remain an unmeasured source-only unfocused frame")
			}
			rectangles, err := responsiveSnapshotRectangles(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if err := compareFlexRectangles(ids, rectangles, rectangles); err != nil {
				t.Fatal(err)
			}
			for _, id := range ids {
				if view.Object(id) != objects[id] {
					t.Fatalf("resize remounted bitmap node %q", id)
				}
			}
			imageBox := rectangles["bitmap-image"]
			if imageBox.Width != 16 || imageBox.Height != 16 || imageBox.X != float64(item.Width-16)/2 || imageBox.Y != 40 {
				t.Fatalf("bitmap was scaled or placed at a noninteger source center: %+v", imageBox)
			}
			var frozen *webui.Node
			for _, root := range snapshot.Roots {
				if root.Node.ID == "responsive-bitmap" {
					for _, child := range root.Children {
						if child.Node.ID == "bitmap-image" {
							copy := child.Node
							frozen = &copy
						}
					}
				}
			}
			if frozen == nil || frozen.ImageResource == nil || frozen.Style.Flex != nil {
				t.Fatal("resolved bitmap snapshot must preserve its resource and remove live flex metadata")
			}
			frozenDigest := sha256.Sum256(frozen.ImageResource.Content())
			if frozenDigest != resourceDigest {
				t.Fatal("resize or snapshot altered original bitmap bytes")
			}
			if before, exists := previous[item.Width]; exists {
				if err := compareFlexRectangles(ids, before, rectangles); err != nil {
					t.Fatalf("returning to bitmap viewport changed source layout: %v", err)
				}
			} else {
				previous[item.Width] = rectangles
			}
			if out == "" {
				return
			}
			directory := filepath.Join(out, item.Name)
			if err := os.MkdirAll(directory, 0755); err != nil {
				t.Fatal(err)
			}
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, capture); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(directory, "native.png"), encoded.Bytes(), 0644); err != nil {
				t.Fatal(err)
			}
			pngDigest := sha256.Sum256(encoded.Bytes())
			native := flexGeometry{1, ResponsiveBitmapSourceHash, scenarioHash, item.Name, flexViewport{item.Width, item.Height, item.Scale}, hex.EncodeToString(pngDigest[:]), rectangles}
			if err := writeFlexJSON(filepath.Join(directory, "native-geometry.json"), native); err != nil {
				t.Fatal(err)
			}
			scene, err := reverse.Export(view, reverse.Options{Viewport: reverse.Viewport{Width: float32(item.Width), Height: float32(item.Height), Scale: 1}, Canvas: target})
			if err != nil {
				t.Fatal(err)
			}
			if err := writeFlexJSON(filepath.Join(directory, "scene.json"), scene); err != nil {
				t.Fatal(err)
			}
			reference, err := readFlexReference(out, item, ResponsiveBitmapSourceHash, scenarioHash)
			if err != nil {
				t.Fatal(err)
			}
			if err := compareFlexRectangles(ids, reference.Nodes, rectangles); err != nil {
				t.Fatalf("%s: %v", item.Name, err)
			}
			// Strict RGBA8 PNG comparison runs separately for every forward and
			// frozen reverse frame. Any changed pixel must fail that visual gate.
		})
	}
}

func TestResponsiveBitmapGeometryGateDoesNotAcceptScaledImages(t *testing.T) {
	parent := "responsive-bitmap"
	reference := map[string]flexRectangle{"bitmap-image": {Parent: &parent, X: 104, Y: 40, Width: 16, Height: 16}}
	changed := map[string]flexRectangle{"bitmap-image": {Parent: &parent, X: 104, Y: 40, Width: 32, Height: 16}}
	if err := compareFlexRectangles([]string{"bitmap-image"}, reference, changed); err == nil {
		t.Fatal("geometry gate accepted a bitmap resampling change")
	}
	// This negative gate protects size evidence; it never grants pixel parity.
	if err := compareFlexRectangles([]string{"bitmap-image"}, reference, reference); err != nil {
		t.Fatal(fmt.Errorf("unchanged bitmap box: %w", err))
	}
}
