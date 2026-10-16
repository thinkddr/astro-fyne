//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontations

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

func backendTestOptions(t *testing.T) Options {
	t.Helper()
	root, library := os.Getenv("ASTRO_FYNE_FONTATIONS_SOURCE_ROOT"), os.Getenv("ASTRO_FYNE_TEXT_LIBRARY")
	if root == "" || library == "" {
		t.Fatal("hosted adapter tests require explicit source and native library paths")
	}
	read := func(path string) []byte {
		data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	var policy Policy
	if err := json.Unmarshal(read("ci/text-engine-probe/policy.json"), &policy); err != nil {
		t.Fatal(err)
	}
	license := fyne.NewStaticResource("LICENSE-NotoSans.txt", read("example/public/fonts/LICENSE-NotoSans.txt"))
	return Options{LibraryPath: library, Policy: policy, Fonts: map[string]map[webui.Font]LicensedFont{"AstroNoto": {
		{Weight: 400}: {Resource: fyne.NewStaticResource("NotoSans-Regular.ttf", read("example/public/fonts/NotoSans-Regular.ttf")), License: license},
		{Weight: 700}: {Resource: fyne.NewStaticResource("NotoSans-Bold.ttf", read("example/public/fonts/NotoSans-Bold.ttf")), License: license},
	}}}
}

func backendTestStyle() webui.Style {
	return webui.Style{FontFamily: "AstroNoto", FontSize: 14, LineHeight: 20, FontWeight: 400, FontStyle: "normal", Color: "#11232b", WhiteSpace: "nowrap", TextAlign: "left", Opacity: 1}
}

func openTestBackend(t *testing.T) *Backend {
	t.Helper()
	b, err := NewBackend(backendTestOptions(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := b.Close(); err != nil {
			t.Error(err)
		}
	})
	return b
}

func TestNativeFontAndSnapshotOwnership(t *testing.T) {
	options := backendTestOptions(t)
	original := options.Fonts["AstroNoto"][webui.Font{Weight: 400}]
	fontHash, noticeHash := digest(original.Resource.Content()), digest(original.License.Content())
	b, err := NewBackend(options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := b.Close(); err != nil {
			t.Error(err)
		}
	})
	original.Resource.Content()[0] ^= 0xff
	original.License.Content()[0] ^= 0xff
	delete(options.Fonts, "AstroNoto")
	line, err := b.Shape("Hgx", backendTestStyle())
	if err != nil {
		t.Fatal(err)
	}
	snapshot := line.Snapshot()
	if snapshot.SourceFontSHA256 != fontHash || len(snapshot.EffectiveFontSHA256) != 64 || len(snapshot.Glyphs) != 3 {
		t.Fatalf("frozen shape identity is invalid: %+v", snapshot)
	}
	wantGlyphs := append([]Glyph(nil), snapshot.Glyphs...)
	snapshot.Glyphs[0].ID = 0
	snapshot.Glyphs[0].XAdvance = 0
	if !reflect.DeepEqual(line.Snapshot().Glyphs, wantGlyphs) {
		t.Fatal("snapshot accessor exposed mutable internal glyphs")
	}
	text := b.Text("Hgx", backendTestStyle())
	text.FontSource.Content()[0] ^= 0xff
	if digest(text.FontSource.Content()) != fontHash {
		t.Fatal("canvas.FontSource exposed mutable frozen font bytes")
	}
	notices := b.FontNotices()
	if len(notices) != 2 || notices[0].LicenseSHA256 != noticeHash || digest(notices[0].Content) != noticeHash {
		t.Fatal("original redistribution notice was not retained")
	}
	notices[0].Content[0] ^= 0xff
	if digest(b.FontNotices()[0].Content) != noticeHash {
		t.Fatal("notice accessor exposed mutable retained bytes")
	}
}

