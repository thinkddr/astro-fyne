// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
package webui

import (
	"fyne.io/fyne/v2/test"
	"strings"
	"testing"
)

func TestNativeCheckboxPreservesStateIdentityAndDoesNotReplayCallbacks(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	checked, disabled, calls := true, false, 0
	view := NewView(func() []Node {
		return []Node{
			{ID: "label", Kind: "text", Text: "Accept", LabelFor: "check"},
			{ID: "check", Kind: "checkbox", Checked: checked, Disabled: disabled, OnChecked: func(value bool) { checked = value; calls++ }},
		}
	})
	control := view.Object("check").(*checkboxWidget)
	window := test.NewWindow(view)
	defer window.Close()
	if calls != 0 || !control.Checked || control.AccessibilityLabel() != "Accept" {
		t.Fatal("mount changed checkbox state or emitted a callback")
	}
	control.Tapped(nil)
	if checked || control.Checked || calls != 1 {
		t.Fatal("activation did not update native and source state exactly once")
	}
	view.Refresh()
	if view.Object("check") != control || calls != 1 {
		t.Fatal("refresh replaced the control or replayed its callback")
	}
	window.Canvas().Focus(control)
	control.TypedRune(' ')
	window.Canvas().Unfocus()
	if !checked || !control.Checked || calls != 2 {
		t.Fatal("keyboard activation differed from pointer activation")
	}
	disabled = true
	view.Refresh()
	control.Tapped(nil)
	control.TypedRune(' ')
	if !control.Disabled() || !checked || calls != 2 {
		t.Fatal("a disabled checkbox activated")
	}
}

func TestNativeCheckboxRejectsVisualStateThatDoesNotMatchItsSource(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	view := NewView(func() []Node { return []Node{{ID: "check", Kind: "checkbox", Checked: true, Disabled: true}} })
	control := view.Object("check").(*checkboxWidget)
	control.SetChecked(false)
	if err := view.uncommittedInputError(); err == nil || !strings.Contains(err.Error(), "uncommitted checked") {
		t.Fatal("source/visual checkbox divergence was exportable")
	}
	view.Refresh()
	if err := view.uncommittedInputError(); err != nil {
		t.Fatal(err)
	}
	layout := control.element.style
	layout.Measured, layout.Width, layout.Height = true, 20, 20
	if err := view.ApplySceneLayout(map[string]Style{"check": layout}); err == nil || !strings.Contains(err.Error(), "checkbox measurements") {
		t.Fatal("checkbox styling was silently certified")
	}
	invalid := NewView(func() []Node { return []Node{{ID: "check", Kind: "checkbox", Style: Style{Width: 20}}} })
	if invalid.Error() == nil {
		t.Fatal("unsupported checkbox styling was ignored")
	}
}
