// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"reflect"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
)

func pointerTestWindow(t *testing.T, v *View) fyne.Window {
	t.Helper()
	w := test.NewWindow(v)
	t.Cleanup(w.Close)
	w.SetPadded(false)
	w.Resize(fyne.NewSize(280, 300))
	if err := v.BindCanvas(w.Canvas()); err != nil {
		t.Fatal(err)
	}
	test.WidgetRenderer(v)
	for _, e := range v.elements {
		test.WidgetRenderer(e.object.(fyne.Widget))
	}
	if err := v.Error(); err != nil {
		t.Fatal(err)
	}
	return w
}

func pointerTestPoint(t *testing.T, v *View, id string, local fyne.Position) fyne.Position {
	t.Helper()
	var find func([]*element, fyne.Position) (fyne.Position, bool)
	find = func(elements []*element, origin fyne.Position) (fyne.Position, bool) {
		for _, e := range elements {
			position := origin.Add(e.object.Position())
			if e.node.ID == id {
				return position.Add(local), true
			}
			if point, ok := find(e.children, position); ok {
				return point, true
			}
		}
		return fyne.Position{}, false
	}
	point, ok := find(v.roots, v.Position())
	if !ok {
		t.Fatalf("pointer target %q is missing", id)
	}
	return point
}

func TestPointerCanvasSelectsOneNativeContainerOrTextTarget(t *testing.T) {
	events := []string{}
	v := NewView(func() []Node {
		return []Node{{ID: "root", Kind: "container", Style: Style{Height: 200, PaddingTop: 20, PaddingLeft: 20}, OnTap: func() { events = append(events, "root") }, Children: []Node{
			{ID: "caption", Kind: "text", Text: "Caption", Style: Style{Height: 28}, OnTap: func() { events = append(events, "caption") }},
			{ID: "inner", Kind: "container", Style: Style{Height: 80, PaddingTop: 12, PaddingLeft: 12}, OnTap: func() { events = append(events, "inner") }, Children: []Node{
				{ID: "raw-text", Kind: "text", Text: "Raw text", Style: Style{Height: 24}, OnTap: func() { events = append(events, "raw-owner") }},
			}},
		}}}
	})
	w := pointerTestWindow(t, v)
	root, caption, inner, raw := v.Object("root"), v.Object("caption"), v.Object("inner"), v.Object("raw-text")
	for _, target := range []struct {
		id    string
		point fyne.Position
	}{
		{"root", fyne.NewPos(4, 4)},
		{"caption", fyne.NewPos(4, 12)},
		{"inner", fyne.NewPos(4, 4)},
		{"raw-text", fyne.NewPos(4, 12)},
	} {
		test.TapCanvas(w.Canvas(), pointerTestPoint(t, v, target.id, target.point))
	}
	if !reflect.DeepEqual(events, []string{"root", "caption", "inner", "raw-owner"}) {
		t.Fatalf("native hit traversal duplicated or retargeted an entry: %v", events)
	}
	if root != v.Object("root") || caption != v.Object("caption") || inner != v.Object("inner") || raw != v.Object("raw-text") {
		t.Fatal("pointer refresh replaced stable native objects")
	}
}

func TestPointerFreeManualNodesStayOutsideHitTesting(t *testing.T) {
	v := NewView(func() []Node {
		return []Node{{ID: "root", Kind: "container", Children: []Node{{ID: "caption", Kind: "text", Text: "Text"}}}}
	})
	for _, id := range []string{"root", "caption"} {
		if _, ok := v.Object(id).(fyne.Tappable); ok {
			t.Fatalf("manual node %q became a pointer interceptor without a callback", id)
		}
	}
}

func TestDisabledPointerControlsBlockTheEnclosingContainer(t *testing.T) {
	rootCalls, controlCalls := 0, 0
	v := NewView(func() []Node {
		return []Node{{ID: "root", Kind: "container", Style: Style{PaddingTop: 16, Height: 260}, OnTap: func() { rootCalls++ }, Children: []Node{
			{ID: "button", Kind: "button", Text: "Disabled button", Disabled: true, OnTap: func() { controlCalls++ }},
			{ID: "input", Kind: "input", Value: "Disabled field", Disabled: true, OnTap: func() { controlCalls++ }},
			{ID: "textarea", Kind: "textarea", Value: "Disabled multiline", Disabled: true, OnTap: func() { controlCalls++ }},
			{ID: "checkbox", Kind: "checkbox", Disabled: true, OnChecked: func(bool) { controlCalls++ }},
		}}}
	})
	w := pointerTestWindow(t, v)
	for _, id := range []string{"button", "input", "textarea", "checkbox"} {
		test.TapCanvas(w.Canvas(), pointerTestPoint(t, v, id, fyne.NewPos(4, 4)))
	}
	if rootCalls != 0 || controlCalls != 0 || w.Canvas().Focused() != nil {
		t.Fatalf("disabled target fell through or activated: root=%d controls=%d focus=%T", rootCalls, controlCalls, w.Canvas().Focused())
	}
	test.TapCanvas(w.Canvas(), pointerTestPoint(t, v, "root", fyne.NewPos(4, 4)))
	if rootCalls != 1 {
		t.Fatal("the enclosing target was not active outside its disabled controls")
	}
}

