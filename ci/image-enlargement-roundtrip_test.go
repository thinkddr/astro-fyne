// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Copied beside the two CI-generated SceneEnlargement widgets.
package enlargements

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
	"github.com/thinkddr/astro-fyne/native/reverse"
	"github.com/thinkddr/astro-fyne/native/visual"
)

func TestEnlargementSceneReconstructsRealNativePixelsAndOriginalResources(t *testing.T) {
	out := os.Getenv("ASTRO_FYNE_IMAGE_ENLARGEMENT_ARTIFACTS")
	if out == "" {
		t.Fatal("ASTRO_FYNE_IMAGE_ENLARGEMENT_ARTIFACTS is required")
	}
	a := test.NewApp()
	t.Cleanup(a.Quit)
	for _, deviceScale := range []int{1, 2} {
		t.Run(fmt.Sprintf("scale-%d", deviceScale), func(t *testing.T) {
			var object fyne.CanvasObject
			var view *webui.View
			if deviceScale == 1 {
				widget, err := NewSceneEnlargement1(webui.Scope{}, webui.Actions{})
				if err != nil {
					t.Fatal(err)
				}
				object, view = widget, widget.View
			} else {
				widget, err := NewSceneEnlargement2(webui.Scope{}, webui.Actions{})
				if err != nil {
					t.Fatal(err)
				}
				object, view = widget, widget.View
			}
			c := software.NewCanvas()
			c.SetPadded(false)
			c.SetScale(float32(deviceScale))
			c.Resize(fyne.NewSize(160, 80))
			c.SetContent(object)
			if err := view.BindCanvas(c); err != nil {
				t.Fatal(err)
			}
			frame := c.Capture()
			if frame.Bounds() != image.Rect(0, 0, 160*deviceScale, 80*deviceScale) {
				t.Fatalf("wrong reconstructed physical bounds: %v", frame.Bounds())
			}
			directory := filepath.Join(out, fmt.Sprintf("scale-%d", deviceScale))
			originalPNG, err := os.ReadFile(filepath.Join(directory, "original-native.png"))
			if err != nil {
				t.Fatal(err)
			}
			reference, err := png.Decode(bytes.NewReader(originalPNG))
			if err != nil {
				t.Fatal(err)
			}
			result, _, err := visual.Compare(reference, frame, visual.Tolerance{})
			if err != nil {
				t.Fatal(err)
			}
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, frame); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(directory, "scene-native.png"), encoded.Bytes(), 0644); err != nil {
				t.Fatal(err)
			}
			resultBytes, err := json.MarshalIndent(result, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(directory, "scene-native-comparison.json"), append(resultBytes, '\n'), 0644); err != nil {
				t.Fatal(err)
			}
			if !result.Exact || !result.Accepted || result.ChangedPixels != 0 {
				t.Fatalf("scene reconstruction changed native bitmap scaling: %+v", result)
			}
			originalBytes, err := os.ReadFile(filepath.Join(directory, "scene.json"))
			if err != nil {
				t.Fatal(err)
			}
			var original reverse.Document
			if err := json.Unmarshal(originalBytes, &original); err != nil {
				t.Fatal(err)
			}
			reexported, err := reverse.Export(object, reverse.Options{Viewport: reverse.Viewport{Width: 160, Height: 80, Scale: float32(deviceScale)}, Canvas: c})
			if err != nil {
				t.Fatal(err)
			}
			if len(original.Resources) != 3 || len(reexported.Resources) != 3 {
				t.Fatal("round trip changed the three original image resources")
			}
			resources := map[string]reverse.Resource{}
			for _, resource := range original.Resources {
				resources[resource.Hash] = resource
			}
			for _, resource := range reexported.Resources {
				before, ok := resources[resource.Hash]
				if !ok || resource.Width != 16 || resource.Height != 16 || !bytes.Equal(before.Content, resource.Content) || fmt.Sprintf("%x", sha256.Sum256(resource.Content)) != resource.Hash {
					t.Fatal("scene round trip baked enlarged pixels into a replacement asset")
				}
			}
			for i, id := range []string{"even-image", "odd-image", "alpha-image"} {
				bitmap := view.Object(id)
				if bitmap == nil || bitmap.Position() != fyne.NewPos(float32(16+48*i), 16) || bitmap.Size() != fyne.NewSize(32, 32) {
					t.Fatalf("scene reconstruction changed image box %s", id)
				}
			}
			sceneBytes, err := json.MarshalIndent(reexported, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(directory, "scene-native-reexport.json"), append(sceneBytes, '\n'), 0644); err != nil {
				t.Fatal(err)
			}
		})
	}
}
