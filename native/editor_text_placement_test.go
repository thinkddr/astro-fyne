// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/test"
)

type editorPlacementCall struct {
	style    Style
	position fyne.Position
}

type editorPlacementBackend struct {
	*editorStyleBackend
	editor, ordinary []editorPlacementCall
}

func (b *editorPlacementBackend) PlaceEditorText(text *canvas.Text, style Style, x, y float32) {
	b.editor = append(b.editor, editorPlacementCall{style, fyne.NewPos(x, y)})
	b.editorStyleBackend.PlaceText(text, style, x, y)
}

func (b *editorPlacementBackend) PlaceText(text *canvas.Text, style Style, x, y float32) {
	b.ordinary = append(b.ordinary, editorPlacementCall{style, fyne.NewPos(x, y)})
	b.editorStyleBackend.PlaceText(text, style, x, y)
}

func TestEditorTextPlacementIsOptionalAndKeepsLogicalGeometry(t *testing.T) {
	test.NewTempApp(t)
	backend := &editorPlacementBackend{editorStyleBackend: &editorStyleBackend{Backend: responsiveTestBackend(), height: 17}}
	style := responsiveTestLeaf("edit", "input", 100).Style
	style.Opacity, style.TextAlign = 1, "center"
	editor := NewEditor(backend, false, style, nil).(*primitiveEditor)
	editor.Layout(fyne.NewPos(9.25, 16), fyne.NewSize(100, 30))
	editor.SetText("ab")
	editor.FocusGained()
	editor.anchor = 0
	editor.Refresh()
	renderer := test.WidgetRenderer(editor.canvas).(*editorRenderer)
	if len(backend.editor) == 0 || len(backend.ordinary) != 0 {
		t.Fatal("single-line editor did not select its optional text placement")
	}
	call := backend.editor[len(backend.editor)-1]
	if call.style.LineHeight != 17 || call.style.Height != style.Height || call.position != fyne.NewPos(40, 6.5) ||
		renderer.lines[0].Position() != call.position || renderer.lines[0].Size() != fyne.NewSize(20, 17) ||
		renderer.cursor.Position() != fyne.NewPos(60, 6.5) || renderer.cursor.Size() != fyne.NewSize(1, 17) ||
		renderer.selection.Position() != fyne.NewPos(40, 6.5) || renderer.selection.Size() != fyne.NewSize(20, 17) ||
		editor.Object().Position() != fyne.NewPos(9.25, 16) || editor.style.LineHeight != 20 {
		t.Fatal("optional glyph placement changed used style, outer geometry, caret or selection")
	}
	editor.Tapped(&fyne.PointEvent{Position: fyne.NewPos(46, 7)})
	if editor.cursor != 1 || editor.anchor != 1 {
		t.Fatal("optional glyph placement changed logical hit testing")
	}
	editor.SetText("")
	editor.SetPlaceholder("Hint")
	if renderer.lines[0].Text != "Hint" || renderer.lines[0].Position().Y != 6.5 || backend.editor[len(backend.editor)-1].style.LineHeight != 17 {
		t.Fatal("placeholder did not use the same optional placement and line style")
	}

	backend.editor, backend.ordinary = nil, nil
	multiline := NewEditor(backend, true, style, nil).(*primitiveEditor)
	multiline.Layout(fyne.NewPos(0, 0), fyne.NewSize(100, 60))
	multiline.SetText("a\nb")
	if len(backend.editor) != 0 || len(backend.ordinary) == 0 {
		t.Fatal("multiline editor unexpectedly selected single-line glyph placement")
	}
	for _, call := range backend.ordinary {
		if call.style.LineHeight != 20 {
			t.Fatal("multiline placement changed its authored line height")
		}
	}

	legacyBackend := &editorStyleBackend{Backend: responsiveTestBackend(), height: 17}
	legacy := NewEditor(legacyBackend, false, style, nil).(*primitiveEditor)
	legacy.Layout(fyne.NewPos(0, 0), fyne.NewSize(100, 30))
	legacy.SetText("ab")
	legacyRenderer := test.WidgetRenderer(legacy.canvas).(*editorRenderer)
	if legacyRenderer.lines[0].Position() != fyne.NewPos(40, 6.5) {
		t.Fatal("backend without optional placement changed its ordinary text geometry")
	}
	seen := false
	for _, call := range legacyBackend.calls {
		seen = seen || call.kind == "place"
	}
	if !seen {
		t.Fatal("backend without optional placement did not call PlaceText")
	}
}
