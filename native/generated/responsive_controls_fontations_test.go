//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package generated

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/fontations"
)

type controlsNativeLine struct {
	ID       string              `json:"id"`
	Text     string              `json:"text"`
	Position fyne.Position       `json:"position"`
	Size     fyne.Size           `json:"size"`
	Baseline float32             `json:"baseline"`
	Color    color.NRGBA         `json:"color"`
	Snapshot fontations.Snapshot `json:"snapshot"`
}

type controlsNativeFrame struct {
	Case           string               `json:"case"`
	Action         string               `json:"action"`
	Viewport       flexViewport         `json:"viewport"`
	ScreenshotHash string               `json:"screenshotHash"`
	Lines          []controlsNativeLine `json:"lines"`
}

type controlsNativeBuildRecord struct {
	Schema               int               `json:"schema"`
	DiagnosticOnly       bool              `json:"diagnosticOnly"`
	PixelPerfectVerified bool              `json:"pixelPerfectVerified"`
	Sources              map[string]string `json:"sources"`
	SourceHash           string            `json:"sourceHash"`
	ScenarioHash         string            `json:"scenarioHash"`
	FontHash             string            `json:"fontHash"`
	FontLicenseHash      string            `json:"fontLicenseHash"`
	PolicyHash           string            `json:"policyHash"`
	LibraryHash          string            `json:"libraryHash"`
	ProductionGoModHash  string            `json:"productionGoModHash"`
	ProductionGoSumHash  string            `json:"productionGoSumHash"`
	Binary               struct {
		Name   string `json:"name"`
		SHA256 string `json:"sha256"`
	} `json:"binary"`
	BuildInfo struct {
		Name   string `json:"name"`
		SHA256 string `json:"sha256"`
	} `json:"buildInfo"`
}

