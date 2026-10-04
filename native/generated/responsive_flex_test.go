// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package generated

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/reverse"
)

// Chromium's layout coordinates are quantized to CSS 1/64 pixels. This explicit
// geometry bound never changes the separate zero-difference PNG comparison.
const flexGeometryTolerance = 1.0 / 64.0

type flexViewportCase struct {
	Name   string `json:"name"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Scale  int    `json:"scale"`
}

type flexScenario struct {
	Schema int                `json:"schema"`
	Cases  []flexViewportCase `json:"cases"`
	IDs    []string           `json:"ids"`
}

type flexViewport struct {
	Width  int `json:"width"`
	Height int `json:"height"`
	Scale  int `json:"scale"`
}

type flexRectangle struct {
	Parent *string `json:"parent"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

func (rectangle *flexRectangle) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if len(fields) != 5 {
		return fmt.Errorf("flex rectangle requires parent, x, y, width and height")
	}
	for _, key := range []string{"parent", "x", "y", "width", "height"} {
		if _, exists := fields[key]; !exists || key != "parent" && bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null")) {
			return fmt.Errorf("flex rectangle is missing %q", key)
		}
	}
	type wireRectangle flexRectangle
	if err := decodeFlexJSON(data, (*wireRectangle)(rectangle)); err != nil {
		return err
	}
	for _, value := range []float64{rectangle.X, rectangle.Y, rectangle.Width, rectangle.Height} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("flex rectangle requires finite geometry")
		}
	}
	if rectangle.Width < 0 || rectangle.Height < 0 {
		return fmt.Errorf("flex rectangle requires nonnegative dimensions")
	}
	return nil
}

type flexGeometry struct {
	Schema         int                      `json:"schema"`
	SourceHash     string                   `json:"sourceHash"`
	ScenarioHash   string                   `json:"scenarioHash"`
	Case           string                   `json:"case"`
	Viewport       flexViewport             `json:"viewport"`
	ScreenshotHash string                   `json:"screenshotHash"`
	Nodes          map[string]flexRectangle `json:"nodes"`
}

func decodeFlexJSON(data []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("flex artifact must contain exactly one JSON object: %v", err)
	}
	return nil
}

func readFlexScenario(t *testing.T) (flexScenario, string) {
	t.Helper()
	data, err := os.ReadFile("../../responsive-flex-scenario.json")
	if err != nil {
		t.Fatal(err)
	}
	var scenario flexScenario
	if err := decodeFlexJSON(data, &scenario); err != nil {
		t.Fatal(err)
	}
	if scenario.Schema != 1 || len(scenario.Cases) == 0 || len(scenario.IDs) == 0 || scenario.IDs[0] != "responsive-flex" {
		t.Fatal("flex scenario requires schema 1, cases and explicit root/IDs")
	}
	seen := map[string]bool{}
	for _, id := range scenario.IDs {
		if !regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*$`).MatchString(id) || seen[id] {
			t.Fatalf("invalid or duplicate flex ID %q", id)
		}
		seen[id] = true
	}
	seen = map[string]bool{}
	for _, item := range scenario.Cases {
		if !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`).MatchString(item.Name) || seen[item.Name] || item.Width < 1 || item.Width > 16384 || item.Height < 1 || item.Height > 16384 || item.Scale != 1 && item.Scale != 2 {
			t.Fatalf("invalid or duplicate flex viewport case %+v", item)
		}
		seen[item.Name] = true
	}
	digest := sha256.Sum256(data)
	return scenario, hex.EncodeToString(digest[:])
}

