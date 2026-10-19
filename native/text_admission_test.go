// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
	"fyne.io/fyne/v2/theme"
)

type legacyAdmissionBackend struct {
	FyneBackend
	calls    []LegacyText
	defaults map[string]int
	editors  int
	reject   func(LegacyText) error
}

func (b *legacyAdmissionBackend) Defaults(node Node) Style {
	if b.defaults == nil {
		b.defaults = make(map[string]int)
	}
	b.defaults[node.ID]++
	return b.FyneBackend.Defaults(node)
}

func (b *legacyAdmissionBackend) ValidateLegacyText(text LegacyText) error {
	b.calls = append(b.calls, text)
	if b.reject != nil {
		return b.reject(text)
	}
	return nil
}

func (b *legacyAdmissionBackend) Editor(multiline bool, style Style, onChange func(string)) Editor {
	b.editors++
	return b.FyneBackend.Editor(multiline, style, onChange)
}

func TestLegacyTextAdmissionUsesInheritedStylesOnceWithoutExposingMetadata(t *testing.T) {
	metadata := &FlexStyle{HeightSet: true}
	nodes := []Node{{ID: "root", Kind: "container", Style: Style{FontFamily: "Host", FontSize: 18, LineHeight: 24, FontWeight: 700, FontStyle: "italic", Color: "#223344"}, Children: []Node{
		{ID: "caption", Kind: "text", Text: "Inherited", Style: Style{Height: 30, Flex: metadata}},
		{ID: "button", Kind: "button", Text: "Action"},
	}}}
	backend := &legacyAdmissionBackend{reject: func(text LegacyText) error {
		if text.Style.Flex != nil {
			return errors.New("mutable metadata escaped admission")
		}
		text.Style.FontFamily, text.Style.Height = "Changed copy", 999
		return nil
	}}
	view := NewView(func() []Node { return nodes }, backend)
	if err := view.Error(); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"root", "caption", "button"} {
		if backend.defaults[id] != 1 {
			t.Fatalf("style resolution called Defaults %d times for %s", backend.defaults[id], id)
		}
	}
	if len(backend.calls) != 2 {
		t.Fatalf("missing static text roles: %+v", backend.calls)
	}
	for i, id := range []string{"caption", "button"} {
		got := backend.calls[i].Style
		want := view.elements[id].style
		want.Flex = nil
		if got != want || got.FontFamily != "Host" || got.FontSize != 18 || got.LineHeight != 24 || got.FontWeight != 700 || got.FontStyle != "italic" || got.Opacity != 1 {
			t.Fatalf("admission differs from inherited paint style for %s: got %+v want %+v", id, got, want)
		}
	}
	if backend.calls[0].Style.Color != "#223344" || backend.calls[1].Style.Color != "#ffffff" {
		t.Fatal("admission lost the inherited caption color or button default color")
	}
	if nodes[0].Children[0].Style.Flex != metadata || !metadata.HeightSet || nodes[0].Children[0].Style.FontFamily != "" || view.elements["caption"].style.Height != 30 {
		t.Fatal("admission mutated source metadata or committed style")
	}
	view.Refresh()
	for _, id := range []string{"root", "caption", "button"} {
		if backend.defaults[id] != 2 {
			t.Fatalf("refresh resolved %s more than once: %d", id, backend.defaults[id])
		}
	}
}

func TestLegacyTextAdmissionIncludesHiddenDisabledEmptyAndRawRoles(t *testing.T) {
	raw := " \ta\nb\r\f\u00a0"
	backend := &legacyAdmissionBackend{}
	view := NewView(func() []Node {
		return []Node{{ID: "hidden", Kind: "container", Style: Style{Display: "none"}, Children: []Node{
			{ID: "caption", Kind: "text", Text: raw, Style: Style{WhiteSpace: "nowrap"}},
		}},
			{ID: "button", Kind: "button", Disabled: true},
			{ID: "label", Kind: "label"},
			{ID: "link", Kind: "link"},
			{ID: "field", Kind: "input"},
			{ID: "area", Kind: "textarea", Value: "first\nsecond", Placeholder: "Hint\nnext"},
			{ID: "manual", Kind: "container", Text: "Manual text"},
		}
	}, backend)
	if err := view.Error(); err != nil {
		t.Fatal(err)
	}
	want := [][3]string{
		{"text", "text", raw}, {"button", "text", ""}, {"label", "text", ""}, {"link", "text", ""},
		{"input", "value", ""}, {"input", "placeholder", ""},
		{"textarea", "value", "first\nsecond"}, {"textarea", "placeholder", "Hint\nnext"},
		{"container", "text", "Manual text"},
	}
	if len(backend.calls) != len(want) {
		t.Fatalf("hidden, disabled or empty roles were skipped: %+v", backend.calls)
	}
	for i, call := range backend.calls {
		if got := [3]string{call.Kind, call.Field, call.Text}; got != want[i] {
			t.Fatalf("role %d normalized text or changed order: got %q want %q", i, got, want[i])
		}
	}
}

