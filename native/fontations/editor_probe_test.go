//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontations_test

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/fontations"
)

type editorProbeSample struct {
	ID, Text, LineHeightSource string
	X, Y, Width, Height        float32
	FontSize, LineHeight       float32
	Padding, Border            float32
}

func TestHeldOutSingleLineEditorMetrics(t *testing.T) {
	root, output := os.Getenv("ASTRO_FYNE_FONTATIONS_SOURCE_ROOT"), os.Getenv("ASTRO_FYNE_FONTATIONS_ARTIFACTS")
	if root == "" || output == "" {
		t.Fatal("editor probe requires the hosted provider source and artifact paths")
	}
	providerBuild, providerBuildHash, testBinaryHash, testBuildInfoHash := probeProviderBuild(t, root)
	probeOutput := filepath.Join(output, "input-editor-metrics")
	if err := os.MkdirAll(probeOutput, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(probeOutput, "provider-build.json"), providerBuild, 0o644); err != nil {
		t.Fatal(err)
	}
	configBytes := probeRead(t, filepath.Join(root, "input-editor-metrics.json"))
	var input struct {
		Schema                          int
		Fixture, Foreground, Background string
		Viewport                        struct{ Width, Height int }
		Scales                          []int
		Font                            struct{ Family, Path string }
		Samples                         []editorProbeSample
	}
	probeJSON(t, configBytes, &input)
	if input.Schema != 1 || input.Viewport.Width != 512 || input.Viewport.Height != 320 || len(input.Samples) != 6 ||
		len(input.Scales) != 2 || input.Scales[0] != 1 || input.Scales[1] != 2 || input.Font.Family != "AstroNoto" {
		t.Fatal("held-out editor profile is incomplete")
	}
	fontBytes := probeRead(t, filepath.Join(root, input.Font.Path))
	fixtureHash, fontHash := probeHash(probeRead(t, filepath.Join(root, input.Fixture))), probeHash(fontBytes)
	identity, err := json.Marshal([]string{probeHash(configBytes), fixtureHash, fontHash})
	if err != nil {
		t.Fatal(err)
	}
	policyBytes := probeRead(t, filepath.Join(root, "ci/text-engine-probe/policy.json"))
	var policy fontations.Policy
	probeJSON(t, policyBytes, &policy)
	b, err := fontations.NewBackend(fontations.Options{LibraryPath: os.Getenv("ASTRO_FYNE_TEXT_LIBRARY"), Policy: policy,
		Fonts: map[string]map[webui.Font]fontations.LicensedFont{input.Font.Family: {{Weight: 400}: {
			Resource: fyne.NewStaticResource("NotoSans-Regular.ttf", fontBytes),
			License:  fyne.NewStaticResource("LICENSE-NotoSans.txt", probeRead(t, filepath.Join(root, "example/public/fonts/LICENSE-NotoSans.txt"))),
		}}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := b.Close(); err != nil {
			t.Error(err)
		}
	})
	app := test.NewApp()
	t.Cleanup(app.Quit)
	foreground, err := webui.ParseColor(input.Foreground)
	if err != nil || foreground.A != 255 {
		t.Fatal("held-out text requires its opaque source color")
	}
	children := make([]webui.Node, 0, len(input.Samples))
	samples := map[string]editorProbeSample{}
	for _, sample := range input.Samples {
		if _, duplicate := samples[sample.ID]; duplicate || sample.ID == "" || sample.Width <= 0 || sample.Height <= 0 ||
			(sample.LineHeightSource != "authored" && sample.LineHeightSource != "normal-font-metrics") {
			t.Fatal("invalid held-out editor sample")
		}
		samples[sample.ID] = sample
		style := webui.Style{Display: "block", Width: sample.Width, Height: sample.Height,
			PaddingTop: sample.Padding, PaddingBottom: sample.Padding, PaddingLeft: sample.Padding, PaddingRight: sample.Padding,
			BorderWidth: sample.Border, BorderColor: "#8899aa", Background: input.Background, Color: input.Foreground,
			FontFamily: input.Font.Family, FontSize: sample.FontSize, FontWeight: 400, FontStyle: "normal",
			LineHeight: sample.LineHeight, WhiteSpace: "nowrap", TextAlign: "left", Opacity: 1,
			Flex: &webui.FlexStyle{Basis: webui.FlexValue(sample.Height), MinWidth: webui.FlexValue(0), MinHeight: webui.FlexValue(0),
				WidthSet: true, HeightSet: true, Shrink: webui.FlexValue(0), BoxSizing: "border-box", MarginSet: true, Appearance: "none", BorderStyle: "solid"}}
		children = append(children, webui.Node{ID: sample.ID, Kind: "input", Value: sample.Text, Style: style})
	}
	for _, scale := range input.Scales {
		v := webui.NewView(func() []webui.Node {
			return []webui.Node{{ID: "input-editor-metrics", Kind: "container",
				Style: webui.Style{Display: "flex", Direction: "column", Height: float32(input.Viewport.Height), Gap: 12,
					PaddingTop: 16, PaddingBottom: 16, PaddingLeft: 16, PaddingRight: 16, Background: input.Background,
					Flex: &webui.FlexStyle{WidthPercent: webui.FlexValue(100), WidthSet: true, HeightSet: true, BoxSizing: "border-box", AlignItems: "flex-start"}}, Children: children}}
		}, b)
		target := software.NewTransparentCanvas()
		target.SetPadded(false)
		target.SetScale(float32(scale))
		target.Resize(fyne.NewSize(float32(input.Viewport.Width), float32(input.Viewport.Height)))
		target.SetContent(v)
		if err := v.BindCanvas(target); err != nil {
			t.Fatal(err)
		}
		captured := target.Capture()
		if v.Error() != nil || b.Error() != nil || captured.Bounds() != image.Rect(0, 0, input.Viewport.Width*scale, input.Viewport.Height*scale) {
			t.Fatalf("held-out native editor frame failed: %v %v", v.Error(), b.Error())
		}
		snapshot, err := v.Snapshot()
		if err != nil || len(snapshot.Roots) != 1 || len(snapshot.Roots[0].Children) != 6 || !snapshot.Responsive || snapshot.Measured {
			t.Fatal("held-out editor source frame is incomplete")
		}
		owners := map[fyne.CanvasObject]string{}
		for _, node := range snapshot.Roots[0].Children {
			sample := samples[node.Node.ID]
			if node.Node.Style.LineHeight != sample.LineHeight || node.Node.Style.Height != sample.Height || node.Node.Style.Width != sample.Width || node.Node.Style.X != sample.X || node.Node.Style.Y != sample.Y {
				t.Fatal("authored outer line height or box changed")
			}
			owners[node.Object] = node.Node.ID
		}
		lines := map[string]any{}
		var walk func(fyne.CanvasObject, fyne.Position, string)
		walk = func(object fyne.CanvasObject, offset fyne.Position, owner string) {
			if id, ok := owners[object]; ok {
				owner = id
			}
			position := offset.Add(object.Position())
			switch current := object.(type) {
			case *canvas.Text:
				sample, exists := samples[owner]
				line, ok := current.Layout.(*fontations.Line)
				if !exists || !ok || lines[owner] != nil {
					t.Fatal("unexpected or repeated native editor text")
				}
				shape := line.Snapshot()
				metrics, baseline, err := current.LayoutMetrics()
				used := sample.LineHeight
				if sample.LineHeightSource == "normal-font-metrics" {
					used = float32(math.Round(float64(shape.Metrics.Ascent)) + math.Round(float64(shape.Metrics.Descent)) + math.Round(float64(shape.Metrics.Leading)))
				}
				inset := sample.Padding + sample.Border
				expected := fyne.NewPos(sample.X+inset, sample.Y+inset+(sample.Height-2*inset-used)/2)
				if err != nil || current.Text != sample.Text || current.TextLayoutError() != nil || metrics != current.Size() || baseline != shape.Metrics.Baseline ||
					current.Size().Height != used || shape.LineHeight != used || position != expected || current.TextSize != sample.FontSize || shape.FontSize != sample.FontSize ||
					shape.Policy != policy || shape.SourceFontSHA256 != fontHash || current.FontSource == nil || probeHash(current.FontSource.Content()) != fontHash ||
					current.Color == nil || color.NRGBAModel.Convert(current.Color) != foreground {
					t.Fatalf("%s: used editor line box/source differs: position %v want %v height %v want %v", owner, position, expected, current.Size().Height, used)
				}
				lines[owner] = map[string]any{"id": owner, "text": current.Text, "position": position, "size": current.Size(), "baseline": baseline,
					"authoredLineHeightCSS": sample.LineHeight, "lineHeightSource": sample.LineHeightSource, "snapshot": shape}
			case fyne.Widget:
				for _, child := range test.WidgetRenderer(current).Objects() {
					walk(child, position, owner)
				}
			}
		}
		walk(v, fyne.NewPos(0, 0), "")
		if len(lines) != 6 {
			t.Fatal("held-out native editor text is missing")
		}
		dir := filepath.Join(output, "input-editor-metrics", fmt.Sprintf("scale-%d", scale))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		file, err := os.Create(filepath.Join(dir, "native.png"))
		if err != nil {
			t.Fatal(err)
		}
		if err := png.Encode(file, captured); err != nil {
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
		data, err := json.MarshalIndent(map[string]any{"schema": 1, "diagnosticOnly": true, "pixelPerfectVerified": false,
			"sourceHash": probeHash(identity), "probeHash": probeHash(configBytes), "fixtureHash": fixtureHash, "fontHash": fontHash,
			"policyHash": probeHash(policyBytes), "libraryHash": probeHash(probeRead(t, os.Getenv("ASTRO_FYNE_TEXT_LIBRARY"))),
			"providerBuildHash": providerBuildHash, "testBinaryHash": testBinaryHash, "testBuildInfoHash": testBuildInfoHash,
			"viewport":       map[string]int{"width": input.Viewport.Width, "height": input.Viewport.Height, "scale": scale},
			"screenshotHash": probeHash(probeRead(t, filepath.Join(dir, "native.png"))), "lines": lines}, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "native.json"), append(data, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		target.SetContent(nil)
	}
}
