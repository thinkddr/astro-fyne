// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package generated

import (
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

func scale2Geometry(t *testing.T) (*GeometryScale2Widget, software.WindowlessCanvas) {
	t.Helper()
	app := test.NewApp()
	t.Cleanup(app.Quit)
	view, err := NewGeometryScale2(webui.Scope{}, webui.Actions{})
	if err != nil {
		t.Fatal(err)
	}
	target := software.NewCanvas()
	target.SetPadded(false)
	target.SetScale(2)
	target.Resize(fyne.NewSize(320, 240))
	target.SetContent(view)
	view.Resize(fyne.NewSize(320, 240))
	if err := view.BindCanvas(target); err != nil {
		t.Fatal(err)
	}
	if err := view.ValidateCanvas(); err != nil {
		t.Fatal(err)
	}
	return view, target
}

func TestCaptureMeasuredGeometryScale2(t *testing.T) {
	view, target := scale2Geometry(t)
	snapshot, err := view.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.Measured || snapshot.CaptureScale != 2 || snapshot.Size != fyne.NewSize(320, 240) {
		t.Fatalf("scale 2 requires a real measured 320x240 logical profile: measured=%v scale=%v size=%v", snapshot.Measured, snapshot.CaptureScale, snapshot.Size)
	}
	capture := target.Capture()
	if capture.Bounds() != image.Rect(0, 0, 640, 480) {
		t.Fatalf("a 320x240 native canvas at scale 2 must paint 640x480 pixels, got %v", capture.Bounds())
	}
	if err := errors.Join(view.Error(), view.ValidateCanvas()); err != nil {
		t.Fatal(err)
	}
	out := os.Getenv("ASTRO_FYNE_SCALE2_ARTIFACTS")
	if out == "" {
		t.Skip("set ASTRO_FYNE_SCALE2_ARTIFACTS to export the scale 2 native geometry capture")
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(filepath.Join(out, "native.png"))
	if err != nil {
		t.Fatal(err)
	}
	encodeErr := png.Encode(file, capture)
	if err := errors.Join(encodeErr, file.Close()); err != nil {
		t.Fatal(err)
	}
}

func TestMeasuredScale2GeometryRejectsAnotherDeviceScale(t *testing.T) {
	view, target := scale2Geometry(t)
	// Change the genuine canvas scale without refreshing the view. Validation
	// must detect driver changes even when cached viewport geometry is unchanged.
	target.SetScale(1)
	if err := view.ValidateCanvas(); err == nil {
		t.Fatal("a scale 2 browser profile was accepted by a scale 1 native canvas")
	}
	if _, err := view.Snapshot(); err == nil {
		t.Fatal("a device scale mismatch was exported as a valid measured snapshot")
	}
	target.SetScale(2)
	if err := view.ValidateCanvas(); err != nil {
		t.Fatalf("restoring the captured device scale did not restore validation: %v", err)
	}
}