func TestInputPointerKeepsFocusAndCaretBeforeOneClick(t *testing.T) {
	for _, kind := range []string{"input", "textarea"} {
		t.Run(kind, func(t *testing.T) {
			value, clicks := "ab", 0
			var v *View
			var w fyne.Window
			v = NewView(func() []Node {
				return []Node{{ID: "field", Kind: kind, Value: value,
					OnChange: func(next string) { value = next },
					OnTap: func() {
						clicks++
						field := v.Object("field").(*inputWidget)
						if w.Canvas().Focused() != field || field.element.input.(*primitiveEditor).cursor != 0 {
							t.Error("click ran before focus and caret placement")
						}
					},
				}}
			})
			w = pointerTestWindow(t, v)
			field := v.Object("field").(*inputWidget)
			style := field.element.style
			test.TapCanvas(w.Canvas(), pointerTestPoint(t, v, "field", fyne.NewPos(style.PaddingLeft+style.BorderWidth, style.PaddingTop+style.BorderWidth+10)))
			field.TypedRune('X')
			if clicks != 1 || value != "Xab" || v.Object("field") != field || w.Canvas().Focused() != field {
				t.Fatalf("input click changed state or identity: clicks=%d value=%q focus=%T", clicks, value, w.Canvas().Focused())
			}
		})
	}
}

func TestInputPointerRevalidatesRemovalOrDisableDuringBlur(t *testing.T) {
	for _, remove := range []bool{false, true} {
		t.Run(String(remove), func(t *testing.T) {
			value, changed, clicks := "a", false, 0
			v := NewView(func() []Node {
				children := []Node{{ID: "first", Kind: "input", Value: value,
					OnChange: func(next string) { value = next }, OnCommit: func(string) { changed = true },
				}}
				if !changed || !remove {
					children = append(children, Node{ID: "target", Kind: "input", Disabled: changed, OnTap: func() { clicks++ }})
				}
				return []Node{{ID: "root", Kind: "container", Children: children}}
			})
			w := pointerTestWindow(t, v)
			first := v.Object("first").(*inputWidget)
			target := v.Object("target").(*inputWidget)
			test.TapCanvas(w.Canvas(), pointerTestPoint(t, v, "first", fyne.NewPos(16, 14)))
			first.TypedRune('x')
			point := pointerTestPoint(t, v, "target", fyne.NewPos(16, 14))
			test.TapCanvas(w.Canvas(), point)
			if !changed || clicks != 0 || w.Canvas().Focused() == target {
				t.Fatalf("blur activated a disabled or detached field: changed=%v clicks=%d focus=%T", changed, clicks, w.Canvas().Focused())
			}
		})
	}
}

func TestRetainedPointerObjectsAreInertAfterRemoval(t *testing.T) {
	for _, kind := range []string{"container", "text", "label", "button", "input", "textarea", "checkbox", "link"} {
		t.Run(kind, func(t *testing.T) {
			present, clicks := true, 0
			v := NewView(func() []Node {
				children := []Node{}
				if present {
					n := Node{ID: "target", Kind: kind, Style: Style{Height: 32}}
					if kind == "checkbox" {
						n.Style, n.OnChecked = Style{}, func(bool) { clicks++ }
					} else {
						n.OnTap = func() { clicks++ }
					}
					children = append(children, n)
				}
				return []Node{{ID: "root", Kind: "container", Style: Style{Height: 80}, Children: children}}
			})
			w := pointerTestWindow(t, v)
			retained := v.Object("target").(fyne.Tappable)
			test.TapCanvas(w.Canvas(), pointerTestPoint(t, v, "target", fyne.NewPos(4, 4)))
			if clicks != 1 {
				t.Fatalf("live pointer target did not activate exactly once: %d", clicks)
			}
			present = false
			v.Refresh()
			retained.Tapped(nil)
			if clicks != 1 || v.Object("target") != nil || w.Canvas().Focused() != nil {
				t.Fatalf("a retained detached object stayed active: clicks=%d focus=%T", clicks, w.Canvas().Focused())
			}
		})
	}
}

