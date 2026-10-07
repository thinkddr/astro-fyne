// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Copied beside CI-generated scene widgets in native/.scene-roundtrip.
package scenes

import (
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	"fyne.io/fyne/v2/theme"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/generated"
	"github.com/thinkddr/astro-fyne/native/reverse"
	"github.com/thinkddr/astro-fyne/native/visual"
)

func evidence(t *testing.T, name string, value any) {
	t.Helper()
	path := filepath.Join(os.Getenv("ASTRO_FYNE_SCENE_ARTIFACTS"), name)
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(data, '\n'), 0644); err != nil {
		t.Fatal(err)
	}
}
func canvasFor(view fyne.CanvasObject, width, height float32) software.WindowlessCanvas {
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(width, height))
	c.SetContent(view)
	return c
}
func exact(t *testing.T, reference, actual image.Image, name string) {
	t.Helper()
	result, _, err := visual.Compare(reference, actual, visual.Tolerance{})
	if err != nil {
		t.Fatal(err)
	}
	evidence(t, name, result)
	if !result.Exact || !result.Accepted || result.ChangedPixels != 0 {
		t.Fatalf("scene round trip changed pixels: %+v", result)
	}
}
func TestFixedSceneReconstructsOriginalNativePixelsAndResources(t *testing.T) {
	a := test.NewApp()
	t.Cleanup(a.Quit)
	v, err := NewSceneGeometry(webui.Scope{}, webui.Actions{})
	if err != nil {
		t.Fatal(err)
	}
	c := canvasFor(v, 320, 240)
	if err := v.BindCanvas(c); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(filepath.Join(os.Getenv("ASTRO_FYNE_SCENE_ARTIFACTS"), "../reverse/native.png"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	reference, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	exact(t, reference, c.Capture(), "fixed-native-roundtrip.json")
	scene, err := reverse.Export(v, reverse.Options{Viewport: reverse.Viewport{Width: 320, Height: 240, Scale: 1}, Canvas: c})
	if err != nil {
		t.Fatal(err)
	}
	if len(scene.Resources) != 1 || scene.Resources[0].Width != 16 || scene.Resources[0].Height != 16 {
		t.Fatal("embedded native bitmap lost its metadata")
	}
}
func TestInteractiveSceneRoundTripMatchesOriginalActionTrace(t *testing.T) {
	a := test.NewApp()
	t.Cleanup(a.Quit)
	var events []map[string]any
	value := ""
	actions := webui.Actions{
		"input": func(args ...any) any {
			value = args[0].(string)
			events = append(events, map[string]any{"action": "input", "value": value})
			return nil
		},
		"commit": func(args ...any) any {
			value = args[0].(string)
			events = append(events, map[string]any{"action": "commit", "value": value})
			return nil
		},
		"tap": func(...any) any { events = append(events, map[string]any{"action": "tap"}); return nil },
	}
	backend := webui.FyneBackend{Fonts: map[string]map[webui.Font]fyne.Resource{"sans-serif": {{Weight: 400}: theme.DefaultTheme().Font(fyne.TextStyle{}), {Weight: 600}: theme.DefaultTheme().Font(fyne.TextStyle{Bold: true})}}}
	if _, err := NewSceneControls(webui.Scope{}, webui.Actions{}, backend); err == nil {
		t.Fatal("scene with missing host actions mounted")
	}
	v, err := NewSceneControls(webui.Scope{}, actions, backend)
	if err != nil {
		t.Fatal(err)
	}
	c := canvasFor(v, 320, 240)
	if err := v.BindCanvas(c); err != nil {
		t.Fatal(err)
	}
	field := v.Object("edit").(fyne.Focusable)
	button := v.Object("save").(fyne.Tappable)
	c.Focus(field)
	if c.Focused() != field {
		t.Fatal("imported scene field cannot focus")
	}
	field.TypedRune('x')
	v.Refresh()
	field.TypedKey(&fyne.KeyEvent{Name: fyne.KeyReturn})
	field.TypedKey(&fyne.KeyEvent{Name: fyne.KeyReturn})
	c.Unfocus()
	button.Tapped(&fyne.PointEvent{})
	c.Focus(field)
	field.TypedRune('y')
	c.Unfocus()
	if v.Error() != nil {
		t.Fatal(v.Error())
	}
	trace := map[string]any{"schema": 1, "events": events, "finalValue": value, "disabled": map[string]bool{"edit": v.Object("edit").(fyne.Disableable).Disabled(), "save": v.Object("save").(fyne.Disableable).Disabled()}}
	evidence(t, "controls-native-roundtrip.json", trace)
	data, err := os.ReadFile(filepath.Join(os.Getenv("ASTRO_FYNE_SCENE_ARTIFACTS"), "../reverse-controls/native-behavior.json"))
	if err != nil {
		t.Fatal(err)
	}
	var want, got any
	if err := json.Unmarshal(data, &want); err != nil {
		t.Fatal(err)
	}
	data, err = json.Marshal(trace)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(want, got) {
		t.Fatalf("native scene import changed callback semantics: want=%v got=%v", want, got)
	}
}
func TestOneResponsiveSceneResizesWithoutAdditionalCaptures(t *testing.T) {
	for _, preset := range []string{"flex", "bitmap"} {
		t.Run(preset, func(t *testing.T) {
			a := test.NewApp()
			t.Cleanup(a.Quit)
			var imported, original fyne.CanvasObject
			var view, source *webui.View
			height := float32(640)
			if preset == "flex" {
				v, err := NewSceneFlex(webui.Scope{}, webui.Actions{})
				if err != nil {
					t.Fatal(err)
				}
				imported, view = v, v.View
				s, err := generated.NewResponsiveFlex(webui.Scope{}, webui.Actions{})
				if err != nil {
					t.Fatal(err)
				}
				original, source = s, s.View
			} else {
				v, err := NewSceneBitmap(webui.Scope{}, webui.Actions{})
				if err != nil {
					t.Fatal(err)
				}
				imported, view = v, v.View
				s, err := generated.NewResponsiveBitmap(webui.Scope{}, webui.Actions{})
				if err != nil {
					t.Fatal(err)
				}
				original, source, height = s, s.View, 96
			}
			actual, reference := canvasFor(imported, 224, height), canvasFor(original, 224, height)
			if err := view.BindCanvas(actual); err != nil {
				t.Fatal(err)
			}
			if err := source.BindCanvas(reference); err != nil {
				t.Fatal(err)
			}
			for index, width := range []float32{224, 368, 512, 368, 224} {
				size := fyne.NewSize(width, height)
				actual.Resize(size)
				reference.Resize(size)
				view.Resize(size)
				source.Resize(size)
				exact(t, reference.Capture(), actual.Capture(), fmt.Sprintf("%s-native-roundtrip-%d.json", preset, index+1))
				if view.Error() != nil || source.Error() != nil {
					t.Fatalf("invalid responsive frame: %v %v", view.Error(), source.Error())
				}
				if _, err := reverse.Export(imported, reverse.Options{Viewport: reverse.Viewport{Width: width, Height: height, Scale: 1}, Canvas: actual, PreserveLayout: true}); err != nil {
					t.Fatal(err)
				}
			}
			if preset == "flex" {
				actual.SetScale(2)
				reference.SetScale(2)
				exact(t, reference.Capture(), actual.Capture(), "flex-native-roundtrip-scale2.json")
			}
		})
	}
}