func TestLegacyStrictFrameAdmissionRejectsEmptyEditorsBeforeFactories(t *testing.T) {
	for _, kind := range []string{"input", "textarea"} {
		t.Run(kind, func(t *testing.T) {
			backend := &legacyAdmissionBackend{reject: func(text LegacyText) error {
				if text.Kind == "input" || text.Kind == "textarea" {
					return errors.New("editable text requires an edit admission adapter")
				}
				return nil
			}}
			view := NewView(func() []Node {
				return []Node{{ID: "caption", Kind: "text", Text: "Before"}, {ID: "edit", Kind: kind, Disabled: true, Style: Style{Display: "none"}}}
			}, backend)
			if view.Error() == nil || !strings.Contains(view.Error().Error(), `"edit" value`) || backend.editors != 0 || view.Object("caption") != nil || view.Object("edit") != nil || len(view.nodes) != 0 {
				t.Fatalf("empty control bypassed preconstruction admission: editors=%d error=%v", backend.editors, view.Error())
			}
		})
	}
}

func TestLegacyTextAdmissionFailureKeepsTheWholeNativeFrameAndFocus(t *testing.T) {
	bad := false
	backend := &legacyAdmissionBackend{reject: func(text LegacyText) error {
		if strings.ContainsRune(text.Text, '\U0010ffff') {
			return errors.New("missing glyph U+10FFFF")
		}
		return nil
	}}
	view := NewView(func() []Node {
		first, last, style := "Before", "Supported", Style{Height: 100}
		if bad {
			first, last, style = "Changed", "\U0010ffff", Style{Height: 200, Display: "none"}
		}
		return []Node{{ID: "root", Identity: "root-instance", Kind: "container", Style: style, Children: []Node{
			{ID: "first", Identity: "first-instance", Kind: "text", Text: first},
			{ID: "action", Identity: "action-instance", Kind: "button", Text: "Action"},
			{ID: "last", Identity: "last-instance", Kind: "text", Text: last},
		}}}
	}, backend)
	window := test.NewWindow(view)
	t.Cleanup(window.Close)
	window.SetPadded(false)
	window.Resize(fyne.NewSize(240, 160))
	window.Canvas().Focus(view.Object("action").(fyne.Focusable))
	objects, positions, sizes, styles := map[string]fyne.CanvasObject{}, map[string]fyne.Position{}, map[string]fyne.Size{}, map[string]Style{}
	for _, id := range []string{"root", "first", "action", "last"} {
		object := view.Object(id)
		objects[id], positions[id], sizes[id], styles[id] = object, object.Position(), object.Size(), view.elements[id].style
	}
	bad = true
	view.Refresh()
	if view.Error() == nil || !strings.Contains(view.Error().Error(), "missing glyph") {
		t.Fatalf("unsupported replacement frame was admitted: %v", view.Error())
	}
	for id, object := range objects {
		if view.Object(id) != object || object.Position() != positions[id] || object.Size() != sizes[id] || view.elements[id].style != styles[id] || !object.Visible() {
			t.Fatalf("rejected late sibling partly committed %s", id)
		}
	}
	if view.elements["first"].node.Text != "Before" || view.elements["last"].node.Text != "Supported" || view.elements["last"].parent != view.elements["root"] || window.Canvas().Focused() != objects["action"].(fyne.Focusable) {
		t.Fatal("failed admission changed committed source, parentage or focus")
	}
	if _, err := view.Snapshot(); err == nil {
		t.Fatal("rejected frame was snapshotted")
	}
	bad = false
	view.Refresh()
	if err := view.Error(); err != nil || view.Object("first") != objects["first"] {
		t.Fatalf("successful admission did not recover retained objects: %v", err)
	}
}