func TestRetainedResponsivePointerDoesNotBlurTheCurrentEditor(t *testing.T) {
	present, value, clicks, commits := true, "a", 0, 0
	v := NewView(func() []Node {
		field := responsiveTestLeaf("field", "input", 140)
		field.Value = value
		field.OnChange = func(next string) { value = next }
		field.OnCommit = func(string) { commits++ }
		children := []Node{field}
		if present {
			button := responsiveTestLeaf("target", "button", 100)
			button.Text, button.OnTap = "Old target", func() { clicks++ }
			children = append(children, button)
		}
		return []Node{flexTestRoot(64, children...)}
	}, responsiveTestBackend())
	w := responsiveTestWindow(t, v)
	retained := v.Object("target").(fyne.Tappable)
	present = false
	v.Refresh()
	field := v.Object("field").(*inputWidget)
	w.Canvas().Focus(field)
	field.TypedRune('x')
	if w.Canvas().Focused() != field || value != "ax" {
		t.Fatal("fixture did not establish a dirty live editor")
	}
	retained.Tapped(nil)
	if clicks != 0 || commits != 0 || w.Canvas().Focused() != field || value != "ax" {
		t.Fatalf("detached responsive button changed live focus or state: clicks=%d commits=%d focus=%T", clicks, commits, w.Canvas().Focused())
	}
}

func TestPointerTargetsRespectHiddenAncestors(t *testing.T) {
	hidden, clicks := false, 0
	v := NewView(func() []Node {
		parent := Node{ID: "parent", Kind: "container", Style: Style{Height: 240}}
		if hidden {
			parent.Style.Display = "none"
		}
		for _, kind := range []string{"container", "text", "label", "button", "input", "textarea", "checkbox", "link"} {
			n := Node{ID: kind, Kind: kind, Style: Style{Height: 24}, OnTap: func() { clicks++ }}
			if kind == "checkbox" {
				n.Style, n.OnTap, n.OnChecked = Style{}, nil, func(bool) { clicks++ }
			}
			parent.Children = append(parent.Children, n)
		}
		return []Node{{ID: "root", Kind: "container", Style: Style{Height: 280}, Children: []Node{parent}}}
	})
	w := pointerTestWindow(t, v)
	retained := map[string]fyne.Tappable{}
	for _, kind := range []string{"container", "text", "label", "button", "input", "textarea", "checkbox", "link"} {
		retained[kind] = v.Object(kind).(fyne.Tappable)
	}
	point := pointerTestPoint(t, v, "text", fyne.NewPos(4, 4))
	test.TapCanvas(w.Canvas(), point)
	if clicks != 1 {
		t.Fatal("visible descendant did not activate")
	}
	hidden = true
	v.Refresh()
	if err := v.Error(); err != nil {
		t.Fatal(err)
	}
	for kind, target := range retained {
		if v.Object(kind) != target.(fyne.CanvasObject) || !v.Object(kind).Visible() || v.elements[kind].pointerAttached() {
			t.Fatal("hidden ancestor did not retain an inactive child", kind)
		}
		target.Tapped(nil)
	}
	test.TapCanvas(w.Canvas(), point)
	if clicks != 1 || w.Canvas().Focused() != nil {
		t.Fatalf("hidden ancestor allowed activation or focus: clicks=%d focus=%T", clicks, w.Canvas().Focused())
	}
}

func TestInputPointerRevalidatesAnAncestorHiddenDuringBlur(t *testing.T) {
	value, hidden, clicks := "a", false, 0
	v := NewView(func() []Node {
		parent := Node{ID: "parent", Kind: "container", Children: []Node{{ID: "target", Kind: "input", Value: "Target", OnTap: func() { clicks++ }}}}
		if hidden {
			parent.Style.Display = "none"
		}
		return []Node{{ID: "root", Kind: "container", Children: []Node{
			{ID: "first", Kind: "input", Value: value, OnChange: func(next string) { value = next }, OnCommit: func(string) { hidden = true }},
			parent,
		}}}
	})
	w := pointerTestWindow(t, v)
	first, target := v.Object("first").(*inputWidget), v.Object("target").(*inputWidget)
	test.TapCanvas(w.Canvas(), pointerTestPoint(t, v, "first", fyne.NewPos(16, 14)))
	first.TypedRune('x')
	point := pointerTestPoint(t, v, "target", fyne.NewPos(16, 14))
	test.TapCanvas(w.Canvas(), point)
	if !hidden || clicks != 0 || v.Object("target") != target || !target.Visible() || target.element.pointerAttached() || w.Canvas().Focused() == target {
		t.Fatalf("blur activated a descendant of a hidden ancestor: hidden=%v clicks=%d focus=%T", hidden, clicks, w.Canvas().Focused())
	}
}

