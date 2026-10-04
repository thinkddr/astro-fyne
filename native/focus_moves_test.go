// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
)

func focusMoveWindow(t *testing.T, view *View) fyne.Window {
	t.Helper()
	w := test.NewWindow(view)
	t.Cleanup(w.Close)
	w.SetPadded(false)
	w.Resize(fyne.NewSize(320, 240))
	if err := view.BindCanvas(w.Canvas()); err != nil {
		t.Fatal(err)
	}
	// The test driver has no painter. Materialize ancestor renderers explicitly
	// before its focus manager traverses the existing native object hierarchy.
	test.WidgetRenderer(view)
	snapshot, err := view.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	var render func([]SnapshotNode)
	render = func(nodes []SnapshotNode) {
		for _, node := range nodes {
			if object, ok := node.Object.(fyne.Widget); ok {
				test.WidgetRenderer(object)
			}
			render(node.Children)
		}
	}
	render(snapshot.Roots)
	return w
}

func TestReorderBlursTheMovedAncestorAndPreservesTheStationaryAnchor(t *testing.T) {
	for _, focused := range []string{"a", "b"} {
		t.Run(focused, func(t *testing.T) {
			order := []string{"a", "b"}
			values := map[string]string{"a": "a", "b": "b"}
			commits := 0
			v := NewView(func() []Node {
				rows := make([]Node, 0, len(order))
				for _, key := range order {
					rows = append(rows, Node{ID: key + "-row", Identity: "row/" + key, Kind: "container", Children: []Node{
						{ID: key, Identity: "editor/" + key, Kind: "input", Value: values[key],
							OnChange: func(value string) { values[key] = value }, OnCommit: func(string) { commits++ }},
					}})
				}
				return []Node{{ID: "list", Identity: "list", Kind: "container", Children: rows}}
			})
			window := focusMoveWindow(t, v)
			originalA, originalB := v.Object("a"), v.Object("b")
			field := v.Object(focused).(fyne.Focusable)
			window.Canvas().Focus(field)
			if window.Canvas().Focused() != field {
				t.Fatal("test did not establish native focus before the reorder")
			}
			field.TypedRune('x')
			if window.Canvas().Focused() != field {
				t.Fatal("the input's own state update lost focus before the reorder")
			}
			order = []string{"b", "a"}
			v.Refresh()
			if v.Object("a") != originalA || v.Object("b") != originalB || values[focused] != focused+"x" {
				t.Fatal("reorder remounted a keyed editor or discarded its state")
			}
			if focused == "a" {
				if window.Canvas().Focused() != nil {
					t.Fatal("moving A's ancestor did not release the detached DOM focus")
				}
				if editor := v.elements["a"].input.(*primitiveEditor); editor.active {
					t.Fatal("the moved editor retained its caret after focus was removed")
				}
			} else {
				if window.Canvas().Focused() != field {
					t.Fatal("stationary B lost focus merely because its sibling index changed")
				}
				field.TypedRune('y')
				if values["b"] != "bxy" {
					t.Fatal("the stationary editor lost its cursor or event binding")
				}
			}
			if commits != 0 {
				t.Fatal("DOM movement emitted a synthetic change/commit event")
			}
		})
	}
}

func TestPrependingRemovingAndReplacingOtherSiblingsPreserveFocus(t *testing.T) {
	order := []string{"b", "a"}
	value := "a"
	v := NewView(func() []Node {
		rows := make([]Node, 0, len(order))
		for _, key := range order {
			row := Node{ID: key + "-row", Identity: "row/" + key, Kind: "container"}
			if key == "a" {
				row.Children = []Node{{ID: "a", Identity: "editor/a", Kind: "input", Value: value, OnChange: func(s string) { value = s }}}
			}
			rows = append(rows, row)
		}
		return []Node{{ID: "list", Identity: "list", Kind: "container", Children: rows}}
	})
	window := focusMoveWindow(t, v)
	field := v.Object("a").(fyne.Focusable)
	window.Canvas().Focus(field)
	if window.Canvas().Focused() != field {
		t.Fatal("test did not establish native focus before sibling changes")
	}
	for _, next := range [][]string{
		{"c", "b", "a"}, // A new sibling is inserted before the cursor.
		{"b", "a"},      // Remove the previous first cursor node.
		{"c", "b", "a"},
		{"d", "b", "a"}, // Replace a sibling without changing array length.
		{"b", "a", "e"}, // Remove the first node and mount at the empty tail.
	} {
		order = next
		v.Refresh()
		if window.Canvas().Focused() != field || v.Object("a") != field.(fyne.CanvasObject) {
			t.Fatalf("unrelated sibling mount/removal moved the focused A subtree: %v", next)
		}
		field.TypedRune('x')
	}
	if value != "axxxxx" {
		t.Fatalf("sibling updates interrupted focused editing: %q", value)
	}
}

func TestHidingAnAncestorReleasesDescendantFocusWithoutCommit(t *testing.T) {
	display := ""
	value := ""
	commits := 0
	v := NewView(func() []Node {
		return []Node{{ID: "panel", Kind: "container", Style: Style{Display: display}, Children: []Node{
			{ID: "field", Kind: "input", Value: value, OnChange: func(s string) { value = s }, OnCommit: func(string) { commits++ }},
		}}}
	})
	window := focusMoveWindow(t, v)
	field := v.Object("field").(fyne.Focusable)
	window.Canvas().Focus(field)
	if window.Canvas().Focused() != field {
		t.Fatal("test did not establish native focus before hiding the ancestor")
	}
	field.TypedRune('x')
	display = "none"
	v.Refresh()
	if window.Canvas().Focused() != nil || commits != 0 || v.Object("field") != field.(fyne.CanvasObject) {
		t.Fatal("hidden ancestor left a focusable descendant active, committed it or remounted it")
	}
	display = ""
	v.Refresh()
	if window.Canvas().Focused() != nil || value != "x" {
		t.Fatal("showing the ancestor restored abandoned focus or discarded editor state")
	}
}