func controlsNativeHash(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func controlsNativeRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func controlsNativeBuild(t *testing.T, root string) (json.RawMessage, controlsNativeBuildRecord, string) {
	t.Helper()
	path := os.Getenv("ASTRO_FYNE_FONTATIONS_CONTROLS_BUILD_RECORD")
	if !filepath.IsAbs(path) {
		t.Fatal("native controls require an explicit absolute build record")
	}
	data := controlsNativeRead(t, path)
	var record controlsNativeBuildRecord
	if err := json.Unmarshal(data, &record); err != nil {
		t.Fatal(err)
	}
	if record.Schema != 1 || !record.DiagnosticOnly || record.PixelPerfectVerified || len(record.Sources) == 0 ||
		record.SourceHash != ResponsiveControlsSourceHash || record.Binary.Name != "controls.test" || record.BuildInfo.Name != "test-build-info.txt" {
		t.Fatal("native controls build record is incomplete or belongs to another profile")
	}
	for name, expected := range record.Sources {
		if !filepath.IsLocal(name) || strings.Contains(name, "\\") || filepath.ToSlash(filepath.Clean(name)) != name {
			t.Fatalf("invalid controls source path %q", name)
		}
		path := filepath.Join(root, filepath.FromSlash(name))
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || controlsNativeHash(controlsNativeRead(t, path)) != expected {
			t.Fatalf("native controls source changed before capture: %s: %v", name, err)
		}
	}
	evidence := filepath.Dir(path)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.Stat(executable)
	if err != nil {
		t.Fatal(err)
	}
	retained, err := os.Stat(filepath.Join(evidence, record.Binary.Name))
	if err != nil || !os.SameFile(actual, retained) || controlsNativeHash(controlsNativeRead(t, executable)) != record.Binary.SHA256 ||
		controlsNativeHash(controlsNativeRead(t, filepath.Join(evidence, record.BuildInfo.Name))) != record.BuildInfo.SHA256 ||
		controlsNativeHash(controlsNativeRead(t, filepath.Join(root, "native/go.mod"))) != record.ProductionGoModHash ||
		controlsNativeHash(controlsNativeRead(t, filepath.Join(root, "native/go.sum"))) != record.ProductionGoSumHash {
		t.Fatal("native controls did not execute the retained binary with its unchanged module/build information")
	}
	return data, record, controlsNativeHash(data)
}

func controlsNativeLines(view *ResponsiveControlsWidget, state webui.ViewSnapshot, backend *fontations.Backend, fontHash string, policy fontations.Policy) ([]controlsNativeLine, error) {
	if err := backend.Error(); err != nil {
		return nil, err
	}
	nodes := controlsSnapshotNodes(state)
	owners := map[fyne.CanvasObject]string{}
	for id := range nodes {
		owners[view.Object(id)] = id
	}
	seen := map[string]bool{}
	lines := []controlsNativeLine{}
	var walk func(fyne.CanvasObject, fyne.Position, string) error
	walk = func(object fyne.CanvasObject, parent fyne.Position, owner string) error {
		if object == nil || !object.Visible() {
			return nil
		}
		position := parent.Add(object.Position())
		if id, exists := owners[object]; exists {
			owner = id
		}
		switch current := object.(type) {
		case *canvas.Text:
			if err := current.TextLayoutError(); err != nil {
				return fmt.Errorf("%s: %w", owner, err)
			}
			line, ok := current.Layout.(*fontations.Line)
			if !ok || seen[owner] {
				return fmt.Errorf("%s: expected one actual native text layout", owner)
			}
			node, exists := nodes[owner]
			if !exists || (node.Node.Kind != "text" && node.Node.Kind != "button" && node.Node.Kind != "input") {
				return fmt.Errorf("native text has no source leaf: %q", owner)
			}
			text := node.Node.Text
			if node.Node.Kind == "input" {
				text = node.Node.Value
			}
			ink, err := webui.ParseColor(node.Node.Style.Color)
			if err != nil || ink.A != 255 || current.Color == nil || color.NRGBAModel.Convert(current.Color) != ink {
				return fmt.Errorf("%s: native text changed the authored opaque color", owner)
			}
			metrics, baseline, err := current.LayoutMetrics()
			if err != nil || current.TextLayoutError() != nil {
				return fmt.Errorf("%s: native layout metrics or paint failed: %v", owner, err)
			}
			snapshot := line.Snapshot()
			if current.Text != text || current.FontSource == nil || controlsNativeHash(current.FontSource.Content()) != fontHash ||
				current.TextSize != 14 || current.Alignment != fyne.TextAlignLeading || metrics != current.Size() ||
				snapshot.Text != text || snapshot.SourceFontSHA256 != fontHash || snapshot.FontSize != 14 || snapshot.LineHeight != 20 ||
				snapshot.Policy != policy || snapshot.Metrics.Baseline != baseline {
				return fmt.Errorf("%s: native text changed its source, font, policy or line box", owner)
			}
			seen[owner] = true
			lines = append(lines, controlsNativeLine{owner, current.Text, position, current.Size(), baseline, ink, snapshot})
		case *fyne.Container:
			for _, child := range current.Objects {
				if err := walk(child, position, owner); err != nil {
					return err
				}
			}
		case fyne.Widget:
			for _, child := range test.WidgetRenderer(current).Objects() {
				if err := walk(child, position, owner); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := walk(view, fyne.NewPos(0, 0), ""); err != nil {
		return lines, err
	}
	if len(lines) != 10 {
		return lines, fmt.Errorf("expected all ten source text leaves, got %d", len(lines))
	}
	return lines, backend.Error()
}

func controlsNativeBackdrop(state webui.ViewSnapshot, captured image.Image) error {
	if state.Measured || !state.Responsive || len(state.Roots) != 1 || state.Size.Height != 320 {
		return fmt.Errorf("native controls require the existing source-only responsive frame")
	}
	root := state.Roots[0].Node
	background, err := webui.ParseColor(root.Style.Background)
	if err != nil || root.ID != "responsive-controls" || background != (color.NRGBA{255, 255, 255, 255}) ||
		root.Style.X != 0 || root.Style.Y != 0 || root.Style.Width != state.Size.Width || root.Style.Height != 320 {
		return fmt.Errorf("native controls lost the authored full-frame white root")
	}
	pixels, ok := captured.(*image.NRGBA)
	if !ok || pixels.Bounds() != image.Rect(0, 0, int(state.Size.Width), 320) {
		return fmt.Errorf("native controls require the actual DPR1 NRGBA capture")
	}
	for y := pixels.Rect.Min.Y; y < pixels.Rect.Max.Y; y++ {
		for x := pixels.Rect.Min.X; x < pixels.Rect.Max.X; x++ {
			if pixels.Pix[pixels.PixOffset(x, y)+3] != 255 {
				return fmt.Errorf("authored controls frame left a nonopaque pixel at %d,%d", x, y)
			}
		}
	}
	return nil
}

func TestGeneratedResponsiveControlsFontationsPointerTypingResizeAndCommit(t *testing.T) {
	root := os.Getenv("ASTRO_FYNE_FONTATIONS_SOURCE_ROOT")
	library := os.Getenv("ASTRO_FYNE_TEXT_LIBRARY")
	out := os.Getenv("ASTRO_FYNE_FONTATIONS_CONTROLS_ARTIFACTS")
	if !filepath.IsAbs(root) || !filepath.IsAbs(library) || !filepath.IsAbs(out) {
		t.Fatal("native controls require explicit absolute source, library and separate artifact paths")
	}
	actualRoot, err := os.Stat("../..")
	if err != nil {
		t.Fatal(err)
	}
	declaredRoot, err := os.Stat(root)
	if err != nil || !os.SameFile(actualRoot, declaredRoot) {
		t.Fatal("native controls source root differs from the compiled package")
	}
	if original := os.Getenv("ASTRO_FYNE_RESPONSIVE_CONTROLS_ARTIFACTS"); original != "" {
		original, err = filepath.Abs(original)
		if err != nil || filepath.Clean(original) == filepath.Clean(out) {
			t.Fatal("native controls must not overwrite the default-backend evidence")
		}
	}
	read := func(name string) []byte { return controlsNativeRead(t, filepath.Join(root, filepath.FromSlash(name))) }
	build, buildRecord, buildHash := controlsNativeBuild(t, root)
	font := NewResponsiveControlsResources()["example/public/fonts/NotoSans-Regular.ttf"]
	if font == nil || !bytes.Equal(font.Content(), read("example/public/fonts/NotoSans-Regular.ttf")) {
		t.Fatal("generated native controls font differs from the unchanged source font")
	}
	license := read("example/public/fonts/LICENSE-NotoSans.txt")
	policyBytes := read("ci/text-engine-probe/policy.json")
	var policy fontations.Policy
	if err := json.Unmarshal(policyBytes, &policy); err != nil {
		t.Fatal(err)
	}
	backend, err := fontations.NewBackend(fontations.Options{LibraryPath: library, Policy: policy,
		Fonts: map[string]map[webui.Font]fontations.LicensedFont{"AstroNoto": {
			{Weight: 400}: {Resource: font, License: fyne.NewStaticResource("LICENSE-NotoSans.txt", license)},
		}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backend.Close(); err != nil {
			t.Error(err)
		}
	})
	libraryHash := controlsNativeHash(controlsNativeRead(t, library))
	var scenario controlsScenario
	if err := decodeFlexJSON(read("responsive-controls-scenario.json"), &scenario); err != nil {
		t.Fatal(err)
	}
	scenarioBytes, err := json.Marshal(scenario)
	if err != nil {
		t.Fatal(err)
	}
	scenarioHash := controlsNativeHash(scenarioBytes)
	if len(scenario.Actions) != 21 || buildRecord.ScenarioHash != scenarioHash || buildRecord.LibraryHash != libraryHash ||
		buildRecord.PolicyHash != controlsNativeHash(policyBytes) || buildRecord.FontHash != controlsNativeHash(font.Content()) ||
		buildRecord.FontLicenseHash != controlsNativeHash(license) {
		t.Fatal("native controls resources or scenario differ from the actual build record")
	}
	report := struct {
		Schema               int                   `json:"schema"`
		DiagnosticOnly       bool                  `json:"diagnosticOnly"`
		PixelPerfectVerified bool                  `json:"pixelPerfectVerified"`
		SourceHash           string                `json:"sourceHash"`
		ScenarioHash         string                `json:"scenarioHash"`
		FontHash             string                `json:"fontHash"`
		FontLicenseHash      string                `json:"fontLicenseHash"`
		PolicyHash           string                `json:"policyHash"`
		LibraryHash          string                `json:"libraryHash"`
		ControlsBuild        json.RawMessage       `json:"controlsBuild"`
		ControlsBuildHash    string                `json:"controlsBuildHash"`
		TestBinaryHash       string                `json:"testBinaryHash"`
		TestBuildInfoHash    string                `json:"testBuildInfoHash"`
		Policy               fontations.Policy     `json:"policy"`
		Frames               []controlsNativeFrame `json:"frames"`
	}{Schema: 1, DiagnosticOnly: true, PixelPerfectVerified: false,
		SourceHash: ResponsiveControlsSourceHash, ScenarioHash: scenarioHash, FontHash: controlsNativeHash(font.Content()),
		FontLicenseHash: controlsNativeHash(license), PolicyHash: controlsNativeHash(policyBytes),
		LibraryHash: libraryHash, ControlsBuild: build, ControlsBuildHash: buildHash,
		TestBinaryHash: buildRecord.Binary.SHA256, TestBuildInfoHash: buildRecord.BuildInfo.SHA256,
		Policy: policy, Frames: []controlsNativeFrame{}}
	inspect := func(t *testing.T, action string, view *ResponsiveControlsWidget, target software.WindowlessCanvas, captured image.Image, state webui.ViewSnapshot) {
		t.Helper()
		if err := controlsNativeBackdrop(state, captured); err != nil {
			t.Errorf("%s: %v", action, err)
		}
		lines, err := controlsNativeLines(view, state, backend, report.FontHash, policy)
		if err != nil {
			t.Errorf("%s: %v", action, err)
		}
		index := len(report.Frames)
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, captured); err != nil {
			t.Fatal(err)
		}
		frame := controlsNativeFrame{Case: fmt.Sprintf("%02d-%s", index, action), Action: action,
			Viewport: flexViewport{int(target.Size().Width), 320, 1}, ScreenshotHash: controlsNativeHash(encoded.Bytes()), Lines: lines}
		report.Frames = append(report.Frames, frame)
		if err := writeFlexJSON(filepath.Join(out, "fontations-frames.json"), report); err != nil {
			t.Fatal(err)
		}
	}
	runResponsiveControls(t, controlsCaptureOptions{output: out, backend: backend, transparent: true, inspect: inspect})
	if len(report.Frames) != 22 || controlsNativeHash(controlsNativeRead(t, library)) != libraryHash {
		t.Fatal("native controls omitted a source frame or changed its library during capture")
	}
	if err := backend.Error(); err != nil {
		t.Fatal(err)
	}
}