func sameFlexParent(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func compareFlexRectangles(ids []string, reference, actual map[string]flexRectangle) error {
	if len(reference) != len(ids) || len(actual) != len(ids) {
		return fmt.Errorf("flex geometry requires all %d IDs, got reference=%d native=%d", len(ids), len(reference), len(actual))
	}
	var failures []error
	for _, id := range ids {
		want, wanted := reference[id]
		got, present := actual[id]
		if !wanted || !present {
			failures = append(failures, fmt.Errorf("flex ID %q is missing from reference or native frame", id))
			continue
		}
		if !sameFlexParent(want.Parent, got.Parent) {
			failures = append(failures, fmt.Errorf("flex ID %q has a different parent", id))
		}
		for _, field := range []struct {
			name      string
			want, got float64
		}{
			{"x", want.X, got.X}, {"y", want.Y, got.Y},
			{"width", want.Width, got.Width}, {"height", want.Height, got.Height},
		} {
			if math.IsNaN(field.want) || math.IsInf(field.want, 0) || math.IsNaN(field.got) || math.IsInf(field.got, 0) ||
				(field.name == "width" || field.name == "height") && (field.want < 0 || field.got < 0) {
				failures = append(failures, fmt.Errorf("flex ID %q has invalid %s", id, field.name))
			} else if delta := math.Abs(field.want - field.got); delta > flexGeometryTolerance {
				failures = append(failures, fmt.Errorf("flex ID %q %s: browser=%v native=%v delta=%v > %v CSS pixels", id, field.name, field.want, field.got, delta, flexGeometryTolerance))
			}
		}
	}
	return errors.Join(failures...)
}

func flexSnapshotRectangles(snapshot webui.ViewSnapshot) (map[string]flexRectangle, error) {
	return snapshotRectangles(snapshot, true)
}

func responsiveSnapshotRectangles(snapshot webui.ViewSnapshot) (map[string]flexRectangle, error) {
	return snapshotRectangles(snapshot, false)
}

// The original rectangle corpus retains its empty-container restriction. The
// wider source corpus measures supported leaves without weakening ID, resolved
// metadata or finite-geometry validation for either kind of oracle.
func snapshotRectangles(snapshot webui.ViewSnapshot, containersOnly bool) (map[string]flexRectangle, error) {
	rectangles := map[string]flexRectangle{}
	var walk func([]webui.SnapshotNode, *string) error
	walk = func(nodes []webui.SnapshotNode, parent *string) error {
		for _, node := range nodes {
			id := node.Node.ID
			if _, exists := rectangles[id]; exists || id == "" {
				return fmt.Errorf("native responsive corpus requires unique nonempty IDs: %q", id)
			}
			if containersOnly && (node.Node.Kind != "container" || node.Node.Text != "") {
				return fmt.Errorf("native flex corpus requires empty rectangles: %q", id)
			}
			switch node.Node.Kind {
			case "container", "text", "button", "input", "image":
			default:
				return fmt.Errorf("native responsive corpus has unsupported kind %q on %q", node.Node.Kind, id)
			}
			if node.Node.Style.Flex != nil {
				return fmt.Errorf("native snapshot %q retained source-only layout metadata", id)
			}
			s := node.Node.Style
			for _, value := range []float32{s.X, s.Y, s.Width, s.Height} {
				if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
					return fmt.Errorf("native responsive snapshot %q has nonfinite geometry", id)
				}
			}
			if s.Width < 0 || s.Height < 0 {
				return fmt.Errorf("native responsive snapshot %q has negative dimensions", id)
			}
			rectangles[id] = flexRectangle{parent, float64(s.X), float64(s.Y), float64(s.Width), float64(s.Height)}
			if err := walk(node.Children, &id); err != nil {
				return err
			}
		}
		return nil
	}
	return rectangles, walk(snapshot.Roots, nil)
}

func readFlexReference(out string, item flexViewportCase, sourceHash, scenarioHash string) (flexGeometry, error) {
	var reference flexGeometry
	data, err := os.ReadFile(filepath.Join(out, item.Name, "geometry.json"))
	if err != nil {
		return reference, err
	}
	if err := decodeFlexJSON(data, &reference); err != nil {
		return reference, err
	}
	if reference.Schema != 1 || reference.SourceHash != sourceHash || reference.ScenarioHash != scenarioHash || reference.Case != item.Name || reference.Viewport != (flexViewport{item.Width, item.Height, item.Scale}) {
		return reference, fmt.Errorf("browser flex geometry belongs to another source/scenario/viewport: %s", item.Name)
	}
	screenshot, err := os.ReadFile(filepath.Join(out, item.Name, "web.png"))
	if err != nil {
		return reference, err
	}
	digest := sha256.Sum256(screenshot)
	if hex.EncodeToString(digest[:]) != reference.ScreenshotHash {
		return reference, fmt.Errorf("browser PNG hash does not match captured geometry: %s", item.Name)
	}
	config, err := png.DecodeConfig(bytes.NewReader(screenshot))
	if err != nil || config.Width != item.Width*item.Scale || config.Height != item.Height*item.Scale {
		return reference, fmt.Errorf("browser PNG dimensions do not match CSS viewport/device scale: %s (%v)", item.Name, err)
	}
	return reference, nil
}

func writeFlexJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}

