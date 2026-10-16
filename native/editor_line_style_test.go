// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"fmt"
	"reflect"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/test"
)

type editorStyleCall struct {
	kind  string
	style Style
}

type editorStyleBackend struct {
	Backend
	height float32
	fail   bool
	calls  []editorStyleCall
}

func (b *editorStyleBackend) EditorLineStyle(s Style) (Style, error) {
	if b.fail {
		return Style{}, fmt.Errorf("editor metrics unavailable")
	}
	s.LineHeight = b.height
	return s, nil
}
func (b *editorStyleBackend) Editor(multiline bool, s Style, change func(string)) Editor {
	return NewEditor(b, multiline, s, change)
}
func (b *editorStyleBackend) Validate(s Style, text bool) error {
	if text {
		b.calls = append(b.calls, editorStyleCall{"validate", s})
	}
	return b.Backend.Validate(s, text)
}
func (b *editorStyleBackend) ValidateText(text string, s Style) error {
	b.calls = append(b.calls, editorStyleCall{"glyphs", s})
	return b.Backend.(TextValidator).ValidateText(text, s)
}
func (b *editorStyleBackend) Measure(text string, s Style) fyne.Size {
	b.calls = append(b.calls, editorStyleCall{"measure", s})
	advance := float32(100)
	if s.LineHeight == b.height {
		advance = 10
	}
	return fyne.NewSize(float32(len([]rune(text)))*advance, s.LineHeight)
}
func (b *editorStyleBackend) Text(text string, s Style) *canvas.Text {
	b.calls = append(b.calls, editorStyleCall{"text", s})
	return b.Backend.Text(text, s)
}
func (b *editorStyleBackend) PlaceText(text *canvas.Text, s Style, x, y float32) {
	b.calls = append(b.calls, editorStyleCall{"place", s})
	text.Move(fyne.NewPos(x, y))
	text.Resize(b.Measure(text.Text, s))
}

func TestEditorInternalLineBoxDrivesTextCaretSelectionAndHitTesting(t *testing.T) {
	test.NewTempApp(t)
	backend := &editorStyleBackend{Backend: responsiveTestBackend(), height: 17}
	style := responsiveTestLeaf("edit", "input", 100).Style
	style.Opacity = 1
	editor := NewEditor(backend, false, style, nil).(*primitiveEditor)
	editor.Layout(fyne.NewPos(0, 0), fyne.NewSize(100, 30))
	editor.SetText("ab")
	editor.FocusGained()
	editor.anchor = 0
	editor.Refresh()
	renderer := test.WidgetRenderer(editor.canvas).(*editorRenderer)
	if editor.style.LineHeight != 20 || renderer.style.LineHeight != 17 || renderer.MinSize().Height != 17 {
		t.Fatal("editor replaced the authored outer line box or retained it internally")
	}
	if renderer.lines[0].Position().Y != 6.5 || renderer.cursor.Position().Y != 6.5 || renderer.cursor.Size().Height != 17 ||
		renderer.selection.Position().Y != 6.5 || renderer.selection.Size() != fyne.NewSize(20, 17) {
		t.Fatal("text, caret and selection did not share the internal line box")
	}
	editor.Tapped(&fyne.PointEvent{Position: fyne.NewPos(6, 7)})
	if editor.cursor != 1 || editor.anchor != 1 {
		t.Fatal("hit testing measured prefixes with the authored rather than internal style")
	}
	editor.SetPlaceholder("Hint")
	editor.SetText("")
	if renderer.lines[0].Text != "Hint" || renderer.lines[0].Position().Y != 6.5 {
		t.Fatal("placeholder text did not share the internal line box")
	}
	for _, call := range backend.calls {
		if call.style.LineHeight != 17 {
			t.Fatalf("%s used a different line box: %v", call.kind, call.style.LineHeight)
		}
	}
	previous := renderer.lines[0]
	backend.fail = true
	editor.Refresh()
	if editor.lineStyleErr == nil || renderer.lines[0] != previous || renderer.style.LineHeight != 17 {
		t.Fatal("unavailable metrics replaced the last valid editor rendering")
	}
	backend.fail = false
	editor.Refresh()
	if editor.lineStyleErr != nil || renderer.lines[0] == previous {
		t.Fatal("successful metrics refresh did not recover its own failure")
	}
	editor.editErr = fmt.Errorf("rejected edit remains pending")
	editor.Refresh()
	if editor.editErr == nil {
		t.Fatal("a metrics refresh erased a rejected edit")
	}
	legacy := NewEditor(responsiveTestBackend(), false, style, nil).(*primitiveEditor)
	legacy.Layout(fyne.NewPos(0, 0), fyne.NewSize(100, 30))
	legacy.SetText("ab")
	if test.WidgetRenderer(legacy.canvas).(*editorRenderer).style.LineHeight != 20 {
		t.Fatal("backend without the optional seam changed editor behavior")
	}
}

func TestEditorUsedStylePreflightPreservesLastFrameOnMetricsAndFitErrors(t *testing.T) {
	backend := &editorStyleBackend{Backend: responsiveTestBackend(), height: 17}
	field := responsiveTestLeaf("edit", "input", 100)
	field.Value, field.Placeholder = "ab", "Hint"
	v := NewView(func() []Node { return []Node{flexTestRoot(64, field)} }, backend)
	w := responsiveTestWindow(t, v)
	w.Canvas().Capture()
	object := v.Object("edit")
	if v.elements["edit"].style.LineHeight != 20 {
		t.Fatal("preflight rewrote the authored outer style")
	}
	seen := map[string]bool{}
	for _, call := range backend.calls {
		seen[call.kind] = true
		if call.style.LineHeight != 17 || call.style.Opacity != 1 {
			t.Fatalf("%s did not use the resolved internal paint style", call.kind)
		}
	}
	for _, kind := range []string{"validate", "glyphs", "measure", "text", "place"} {
		if !seen[kind] {
			t.Fatalf("missing real editor operation %s", kind)
		}
	}
	before := v.elements["edit"].node
	backend.fail = true
	field.Value = "changed"
	v.Refresh()
	if v.Error() == nil || v.Object("edit") != object || !reflect.DeepEqual(v.elements["edit"].node, before) {
		t.Fatal("unavailable metrics changed the last valid native frame")
	}
	backend.fail, backend.height = false, 40
	v.Refresh()
	if v.Error() == nil || v.Object("edit") != object || v.elements["edit"].input.Text() != "ab" {
		t.Fatal("internal-height overflow bypassed preflight or changed pending text")
	}
	backend.height = 17
	field.Value = "ab"
	v.Refresh()
	if v.Error() != nil || v.Object("edit") != object {
		t.Fatalf("valid editor style did not recover: %v", v.Error())
	}
}
