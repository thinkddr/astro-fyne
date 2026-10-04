// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"image/color"
	"math"
	"reflect"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	"fyne.io/fyne/v2/theme"
)

func responsiveTestBackend() FyneBackend {
	return FyneBackend{Fonts: map[string]map[Font]fyne.Resource{
		"Fixture": {{Weight: 400}: theme.DefaultTheme().Font(fyne.TextStyle{})},
	}}
}

func responsiveTestLeaf(id, kind string, basis float32) Node {
	n := flexTestItem(id, basis)
	n.Kind = kind
	n.Style.FontFamily, n.Style.FontWeight, n.Style.FontStyle = "Fixture", 400, "normal"
	n.Style.FontSize, n.Style.LineHeight = 14, 20
	n.Style.WhiteSpace, n.Style.TextAlign, n.Style.Color = "nowrap", "left", "#112233"
	n.Style.Background, n.Style.Height, n.Style.Flex.HeightSet = "#ffffff", 32, true
	n.Style.Flex.MarginSet, n.Style.Flex.Shrink = true, FlexValue(0)
	if kind == "input" || kind == "button" {
		n.Style.Flex.Appearance, n.Style.Flex.BorderStyle = "none", "solid"
	}
	return n
}

func responsiveTestWindow(t *testing.T, v *View) fyne.Window {
	t.Helper()
	w := test.NewWindow(v)
	t.Cleanup(w.Close)
	w.SetPadded(false)
	w.Resize(fyne.NewSize(320, 64))
	if err := v.BindCanvas(w.Canvas()); err != nil {
		t.Fatal(err)
	}
	if err := v.Error(); err != nil {
		t.Fatal(err)
	}
	return w
}

func TestResponsiveControlsPreserveEditingAndObjectsAcrossResize(t *testing.T) {
	value, events, calls, builds := "a", []string{}, 0, 0
	v := NewView(func() []Node {
		builds++
		field, save, caption := responsiveTestLeaf("edit", "input", 160), responsiveTestLeaf("save", "button", 80), responsiveTestLeaf("caption", "text", 40)
		field.Value, field.Placeholder = value, "Name"
		field.OnChange = func(s string) { value = s; events = append(events, "input:"+s) }
		field.OnCommit = func(s string) { events = append(events, "change:"+s) }
		save.Text, save.OnTap = "Save", func() { calls++; events = append(events, "tap") }
		caption.Text = String(calls)
		root := flexTestRoot(64, field, save, caption)
		root.Style.Gap = 8
		root.Children[0].Style.Flex.Grow = FlexValue(1)
		return []Node{root}
	}, responsiveTestBackend())
	w := responsiveTestWindow(t, v)
	field, save := v.Object("edit").(*inputWidget), v.Object("save").(*actionWidget)
	field.Tapped(nil)
	field.TypedKey(&fyne.KeyEvent{Name: fyne.KeyEnd})
	field.TypedRune('x')
	if value != "ax" || w.Canvas().Focused() != field || !reflect.DeepEqual(events, []string{"input:ax"}) {
		t.Fatalf("responsive controlled edit changed focus/state: value=%q focus=%T events=%v", value, w.Canvas().Focused(), events)
	}
	cursor := field.element.input.(*primitiveEditor).cursor
	before := builds
	for _, width := range []float32{480, 640, 320} {
		w.Resize(fyne.NewSize(width, 64))
		if v.Error() != nil || v.Object("edit") != field || v.Object("save") != save || w.Canvas().Focused() != field || field.element.input.(*primitiveEditor).cursor != cursor {
			t.Fatalf("resize replaced editing state at %v: focus=%T error=%v", width, w.Canvas().Focused(), v.Error())
		}
		flexTestFrame(t, v, "edit", 0, 0, width-136, 32)
		flexTestFrame(t, v, "save", width-128, 0, 80, 32)
	}
	if builds != before || len(v.measurements) != 0 {
		t.Fatal("responsive controls resized by reevaluating source or using measured profiles")
	}
	save.Tapped(nil)
	if calls != 1 || w.Canvas().Focused() != save || !reflect.DeepEqual(events, []string{"input:ax", "change:ax", "tap"}) || v.elements["caption"].node.Text != "1" {
		t.Fatalf("pointer button did not commit then activate with native focus: calls=%d focus=%T events=%v", calls, w.Canvas().Focused(), events)
	}
	w.Canvas().Unfocus()
	if len(events) != 3 {
		t.Fatal("button blur duplicated the preceding input's commit")
	}
}

