// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package zeroprobe

import (
	"encoding/json"
	"fmt"
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
	js "github.com/thinkddr/astro-fyne/native/javascript"
)

type zeroRect struct {
	X      float32 `json:"x"`
	Y      float32 `json:"y"`
	Width  float32 `json:"width"`
	Height float32 `json:"height"`
}

type zeroSample struct {
	TimeMS   float64             `json:"timeMs"`
	Objects  map[string]zeroRect `json:"objects"`
	Snapshot map[string]zeroRect `json:"snapshot"`
	Archive  js.Archive          `json:"archive"`
	Image    string              `json:"image"`
}

func TestGeneratedCSSZeroHeight(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	app.Settings().SetTheme(theme.LightTheme())
	out, mode := os.Getenv("ASTRO_FYNE_ZERO_OUTPUT"), os.Getenv("ASTRO_FYNE_ZERO_MODE")
	if out == "" || mode != "source" && mode != "return" {
		t.Fatal("missing zero-height output or mode")
	}
	check := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	write := func(name string, value any) {
		data, err := json.MarshalIndent(value, "", "  ")
		check(err)
		check(os.WriteFile(filepath.Join(out, name), append(data, '\n'), 0644))
	}
	input := "source.javascript.json"
	if mode == "return" {
		input = "browser-checkpoint.javascript.json"
	}
	data, err := os.ReadFile(filepath.Join(out, input))
	check(err)
	var expected, embedded any
	check(json.Unmarshal(data, &expected))
	check(json.Unmarshal([]byte(zeroProbeArchive), &embedded))
	if !reflect.DeepEqual(expected, embedded) {
		t.Fatal("generated constructor did not embed the exact input archive")
	}
	profiles := []any{}
	for _, scale := range []float32{1, 2} {
		w, err := newZeroProbe()
		check(err)
		defer func() { check(w.Close()) }()
		canvas := software.NewCanvas()
		canvas.SetPadded(false)
		canvas.SetScale(scale)
		canvas.SetContent(w)
		canvas.Resize(fyne.NewSize(320, 240))
		w.Resize(fyne.NewSize(320, 240))
		check(w.BindCanvas(canvas))
		ids := []string{"zero-root", "zero-panel", "zero-static", "zero-following"}
		objects := map[string]fyne.CanvasObject{}
		for _, id := range ids {
			objects[id] = w.Object(id)
			if objects[id] == nil {
				t.Fatalf("missing %s", id)
			}
		}
		times, heights := []float64{0, 100, 350, 600, 1100, 1350, 1600, 2100}, []float32{0, 0, 16, 32, 64, 48, 32, 0}
		if mode == "return" {
			state, err := w.AnimationState()
			check(err)
			if state.TimeMS != 100 || state.PlayState != "paused" {
				t.Fatalf("zero checkpoint was not restored: %+v", state)
			}
			times, heights = []float64{100, 350, 1100, 2100}, []float32{0, 16, 64, 0}
		}
		samples := []zeroSample{}
		for index, time := range times {
			if mode == "return" && index == 1 {
				check(w.PlayAnimations())
			}
			check(w.AdvanceAnimations(time))
			image := canvas.Capture()
			if image.Bounds().Dx() != int(320*scale) || image.Bounds().Dy() != int(240*scale) {
				t.Fatalf("unexpected DPR raster: %v", image.Bounds())
			}
			state, err := w.AnimationState()
			check(err)
			if state.TimeMS != time {
				t.Fatal("sample changed logical time")
			}
			height := heights[index]
			want := map[string]zeroRect{"zero-root": {0, 0, 320, height + 24}, "zero-panel": {0, 0, 320, height}, "zero-static": {0, height, 320, 0}, "zero-following": {0, height, 320, 24}}
			frame, err := w.Snapshot()
			check(err)
			snapshot := map[string]zeroRect{}
			var collect func([]webui.SnapshotNode)
			collect = func(nodes []webui.SnapshotNode) {
				for _, node := range nodes {
					s := node.Node.Style
					if !s.Measured || s.Flex != nil {
						t.Fatal("frozen snapshot retained source sizing metadata")
					}
					snapshot[node.Node.ID] = zeroRect{s.X, s.Y, s.Width, s.Height}
					collect(node.Children)
				}
			}
			collect(frame.Roots)
			actual := map[string]zeroRect{}
			for _, id := range ids {
				object := w.Object(id)
				if object != objects[id] || !object.Visible() {
					t.Fatalf("sample replaced or hid %s", id)
				}
				p, s := object.Position(), object.Size()
				actual[id] = zeroRect{p.X, p.Y, s.Width, s.Height}
				if actual[id] != want[id] || snapshot[id] != want[id] {
					t.Fatalf("wrong zero flow at %v: %s %+v %+v want %+v", time, id, actual[id], snapshot[id], want[id])
				}
			}
			if w.MinSize().Height != height+24 || objects["zero-static"].MinSize().Height != 0 || objects["zero-panel"].MinSize().Height != height {
				t.Fatal("zero height inflated native minimum")
			}
			archive, err := w.ExportJavascript()
			check(err)
			filename := fmt.Sprintf("%s-dpr%g-%gms.png", mode, scale, time)
			file, err := os.Create(filepath.Join(out, filename))
			check(err)
			encodeErr := png.Encode(file, image)
			closeErr := file.Close()
			check(encodeErr)
			check(closeErr)
			samples = append(samples, zeroSample{time, actual, snapshot, archive, filename})
			if mode == "source" && time == 100 {
				check(w.PauseAnimations())
				checkpoint, err := w.ExportJavascript()
				check(err)
				if scale == 1 {
					write("native-checkpoint.javascript.json", checkpoint)
				}
				check(w.PlayAnimations())
			}
		}
		profiles = append(profiles, map[string]any{"scale": scale, "samples": samples})
	}
	write("native-"+mode+".json", map[string]any{"schema": 1, "actualGeneratedConstructor": true, "constructor": zeroProbeConstructor, "profiles": profiles})
}
