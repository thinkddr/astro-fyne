// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
package generated

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

func keyedView(t *testing.T) (*KeyedConformanceWidget, fyne.Window) {
	t.Helper()
	app := test.NewApp()
	t.Cleanup(app.Quit)
	view, err := NewKeyedConformance(webui.Scope{}, webui.Actions{})
	if err != nil {
		t.Fatal(err)
	}
	window := app.NewWindow("Keyed conformance")
	window.Resize(fyne.NewSize(800, 1200))
	window.SetContent(view)
	if err := view.BindCanvas(window.Canvas()); err != nil {
		t.Fatal(err)
	}
	view.Refresh()
	if err := view.Error(); err != nil {
		t.Fatal(err)
	}
	// The test canvas has no painter. Materialize the genuine renderer tree as a
	// drawn first frame would: Fyne's focus walker skips unrendered ancestors.
	snapshot, err := view.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	var render func([]webui.SnapshotNode)
	render = func(nodes []webui.SnapshotNode) {
		for _, node := range nodes {
			if widget, ok := node.Object.(fyne.Widget); ok {
				test.WidgetRenderer(widget)
			}
			render(node.Children)
		}
	}
	render(snapshot.Roots)
	return view, window
}

// activateKeyed matches browser HTMLElement.click(), which is programmatic
// activation. Fyne test.Tap additionally blurs the focused input like a pointer.
func activateKeyed(t *testing.T, view *KeyedConformanceWidget, id string) {
	t.Helper()
	object := view.Object(id)
	tappable, ok := object.(fyne.Tappable)
	if !ok {
		t.Fatalf("keyed action %q is not tappable: %T", id, object)
	}
	tappable.Tapped(nil)
	if err := view.Error(); err != nil {
		t.Fatalf("keyed action %q: %v", id, err)
	}
}

func focusKeyed(t *testing.T, view *KeyedConformanceWidget, window fyne.Window, id string) fyne.Focusable {
	t.Helper()
	input, ok := view.Object(id).(fyne.Focusable)
	if !ok {
		t.Fatalf("keyed input %q is not focusable", id)
	}
	window.Canvas().Focus(input)
	if window.Canvas().Focused() != input {
		t.Fatalf("initial focus %q: got %T (%p), want %p", id, window.Canvas().Focused(), window.Canvas().Focused(), input)
	}
	return input
}

func typeKeyed(t *testing.T, view *KeyedConformanceWidget, window fyne.Window, id string) fyne.Focusable {
	t.Helper()
	input := focusKeyed(t, view, window, id)
	input.TypedKey(&fyne.KeyEvent{Name: fyne.KeyEnd})
	if window.Canvas().Focused() != input {
		t.Fatalf("End lost focus for %q", id)
	}
	input.TypedRune('!')
	if window.Canvas().Focused() != input {
		t.Fatalf("controlled typing lost focus for %q; view error: %v", id, view.Error())
	}
	return input
}