func TestReusedTextUpdatesMetricsFontAndExportMetadata(t *testing.T) {
	test.NewTempApp(t)
	b := openTestBackend(t)
	s := backendTestStyle()
	text := b.Text("Hgx", s)
	originalObject := text
	regular := text.Layout.(*Line).Snapshot().SourceFontSHA256
	text.TextStyle.Underline, text.TextStyle.Strikethrough = true, true
	chosenColor := color.NRGBA{R: 31, G: 67, B: 103, A: 255}
	text.Color = chosenColor
	s.FontSize, s.FontWeight, s.FontFamily = 18, 700, "ASTRONOTO"
	b.PlaceText(text, s, 4.25, 8.5)
	line, ok := text.Layout.(*Line)
	if !ok {
		t.Fatalf("style transition did not create a valid line: %v", text.TextLayoutError())
	}
	shape := line.Snapshot()
	if text != originalObject || text.TextSize != 18 || !text.TextStyle.Bold || text.TextStyle.Italic || !text.TextStyle.Underline || !text.TextStyle.Strikethrough ||
		shape.FontSize != 18 || shape.SourceFontSHA256 == regular || shape.SourceFontSHA256 != digest(text.FontSource.Content()) || text.Color != chosenColor ||
		text.Position() != fyne.NewPos(4.25, 8.5) || text.Size() != b.Measure(text.Text, s) {
		t.Fatal("reused text retained old font, size, style, geometry or source metadata")
	}
	// Reusing the same line must also restore externally modified canvas metadata.
	text.TextSize, text.TextStyle.Italic = 99, true
	text.FontSource = fyne.NewStaticResource("wrong", []byte("not the chosen font"))
	b.PlaceText(text, s, 5, 9)
	if text.Layout != line || text.TextSize != 18 || text.TextStyle.Italic || digest(text.FontSource.Content()) != shape.SourceFontSHA256 {
		t.Fatal("same-line reuse failed to restore the selected font metadata")
	}
	s = backendTestStyle()
	b.PlaceText(text, s, 0, 0)
	if text.TextSize != 14 || text.TextStyle.Bold || text.TextStyle.Italic || text.Layout.(*Line).Snapshot().SourceFontSHA256 != regular {
		t.Fatal("return to regular font kept bold metrics or metadata")
	}
}

func TestCloseBlocksFurtherShapeMetricsAndPaintWithoutFallback(t *testing.T) {
	b := openTestBackend(t)
	s := backendTestStyle()
	text := b.Text("Hgx", s)
	line := text.Layout.(*Line)
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Shape("Hgx", s); !errors.Is(err, ErrClosed) {
		t.Fatalf("closed backend shaped text: %v", err)
	}
	if size, _, err := text.LayoutMetrics(); !errors.Is(err, ErrClosed) || size != (fyne.Size{}) || !errors.Is(text.TextLayoutError(), ErrClosed) {
		t.Fatalf("closed layout returned default metrics: %v %v", size, err)
	}
	destination := transportImage(image.Rect(0, 0, 64, 24))
	before := bytes.Clone(destination.Pix)
	err := line.PaintSoftware(destination, canvas.TextPaintContext{Scale: 1, Clip: destination.Bounds(), Color: color.Black})
	if !errors.Is(err, ErrClosed) || !bytes.Equal(before, destination.Pix) {
		t.Fatalf("closed backend painted or changed its error: %v", err)
	}
	rejected := b.Text("Hgx", s)
	if _, _, err := rejected.LayoutMetrics(); !errors.Is(err, ErrClosed) || rejected.Layout == nil {
		t.Fatal("closed Text did not carry a failing layout")
	}
	b.ClearError()
	if !errors.Is(b.Error(), ErrClosed) || len(line.Snapshot().Glyphs) == 0 || len(b.FontNotices()) == 0 {
		t.Fatal("close status was erased or immutable evidence became unavailable")
	}
}