func admissionMeasuredBackend() *legacyAdmissionBackend {
	resource := theme.DefaultTheme().Font(fyne.TextStyle{})
	return &legacyAdmissionBackend{FyneBackend: FyneBackend{Fonts: map[string]map[Font]fyne.Resource{
		"Host":     {{Weight: 400}: resource},
		"Rejected": {{Weight: 400}: resource},
	}}, reject: func(text LegacyText) error {
		if text.Style.FontFamily == "Rejected" {
			return errors.New("face rejected by the host profile")
		}
		return nil
	}}
}

func TestLegacyTextAdmissionRejectsProfilesBeforeStoredStateChanges(t *testing.T) {
	for _, scene := range []bool{false, true} {
		t.Run(fmt.Sprint("scene=", scene), func(t *testing.T) {
			backend := admissionMeasuredBackend()
			view := NewView(func() []Node {
				return []Node{{ID: "caption", Kind: "text", Text: "Caption", Style: Style{FontFamily: "Host"}}}
			}, backend)
			view.SetViewport(200, 100)
			if err := view.SetCaptureScale(1); err != nil {
				t.Fatal(err)
			}
			window := test.NewWindow(view)
			t.Cleanup(window.Close)
			window.SetPadded(false)
			window.Resize(fyne.NewSize(200, 100))
			if err := view.BindCanvas(window.Canvas()); err != nil {
				t.Fatal(err)
			}
			good := Style{X: 4, Y: 5, Width: 120, Height: 30, FontFamily: "Host", FontSize: 16, LineHeight: 22, FontWeight: 400, FontStyle: "normal", Color: "#112233", Opacity: 1, Measured: true}
			apply := view.ApplyMeasurements
			if scene {
				apply = view.ApplySceneLayout
			}
			if err := apply(map[string]Style{"caption": good}); err != nil {
				t.Fatal(err)
			}
			backend.calls = nil
			view.Refresh()
			if len(backend.calls) != 1 || backend.calls[0].Style != good || view.elements["caption"].style != good {
				t.Fatalf("fresh measurement was not the exact admitted paint style: %+v", backend.calls)
			}
			object, beforeState := view.Object("caption"), view.measurementState
			position, size := object.Position(), object.Size()
			bad := good
			bad.FontFamily, bad.X, bad.Height = "Rejected", 25, 50
			replace := view.ApplySceneLayout
			if scene {
				replace = view.ApplyMeasurements
			}
			if err := replace(map[string]Style{"caption": bad}); err == nil || !strings.Contains(err.Error(), "face rejected") {
				t.Fatalf("unsupported measured face was admitted: %v", err)
			}
			if view.Object("caption") != object || object.Position() != position || object.Size() != size || view.elements["caption"].style != good || view.measurements["caption"] != good || view.measurementState != beforeState || view.sceneLayout != scene {
				t.Fatal("rejected profile replaced stored state or native geometry")
			}
			calls := len(backend.calls)
			if _, err := view.Snapshot(); err == nil {
				t.Fatal("rejected measured profile retained a valid snapshot")
			}
			if _, err := ExportProgram(`{"actions":[]}`, strings.Repeat("a", 64), Scope{}, Scope{}, view); err == nil || !strings.Contains(err.Error(), "face rejected") {
				t.Fatalf("rejected profile retained a valid export: %v", err)
			}
			if view.Error() == nil || len(backend.calls) != calls {
				t.Fatal("state inspection reran admission or cleared its error")
			}
			view.Refresh()
			if err := view.Error(); err != nil {
				t.Fatalf("valid retained profile could not recover: %v", err)
			}
			calls = len(backend.calls)
			if _, err := view.Snapshot(); err != nil {
				t.Fatal(err)
			}
			if _, err := ExportProgram(`{"actions":[]}`, strings.Repeat("a", 64), Scope{}, Scope{}, view); err != nil {
				t.Fatal(err)
			}
			if view.Object("caption") != object || len(backend.calls) != calls {
				t.Fatal("valid getters/export reran admission or replaced the object")
			}
		})
	}
}

