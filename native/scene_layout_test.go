// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"reflect"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	"fyne.io/fyne/v2/theme"
)

func TestSceneLayoutRetainsLocalEditingCommitSubmitAndFixedGeometry(t *testing.T) {
	a := test.NewApp()
	t.Cleanup(a.Quit)
	backend := FyneBackend{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: theme.DefaultTheme().Font(fyne.TextStyle{})}}}
	var events []string
	v := NewView(func() []Node {
		return []Node{{ID: "field", Kind: "input", Value: "", LocalValue: true,
			OnChange: func(value string) { events = append(events, "input:"+value) },
			OnCommit: func(value string) { events = append(events, "commit:"+value) },
			OnSubmit: func(value string) { events = append(events, "submit:"+value) },
		}}
	}, backend)
	v.SetViewport(320, 240)
	if err := v.SetCaptureScale(1); err != nil {
		t.Fatal(err)
	}
	layout := map[string]Style{"field": {X: 24, Y: 16, Width: 128, Height: 32, FontFamily: "Host", FontSize: 14, LineHeight: 20, FontWeight: 400, Color: "#000000", Opacity: 1, Measured: true}}
	if err := v.ApplySceneLayout(layout); err != nil {
		t.Fatal(err)
	}
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(v)
	if err := v.BindCanvas(c); err != nil {
		t.Fatal(err)
	}
	field := v.Object("field").(fyne.Focusable)
	c.Focus(field)
	field.TypedRune('x')
	v.Refresh()
	field.TypedKey(&fyne.KeyEvent{Name: fyne.KeyReturn})
	field.TypedKey(&fyne.KeyEvent{Name: fyne.KeyEnter})
	c.Unfocus()
	if err := v.Error(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(events, []string{"input:x", "commit:x", "submit:x", "submit:x"}) {
		t.Fatalf("incorrect imported event ordering: %v", events)
	}
	snapshot, err := v.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Roots[0].Node.Value != "x" || snapshot.Roots[0].Node.Style.X != 24 || snapshot.Roots[0].Node.Style.Y != 16 {
		t.Fatalf("scene lost local value or geometry: %+v", snapshot)
	}
	layout["field"] = Style{}
	if snapshot.Roots[0].Node.Style.Width != 128 {
		t.Fatal("scene layout retained caller-owned styles")
	}
	if err := v.ValidateViewport(fyne.NewSize(321, 240)); err == nil {
		t.Fatal("fixed scene accepted a different viewport")
	}
	// Browser captures still require a profile matching the exact visual state.
	if err := v.ApplyMeasurements(map[string]Style{"field": snapshot.Roots[0].Node.Style}); err == nil {
		t.Fatal("scene mode weakened browser measurement freshness")
	}
}

func TestSubmitDoesNotFireAfterCommitDisablesOrRemovesInput(t *testing.T) {
	for _, remove := range []bool{false, true} {
		t.Run(map[bool]string{false: "disable", true: "remove"}[remove], func(t *testing.T) {
			a := test.NewApp()
			t.Cleanup(a.Quit)
			active, disabled, submits := true, false, 0
			v := NewView(func() []Node {
				if !active {
					return nil
				}
				return []Node{{ID: "field", Kind: "input", Disabled: disabled, LocalValue: true, OnCommit: func(string) {
					if remove {
						active = false
					} else {
						disabled = true
					}
				}, OnSubmit: func(string) { submits++ }}}
			})
			field := v.Object("field").(fyne.Focusable)
			field.FocusGained()
			field.TypedRune('x')
			field.TypedKey(&fyne.KeyEvent{Name: fyne.KeyReturn})
			if submits != 0 {
				t.Fatal("submit fired after commit invalidated the input")
			}
		})
	}
}
