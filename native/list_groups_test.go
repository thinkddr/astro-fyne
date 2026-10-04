// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"testing"

	"fyne.io/fyne/v2"
)

func TestSiblingListGroupsReconcileMovementIndependently(t *testing.T) {
	for _, focused := range []string{"X", "Z"} {
		t.Run(focused, func(t *testing.T) {
			updated := false
			v := NewView(func() []Node {
				left, right := []string{}, []string{"X", "Y", "Z"}
				if updated {
					left, right = []string{"A"}, []string{"Z", "X"}
				}
				rows := func(keys []string) []Node {
					nodes := make([]Node, 0, len(keys))
					for _, key := range keys {
						nodes = append(nodes, Node{ID: "row-" + key, Identity: "row/" + key, Kind: "container", Children: []Node{
							{ID: key, Identity: "input/" + key, Kind: "input", Value: key},
						}})
					}
					return nodes
				}
				children := []Node{{ID: "update", Identity: "update", Kind: "button", Text: "Update", OnTap: func() { updated = true }}}
				children = append(children, GroupList(rows(left), "left-site")...)
				children = append(children, GroupList(rows(right), "right-site")...)
				return []Node{{ID: "main", Identity: "main", Kind: "container", Children: children}}
			})
			window := focusMoveWindow(t, v)
			originalX, originalZ := v.Object("X"), v.Object("Z")
			field := v.Object(focused).(fyne.Focusable)
			window.Canvas().Focus(field)
			if window.Canvas().Focused() != field {
				t.Fatal("test did not establish focus before the simultaneous list update")
			}
			// Match the browser's programmatic .click(): the activation itself
			// must not blur the input before reconciliation can decide movement.
			v.Object("update").(fyne.Tappable).Tapped(nil)
			if v.Error() != nil {
				t.Fatal(v.Error())
			}
			if v.Object("X") != originalX || v.Object("Z") != originalZ || v.Object("A") == nil || v.Object("Y") != nil {
				t.Fatal("independent list updates remounted retained rows or failed to mount/unmount rows")
			}
			if focused == "X" {
				if window.Canvas().Focused() != field {
					t.Fatal("flattening left/right list diffs moved stationary X instead of Z")
				}
			} else if window.Canvas().Focused() != nil {
				t.Fatal("moving Z within the right Fragment failed to clear descendant focus")
			}
			if v.elements["row-X"].node.ListGroup != "right-site" || v.elements["X"].node.ListGroup != "" {
				t.Fatal("group metadata belongs to physical roots, not descendant inputs")
			}
		})
	}
}

func TestGroupListPreservesDescendantGroupsAndRejectsFlattenedNestedBoundaries(t *testing.T) {
	nodes := []Node{{ID: "outer", Kind: "container", Children: GroupList([]Node{{ID: "inner", Kind: "input"}}, "inner-site")}}
	nodes = GroupList(nodes, "outer-site")
	if nodes[0].ListGroup != "outer-site" || nodes[0].Children[0].ListGroup != "inner-site" {
		t.Fatal("outer list tagging replaced a descendant list's independent boundary")
	}
	for _, group := range []string{"", string([]byte{0xff})} {
		v := NewView(func() []Node { return GroupList([]Node{{ID: "root", Kind: "container"}}, group) })
		if v.Error() == nil || v.Object("root") != nil {
			t.Fatal("invalid list group was not rejected at the recoverable builder boundary")
		}
	}
	fail := false
	v := NewView(func() []Node {
		result := GroupList([]Node{{ID: "root", Identity: "root", Kind: "container"}}, "inner-site")
		if fail {
			return GroupList(result, "outer-site")
		}
		return result
	})
	root := v.Object("root")
	fail = true
	v.Refresh()
	if v.Error() == nil || v.Object("root") != root {
		t.Fatal("flattened nested Fragment boundaries silently lost metadata or replaced the last valid frame")
	}
}

func TestChangingListBoundaryRemountsInsteadOfReusingAnotherFragmentsInput(t *testing.T) {
	group := "left-site"
	v := NewView(func() []Node { return GroupList([]Node{{ID: "field", Identity: "input", Kind: "input"}}, group) })
	window := focusMoveWindow(t, v)
	field := v.Object("field").(fyne.Focusable)
	window.Canvas().Focus(field)
	if window.Canvas().Focused() != field {
		t.Fatal("test did not establish native focus before changing the Fragment boundary")
	}
	group = "right-site"
	v.Refresh()
	if v.Object("field") == field.(fyne.CanvasObject) || window.Canvas().Focused() != nil {
		t.Fatal("moving a source identity to another Fragment reused its old editor or stale focus")
	}
}
