// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package generated

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

func TestExportBrowserComparablePrimitiveBehavior(t *testing.T) {
	out := os.Getenv("ASTRO_FYNE_ARTIFACTS")
	if out == "" {
		t.Skip("set ASTRO_FYNE_ARTIFACTS for the primitive browser/native trace")
	}
	data, err := os.ReadFile("../../primitive-scenario.json")
	if err != nil {
		t.Fatal(err)
	}
	var scenario struct {
		IDs     []string `json:"ids"`
		Actions []string `json:"actions"`
	}
	if err := json.Unmarshal(data, &scenario); err != nil {
		t.Fatal(err)
	}
	canonical, err := json.Marshal(scenario)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(canonical)
	if PrimitiveConformanceSourceHash != os.Getenv("ASTRO_FYNE_PRIMITIVE_SOURCE_HASH") {
		t.Fatal("native primitive source differs from the analyzed browser source")
	}
	app := test.NewApp()
	t.Cleanup(app.Quit)
	view, err := NewPrimitiveConformance(webui.Scope{}, webui.Actions{})
	if err != nil {
		t.Fatal(err)
	}
	window := app.NewWindow("Primitive conformance")
	window.SetContent(view)
	window.Resize(fyne.NewSize(640, 1800))
	t.Cleanup(window.Close)
	type frame struct {
		Action string         `json:"action"`
		Nodes  map[string]any `json:"nodes"`
	}
	trace := struct {
		Schema          int      `json:"schema"`
		SourceHash      string   `json:"sourceHash"`
		ScenarioHash    string   `json:"scenarioHash"`
		Frames          []frame  `json:"frames"`
		Observations    []any    `json:"observations"`
		UnexpectedCalls []string `json:"unexpectedCalls"`
	}{1, PrimitiveConformanceSourceHash, hex.EncodeToString(digest[:]), []frame{}, []any{}, []string{}}
	snapshot := func(action string) {
		if err := view.Error(); err != nil {
			t.Fatal(err)
		}
		nodes := map[string]any{}
		for _, id := range scenario.IDs {
			object := view.Object(id)
			if object == nil {
				t.Fatalf("the unconditional primitive field %q is missing after %q", id, action)
			}
			text, ok := object.(interface{ AccessibilityLabel() string })
			if !ok {
				t.Fatalf("primitive %s has no native observable text: %T", id, object)
			}
			nodes[id] = text.AccessibilityLabel()
		}
		trace.Frames = append(trace.Frames, frame{action, nodes})
	}
	snapshot("initial")
	for _, action := range scenario.Actions {
		tapGenerated(t, view, action)
		snapshot(action)
	}
	data, err = json.MarshalIndent(trace, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(out, "native-primitive-behavior.json"), append(data, '\n'), 0644); err != nil {
		t.Fatal(err)
	}
}