func TestResponsiveFocusRevalidatesTargetsChangedByBlur(t *testing.T) {
	for _, targetKind := range []string{"button", "input"} {
		for _, remove := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/remove=%v", targetKind, remove), func(t *testing.T) {
				value, changed, taps := "a", false, 0
				v := NewView(func() []Node {
					first, target := responsiveTestLeaf("first", "input", 160), responsiveTestLeaf("target", targetKind, 100)
					first.Value = value
					first.OnCommit = func(s string) { value = s; changed = true }
					if targetKind == "button" {
						target.Text, target.OnTap = "Go", func() { taps++ }
					}
					target.Disabled = changed
					root := flexTestRoot(64, first, target)
					if changed && remove {
						root.Children = root.Children[:1]
					}
					return []Node{root}
				}, responsiveTestBackend())
				w := responsiveTestWindow(t, v)
				first, target := v.Object("first").(*inputWidget), v.Object("target")
				first.Tapped(nil)
				first.TypedRune('x')
				target.(fyne.Tappable).Tapped(nil)
				if value != "ax" || !changed || taps != 0 || w.Canvas().Focused() == target.(fyne.Focusable) {
					t.Fatalf("blur left a disabled/detached focus target: value=%q changed=%v taps=%d focus=%T", value, changed, taps, w.Canvas().Focused())
				}
			})
		}
	}
}

func TestResponsiveFontAndStyleFailuresPreserveLastTree(t *testing.T) {
	for _, invalid := range []struct {
		name   string
		change func(*Node)
	}{
		{"missing font", func(n *Node) { n.Style.FontFamily = "Missing" }},
		{"missing face", func(n *Node) { n.Style.FontWeight = 700 }},
		{"missing glyph", func(n *Node) { n.Text = "\U0010ffff" }},
		{"incomplete typography", func(n *Node) { n.Style.LineHeight = 0 }},
		{"missing reset", func(n *Node) { n.Style.Flex.MarginSet = false }},
		{"multiline", func(n *Node) { n.Kind = "textarea"; n.Text = "" }},
		{"overflow", func(n *Node) { n.Text = strings.Repeat("W", 100) }},
	} {
		t.Run(invalid.name, func(t *testing.T) {
			leaf := responsiveTestLeaf("caption", "text", 80)
			leaf.Text = "Safe"
			v := NewView(func() []Node { return []Node{flexTestRoot(64, leaf)} }, responsiveTestBackend())
			responsiveTestWindow(t, v)
			object := v.Object("caption")
			position, size := object.Position(), object.Size()
			invalid.change(&leaf)
			v.Refresh()
			if v.Error() == nil || v.Object("caption") != object || v.elements["caption"].node.Text != "Safe" || object.Position() != position || object.Size() != size {
				t.Fatalf("rejected source replaced its last native frame: error=%v node=%+v", v.Error(), v.elements["caption"].node)
			}
			if _, err := v.Snapshot(); err == nil {
				t.Fatal("rejected responsive source was exported as a valid frozen scene")
			}
		})
	}
	leaf := responsiveTestLeaf("caption", "text", 80)
	leaf.Text = "Safe"
	broken := responsiveTestBackend()
	broken.Fonts["Fixture"][Font{Weight: 400}] = fyne.NewStaticResource("bad.ttf", []byte("not a font"))
	v := NewView(func() []Node { return []Node{flexTestRoot(64, leaf)} }, broken)
	if v.Error() == nil || len(v.elements) != 0 || !strings.Contains(v.Error().Error(), "invalid font resource") {
		t.Fatalf("corrupt resource silently fell back to a theme font: %v", v.Error())
	}
}

