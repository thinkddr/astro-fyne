// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"image/color"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
)

type attachedViewWidget struct {
	*View
	rendererCalls int
}

func (w *attachedViewWidget) CreateRenderer() fyne.WidgetRenderer {
	if w.View == nil {
		panic("owner renderer was called before the View was attached")
	}
	w.rendererCalls++
	return w.View.CreateRenderer()
}

func TestExtendingWidgetOwnsInitialFocusAndRefreshWithoutRendererPrewarm(t *testing.T) {
	var owner *attachedViewWidget
	attached := 0
	value := ""
	swapped := false
	v := NewViewForWidget(func(view *View) fyne.Widget {
		attached++
		owner = &attachedViewWidget{View: view}
		return owner
	}, func() []Node {
		if owner == nil || owner.View == nil || owner.View.owner != owner {
			t.Fatal("initial builder ran before the owner was fully attached and bound")
		}
		if swapped {
			return []Node{{ID: "new-panel", Kind: "container", Children: []Node{{ID: "new-text", Kind: "text", Text: value}}}}
		}
		return []Node{{ID: "panel", Kind: "container", Children: []Node{
			{ID: "field", Kind: "input", Value: value, OnChange: func(text string) { value = text }},
			{ID: "swap", Kind: "button", Text: "Replace root", OnTap: func() { swapped = true }},
		}}}
	})
	if v.Error() != nil || attached != 1 || owner.View != v || owner.rendererCalls != 0 {
		t.Fatalf("invalid factory lifecycle: error=%v attaches=%d renderer calls=%d", v.Error(), attached, owner.rendererCalls)
	}
	window := test.NewWindow(owner)
	t.Cleanup(window.Close)
	window.SetPadded(false)
	window.Resize(fyne.NewSize(320, 240))
	if err := v.BindCanvas(window.Canvas()); err != nil {
		t.Fatal(err)
	}
	field := v.Object("field").(fyne.Focusable)
	window.Canvas().Focus(field)
	if window.Canvas().Focused() != field {
		t.Fatal("the attached generated widget was not traversable by Fyne's focus manager on its first frame")
	}
	field.TypedRune('x')
	if value != "x" || window.Canvas().Focused() != field || v.Object("field") != field.(fyne.CanvasObject) {
		t.Fatal("controlled input refresh changed its focus owner, cursor or object")
	}
	// Inspect the genuine renderer after establishing focus, without using
	// WidgetRenderer as an artificial prewarm before the first Focus call.
	renderer := test.WidgetRenderer(owner)
	if len(renderer.Objects()) != 1 || renderer.Objects()[0] != v.Object("panel") {
		t.Fatal("the extending widget's renderer does not contain the actual initial root")
	}
	v.Object("swap").(fyne.Tappable).Tapped(nil)
	if v.Error() != nil {
		t.Fatal(v.Error())
	}
	if test.WidgetRenderer(owner) != renderer || owner.rendererCalls != 1 {
		t.Fatal("refresh created a second owner renderer rather than refreshing the existing one")
	}
	if len(renderer.Objects()) != 1 || renderer.Objects()[0] != v.Object("new-panel") || v.Object("panel") != nil {
		t.Fatal("the owner's renderer retained a stale root after a native callback replaced the tree")
	}
	if window.Canvas().Focused() != nil {
		t.Fatal("the owner retained focus on an editor removed from its renderer tree")
	}
}

func TestExtendingWidgetPaintsReplacedRootsOnTheSameSoftwareCanvas(t *testing.T) {
	var owner *attachedViewWidget
	red := true
	v := NewViewForWidget(func(view *View) fyne.Widget { owner = &attachedViewWidget{View: view}; return owner }, func() []Node {
		id, background := "red", "#ff0000"
		if !red {
			id, background = "blue", "#0000ff"
		}
		return []Node{{ID: id, Kind: "container", Style: Style{Width: 32, Height: 24, Background: background}}}
	})
	canvas := software.NewCanvas()
	canvas.SetPadded(false)
	canvas.SetContent(owner)
	canvas.Resize(fyne.NewSize(32, 24))
	if err := v.BindCanvas(canvas); err != nil {
		t.Fatal(err)
	}
	first := canvas.Capture()
	if rgba(first.At(8, 8)) != (color.NRGBA{R: 255, A: 255}) {
		t.Fatal("the initial extending widget did not paint its real native red root")
	}
	red = false
	v.Refresh()
	second := canvas.Capture()
	if rgba(second.At(8, 8)) != (color.NRGBA{B: 255, A: 255}) || owner.rendererCalls != 1 {
		t.Fatal("the extending widget painted its stale red renderer after its root changed to blue")
	}
}

func TestExtendingWidgetFactoryRejectsNilOwnersBeforeEvaluatingTheBuilder(t *testing.T) {
	built := 0
	build := func() []Node { built++; return []Node{{ID: "root", Kind: "container"}} }
	for _, attach := range []func(*View) fyne.Widget{
		nil,
		func(*View) fyne.Widget { return nil },
		func(*View) fyne.Widget { return (*attachedViewWidget)(nil) },
	} {
		v := NewViewForWidget(attach, build)
		if v.Error() == nil || v.Object("root") != nil {
			t.Fatal("an invalid attachment factory did not return an explicit empty-view error")
		}
	}
	if built != 0 {
		t.Fatal("a builder ran without a valid native widget owner")
	}
	plain := NewView(build)
	if plain.Error() != nil || plain.owner != plain || plain.Object("root") == nil || built != 1 {
		t.Fatal("the normal NewView constructor lost its own widget ownership")
	}
}
