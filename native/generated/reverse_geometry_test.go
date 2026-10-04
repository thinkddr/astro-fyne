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

func TestCaptureReverseGeometryRoundTrip(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	view, err := NewReverseGeometry(webui.Scope{}, webui.Actions{})
	if err != nil {
		t.Fatal(err)
	}
	target := software.NewCanvas()
	target.SetPadded(false)
	target.SetScale(1)
	target.Resize(fyne.NewSize(320, 240))
	target.SetContent(view)
	view.Resize(fyne.NewSize(320, 240))
	if err := view.BindCanvas(target); err != nil {
		t.Fatal(err)
	}
	if err := view.ValidateCanvas(); err != nil {
		t.Fatal(err)
	}
	out := os.Getenv("ASTRO_FYNE_REVERSE_ARTIFACTS")
	if out == "" {
		t.Skip("set ASTRO_FYNE_REVERSE_ARTIFACTS to export a round-trip capture")
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(filepath.Join(out, "roundtrip.png"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := png.Encode(file, target.Capture()); err != nil {
		t.Fatal(err)
	}
	if err := view.Error(); err != nil {
		t.Fatal(err)
	}
}