type responsiveBackendWithoutGlyphValidation struct{ Backend }

func TestResponsiveRequiresExplicitTextValidationWithoutChangingLegacy(t *testing.T) {
	leaf := responsiveTestLeaf("caption", "text", 80)
	leaf.Text = "Text"
	v := NewView(func() []Node { return []Node{flexTestRoot(64, leaf)} }, responsiveBackendWithoutGlyphValidation{responsiveTestBackend()})
	if v.Error() == nil || !strings.Contains(v.Error().Error(), "TextValidator") {
		t.Fatal("a responsive text adapter without glyph validation was accepted")
	}
	legacy := Style{Width: 100, Flex: &FlexStyle{WidthSet: true}}
	if err := (FyneBackend{}).Validate(legacy, true); err != nil {
		t.Fatalf("legacy dimension presence started requiring source-only fonts: %v", err)
	}
}

func TestResponsiveFontsOwnTheirBytesAndMetricsCacheName(t *testing.T) {
	content := bytes.Clone(theme.DefaultTheme().Font(fyne.TextStyle{}).Content())
	resource := fyne.NewStaticResource("host-font.ttf", content)
	backend := FyneBackend{Fonts: map[string]map[Font]fyne.Resource{"Fixture": {{Weight: 400}: resource}}}
	leaf := responsiveTestLeaf("caption", "text", 80)
	leaf.Text = "Safe"
	v := NewView(func() []Node { return []Node{flexTestRoot(64, leaf)} }, backend)
	if v.Error() != nil {
		t.Fatal(v.Error())
	}
	owned := v.backend.(FyneBackend).font(leaf.Style)
	hash := sha256.Sum256(content)
	if owned == resource || !strings.HasSuffix(owned.Name(), fmt.Sprintf("#sha256=%x", hash)) {
		t.Fatal("the owned font retained mutable host bytes or a metrics cache name without content identity")
	}
	content[0] ^= 255
	backend.Fonts["Fixture"][Font{Weight: 400}] = fyne.NewStaticResource("host-font.ttf", []byte("invalid replacement"))
	v.Refresh()
	if v.Error() != nil || bytes.Equal(owned.Content(), content) {
		t.Fatalf("host mutation changed an already validated font: %v", v.Error())
	}
	if err := v.backend.(FyneBackend).ValidateText("Safe", leaf.Style); err != nil {
		t.Fatal(err)
	}
}

func TestResponsiveRejectedInputEditPreservesEditorAndCallbacks(t *testing.T) {
	value, inputs := "a", 0
	v := NewView(func() []Node {
		field := responsiveTestLeaf("edit", "input", 160)
		field.Value, field.OnChange = value, func(s string) { value = s; inputs++ }
		return []Node{flexTestRoot(64, field)}
	}, responsiveTestBackend())
	w := responsiveTestWindow(t, v)
	field := v.Object("edit").(*inputWidget)
	field.Tapped(nil)
	field.TypedRune('\U0010ffff')
	if v.Error() == nil || value != "a" || field.element.input.Text() != "a" || inputs != 0 || w.Canvas().Focused() != field {
		t.Fatal("unsupported glyph mutated the pending input before validation")
	}
	field.TypedRune('b')
	if v.Error() != nil || value != "ab" || inputs != 1 {
		t.Fatalf("a valid edit did not recover from its rejected predecessor: value=%q error=%v", value, v.Error())
	}
	field.TypedShortcut(&fyne.ShortcutSelectAll{})
	clipboard := test.NewClipboard()
	clipboard.SetContent(strings.Repeat("W", 100))
	field.TypedShortcut(&fyne.ShortcutPaste{Clipboard: clipboard})
	if v.Error() == nil || value != "ab" || field.element.input.Text() != "ab" || inputs != 1 {
		t.Fatal("overflowing input edit replaced its last fitted value")
	}
}

