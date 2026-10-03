// SPDX-License-Identifier: Apache-2.0
package generated

import (
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

func TestGeneratedStateAndInput(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	view, err := NewCounter(webui.Scope{}, webui.Actions{})
	if err != nil {
		t.Fatal(err)
	}
	window := app.NewWindow("Counter")
	window.Resize(fyne.NewSize(480, 480))
	window.SetContent(view)
	view.Refresh()
	before := view.Object("name")
	test.Tap(view.Object("increment"))
	if view.Object("changed") == nil {
		t.Fatal("useState did not reveal conditional content")
	}
	if before != view.Object("name") {
		t.Fatal("state update recreated the text input")
	}
	input, ok := before.(fyne.Focusable)
	if !ok {
		t.Fatal("generated input is not focusable")
	}
	window.Canvas().Focus(input)
	input.TypedRune('!')
	if window.Canvas().Focused() != input {
		t.Fatal("controlled update lost keyboard focus")
	}
	if err := view.Error(); err != nil {
		t.Fatal(err)
	}
}

func TestCaptureMeasuredGeometry(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	view, err := NewGeometry(webui.Scope{}, webui.Actions{})
	if err != nil {
		t.Fatal(err)
	}
	target := software.NewCanvas()
	target.SetPadded(false)
	target.SetScale(1)
	target.Resize(fyne.NewSize(320, 240))
	target.SetContent(view)
	view.Resize(fyne.NewSize(320, 240))
	image := target.Capture()
	out := os.Getenv("ASTRO_FYNE_ARTIFACTS")
	if out == "" {
		t.Skip("set ASTRO_FYNE_ARTIFACTS to export a native comparison capture")
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(filepath.Join(out, "native.png"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := png.Encode(file, image); err != nil {
		t.Fatal(err)
	}
	if err := view.Error(); err != nil {
		t.Fatal(err)
	}
}