func TestConcurrentCloseAndNativeCalls(t *testing.T) {
	b := openTestBackend(t)
	s := backendTestStyle()
	destination := transportImage(image.Rect(0, 0, 64, 24))
	context := canvas.TextPaintContext{Origin: fyne.NewPos(2, 1), Scale: 1, Clip: destination.Bounds(), Color: color.Black}
	start, shaped := make(chan struct{}), make(chan struct{}, 1)
	failures := make(chan error, 4)
	var workers sync.WaitGroup
	for i := 0; i < 4; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			for n := 0; n < 12; n++ {
				line, err := b.Shape("Hgx", s)
				if err == nil {
					select {
					case shaped <- struct{}{}:
					default:
					}
					err = line.PaintSoftware(destination, context)
				}
				if err != nil && !errors.Is(err, ErrClosed) {
					failures <- err
					return
				}
			}
		}()
	}
	close(start)
	select {
	case <-shaped:
	case err := <-failures:
		t.Fatalf("native calls failed before exercising concurrency: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatal("no native shape completed before the concurrent-close deadline")
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	workers.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	if !errors.Is(b.Error(), ErrClosed) {
		t.Fatal("concurrent close did not leave a visible closed state")
	}
}

func TestEmptyLineNoopStillValidatesStyleAndGeometry(t *testing.T) {
	b := openTestBackend(t)
	s := backendTestStyle()
	s.Color, s.Opacity = "rgba(17,35,43,0.5)", 0
	line, err := b.Shape("", s)
	if err != nil || len(line.Snapshot().Glyphs) != 0 {
		t.Fatalf("valid empty line rejected: %v", err)
	}
	destination := image.NewNRGBA(image.Rect(0, 0, 8, 4))
	before := bytes.Clone(destination.Pix)
	context := canvas.TextPaintContext{Scale: 1, Clip: destination.Bounds()}
	if err := line.PaintSoftware(destination, context); err != nil || !bytes.Equal(before, destination.Pix) {
		t.Fatalf("empty line wrote pixels or rejected its unused alpha: %v", err)
	}
	context.Scale = 3
	if err := line.PaintSoftware(destination, context); err == nil || !bytes.Equal(before, destination.Pix) {
		t.Fatal("empty line silently accepted unsupported scale or changed pixels")
	}
	for _, change := range []func(*webui.Style){
		func(s *webui.Style) { s.Color = "not-a-solid-color" },
		func(s *webui.Style) { s.Opacity = float32(math.NaN()) },
		func(s *webui.Style) { s.FontSize = 0 },
		func(s *webui.Style) { s.FontFamily = "missing" },
	} {
		bad := s
		change(&bad)
		if _, err := b.Shape("", bad); err == nil {
			t.Fatal("empty exception hid an invalid color, opacity, metric or font")
		}
	}
}

func TestNativeEditorEmptyAndUnsupportedPlaceholderPainting(t *testing.T) {
	test.NewTempApp(t)
	b := openTestBackend(t)
	s := backendTestStyle()
	changed := ""
	editor := b.Editor(false, s, func(value string) { changed = value })
	if _, duplicateFocus := editor.Object().(fyne.Focusable); duplicateFocus {
		t.Fatal("adapter introduced a second input focus owner")
	}
	editor.Layout(fyne.NewPos(8, 8), fyne.NewSize(144, 24))
	target := software.NewTransparentCanvas()
	target.SetPadded(false)
	target.Resize(fyne.NewSize(160, 40))
	background := canvas.NewRectangle(color.White)
	background.Resize(target.Size())
	target.SetContent(container.NewWithoutLayout(background, editor.Object()))
	empty := target.Capture().(*image.NRGBA)
	if b.Error() != nil {
		t.Fatalf("empty editor/no-placeholder construction was diagnosed as glyph paint: %v", b.Error())
	}
	for y := 0; y < empty.Bounds().Dy(); y++ {
		for x := 0; x < empty.Bounds().Dx(); x++ {
			if empty.NRGBAAt(x, y) != (color.NRGBA{R: 255, G: 255, B: 255, A: 255}) {
				t.Fatal("inactive empty editor painted unexpected pixels")
			}
		}
	}
	editor.TypedRune('x')
	painted := target.Capture().(*image.NRGBA)
	if changed != "x" || editor.Text() != "x" || b.Error() != nil || bytes.Equal(empty.Pix, painted.Pix) {
		t.Fatalf("native editor lost its event or glyph paint: %q %v", changed, b.Error())
	}
	editor.SetText("")
	editor.SetPlaceholder("Name")
	rejected := target.Capture().(*image.NRGBA)
	if b.Error() == nil || !bytes.Equal(empty.Pix, rejected.Pix) {
		t.Fatal("nonempty half-alpha placeholder painted opaque/fallback glyphs or hid its error")
	}
	renderer := test.WidgetRenderer(editor.Object().(fyne.Widget))
	found := false
	for _, object := range renderer.Objects() {
		if text, ok := object.(*canvas.Text); ok && text.Text == "Name" {
			found = true
			_, _, _, alpha := text.Color.RGBA()
			if _, _, err := text.LayoutMetrics(); err == nil || alpha == 65535 {
				t.Fatal("placeholder's unsupported actual color was silently replaced")
			}
		}
	}
	if !found {
		t.Fatal("placeholder error was not associated with a real canvas.Text")
	}
}

func TestUnsupportedTextAndStyleErrorsRemainVisible(t *testing.T) {
	b := openTestBackend(t)
	s := backendTestStyle()
	if err := b.ValidateText("outside \u03a9", s); err == nil {
		t.Fatal("unsupported script was silently forced into Latin")
	}
	previousError := b.Error()
	if previousError == nil {
		t.Fatal("validation error is not observable")
	}
	if _, err := b.Shape("Hgx", s); err != nil || b.Error() != previousError {
		t.Fatal("successful metrics hid the previous failure")
	}
	b.ClearError()
	if b.Error() != nil {
		t.Fatal("explicit error reset failed")
	}
	for _, change := range []func(*webui.Style){
		func(s *webui.Style) { s.Color = "rgba(17,35,43,0.5)" },
		func(s *webui.Style) { s.Opacity = 0 },
		func(s *webui.Style) { s.WhiteSpace = "normal" },
		func(s *webui.Style) { s.FontFamily = "missing, fallback" },
	} {
		bad := s
		change(&bad)
		text := b.Text("Hgx", bad)
		if _, _, err := text.LayoutMetrics(); err == nil || text.Layout == nil || b.Error() == nil {
			t.Fatal("unsupported style used default font metrics")
		}
	}
}

func TestRejectedLibraryFontAndPolicyConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*Options)
	}{
		{"relative library", func(o *Options) { o.LibraryPath = "text-engine.so" }},
		{"missing library", func(o *Options) { o.LibraryPath = filepath.Join(t.TempDir(), "missing-engine.so") }},
		{"policy enum", func(o *Options) { o.Policy.Hinting = 4 }},
		{"policy nonfinite", func(o *Options) { o.Policy.Gamma = float32(math.NaN()) }},
		{"missing notice", func(o *Options) {
			face := o.Fonts["AstroNoto"][webui.Font{Weight: 400}]
			face.License = nil
			o.Fonts["AstroNoto"][webui.Font{Weight: 400}] = face
		}},
		{"corrupt font", func(o *Options) {
			face := o.Fonts["AstroNoto"][webui.Font{Weight: 400}]
			face.Resource = fyne.NewStaticResource("corrupt.ttf", []byte("not a TrueType font"))
			o.Fonts["AstroNoto"][webui.Font{Weight: 400}] = face
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			options := backendTestOptions(t)
			tc.change(&options)
			backend, err := NewBackend(options)
			if backend != nil {
				if closeErr := backend.Close(); closeErr != nil {
					t.Error(closeErr)
				}
				t.Fatal("invalid configuration created a live backend")
			}
			if err == nil || !strings.Contains(err.Error(), "fontations:") {
				t.Fatalf("invalid configuration lacked a visible native diagnostic: %v", err)
			}
		})
	}
}
