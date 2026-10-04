// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
package generated

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

type controlsScenario struct {
	IDs     []string `json:"ids"`
	Actions []string `json:"actions"`
}

type controlsFrame struct {
	Action string         `json:"action"`
	Nodes  map[string]any `json:"nodes"`
}

type controlsObservation struct {
	Prefix   string `json:"prefix"`
	Previous int    `json:"previous"`
}

func controlsSnapshotNodes(snapshot webui.ViewSnapshot) map[string]webui.SnapshotNode {
	nodes := map[string]webui.SnapshotNode{}
	var visit func([]webui.SnapshotNode)
	visit = func(items []webui.SnapshotNode) {
		for _, item := range items {
			nodes[item.Node.ID] = item
			visit(item.Children)
		}
	}
	visit(snapshot.Roots)
	return nodes
}

func controlsTap(t *testing.T, view *ResponsiveControlsWidget, target software.WindowlessCanvas, id string) {
	t.Helper()
	snapshot, err := view.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	rectangles, err := responsiveSnapshotRectangles(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	rectangle, found := rectangles[id]
	if !found {
		t.Fatalf("pointer target %q is absent", id)
	}
	x, y := rectangle.X+rectangle.Width/2, rectangle.Y+rectangle.Height/2
	for parent := rectangle.Parent; parent != nil; {
		ancestor, exists := rectangles[*parent]
		if !exists {
			t.Fatalf("pointer target %q has an absent parent", id)
		}
		x, y = x+ancestor.X, y+ancestor.Y
		parent = ancestor.Parent
	}
	// Hit-test the actual canvas at the element's center. No programmatic
	// activation or forced Canvas.Focus conceals a missing native pointer focus.
	test.TapCanvas(target, fyne.NewPos(float32(x), float32(y)))
}

func TestGeneratedResponsiveControlsPointerTypingResizeAndCommit(t *testing.T) {
	data, err := os.ReadFile("../../responsive-controls-scenario.json")
	if err != nil {
		t.Fatal(err)
	}
	var scenario controlsScenario
	if err := decodeFlexJSON(data, &scenario); err != nil {
		t.Fatal(err)
	}
	if len(scenario.IDs) != 10 || len(scenario.Actions) == 0 {
		t.Fatal("controls scenario is incomplete")
	}
	canonical, err := json.Marshal(scenario)
	if err != nil {
		t.Fatal(err)
	}
	scenarioDigest := sha256.Sum256(canonical)
	scenarioHash := hex.EncodeToString(scenarioDigest[:])
	geometryIDs := append([]string{"responsive-controls", "controls-editor-row", "controls-toggle-row"}, scenario.IDs...)
	seen := map[string]bool{}
	for _, id := range geometryIDs {
		if id == "" || seen[id] {
			t.Fatal("controls IDs must be present and unique")
		}
		seen[id] = true
	}
	font := NewResponsiveControlsResources()["example/public/fonts/NotoSans-Regular.ttf"]
	if font == nil {
		t.Fatal("generated controls must embed the public font resource")
	}
	fontDigest := sha256.Sum256(font.Content())
	fontHash := hex.EncodeToString(fontDigest[:])
	out := os.Getenv("ASTRO_FYNE_RESPONSIVE_CONTROLS_ARTIFACTS")
	if out != "" {
		if os.Getenv("ASTRO_FYNE_RESPONSIVE_CONTROLS_SOURCE_HASH") != ResponsiveControlsSourceHash {
			t.Fatal("controls source hash differs from browser analysis")
		}
		bytes, err := os.ReadFile(filepath.Join(out, "web-font.json"))
		if err != nil {
			t.Fatal(err)
		}
		var served struct {
			Schema     int    `json:"schema"`
			SourceHash string `json:"sourceHash"`
			Family     string `json:"family"`
			Weight     int    `json:"weight"`
			Style      string `json:"style"`
			Hash       string `json:"hash"`
			WebSrc     string `json:"webSrc"`
		}
		if err := decodeFlexJSON(bytes, &served); err != nil {
			t.Fatal(err)
		}
		if served.Schema != 1 || served.SourceHash != ResponsiveControlsSourceHash || served.Family != "AstroNoto" || served.Weight != 400 || served.Style != "normal" || served.Hash != fontHash || served.WebSrc != "/fonts/NotoSans-Regular.ttf" {
			t.Fatal("native embedded font differs from the font actually used by Chromium")
		}
	}
	app := test.NewApp()
	t.Cleanup(app.Quit)
	// Exercise the generated font backend's default path, without an injected
	// measurement profile or hand-written host font substitution.
	view, err := NewResponsiveControls(webui.Scope{}, webui.Actions{})
	if err != nil {
		t.Fatal(err)
	}
	target := software.NewCanvas()
	target.SetPadded(false)
	target.SetScale(1)
	width := 224
	target.Resize(fyne.NewSize(float32(width), 320))
	target.SetContent(view)
	if err := view.BindCanvas(target); err != nil {
		t.Fatal(err)
	}
	original := map[string]fyne.CanvasObject{}
	for _, id := range geometryIDs {
		original[id] = view.Object(id)
		if original[id] == nil {
			t.Fatalf("controls node %q is absent", id)
		}
	}
	trace := struct {
		Schema          int                   `json:"schema"`
		SourceHash      string                `json:"sourceHash"`
		ScenarioHash    string                `json:"scenarioHash"`
		Frames          []controlsFrame       `json:"frames"`
		Observations    []controlsObservation `json:"observations"`
		UnexpectedCalls []string              `json:"unexpectedCalls"`
	}{Schema: 1, SourceHash: ResponsiveControlsSourceHash, ScenarioHash: scenarioHash, Frames: []controlsFrame{}, Observations: []controlsObservation{}, UnexpectedCalls: []string{}}
	snapshot := func(action string) {
		if err := view.Error(); err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		capture := target.Capture()
		if capture.Bounds() != image.Rect(0, 0, width, 320) {
			t.Fatalf("controls capture physical size: %v", capture.Bounds())
		}
		state, err := view.Snapshot()
		if err != nil {
			t.Fatal(err)
		}
		if state.Measured || state.Size != fyne.NewSize(float32(width), 320) {
			t.Fatal("controls layout must be source-only at its actual viewport")
		}
		rectangles, err := responsiveSnapshotRectangles(state)
		if err != nil {
			t.Fatal(err)
		}
		if err := compareFlexRectangles(geometryIDs, rectangles, rectangles); err != nil {
			t.Fatal(err)
		}
		actual := controlsSnapshotNodes(state)
		nodes := map[string]any{}
		for _, id := range scenario.IDs {
			node, exists := actual[id]
			if !exists {
				t.Fatalf("controls state node %q is absent", id)
			}
			if node.Node.Kind == "input" {
				nodes[id] = node.Node.Value
			} else {
				nodes[id] = node.Node.Text
			}
		}
		for _, id := range geometryIDs {
			if view.Object(id) != original[id] {
				t.Fatalf("%s remounted controls node %q", action, id)
			}
		}
		focus := 0
		focused := target.Focused()
		if focused != nil {
			focus = -1
			for index, id := range []string{"controls-input", "controls-commit", "controls-toggle-disabled"} {
				if candidate, ok := view.Object(id).(fyne.Focusable); ok && candidate == focused {
					focus = index + 1
				}
			}
			if focus < 0 {
				t.Fatal("controls focus is outside the declared tree")
			}
		}
		index := len(trace.Frames)
		trace.Frames = append(trace.Frames, controlsFrame{action, nodes})
		values := []int{focus, 1, 1, 1, 0, 0}
		if actual["controls-input"].Node.Disabled {
			values[4] = 1
		}
		if actual["controls-commit"].Node.Disabled {
			values[5] = 1
		}
		for column, name := range []string{"focus", "same-input", "same-commit", "same-toggle", "input-disabled", "button-disabled"} {
			trace.Observations = append(trace.Observations, controlsObservation{fmt.Sprintf("%d:%s", index, name), values[column]})
		}
		if action == "click-canvas" && state.HasFocus {
			t.Fatal("the final background pointer dispatch did not remove focus")
		}
		if out == "" {
			return
		}
		caseName := fmt.Sprintf("%02d-%s", index, action)
		directory := filepath.Join(out, caseName)
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
		pngHash := sha256.Sum256(encoded.Bytes())
		geometry := flexGeometry{1, ResponsiveControlsSourceHash, scenarioHash, caseName, flexViewport{width, 320, 1}, hex.EncodeToString(pngHash[:]), rectangles}
		if err := writeFlexJSON(filepath.Join(directory, "native-geometry.json"), geometry); err != nil {
			t.Fatal(err)
		}
		reference, err := readFlexReference(out, flexViewportCase{caseName, width, 320, 1}, ResponsiveControlsSourceHash, scenarioHash)
		if err != nil {
			t.Fatal(err)
		}
		if err := compareFlexRectangles(geometryIDs, reference.Nodes, rectangles); err != nil {
			t.Fatalf("%s: %v", action, err)
		}
	}
	snapshot("initial")
	for _, action := range scenario.Actions {
		if strings.HasPrefix(action, "resize-") {
			next, err := strconv.Atoi(strings.TrimPrefix(action, "resize-"))
			if err != nil || next != 224 && next != 368 && next != 512 {
				t.Fatalf("unknown controls resize %q", action)
			}
			width = next
			size := fyne.NewSize(float32(width), 320)
			target.Resize(size)
			view.Resize(size)
		} else if strings.HasPrefix(action, "type-") || action == "press-enter" {
			input, ok := view.Object("controls-input").(fyne.Focusable)
			if !ok || target.Focused() != input {
				t.Fatalf("%s requires the pointer's existing input focus", action)
			}
			if action == "press-enter" {
				input.TypedKey(&fyne.KeyEvent{Name: fyne.KeyReturn})
			} else {
				text := strings.TrimPrefix(action, "type-")
				if text != "BC" && text != "D" && text != "E" && text != "F" {
					t.Fatalf("unknown controls typing %q", action)
				}
				input.TypedKey(&fyne.KeyEvent{Name: fyne.KeyEnd})
				for _, character := range text {
					// The focused target receives the same rune events that the native
					// driver dispatches; this never creates or repairs focus.
					input.TypedRune(character)
				}
			}
		} else if action == "click-canvas" {
			// Fyne test.TapCanvas omits the desktop pointer dispatcher when
			// no Tappable is hit. The empty root padding is such a background;
			// dispatch its actual blur, rather than forcing any control focus.
			before := target.Focused()
			commit, ok := view.Object("controls-commit").(fyne.Focusable)
			if !ok || before != commit {
				t.Fatal("background gesture requires the commit button focus retained through resize")
			}
			test.TapCanvas(target, fyne.NewPos(4, 316))
			if after := target.Focused(); after != nil && after != before {
				t.Fatal("background hit-test unexpectedly focused a control")
			}
			target.Unfocus()
		} else {
			id := map[string]string{"click-input": "controls-input", "click-commit": "controls-commit", "click-toggle-disabled": "controls-toggle-disabled", "click-disabled-input": "controls-input", "click-disabled-button": "controls-commit"}[action]
			if id == "" {
				t.Fatalf("unknown controls action %q", action)
			}
			controlsTap(t, view, target, id)
		}
		snapshot(action)
	}
	if out != "" {
		if err := writeFlexJSON(filepath.Join(out, "native-behavior.json"), trace); err != nil {
			t.Fatal(err)
		}
		status := map[string]any{"schema": 1, "sourceHash": ResponsiveControlsSourceHash, "scenarioHash": scenarioHash, "fontHash": fontHash, "pixelPerfectVerified": false, "reason": "Text, focus decoration and caret PNG parity require a separate strict comparison"}
		if err := writeFlexJSON(filepath.Join(out, "native-visual-status.json"), status); err != nil {
			t.Fatal(err)
		}
	}
}