func TestLegacyTextAdmissionChecksSourceAfterMeasurementBecomesStale(t *testing.T) {
	backend := admissionMeasuredBackend()
	text := "Before"
	view := NewView(func() []Node {
		return []Node{{ID: "caption", Kind: "text", Text: text, Style: Style{FontFamily: "Host", FontSize: 14, LineHeight: 20}}}
	}, backend)
	measured := Style{Width: 140, Height: 30, FontFamily: "Host", FontSize: 18, LineHeight: 24, FontWeight: 400, Color: "#000000", Opacity: 1, Measured: true}
	if err := view.ApplyMeasurements(map[string]Style{"caption": measured}); err != nil {
		t.Fatal(err)
	}
	backend.calls = nil
	text = "Changed"
	view.Refresh()
	if view.Error() == nil || !strings.Contains(view.Error().Error(), "visual state changed") || len(backend.calls) != 1 || backend.calls[0].Style.Measured || backend.calls[0].Style.FontSize != 14 || view.elements["caption"].style != backend.calls[0].Style {
		t.Fatalf("stale measurements bypassed source admission: %+v %v", backend.calls, view.Error())
	}
	view.ClearMeasurements()
	if err := view.Error(); err != nil {
		t.Fatal(err)
	}
}

func TestLegacyTextAdmissionRestoresProfilesAfterPendingSourceRejection(t *testing.T) {
	for _, scene := range []bool{false, true} {
		t.Run(fmt.Sprint("scene=", scene), func(t *testing.T) {
			bad, builds := false, 0
			missing := errors.New("missing glyph U+10FFFF")
			backend := admissionMeasuredBackend()
			backend.reject = func(text LegacyText) error {
				if strings.ContainsRune(text.Text, '\U0010ffff') {
					return missing
				}
				return nil
			}
			view := NewView(func() []Node {
				builds++
				text := "Supported"
				if bad {
					text = "\U0010ffff"
				}
				return []Node{{ID: "root", Kind: "container", Style: Style{Height: 120, FontFamily: "Host", FontSize: 14, LineHeight: 20}, Children: []Node{
					{ID: "caption", Kind: "text", Text: text}, {ID: "action", Kind: "button", Text: "Action"},
				}}}
			}, backend)
			view.SetViewport(240, 160)
			if err := view.SetCaptureScale(1); err != nil {
				t.Fatal(err)
			}
			window := test.NewWindow(view)
			t.Cleanup(window.Close)
			window.SetPadded(false)
			window.Resize(fyne.NewSize(240, 160))
			if err := view.BindCanvas(window.Canvas()); err != nil {
				t.Fatal(err)
			}
			caption := Style{X: 4, Y: 5, Width: 120, Height: 30, FontFamily: "Host", FontSize: 16, LineHeight: 22, FontWeight: 400, Color: "#112233", Opacity: 1, Measured: true}
			action := caption
			action.Y, action.Width, action.Height = 45, 100, 36
			profile := map[string]Style{
				"root":    {Width: 200, Height: 120, Opacity: 1, Measured: true},
				"caption": caption,
				"action":  action,
			}
			apply := view.ApplyMeasurements
			if scene {
				apply = view.ApplySceneLayout
			}
			if err := apply(profile); err != nil {
				t.Fatal(err)
			}
			window.Canvas().Focus(view.Object("action").(fyne.Focusable))
			beforeJSON, err := json.Marshal(view.measurements)
			if err != nil {
				t.Fatal(err)
			}
			beforeState, beforeBuilds := view.measurementState, builds
			objects, positions, sizes := map[string]fyne.CanvasObject{}, map[string]fyne.Position{}, map[string]fyne.Size{}
			replacement := make(map[string]Style, len(profile))
			for id, style := range profile {
				object := view.Object(id)
				objects[id], positions[id], sizes[id] = object, object.Position(), object.Size()
				style.X += 20
				replacement[id] = style
			}
			backend.calls = nil
			bad = true
			replace := view.ApplySceneLayout
			if scene {
				replace = view.ApplyMeasurements
			}
			if err := replace(replacement); !errors.Is(err, missing) || !strings.Contains(err.Error(), `"caption" text`) {
				t.Fatalf("pending source admission did not preserve its diagnostic: %v", err)
			}
			afterJSON, err := json.Marshal(view.measurements)
			if err != nil {
				t.Fatal(err)
			}
			if string(afterJSON) != string(beforeJSON) || view.measurementState != beforeState || view.sceneLayout != scene || builds != beforeBuilds+1 {
				t.Fatalf("pending rejection kept a new profile or rebuilt twice: builds=%d want=%d", builds, beforeBuilds+1)
			}
			for id, object := range objects {
				if view.Object(id) != object || object.Position() != positions[id] || object.Size() != sizes[id] || view.elements[id].style != profile[id] {
					t.Fatalf("pending source rejection changed committed %s", id)
				}
			}
			if view.elements["caption"].node.Text != "Supported" || window.Canvas().Focused() != objects["action"].(fyne.Focusable) {
				t.Fatal("pending rejection changed caption text or focus")
			}
			if len(backend.calls) == 0 {
				t.Fatal("pending source bypassed admission")
			}
			last := backend.calls[len(backend.calls)-1]
			if last.Text != "\U0010ffff" || last.Style.Measured || last.Style.FontSize != 14 || last.Field != "text" {
				t.Fatalf("pending source was not checked with its effective source style: %+v", last)
			}
			calls := len(backend.calls)
			if _, err := view.Snapshot(); !errors.Is(err, missing) {
				t.Fatalf("pending rejected frame was snapshotted: %v", err)
			}
			if _, err := ExportProgram(`{"actions":[]}`, strings.Repeat("a", 64), Scope{}, Scope{}, view); !errors.Is(err, missing) || len(backend.calls) != calls {
				t.Fatalf("pending rejected frame was exported or admission reran: %v", err)
			}
			bad = false
			view.Refresh()
			if err := view.Error(); err != nil || view.elements["caption"].style != caption || view.sceneLayout != scene || builds != beforeBuilds+2 {
				t.Fatalf("source recovery did not use the original profile: %v", err)
			}
			window.Canvas().Unfocus()
			calls = len(backend.calls)
			if _, err := ExportProgram(`{"actions":[]}`, strings.Repeat("a", 64), Scope{}, Scope{}, view); err != nil || len(backend.calls) != calls {
				t.Fatalf("recovered profile did not export without readmission: %v", err)
			}
		})
	}
}

