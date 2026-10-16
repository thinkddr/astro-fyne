// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Copied beside the source or scene widget and its constructor shim in CI.
package generated

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/reverse"
)

type reverseCase struct {
	Name                 string
	Width, Height, Scale int
}
type reverseScenario struct {
	Schema                                                   int
	Cases                                                    []reverseCase
	IDs, Buttons, ExpectedPointerActions, ExpectedFocusOrder []string
}
type reverseRect struct {
	Parent   *string  `json:"parent"`
	X        float32  `json:"x"`
	Y        float32  `json:"y"`
	Width    float32  `json:"width"`
	Height   float32  `json:"height"`
	Children []string `json:"children"`
}
type reverseReference struct {
	Schema          int                                `json:"schema"`
	SourceHash      string                             `json:"sourceHash"`
	ScenarioHash    string                             `json:"scenarioHash"`
	Case            string                             `json:"case"`
	Viewport        struct{ Width, Height, Scale int } `json:"viewport"`
	ScreenshotHash  string                             `json:"screenshotHash"`
	Nodes           map[string]reverseRect             `json:"nodes"`
	PointerActions  []string                           `json:"pointerActions"`
	FocusOrder      []string                           `json:"focusOrder"`
	IdentityChecked bool                               `json:"identityChecked"`
}

