// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"fmt"
	"reflect"
	"testing"

	"fyne.io/fyne/v2/canvas"
)

type responsiveResolvedTextCall struct {
	text  string
	style Style
}

type responsiveResolvedStyleBackend struct {
	Backend
	validated []Style
	glyphs    []responsiveResolvedTextCall
	placed    []Style
}

func (b *responsiveResolvedStyleBackend) Validate(style Style, text bool) error {
	b.validated = append(b.validated, style)
	if style.Opacity != 1 {
		return fmt.Errorf("text validator received unresolved opacity %v", style.Opacity)
	}
	return b.Backend.Validate(style, text)
}

func (b *responsiveResolvedStyleBackend) ValidateText(text string, style Style) error {
	b.glyphs = append(b.glyphs, responsiveResolvedTextCall{text, style})
	if style.Opacity != 1 {
		return fmt.Errorf("glyph validator received unresolved opacity %v", style.Opacity)
	}
	return b.Backend.(TextValidator).ValidateText(text, style)
}

func (b *responsiveResolvedStyleBackend) PlaceText(text *canvas.Text, style Style, x, y float32) {
	b.placed = append(b.placed, style)
	b.Backend.PlaceText(text, style, x, y)
}

func TestResponsiveBackendPreflightUsesTheActualPaintStyle(t *testing.T) {
	backend := &responsiveResolvedStyleBackend{Backend: responsiveTestBackend()}
	leaf := responsiveTestLeaf("caption", "text", 100)
	leaf.Text = "Opacity"
	if leaf.Style.Opacity != 0 {
		t.Fatal("the regression must use omitted source opacity")
	}
	v := NewView(func() []Node { return []Node{flexTestRoot(64, leaf)} }, backend)
	if err := v.Error(); err != nil {
		t.Fatalf("omitted source opacity did not reach its opaque default: %v", err)
	}
	w := responsiveTestWindow(t, v)
	w.Canvas().Capture()
	if err := v.Error(); err != nil {
		t.Fatal(err)
	}
	expected := v.elements["caption"].style
	if expected.Opacity != 1 || expected.Color != "#112233" || len(backend.validated) == 0 || len(backend.glyphs) == 0 || len(backend.placed) == 0 {
		t.Fatal("the real source frame did not validate and place its opaque text")
	}
	for _, styles := range [][]Style{backend.validated, backend.placed} {
		for _, style := range styles {
			if !reflect.DeepEqual(style, expected) {
				t.Fatalf("validation and native placement used different styles: got %+v want %+v", style, expected)
			}
		}
	}
	for _, call := range backend.glyphs {
		if call.text != leaf.Text || !reflect.DeepEqual(call.style, expected) {
			t.Fatalf("glyph validation did not use the real paint style: %+v", call)
		}
	}
	object := v.Object("caption")
	validationCalls := len(backend.validated)
	leaf.Style.Opacity = 0.5
	v.Refresh()
	if v.Error() == nil || v.Object("caption") != object || v.elements["caption"].style.Opacity != 1 || len(backend.validated) != validationCalls {
		t.Fatal("resolving validation styles bypassed raw group-opacity rejection or changed the last valid tree")
	}
}

func TestResponsiveBackendPreflightCarriesInheritedInkWithoutMutatingSource(t *testing.T) {
	backend := &responsiveResolvedStyleBackend{Backend: responsiveTestBackend()}
	nested := responsiveTestLeaf("nested", "text", 80)
	nested.Text, nested.Style.Color = "Nested", ""
	input := responsiveTestLeaf("edit", "input", 100)
	input.Value, input.Placeholder, input.Style.Color = "Value", "Hint", ""
	explicit := responsiveTestLeaf("explicit", "text", 80)
	explicit.Text, explicit.Style.Color = "Explicit", "#abc123"
	sibling := responsiveTestLeaf("sibling", "text", 80)
	sibling.Text, sibling.Style.Color = "Sibling", ""
	branch := Node{ID: "branch", Kind: "container", Style: Style{Color: "#335577"}, Children: []Node{nested, input}}
	root := flexTestRoot(64, branch, explicit, sibling)
	nodes := []Node{root}
	// This checks the validation helper's inheritance contract. The separate
	// structural preflight still requires explicit source-leaf typography.
	if err := validateResponsiveBackend(nodes, backend); err != nil {
		t.Fatal(err)
	}
	colors := []string{"#335577", "#335577", "#abc123", "#11232b"}
	if len(backend.validated) != len(colors) {
		t.Fatalf("missing backend validation calls: %d", len(backend.validated))
	}
	for index, style := range backend.validated {
		if style.Opacity != 1 || style.Color != colors[index] || style.BorderColor != colors[index] || style.Width != 0 || style.PaddingLeft != 0 {
			t.Fatalf("wrong resolved style or leaked legacy geometry at %d: %+v", index, style)
		}
	}
	texts := []string{"Nested", "Value", "Hint", "Explicit", "Sibling"}
	glyphColors := []string{"#335577", "#335577", "#335577", "#abc123", "#11232b"}
	if len(backend.glyphs) != len(texts) {
		t.Fatalf("missing text/value/placeholder validations: %d", len(backend.glyphs))
	}
	for index, call := range backend.glyphs {
		if call.text != texts[index] || call.style.Color != glyphColors[index] || call.style.Opacity != 1 {
			t.Fatalf("wrong inherited glyph-validation style at %d: %+v", index, call)
		}
	}
	if nodes[0].Style.Color != "" || nodes[0].Style.Opacity != 0 || nodes[0].Children[0].Children[0].Style.Color != "" || nodes[0].Children[0].Children[1].Style.Opacity != 0 || nodes[0].Children[2].Style.Color != "" {
		t.Fatal("validation mutated the raw source or carried a sibling's ink into it")
	}
}
