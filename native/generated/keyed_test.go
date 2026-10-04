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
	return view, window
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
		order := 2
		if a != nil {
			if view.Object("a-row").Position().Y < view.Object("b-row").Position().Y {
				order = 12
			} else {
				order = 21
			}
		}
		primitiveOrder := 12
		if view.Object("y-primitive").Position().Y < view.Object("x-primitive").Position().Y {
			primitiveOrder = 21
		}
		sameBranch := 0
		if branch := view.Object("a-branch-input"); branch != nil && branch == originalBranch {
			sameBranch = 1
		}
		for index, value := range []int{focus, sameA, sameB, order, primitiveOrder, sameBranch} {
			trace.Observations = append(trace.Observations, observation{fmt.Sprintf("%d:%s", len(trace.Frames)-1, []string{"focus", "same-a", "same-b", "order", "primitive-order", "same-branch-a"}[index]), value})
		}
	}
	snapshot("initial")
	for _, action := range scenario.Actions {
		if action == "edit-a" || action == "edit-branch-a" {
			id := "a-input"
			if action == "edit-branch-a" {
				id = "a-branch-input"
			}
			input := view.Object(id).(fyne.Focusable)
			window.Canvas().Focus(input)
			input.TypedKey(&fyne.KeyEvent{Name: fyne.KeyEnd})
			input.TypedRune('!')
		} else {
			tapGenerated(t, view, action)
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
	focus := branch.(fyne.Focusable)
	window.Canvas().Focus(focus)
	focus.TypedKey(&fyne.KeyEvent{Name: fyne.KeyEnd})
	focus.TypedRune('!')
	tapGenerated(t, view, "a-branch-increment")
	tapGenerated(t, view, "a-branch-toggle")
	if view.Object("a-branch-input") != branch || window.Canvas().Focused() != focus ||
		keyedText(t, view, "a-branch-count") != "1" || keyedText(t, view, "a-branch-text") != "initial!" ||
		keyedText(t, view, "a-branch-label") != "alternate" {
		t.Fatal("same component branch changed identity, initializer state or focus instead of just its props")
	}
	tapGenerated(t, view, "a-branch-toggle")
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

func TestGeneratedKeyedReorderPreservesStateObjectsAndFocus(t *testing.T) {
	view, window := keyedView(t)
	a, b := view.Object("a-input"), view.Object("b-input")
	aFocus := a.(fyne.Focusable)
	window.Canvas().Focus(aFocus)
	aFocus.TypedKey(&fyne.KeyEvent{Name: fyne.KeyEnd})
	aFocus.TypedRune('!')
	tapGenerated(t, view, "a-increment")
	tapGenerated(t, view, "change-input-id")
	if view.Object("a-input") != nil || view.Object("a-renamed-input") != a || window.Canvas().Focused() != aFocus {
		t.Fatal("changing DOM id replaced a stable keyed editor or lost its focus")
	}
	tapGenerated(t, view, "reorder")
	if keyedA(view) != a || view.Object("b-input") != b || window.Canvas().Focused() != aFocus {
		t.Fatal("keyed reorder replaced an editor or lost its focus")
	}
	if keyedText(t, view, "a-value") != "1" || keyedText(t, view, "b-value") != "0" || keyedText(t, view, "a-text") != "a!" {
		t.Fatal("state moved with list position instead of key")
	}
	if view.Object("b-row").Position().Y >= view.Object("a-row").Position().Y {
		t.Fatal("native keyed rows did not reorder")
	}
	tapGenerated(t, view, "a-increment")
	if keyedText(t, view, "a-value") != "2" {
		t.Fatal("reordered handler lost its owning component prefix")
	}
	tapGenerated(t, view, "swap-primitives")
	if view.Object("y-primitive").Position().Y >= view.Object("x-primitive").Position().Y {
		t.Fatal("primitive keyed elements did not reorder")
	}
}

func TestGeneratedKeyedRemovalRemountAndKeyChangeResetOnlyTheirInstance(t *testing.T) {
	view, _ := keyedView(t)
	a, b := view.Object("a-input"), view.Object("b-input")
	tapGenerated(t, view, "a-increment")
	tapGenerated(t, view, "b-increment")
	tapGenerated(t, view, "toggle-a")
	if view.Object("a-input") != nil {
		t.Fatal("removed keyed component retained its native object")
	}
	tapGenerated(t, view, "toggle-a")
	if view.Object("a-input") == a || view.Object("b-input") != b || keyedText(t, view, "a-value") != "0" || keyedText(t, view, "b-value") != "1" {
		t.Fatal("keyed remount reused dead state or recreated a sibling")
	}
	a = view.Object("a-input")
	tapGenerated(t, view, "a-increment")
	tapGenerated(t, view, "change-key")
	if view.Object("a-input") == a || view.Object("b-input") != b || keyedText(t, view, "a-value") != "0" || keyedText(t, view, "a-text") != "a" || keyedText(t, view, "b-value") != "1" {
		t.Fatal("changing key with a fixed DOM id did not reset just that native instance")
	}
}