func reverseHash(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }
func reverseWrite(t *testing.T, path string, value any) {
	t.Helper()
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, append(data, '\n'), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestReverseFlexSourceAndReconstructedSceneUseRealObjects(t *testing.T) {
	out := os.Getenv("ASTRO_FYNE_REVERSE_FLEX_ARTIFACTS")
	if out == "" {
		t.Fatal("ASTRO_FYNE_REVERSE_FLEX_ARTIFACTS is required")
	}
	data, err := os.ReadFile("../../reverse-flex-scenario.json")
	if err != nil {
		t.Fatal(err)
	}
	var scenario reverseScenario
	if err = json.Unmarshal(data, &scenario); err != nil {
		t.Fatal(err)
	}
	if scenario.Schema != 1 || len(scenario.Cases) != 6 || len(scenario.IDs) < 50 || len(scenario.Buttons) != 3 {
		t.Fatal("missing explicit reverse-flex scenario")
	}
	expectedCases := []reverseCase{{"01-224", 224, 2400, 1}, {"02-368", 368, 2400, 1}, {"03-512", 512, 2400, 1}, {"04-368", 368, 2400, 1}, {"05-224", 224, 2400, 1}, {"06-224-scale2", 224, 2400, 2}}
	if !reflect.DeepEqual(scenario.Cases, expectedCases) || !reflect.DeepEqual(scenario.Buttons, []string{"action-a", "action-b", "action-c"}) || !reflect.DeepEqual(scenario.ExpectedPointerActions, []string{"action-c", "action-b", "action-a"}) || !reflect.DeepEqual(scenario.ExpectedFocusOrder, []string{"action-a", "action-b", "action-c"}) {
		t.Fatal("reverse-flex cases or fixed action outcomes differ")
	}
	seenCases := map[string]bool{}
	for _, item := range scenario.Cases {
		if seenCases[item.Name] {
			t.Fatal("duplicate reverse-flex case")
		}
		seenCases[item.Name] = true
	}
	scenarioHash := reverseHash(data)
	sourceHash := os.Getenv("ASTRO_FYNE_REVERSE_FLEX_SOURCE_HASH")
	if len(sourceHash) != 64 || sourceHash != reverseProbeSourceHash {
		t.Fatal("source widget and scenario analysis differ")
	}
	a := test.NewApp()
	t.Cleanup(a.Quit)
	var events []string
	actions := webui.Actions{}
	if reverseProbeMode == "source" {
		actions["observe"] = func(args ...any) any {
			if len(args) != 1 {
				panic("observe requires one ID")
			}
			events = append(events, args[0].(string))
			return nil
		}
	} else {
		for _, id := range scenario.Buttons {
			id := id
			actions[id] = func(...any) any { events = append(events, id); return nil }
		}
	}
	object, view, err := newReverseProbe(actions)
	if err != nil {
		t.Fatal(err)
	}
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(float32(scenario.Cases[0].Width), float32(scenario.Cases[0].Height)))
	c.SetContent(object)
	if err = view.BindCanvas(c); err != nil {
		t.Fatal(err)
	}
	c.Capture()
	objects := map[string]fyne.CanvasObject{}
	for _, id := range scenario.IDs {
		objects[id] = view.Object(id)
		if objects[id] == nil {
			t.Fatalf("missing source object %q", id)
		}
	}
	for index, item := range scenario.Cases {
		t.Run(item.Name, func(t *testing.T) {
			if index > 0 {
				c.Focus(objects[scenario.Buttons[0]].(fyne.Focusable))
				if c.Focused() != objects[scenario.Buttons[0]].(fyne.Focusable) {
					t.Fatal("field could not focus before resize")
				}
			}
			c.SetScale(float32(item.Scale))
			size := fyne.NewSize(float32(item.Width), float32(item.Height))
			c.Resize(size)
			view.Resize(size)
			c.Capture()
			if index > 0 && c.Focused() != objects[scenario.Buttons[0]].(fyne.Focusable) {
				t.Fatal("resize lost the retained source focus")
			}
			c.Unfocus()
			frame := c.Capture()
			if frame.Bounds().Dx() != item.Width*item.Scale || frame.Bounds().Dy() != item.Height*item.Scale {
				t.Fatal("incorrect physical viewport")
			}
			snapshot, err := view.Snapshot()
			if err != nil {
				t.Fatal(err)
			}
			if snapshot.Measured || !snapshot.Responsive || snapshot.HasFocus || snapshot.Size != size {
				t.Fatal("reverse fixture must retain unmeasured responsive declarations")
			}
			nodes := map[string]reverseRect{}
			absolute := map[string]fyne.Position{}
			var walk func([]webui.SnapshotNode, *string, fyne.Position)
			walk = func(children []webui.SnapshotNode, parent *string, origin fyne.Position) {
				for _, n := range children {
					id, s := n.Node.ID, n.Node.Style
					if _, exists := nodes[id]; exists || objects[id] != n.Object || view.Object(id) != objects[id] {
						t.Fatalf("duplicate or replaced source object %q", id)
					}
					ids := make([]string, len(n.Children))
					for i, child := range n.Children {
						ids[i] = child.Node.ID
					}
					nodes[id] = reverseRect{parent, s.X, s.Y, s.Width, s.Height, ids}
					absolute[id] = origin.Add(fyne.NewPos(s.X, s.Y))
					walk(n.Children, &id, absolute[id])
				}
			}
			walk(snapshot.Roots, nil, fyne.NewPos(0, 0))
			if len(nodes) != len(scenario.IDs) {
				t.Fatal("node inventory changed")
			}
			directory := filepath.Join(out, item.Name)
			webBytes, err := os.ReadFile(filepath.Join(directory, "web.json"))
			if err != nil {
				t.Fatal(err)
			}
			var reference reverseReference
			if err = json.Unmarshal(webBytes, &reference); err != nil {
				t.Fatal(err)
			}
			if reference.Schema != 1 || reference.SourceHash != sourceHash || reference.ScenarioHash != scenarioHash || reference.Case != item.Name || reference.Viewport.Width != item.Width || reference.Viewport.Height != item.Height || reference.Viewport.Scale != item.Scale || !reference.IdentityChecked || len(reference.Nodes) != len(nodes) {
				t.Fatal("browser evidence belongs to another frame or lacks identity checks")
			}
			webPNG, err := os.ReadFile(filepath.Join(directory, "web.png"))
			if err != nil {
				t.Fatal(err)
			}
			if reverseHash(webPNG) != reference.ScreenshotHash {
				t.Fatal("browser PNG identity differs")
			}
			for id, want := range reference.Nodes {
				got, ok := nodes[id]
				if !ok || !reflect.DeepEqual(got.Parent, want.Parent) || !reflect.DeepEqual(got.Children, want.Children) {
					t.Fatalf("source parent/child order changed at %q", id)
				}
				for _, pair := range [][2]float32{{got.X, want.X}, {got.Y, want.Y}, {got.Width, want.Width}, {got.Height, want.Height}} {
					if math.IsNaN(float64(pair[0])) || math.Abs(float64(pair[0]-pair[1])) > 1.0/64 {
						t.Errorf("browser/native geometry differs at %q: %+v != %+v", id, got, want)
					}
				}
			}
			if reverseProbeMode == "source" && index == 0 {
				bindings := map[string]reverse.Events{}
				for _, id := range scenario.Buttons {
					bindings[id] = reverse.Events{Tap: id}
				}
				doc, err := reverse.Export(object, reverse.Options{Viewport: reverse.Viewport{Width: size.Width, Height: size.Height, Scale: float32(item.Scale)}, Canvas: c, PreserveLayout: true, IDBindings: bindings})
				if err != nil {
					t.Fatal(err)
				}
				if doc.Schema != 2 || doc.Layout != "flex" {
					t.Fatal("export lost responsive source declarations")
				}
				reverseWrite(t, filepath.Join(out, "scene.json"), doc)
			}
			var encoded bytes.Buffer
			if err = png.Encode(&encoded, frame); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filepath.Join(directory, reverseProbeMode+"-native.png"), encoded.Bytes(), 0644); err != nil {
				t.Fatal(err)
			}
			order := append([]string(nil), scenario.Buttons...)
			sort.Slice(order, func(i, j int) bool { return absolute[order[i]].X < absolute[order[j]].X })
			events = nil
			for _, id := range order {
				pos := absolute[id]
				s := nodes[id]
				test.TapCanvas(c, fyne.NewPos(pos.X+s.Width/2, pos.Y+s.Height/2))
			}
			if !reflect.DeepEqual(events, scenario.ExpectedPointerActions) || !reflect.DeepEqual(events, reference.PointerActions) {
				t.Fatalf("reverse coordinate hits changed action order: %v", events)
			}
			focus := []string{scenario.Buttons[0]}
			c.Focus(objects[scenario.Buttons[0]].(fyne.Focusable))
			for i := 1; i < len(scenario.Buttons); i++ {
				c.FocusNext()
				id := ""
				for _, candidate := range scenario.Buttons {
					if c.Focused() == objects[candidate].(fyne.Focusable) {
						id = candidate
					}
				}
				focus = append(focus, id)
			}
			c.Unfocus()
			if !reflect.DeepEqual(focus, scenario.ExpectedFocusOrder) || !reflect.DeepEqual(focus, reference.FocusOrder) {
				t.Fatalf("source navigation order changed: %v", focus)
			}
			if view.Error() != nil {
				t.Fatal(view.Error())
			}
			reverseWrite(t, filepath.Join(directory, reverseProbeMode+"-native.json"), map[string]any{"schema": 1, "sourceHash": sourceHash, "scenarioHash": scenarioHash, "case": item.Name, "viewport": map[string]int{"width": item.Width, "height": item.Height, "scale": item.Scale}, "nodes": nodes, "pointerActions": events, "focusOrder": focus, "identityChecked": true, "responsive": true, "measured": false, "screenshotHash": reverseHash(encoded.Bytes())})
		})
	}
}