func TestGeneratedResponsiveFlexResizesOneSourceTreeWithoutMeasurements(t *testing.T) {
	scenario, scenarioHash := readFlexScenario(t)
	out := os.Getenv("ASTRO_FYNE_RESPONSIVE_FLEX_ARTIFACTS")
	if out != "" && os.Getenv("ASTRO_FYNE_RESPONSIVE_FLEX_SOURCE_HASH") != ResponsiveFlexSourceHash {
		t.Fatal("generated flex widget does not match the analyzed browser source")
	}
	app := test.NewApp()
	t.Cleanup(app.Quit)
	view, err := NewResponsiveFlex(webui.Scope{}, webui.Actions{})
	if err != nil {
		t.Fatal(err)
	}
	target := software.NewCanvas()
	target.SetPadded(false)
	first := scenario.Cases[0]
	target.SetScale(float32(first.Scale))
	target.Resize(fyne.NewSize(float32(first.Width), float32(first.Height)))
	target.SetContent(view)
	if err := view.BindCanvas(target); err != nil {
		t.Fatal(err)
	}
	objects := map[string]fyne.CanvasObject{}
	previousSizes := map[int]map[string]flexRectangle{}
	for _, id := range scenario.IDs {
		objects[id] = view.Object(id)
		if objects[id] == nil {
			t.Fatalf("generated flex rectangle %q is missing", id)
		}
	}
	for _, item := range scenario.Cases {
		t.Run(item.Name, func(t *testing.T) {
			// Both widget and canvas are created once. No browser profile is applied,
			// including after returning to a previous width or changing device scale.
			target.SetScale(float32(item.Scale))
			size := fyne.NewSize(float32(item.Width), float32(item.Height))
			target.Resize(size)
			view.Resize(size)
			view.Refresh()
			capture := target.Capture()
			if capture.Bounds() != image.Rect(0, 0, item.Width*item.Scale, item.Height*item.Scale) {
				t.Fatalf("native flex PNG has incorrect physical dimensions: %v", capture.Bounds())
			}
			snapshot, err := view.Snapshot()
			if err != nil {
				t.Fatal(err)
			}
			if snapshot.Measured || snapshot.Size != size || snapshot.HasFocus {
				t.Fatalf("responsive flex must be an unmeasured unfocused source frame: %+v", snapshot)
			}
			for _, id := range scenario.IDs {
				if view.Object(id) != objects[id] {
					t.Errorf("resize remounted native rectangle %q", id)
				}
			}
			rectangles, err := flexSnapshotRectangles(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if err := compareFlexRectangles(scenario.IDs, rectangles, rectangles); err != nil {
				t.Fatal(err)
			}
			root := rectangles["responsive-flex"]
			if root.Parent != nil || root.X != 0 || root.Y != 0 || root.Width != float64(item.Width) || root.Height != float64(item.Height) {
				t.Fatalf("source root width 100%% / height 640 did not fill the actual canvas: %+v", root)
			}
			if previous, exists := previousSizes[item.Width]; exists {
				if err := compareFlexRectangles(scenario.IDs, previous, rectangles); err != nil {
					t.Fatalf("returning to a viewport or changing device scale changed CSS layout: %v", err)
				}
			} else {
				previousSizes[item.Width] = rectangles
			}
			if out == "" {
				return
			}
			caseOut := filepath.Join(out, item.Name)
			if err := os.MkdirAll(caseOut, 0755); err != nil {
				t.Fatal(err)
			}
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, capture); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(caseOut, "native.png"), encoded.Bytes(), 0644); err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(encoded.Bytes())
			native := flexGeometry{1, ResponsiveFlexSourceHash, scenarioHash, item.Name, flexViewport{item.Width, item.Height, item.Scale}, hex.EncodeToString(digest[:]), rectangles}
			if err := writeFlexJSON(filepath.Join(caseOut, "native-geometry.json"), native); err != nil {
				t.Fatal(err)
			}
			scene, err := reverse.Export(view, reverse.Options{Viewport: reverse.Viewport{Width: float32(item.Width), Height: float32(item.Height), Scale: float32(item.Scale)}, Canvas: target})
			if err != nil {
				t.Fatal(err)
			}
			if err := writeFlexJSON(filepath.Join(caseOut, "scene.json"), scene); err != nil {
				t.Fatal(err)
			}
			reference, err := readFlexReference(out, item, ResponsiveFlexSourceHash, scenarioHash)
			if err != nil {
				t.Fatal(err)
			}
			if err := compareFlexRectangles(scenario.IDs, reference.Nodes, rectangles); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestResponsiveFlexGeometryGateRejectsRealPerturbations(t *testing.T) {
	ids := []string{"responsive-flex"}
	reference := map[string]flexRectangle{"responsive-flex": {Width: 224, Height: 640}}
	changed := map[string]flexRectangle{"responsive-flex": {X: 2 * flexGeometryTolerance, Width: 224, Height: 640}}
	if compareFlexRectangles(ids, reference, changed) == nil {
		t.Fatal("a two-layout-unit geometry drift passed the explicit one-unit gate")
	}
	changed[ids[0]] = flexRectangle{Width: math.NaN(), Height: 640}
	if compareFlexRectangles(ids, reference, changed) == nil {
		t.Fatal("nonfinite native geometry passed the gate")
	}
	if compareFlexRectangles(ids, reference, map[string]flexRectangle{}) == nil {
		t.Fatal("a missing native rectangle passed the gate")
	}
	var rectangle flexRectangle
	for _, invalid := range []string{
		`{"parent":null,"x":0,"y":0,"width":224}`,
		`{"parent":null,"x":0,"y":0,"width":224,"height":null}`,
		`{"parent":null,"x":0,"y":0,"width":224,"height":640,"extra":0}`,
		`{"parent":null,"x":0,"y":0,"width":-1,"height":640}`,
	} {
		if decodeFlexJSON([]byte(invalid), &rectangle) == nil {
			t.Fatalf("incomplete or unexpected geometry columns passed the gate: %s", invalid)
		}
	}
}