func TestLegacyTextAdmissionDoesNotChangeDefaultEditingOrResponsiveValidation(t *testing.T) {
	value := "a"
	view := NewView(func() []Node {
		return []Node{{ID: "edit", Kind: "input", Value: value, Style: Style{FontFamily: "Unregistered"}, OnChange: func(next string) { value = next }}}
	})
	object := view.Object("edit").(fyne.Focusable)
	object.TypedKey(&fyne.KeyEvent{Name: fyne.KeyEnd})
	object.TypedRune('ñ')
	if value != "añ" || view.Error() != nil || view.Object("edit") != object.(fyne.CanvasObject) {
		t.Fatalf("default legacy fallback/editing changed: value=%q error=%v", value, view.Error())
	}
	backend := &legacyAdmissionBackend{FyneBackend: responsiveTestBackend(), reject: func(LegacyText) error {
		return errors.New("legacy admission must not run for responsive text")
	}}
	leaf := responsiveTestLeaf("caption", "text", 100)
	leaf.Text = "Responsive"
	responsive := NewView(func() []Node { return []Node{flexTestRoot(64, leaf)} }, backend)
	if responsive.Error() != nil || len(backend.calls) != 0 {
		t.Fatalf("optional legacy admission changed responsive validation: %v", responsive.Error())
	}
}

func TestLegacyTextAdmissionRecoveryPreservesOtherFaults(t *testing.T) {
	backend := &legacyAdmissionBackend{}
	view := NewView(func() []Node { return []Node{{ID: "caption", Kind: "text", Text: "Text"}} }, backend)
	fault := errors.New("navigation remains failed")
	view.navigationErr = fault
	backend.reject = func(LegacyText) error { return errors.New("admission rejected") }
	view.Refresh()
	backend.reject = nil
	view.Refresh()
	if !errors.Is(view.Error(), fault) || strings.Contains(view.Error().Error(), "admission rejected") || view.elements["caption"].node.Text != "Text" {
		t.Fatalf("successful admission cleared another fault or retained its own failure: %v", view.Error())
	}
}
