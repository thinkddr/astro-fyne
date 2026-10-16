//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontations_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/fontations"
)

type probeSample struct {
	ID       string   `json:"id"`
	Text     string   `json:"text"`
	X        float32  `json:"x"`
	Y        float32  `json:"y"`
	Width    float32  `json:"width"`
	Height   float32  `json:"height"`
	FontSize *float32 `json:"fontSize"`
}

type probeInput struct {
	Schema     int    `json:"schema"`
	Fixture    string `json:"fixture"`
	Foreground string `json:"foreground"`
	Background string `json:"background"`
	Scales     []int  `json:"scales"`
	Viewport   struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"viewport"`
	Font struct {
		Family     string  `json:"family"`
		Path       string  `json:"path"`
		Weight     int     `json:"weight"`
		Style      string  `json:"style"`
		Size       float32 `json:"size"`
		LineHeight float32 `json:"lineHeight"`
	} `json:"font"`
	Samples []probeSample `json:"samples"`
}

type probeLine struct {
	ID             string          `json:"id"`
	Text           string          `json:"text"`
	Position       fyne.Position   `json:"position"`
	Size           fyne.Size       `json:"size"`
	BackendMeasure fyne.Size       `json:"backendMeasure"`
	Baseline       float32         `json:"baseline"`
	FontHash       string          `json:"fontHash"`
	Snapshot       json.RawMessage `json:"snapshot"`
}

type probeFrame struct {
	Scale   int         `json:"scale"`
	Width   int         `json:"width"`
	Height  int         `json:"height"`
	Path    string      `json:"path"`
	Hash    string      `json:"hash"`
	Samples []probeLine `json:"samples"`
}

type probeBuildRecord struct {
	Schema               int               `json:"schema"`
	DiagnosticOnly       bool              `json:"diagnosticOnly"`
	PixelPerfectVerified bool              `json:"pixelPerfectVerified"`
	Sources              map[string]string `json:"sources"`
	Binary               struct {
		Name   string `json:"name"`
		SHA256 string `json:"sha256"`
	} `json:"binary"`
	BuildInfo struct {
		Name   string `json:"name"`
		SHA256 string `json:"sha256"`
	} `json:"buildInfo"`
	ModuleContext struct {
		ProductionGoModHash          string `json:"productionGoModHash"`
		ProductionGoSumHash          string `json:"productionGoSumHash"`
		RetainedGoModHash            string `json:"retainedGoModHash"`
		RetainedGoSumHash            string `json:"retainedGoSumHash"`
		SelectedModulesHash          string `json:"selectedModulesHash"`
		UsesPublishedModule          bool   `json:"usesPublishedProductionModule"`
		TemporaryFyneReplacement     bool   `json:"temporaryFyneReplacement"`
		DependencyChangedDuringBuild bool   `json:"productionDependencyChangedDuringBuild"`
	} `json:"moduleContext"`
}

func probeSources(t *testing.T, root string) map[string]string {
	t.Helper()
	names := []string{"native/go.mod", "native/go.sum", "ci/text-engine-probe/compare-fyne.py",
		"ci/text-engine-probe/test-fyne-remote.sh", "ci/text-engine-probe/fyne-hook-pin.json"}
	native := filepath.Join(root, "native")
	err := filepath.WalkDir(native, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(native, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		if entry.IsDir() {
			if name == "generated" {
				return filepath.SkipDir
			}
			return nil
		}
		extension := filepath.Ext(name)
		if extension == ".go" || (strings.HasPrefix(name, "fontations/") &&
			(extension == ".c" || extension == ".cc" || extension == ".h" || entry.Name() == "LICENSE-Chromium")) {
			names = append(names, "native/"+name)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	result := make(map[string]string, len(names))
	for _, name := range names {
		path := filepath.Join(root, filepath.FromSlash(name))
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			t.Fatalf("provider source is not a regular file: %s: %v", name, err)
		}
		result[name] = probeHash(probeRead(t, path))
	}
	return result
}

func probeProviderBuild(t *testing.T, root string) (json.RawMessage, string, string, string) {
	t.Helper()
	path := os.Getenv("ASTRO_FYNE_FONTATIONS_BUILD_RECORD")
	if path == "" || !filepath.IsAbs(path) {
		t.Fatal("the hosted probe requires an absolute provider build record")
	}
	data := probeRead(t, path)
	var record probeBuildRecord
	probeJSON(t, data, &record)
	if record.Schema != 1 || !record.DiagnosticOnly || record.PixelPerfectVerified ||
		!reflect.DeepEqual(record.Sources, probeSources(t, root)) || record.Binary.Name != "fontations.test" ||
		record.BuildInfo.Name != "test-build-info.txt" || !record.ModuleContext.UsesPublishedModule ||
		record.ModuleContext.TemporaryFyneReplacement || record.ModuleContext.DependencyChangedDuringBuild {
		t.Fatal("provider source/build record differs from the current source and bounded module selection")
	}
	provider := filepath.Dir(path)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.Stat(executable)
	if err != nil {
		t.Fatal(err)
	}
	retained, err := os.Stat(filepath.Join(provider, record.Binary.Name))
	if err != nil || !os.SameFile(actual, retained) {
		t.Fatal("the probe is not running the retained provider test binary")
	}
	binaryHash := probeHash(probeRead(t, executable))
	infoHash := probeHash(probeRead(t, filepath.Join(provider, record.BuildInfo.Name)))
	if binaryHash != record.Binary.SHA256 || infoHash != record.BuildInfo.SHA256 {
		t.Fatal("executed provider binary/build information differs from its capture binding")
	}
	for name, expected := range map[string]string{
		filepath.Join(root, "native/go.mod"):             record.ModuleContext.ProductionGoModHash,
		filepath.Join(root, "native/go.sum"):             record.ModuleContext.ProductionGoSumHash,
		filepath.Join(provider, "provider.mod"):          record.ModuleContext.RetainedGoModHash,
		filepath.Join(provider, "provider.sum"):          record.ModuleContext.RetainedGoSumHash,
		filepath.Join(provider, "selected-modules.json"): record.ModuleContext.SelectedModulesHash,
	} {
		if probeHash(probeRead(t, name)) != expected {
			t.Fatalf("provider module context changed before capture: %s", name)
		}
	}
	return data, probeHash(data), binaryHash, infoHash
}

func probeHash(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func probeRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func probeJSON(t *testing.T, data []byte, value any) {
	t.Helper()
	if err := json.Unmarshal(data, value); err != nil {
		t.Fatal(err)
	}
}

func TestOriginalTypographyProbeThroughFyne(t *testing.T) {
	root, output, library := os.Getenv("ASTRO_FYNE_FONTATIONS_SOURCE_ROOT"), os.Getenv("ASTRO_FYNE_FONTATIONS_ARTIFACTS"), os.Getenv("ASTRO_FYNE_TEXT_LIBRARY")
	if root == "" || output == "" || library == "" {
		t.Fatal("the hosted probe requires explicit source, artifact and native library paths")
	}
	providerBuild, providerBuildHash, testBinaryHash, testBuildInfoHash := probeProviderBuild(t, root)
	probeBytes := probeRead(t, filepath.Join(root, "typography-probe.json"))
	var input probeInput
	probeJSON(t, probeBytes, &input)
	var pin struct {
		ProbeHash   string `json:"probeHash"`
		FixtureHash string `json:"fixtureHash"`
		FontHash    string `json:"fontHash"`
		SourceHash  string `json:"sourceHash"`
	}
	probeJSON(t, probeRead(t, filepath.Join(root, "ci/text-engine-probe/probe-pin.json")), &pin)
	fontBytes := probeRead(t, filepath.Join(root, input.Font.Path))
	fixtureBytes := probeRead(t, filepath.Join(root, input.Fixture))
	if input.Schema != 1 || input.Viewport.Width != 512 || input.Viewport.Height != 256 || len(input.Samples) != 7 ||
		len(input.Scales) != 2 || input.Scales[0] != 1 || input.Scales[1] != 2 ||
		probeHash(probeBytes) != pin.ProbeHash || probeHash(fontBytes) != pin.FontHash || probeHash(fixtureBytes) != pin.FixtureHash {
		t.Fatal("the real Fyne probe requires the unchanged seven-row source, font and fixture")
	}
	identity, err := json.Marshal([]string{pin.ProbeHash, pin.FixtureHash, pin.FontHash})
	if err != nil || probeHash(identity) != pin.SourceHash {
		t.Fatal("the source identity differs from its declared pin")
	}
	policyBytes := probeRead(t, filepath.Join(root, "ci/text-engine-probe/policy.json"))
	var policy fontations.Policy
	probeJSON(t, policyBytes, &policy)
	font := fyne.NewStaticResource(input.Font.Path, fontBytes)
	license := fyne.NewStaticResource("LICENSE-NotoSans.txt", probeRead(t, filepath.Join(root, "example/public/fonts/LICENSE-NotoSans.txt")))
	backend, err := fontations.NewBackend(fontations.Options{LibraryPath: library, Policy: policy,
		Fonts: map[string]map[webui.Font]fontations.LicensedFont{input.Font.Family: {
			{Weight: input.Font.Weight, Italic: false}: {Resource: font, License: license},
		}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backend.Close(); err != nil {
			t.Error(err)
		}
	})
	app := test.NewApp()
	t.Cleanup(app.Quit)
	background, err := webui.ParseColor(input.Background)
	if err != nil || background.A != 255 {
		t.Fatal("the source background must be opaque")
	}
	foreground, err := webui.ParseColor(input.Foreground)
	if err != nil || foreground.A != 255 {
		t.Fatal("the source foreground must be opaque")
	}
	frames := make([]probeFrame, 0, len(input.Scales))
	for _, scale := range input.Scales {
		target := software.NewTransparentCanvas()
		target.SetPadded(false)
		target.SetScale(float32(scale))
		target.Resize(fyne.NewSize(float32(input.Viewport.Width), float32(input.Viewport.Height)))
		fill := canvas.NewRectangle(background)
		fill.Resize(target.Size())
		objects := []fyne.CanvasObject{fill}
		texts := make([]*canvas.Text, len(input.Samples))
		lines := make([]probeLine, 0, len(input.Samples))
		for index, sample := range input.Samples {
			size := input.Font.Size
			if sample.FontSize != nil {
				size = *sample.FontSize
			}
			style := webui.Style{Measured: true, FontFamily: input.Font.Family, FontSize: size,
				FontWeight: float32(input.Font.Weight), FontStyle: input.Font.Style, LineHeight: input.Font.LineHeight,
				Color: input.Foreground, WhiteSpace: "nowrap", TextAlign: "left", Opacity: 1}
			if err := backend.Validate(style, true); err != nil {
				t.Fatal(err)
			}
			if err := backend.ValidateText(sample.Text, style); err != nil {
				t.Fatal(err)
			}
			measured := backend.Measure(sample.Text, style)
			text := backend.Text(sample.Text, style)
			backend.PlaceText(text, style, sample.X, sample.Y)
			metrics, baseline, err := text.LayoutMetrics()
			line, ok := text.Layout.(*fontations.Line)
			if err != nil || !ok || text.FontSource == nil || probeHash(text.FontSource.Content()) != pin.FontHash ||
				text.Text != sample.Text || text.TextSize != size || color.NRGBAModel.Convert(text.Color) != foreground ||
				text.Position() != fyne.NewPos(sample.X, sample.Y) || text.Size() != measured || metrics != measured ||
				measured.Width > sample.Width || measured.Height != sample.Height {
				t.Fatalf("%s: native Fyne text changed the requested line geometry or source", sample.ID)
			}
			snapshot, err := json.Marshal(line.Snapshot())
			if err != nil {
				t.Fatal(err)
			}
			lines = append(lines, probeLine{ID: sample.ID, Text: text.Text, Position: text.Position(), Size: text.Size(),
				BackendMeasure: measured, Baseline: baseline, FontHash: pin.FontHash, Snapshot: snapshot})
			texts[index] = text
			objects = append(objects, text)
		}
		target.SetContent(container.NewWithoutLayout(objects...))
		captured := target.Capture()
		if captured.Bounds() != image.Rect(0, 0, input.Viewport.Width*scale, input.Viewport.Height*scale) {
			t.Fatal("the physical Fyne viewport differs from the source")
		}
		for _, text := range texts {
			if err := text.TextLayoutError(); err != nil {
				t.Fatal(err)
			}
		}
		if err := backend.Error(); err != nil {
			t.Fatal(err)
		}
		name := fmt.Sprintf("scale-%d/fyne.png", scale)
		path := filepath.Join(output, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		file, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		encodeErr, closeErr := png.Encode(file, captured), file.Close()
		if encodeErr != nil || closeErr != nil {
			t.Fatalf("PNG write failed: %v / %v", encodeErr, closeErr)
		}
		frames = append(frames, probeFrame{Scale: scale, Width: captured.Bounds().Dx(), Height: captured.Bounds().Dy(),
			Path: name, Hash: probeHash(probeRead(t, path)), Samples: lines})
	}
	report := map[string]any{"schema": 1, "diagnosticOnly": true, "pixelPerfectVerified": false,
		"browserEffectivePolicyVerified": false, "nativeScalerInternalsObserved": false,
		"sourceHash": pin.SourceHash, "probeHash": pin.ProbeHash, "fixtureHash": pin.FixtureHash, "fontHash": pin.FontHash,
		"libraryHash": probeHash(probeRead(t, library)), "policyHash": probeHash(policyBytes), "nativePolicy": policy,
		"testHash":      probeHash(probeRead(t, filepath.Join(root, "native/fontations/probe_external_test.go"))),
		"providerBuild": providerBuild, "providerBuildHash": providerBuildHash,
		"testBinaryHash": testBinaryHash, "testBuildInfoHash": testBuildInfoHash,
		"fyneRevision": os.Getenv("ASTRO_FYNE_FONTATIONS_FYNE_REVISION"), "frames": frames,
		"scope": "Real Fyne canvas.Text and software painter; generated widgets, editors, inverse conversion and GPU remain separate"}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(output, "fyne-text.json"), append(data, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}