func TestExportBrowserComparableKeyedBehavior(t *testing.T) {
	out := os.Getenv("ASTRO_FYNE_ARTIFACTS")
	if out == "" {
		t.Skip("set ASTRO_FYNE_ARTIFACTS to export the keyed browser/native trace")
	}
	data, err := os.ReadFile("../../keyed-scenario.json")
	if err != nil {
		t.Fatal(err)
	}
	var scenario struct {
		IDs     []string `json:"ids"`
		Actions []string `json:"actions"`
	}
	if err := json.Unmarshal(data, &scenario); err != nil {
		t.Fatal(err)
	}
	canonical, err := json.Marshal(scenario)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(canonical)
	view, window := keyedView(t)
	originalA, originalB := view.Object("a-input"), view.Object("b-input")
	originalBranch := view.Object("a-branch-input")
	originalX, originalZ := view.Object("side-X-input"), view.Object("side-Z-input")
	type frame struct {
		Action string         `json:"action"`
		Nodes  map[string]any `json:"nodes"`
	}
	type observation struct {
		Prefix   string `json:"prefix"`
		Previous int    `json:"previous"`
	}
	trace := struct {
		Schema          int           `json:"schema"`
		SourceHash      string        `json:"sourceHash"`
		ScenarioHash    string        `json:"scenarioHash"`
		Frames          []frame       `json:"frames"`
		Observations    []observation `json:"observations"`
		UnexpectedCalls []string      `json:"unexpectedCalls"`
	}{Schema: 1, SourceHash: KeyedConformanceSourceHash, ScenarioHash: hex.EncodeToString(digest[:]), Frames: []frame{}, Observations: []observation{}, UnexpectedCalls: []string{}}
	snapshot := func(action string) {
		nodes := map[string]any{}
		for _, id := range scenario.IDs {
			if view.Object(id) == nil {
				nodes[id] = nil
			} else {
				nodes[id] = keyedText(t, view, id)
			}
		}
		trace.Frames = append(trace.Frames, frame{action, nodes})
		a, b := keyedA(view), view.Object("b-input")
		focus := 0
		if window.Canvas().Focused() != nil {
			if a != nil && window.Canvas().Focused() == a.(fyne.Focusable) {
				focus = 1
			} else if b != nil && window.Canvas().Focused() == b.(fyne.Focusable) {
				focus = 2
			} else if branch := view.Object("a-branch-input"); branch != nil && window.Canvas().Focused() == branch.(fyne.Focusable) {
				focus = 4
			} else if x := view.Object("side-X-input"); x != nil && window.Canvas().Focused() == x.(fyne.Focusable) {
				focus = 5
			} else if z := view.Object("side-Z-input"); z != nil && window.Canvas().Focused() == z.(fyne.Focusable) {
				focus = 6
			} else {
				focus = 3
			}
		}
		sameA, sameB := 0, 0
		if a != nil && a == originalA {
			sameA = 1
		}
		if b != nil && b == originalB {
			sameB = 1
		}
		// Observe actual row positions, including newly mounted C. Assuming that
		// C is prepended would conceal an erroneous native append operation.
		type row struct {
			digit int
			y     float32
		}
		orderOf := func(ids []string) int {
			rows := []row{}
			for index, id := range ids {
				if object := view.Object(id); object != nil {
					rows = append(rows, row{digit: index + 1, y: object.Position().Y})
				}
			}
			sort.Slice(rows, func(i, j int) bool { return rows[i].y < rows[j].y })
			order := 0
			for index, item := range rows {
				if index > 0 && rows[index-1].y == item.y {
					t.Fatalf("keyed native rows overlap at y=%v after %q", item.y, action)
				}
				order = order*10 + item.digit
			}
			return order
		}
		order := orderOf([]string{"a-row", "b-row", "c-row"})
		sideOrder := orderOf([]string{"side-A-row", "side-X-row", "side-Y-row", "side-Z-row"})
		primitiveOrder := 12
		if view.Object("y-primitive").Position().Y < view.Object("x-primitive").Position().Y {
			primitiveOrder = 21
		}
		sameBranch := 0
		if branch := view.Object("a-branch-input"); branch != nil && branch == originalBranch {
			sameBranch = 1
		}
		sameX, sameZ := 0, 0
		if x := view.Object("side-X-input"); x != nil && x == originalX {
			sameX = 1
		}
		if z := view.Object("side-Z-input"); z != nil && z == originalZ {
			sameZ = 1
		}
		for index, value := range []int{focus, sameA, sameB, order, primitiveOrder, sameBranch, sameX, sameZ, sideOrder} {
			trace.Observations = append(trace.Observations, observation{fmt.Sprintf("%d:%s", len(trace.Frames)-1, []string{"focus", "same-a", "same-b", "order", "primitive-order", "same-branch-a", "same-x", "same-z", "side-order"}[index]), value})
		}
	}
	snapshot("initial")
	for _, action := range scenario.Actions {
		if action == "focus-x" || action == "focus-z" {
			id := "side-X-input"
			if action == "focus-z" {
				id = "side-Z-input"
			}
			focusKeyed(t, view, window, id)
		} else if action == "edit-a" || action == "edit-branch-a" || action == "edit-b" {
			id := "a-input"
			if action == "edit-branch-a" {
				id = "a-branch-input"
			} else if action == "edit-b" {
				id = "b-input"
			} else if view.Object("a-renamed-input") != nil {
				id = "a-renamed-input"
			}
			typeKeyed(t, view, window, id)
		} else {
			activateKeyed(t, view, action)
		}
		snapshot(action)
	}
	data, err = json.MarshalIndent(trace, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(out, "native-keyed-behavior.json"), append(data, '\n'), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestGeneratedCompatibleBranchesPreserveStateObjectAndFocus(t *testing.T) {
	view, window := keyedView(t)
	branch := view.Object("a-branch-input")
	focus := typeKeyed(t, view, window, "a-branch-input")
	activateKeyed(t, view, "a-branch-increment")
	activateKeyed(t, view, "a-branch-toggle")
	if view.Object("a-branch-input") != branch {
		t.Fatal("compatible branch recreated its editor")
	}
	if window.Canvas().Focused() != focus {
		t.Fatal("compatible branch lost editor focus")
	}
	for id, expected := range map[string]string{"a-branch-count": "1", "a-branch-text": "initial!", "a-branch-label": "alternate"} {
		if actual := keyedText(t, view, id); actual != expected {
			t.Fatalf("compatible branch %q: got %q, want %q", id, actual, expected)
		}
	}
	activateKeyed(t, view, "a-branch-toggle")
	if view.Object("a-branch-input") != branch || keyedText(t, view, "a-branch-count") != "1" {
		t.Fatal("returning to the first compatible branch lost its instance")
	}
}

func keyedText(t *testing.T, view *KeyedConformanceWidget, id string) string {
	t.Helper()
	object := view.Object(id)
	text, ok := object.(interface{ AccessibilityLabel() string })
	if !ok {
		t.Fatalf("keyed text %q is missing: %T", id, object)
	}
	return text.AccessibilityLabel()
}

func keyedA(view *KeyedConformanceWidget) fyne.CanvasObject {
	if renamed := view.Object("a-renamed-input"); renamed != nil {
		return renamed
	}
	return view.Object("a-input")
}

func TestGeneratedKeyedReorderPreservesStateObjectsAndMatchesFocusProfile(t *testing.T) {
	view, window := keyedView(t)
	a, b := view.Object("a-input"), view.Object("b-input")
	aFocus := typeKeyed(t, view, window, "a-input")
	activateKeyed(t, view, "a-increment")
	activateKeyed(t, view, "change-input-id")
	if view.Object("a-input") != nil {
		t.Fatal("changing DOM id left the old public ID")
	}
	if view.Object("a-renamed-input") != a {
		t.Fatal("changing DOM id recreated a stable keyed editor")
	}
	if window.Canvas().Focused() != aFocus {
		t.Fatal("changing DOM id lost editor focus")
	}
	activateKeyed(t, view, "reorder")
	if keyedA(view) != a || view.Object("b-input") != b {
		t.Fatal("keyed reorder replaced an editor")
	}
	if window.Canvas().Focused() != nil {
		t.Fatal("keyed DOM reorder must blur the moved focused subtree in the Chromium conformance profile")
	}
	if keyedText(t, view, "a-value") != "1" || keyedText(t, view, "b-value") != "0" || keyedText(t, view, "a-text") != "a!" {
		t.Fatal("state moved with list position instead of key")
	}
	if view.Object("b-row").Position().Y >= view.Object("a-row").Position().Y {
		t.Fatal("native keyed rows did not reorder")
	}
	activateKeyed(t, view, "a-increment")
	if keyedText(t, view, "a-value") != "2" {
		t.Fatal("reordered handler lost its owning component prefix")
	}
	activateKeyed(t, view, "swap-primitives")
	if view.Object("y-primitive").Position().Y >= view.Object("x-primitive").Position().Y {
		t.Fatal("primitive keyed elements did not reorder")
	}
}

func TestGeneratedKeyedRemovalRemountAndKeyChangeResetOnlyTheirInstance(t *testing.T) {
	view, _ := keyedView(t)
	a, b := view.Object("a-input"), view.Object("b-input")
	activateKeyed(t, view, "a-increment")
	activateKeyed(t, view, "b-increment")
	activateKeyed(t, view, "toggle-a")
	if view.Object("a-input") != nil {
		t.Fatal("removed keyed component retained its native object")
	}
	activateKeyed(t, view, "toggle-a")
	if view.Object("a-input") == a || view.Object("b-input") != b || keyedText(t, view, "a-value") != "0" || keyedText(t, view, "b-value") != "1" {
		t.Fatal("keyed remount reused dead state or recreated a sibling")
	}
	a = view.Object("a-input")
	activateKeyed(t, view, "a-increment")
	activateKeyed(t, view, "change-key")
	if view.Object("a-input") == a || view.Object("b-input") != b || keyedText(t, view, "a-value") != "0" || keyedText(t, view, "a-text") != "a" || keyedText(t, view, "b-value") != "1" {
		t.Fatal("changing key with a fixed DOM id did not reset just that native instance")
	}
}
