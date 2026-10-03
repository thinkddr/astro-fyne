// SPDX-License-Identifier: Apache-2.0
package generated

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func TestExportBrowserComparableBehavior(t *testing.T) {
	out := os.Getenv("ASTRO_FYNE_ARTIFACTS")
	if out == "" {
		t.Skip("set ASTRO_FYNE_ARTIFACTS for browser/native traces")
	}
	data, err := os.ReadFile("../../conformance-scenario.json")
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
	view, observations, calls := conformanceView(t)
	type frame struct {
		Action string            `json:"action"`
		Nodes  map[string]string `json:"nodes"`
	}
	type observed struct {
		Prefix   string  `json:"prefix"`
		Previous float64 `json:"previous"`
	}
	trace := struct {
		Frames          []frame    `json:"frames"`
		Observations    []observed `json:"observations"`
		UnexpectedCalls []string   `json:"unexpectedCalls"`
	}{Frames: []frame{}, Observations: []observed{}, UnexpectedCalls: []string{}}
	snapshot := func(action string) {
		nodes := map[string]string{}
		for _, id := range scenario.IDs {
			if view.Object(id) == nil {
				nodes[id] = "<absent>"
			} else {
				nodes[id] = generatedText(t, view, id)
			}
		}
		trace.Frames = append(trace.Frames, frame{action, nodes})
	}
	snapshot("initial")
	for _, action := range scenario.Actions {
		tapGenerated(t, view, action)
		snapshot(action)
	}
	for _, value := range *observations {
		trace.Observations = append(trace.Observations, observed{value.prefix, value.previous})
	}
	for _, key := range []string{"unexpected-and", "unexpected-or", "unexpected-nullish"} {
		for count := 0; count < calls[key]; count++ {
			trace.UnexpectedCalls = append(trace.UnexpectedCalls, key)
		}
	}
	sort.Strings(trace.UnexpectedCalls)
	data, err = json.MarshalIndent(trace, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(out, "native-behavior.json"), append(data, '\n'), 0644); err != nil {
		t.Fatal(err)
	}
}