func TestResponsivePointerRevalidatesAnAncestorHiddenDuringFocus(t *testing.T) {
	value, clicks, commits := "a", 0, 0
	var v *View
	v = NewView(func() []Node {
		first, button := responsiveTestLeaf("first", "input", 140), responsiveTestLeaf("target", "button", 100)
		first.Value = value
		first.OnChange = func(next string) { value = next }
		first.OnCommit = func(string) {
			commits++
			v.Object("root").Hide()
		}
		button.Text, button.OnTap = "Target", func() { clicks++ }
		return []Node{flexTestRoot(64, first, button)}
	}, responsiveTestBackend())
	w := responsiveTestWindow(t, v)
	v.SetAutoRefreshEvents(false)
	first, target := v.Object("first").(*inputWidget), v.Object("target").(*actionWidget)
	w.Canvas().Focus(first)
	first.TypedRune('x')
	// Keep focus until the button's own focus step commits the preceding field.
	target.Tapped(nil)
	if commits != 1 || clicks != 0 || v.Object("root").Visible() || !target.Visible() || target.element.pointerAttached() || w.Canvas().Focused() == target {
		t.Fatalf("responsive focus activated a target hidden by blur: commits=%d clicks=%d focus=%T", commits, clicks, w.Canvas().Focused())
	}
}

func TestPointerParentLinksCommitOnlyAfterFullAdmission(t *testing.T) {
	stage := 0
	v := NewView(func() []Node {
		target := Node{ID: "target", Identity: "target", Kind: "text", Text: "Retained", OnTap: func() {}}
		left, right := Node{ID: "left", Kind: "container"}, Node{ID: "right", Kind: "container"}
		if stage == 1 {
			right.Children = []Node{target}
		} else {
			left.Children = []Node{target}
		}
		children := []Node{left, right}
		if stage == 2 {
			children = append(children, Node{ID: "opaque", Kind: "input", OnTap: func() {}})
		}
		return []Node{{ID: "root", Kind: "container", Children: children}}
	}, opaquePointerBackend{})
	pointerTestWindow(t, v)
	target, left, right := v.elements["target"], v.elements["left"], v.elements["right"]
	if target.parent != left || !target.pointerAttached() {
		t.Fatal("initial pointer parent was not committed")
	}
	stage = 1
	v.Refresh()
	if err := v.Error(); err != nil {
		t.Fatal(err)
	}
	if v.elements["target"] != target || target.parent != right || !target.pointerAttached() {
		t.Fatal("successful reparenting changed identity or retained the old parent")
	}
	stage = 2
	v.Refresh()
	if v.Error() == nil || !strings.Contains(v.Error().Error(), "shared NewEditor factory") || v.elements["target"] != target || target.parent != right || len(left.children) != 0 || len(right.children) != 1 || right.children[0] != target {
		t.Fatal("failed admission partly changed the committed parent chain")
	}
	right.object.Hide()
	if target.pointerAttached() {
		t.Fatal("a failed reparent changed the ancestor used for pointer visibility")
	}
}

type opaquePointerEditor struct{ Editor }
type opaquePointerBackend struct{ FyneBackend }

func (b opaquePointerBackend) Editor(multiline bool, style Style, changed func(string)) Editor {
	return opaquePointerEditor{NewEditor(b.FyneBackend, multiline, style, changed)}
}

func TestPointerInputRejectsOpaqueEditorsBeforeChangingTheTree(t *testing.T) {
	pointer := false
	v := NewView(func() []Node {
		n := Node{ID: "field", Kind: "input", Value: "Before", Style: Style{Height: 36}}
		if pointer {
			n.Value, n.Style.Height, n.OnTap = "After", 80, func() {}
		}
		return []Node{n}
	}, opaquePointerBackend{})
	pointerTestWindow(t, v)
	field := v.Object("field")
	before := v.elements["field"].node
	pointer = true
	v.Refresh()
	if v.Error() == nil || !strings.Contains(v.Error().Error(), "shared NewEditor factory") || v.Object("field") != field || v.elements["field"].node.Value != before.Value || v.elements["field"].node.Style.Height != before.Style.Height {
		t.Fatalf("opaque editor pointer admission changed the last valid tree: %v", v.Error())
	}
	initial := NewView(func() []Node { return []Node{{ID: "field", Kind: "input", OnTap: func() {}}} }, opaquePointerBackend{})
	if initial.Error() == nil || len(initial.elements) != 0 {
		t.Fatal("an opaque initial pointer editor was accepted")
	}
}
