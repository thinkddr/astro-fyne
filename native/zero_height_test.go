// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
)

type zeroHeightBackend struct{ FyneBackend }

func (b zeroHeightBackend) Defaults(node Node) Style {
	s := b.FyneBackend.Defaults(node)
	if node.Kind == "container" {
		s.Height = 17
	}
	return s
}

type decoratedZeroBackend struct {
	FyneBackend
	decoration Style
}

func (b decoratedZeroBackend) Defaults(node Node) Style {
	s := b.FyneBackend.Defaults(node)
	if node.Kind == "container" {
		s.Width, s.Radius = b.decoration.Width, b.decoration.Radius
		s.PaddingLeft, s.PaddingRight = b.decoration.PaddingLeft, b.decoration.PaddingRight
		s.BorderColor, s.BorderWidth = b.decoration.BorderColor, b.decoration.BorderWidth
	}
	return s
}

func TestZeroHeightRejectsDecoratedBackendDefaultsBeforeCommit(t *testing.T) {
	for _, decoration := range []Style{
		{Width: 9}, {Radius: 3}, {PaddingLeft: 2, PaddingRight: 2},
		{BorderColor: "#112233", BorderWidth: 1},
	} {
		style := Style{Height: 32}
		view := NewView(func() []Node { return []Node{{ID: "panel", Kind: "container", Style: style}} }, decoratedZeroBackend{decoration: decoration})
		view.Resize(fyne.NewSize(100, 100))
		object := view.Object("panel")
		beforeSize, beforeStyle := object.Size(), view.elements["panel"].style
		style = Style{Flex: &FlexStyle{HeightSet: true}}
		view.Refresh()
		if view.Error() == nil || !strings.Contains(view.Error().Error(), "backend defaults") || view.Object("panel") != object || object.Size() != beforeSize || view.elements["panel"].style != beforeStyle {
			t.Fatalf("decorated backend partly committed a zero-height frame: %+v %v", decoration, view.Error())
		}
	}
}

func TestExplicitZeroHeightSurvivesDefaultsReflowAndSnapshot(t *testing.T) {
	height := float32(0)
	view := NewView(func() []Node {
		return []Node{
			{ID: "auto", Kind: "container"},
			{ID: "panel", Kind: "container", Style: Style{Height: height, Flex: &FlexStyle{HeightSet: true}}},
			{ID: "following", Kind: "container", Style: Style{Height: 24}},
		}
	}, zeroHeightBackend{})
	canvas := software.NewCanvas()
	canvas.SetPadded(false)
	canvas.SetContent(view)
	canvas.Resize(fyne.NewSize(100, 100))
	objects := []fyne.CanvasObject{view.Object("auto"), view.Object("panel"), view.Object("following")}
	for _, next := range []float32{0, 32, 0} {
		height = next
		view.Refresh()
		canvas.Capture()
		if err := view.Error(); err != nil {
			t.Fatal(err)
		}
		if objects[0].Size().Height != 17 || objects[1].Size().Height != next || objects[1].MinSize().Height != next || objects[2].Position().Y != 17+next {
			t.Fatalf("zero/auto sizing or sibling flow changed: %v %v %v", objects[0].Size(), objects[1].Size(), objects[2].Position())
		}
		snapshot, err := view.Snapshot()
		if err != nil {
			t.Fatal(err)
		}
		for i, id := range []string{"auto", "panel", "following"} {
			if view.Object(id) != objects[i] || snapshot.Roots[i].Node.Style.Flex != nil || !snapshot.Roots[i].Node.Style.Measured || snapshot.Roots[i].Node.Style.Height != objects[i].Size().Height {
				t.Fatalf("snapshot lost used sizing or identity for %s", id)
			}
		}
	}
}

func TestUnsupportedExplicitZeroHeightPreservesCommittedTree(t *testing.T) {
	for _, invalid := range []Node{
		{Kind: "button"}, {Kind: "input"}, {Kind: "textarea"}, {Kind: "text", Text: "overflow"},
		{Kind: "container", Children: []Node{{ID: "child", Kind: "container"}}},
		{Kind: "container", Style: Style{PaddingTop: 1}},
		{Kind: "container", Style: Style{BorderWidth: 1}},
		{Kind: "container", Style: Style{BorderColor: "#112233", BorderWidth: 1}},
		{Kind: "container", Style: Style{Radius: 1}},
		{Kind: "container", Style: Style{Width: 10}},
		{Kind: "container", Style: Style{Direction: "row"}},
	} {
		current := Node{ID: "panel", Kind: "container", Style: Style{Height: 32}}
		view := NewView(func() []Node { return []Node{current} })
		view.Resize(fyne.NewSize(100, 100))
		object := view.Object("panel")
		before := object.Size()
		invalid.ID = "panel"
		invalid.Style.Flex = &FlexStyle{HeightSet: true}
		current = invalid
		view.Refresh()
		if view.Error() == nil || !strings.Contains(view.Error().Error(), "explicit zero height") || view.Object("panel") != object || object.Size() != before || view.Object("child") != nil {
			t.Fatalf("invalid zero frame partly committed: %+v %v", invalid, view.Error())
		}
		if _, err := view.Snapshot(); err == nil {
			t.Fatal("invalid zero frame was exported")
		}
	}
}

func TestZeroHeightPresenceInvalidatesIdenticalMeasuredGeometry(t *testing.T) {
	explicit := false
	view := NewView(func() []Node {
		style := Style{}
		if explicit {
			style.Flex = &FlexStyle{HeightSet: true}
		}
		return []Node{{ID: "panel", Kind: "container", Style: style}}
	})
	if err := view.ApplyMeasurements(map[string]Style{"panel": {Width: 100, Height: 0, Measured: true, Opacity: 1}}); err != nil {
		t.Fatal(err)
	}
	explicit = true
	view.Refresh()
	if view.Error() == nil || !strings.Contains(view.Error().Error(), "visual state changed") {
		t.Fatalf("presence was omitted from the measurement fingerprint: %v", view.Error())
	}
}