func TestResponsiveLegacyEditorTransitionUsesFrozenBackend(t *testing.T) {
	responsive := false
	backend := responsiveTestBackend()
	v := NewView(func() []Node {
		field := responsiveTestLeaf("edit", "input", 160)
		field.Value = "a"
		if responsive {
			return []Node{flexTestRoot(64, field)}
		}
		field.Style.Flex = nil
		return []Node{field}
	}, backend)
	field := v.Object("edit").(*inputWidget)
	responsive = true
	v.Refresh()
	if v.Error() != nil || v.Object("edit") != field {
		t.Fatalf("transition replaced a compatible editor: %v", v.Error())
	}
	owned := v.backend.(FyneBackend).font(field.element.style)
	editorFont := field.element.input.(*primitiveEditor).backend.(FyneBackend).font(field.element.style)
	if owned != editorFont || owned == backend.font(field.element.style) {
		t.Fatal("a reused editor still measured and painted through the mutable legacy backend")
	}
}

func TestResponsiveNowrapAndAlignedCaret(t *testing.T) {
	if got := sourceNowrap(" \tA\n\r\f B\u00a0 C  "); got != "A B\u00a0 C" {
		t.Fatalf("CSS ASCII collapse changed a nonbreaking space or preserved a segment break: %q", got)
	}
	for _, align := range []string{"left", "center", "right"} {
		t.Run(align, func(t *testing.T) {
			leaf := responsiveTestLeaf("edit", "input", 160)
			leaf.Value, leaf.Style.TextAlign = "ab", align
			v := NewView(func() []Node { return []Node{flexTestRoot(64, leaf)} }, responsiveTestBackend())
			responsiveTestWindow(t, v)
			field := v.Object("edit").(*inputWidget)
			field.Tapped(nil)
			field.TypedKey(&fyne.KeyEvent{Name: fyne.KeyEnd})
			editor := field.element.input.(*primitiveEditor)
			renderer := test.WidgetRenderer(editor.canvas).(*editorRenderer)
			renderer.Layout(editor.Size())
			width := v.backend.Measure("ab", field.element.style).Width
			want := width
			if align == "center" {
				want += (editor.Size().Width - width) / 2
			} else if align == "right" {
				want = editor.Size().Width
			}
			if math.Abs(float64(renderer.cursor.Position().X-want)) > .0001 {
				t.Fatalf("%s caret does not follow its aligned value: got=%v want=%v", align, renderer.cursor.Position().X, want)
			}
		})
	}
}

func TestResponsiveBitmapLeafResizesPositionWithoutIntrinsicMeasurements(t *testing.T) {
	image := flexTestItem("image", 16)
	image.Kind, image.ImageResource = "image", bitmapFixture(t, "png", color.NRGBA{R: 255, A: 255})
	image.Style.Display, image.Style.Width, image.Style.Height = "block", 16, 8
	image.Style.Flex.WidthSet, image.Style.Flex.HeightSet, image.Style.Flex.MarginSet = true, true, true
	image.Style.Flex.Shrink = FlexValue(0)
	left, right := flexTestItem("left", 0), flexTestItem("right", 0)
	left.Style.Flex.Grow, right.Style.Flex.Grow = FlexValue(1), FlexValue(1)
	root := flexTestRoot(32, left, image, right)
	root.Style.Gap = 8
	v := NewView(func() []Node { return []Node{root} })
	canvas := software.NewCanvas()
	canvas.SetPadded(false)
	canvas.SetContent(v)
	if err := v.BindCanvas(canvas); err != nil {
		t.Fatal(err)
	}
	object := v.Object("image")
	for _, width := range []float32{64, 96, 64} {
		canvas.Resize(fyne.NewSize(width, 32))
		frame := canvas.Capture()
		x := (width-32)/2 + 8
		flexTestFrame(t, v, "image", x, 0, 16, 8)
		if v.Error() != nil || v.Object("image") != object || len(v.measurements) != 0 || rgba(frame.At(int(x)+1, 1)) != (color.NRGBA{R: 255, A: 255}) {
			t.Fatalf("responsive bitmap did not move its real pixels at %v: error=%v", width, v.Error())
		}
	}
}
