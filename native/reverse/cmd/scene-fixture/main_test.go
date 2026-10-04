// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/thinkddr/astro-fyne/native/reverse"
)

func TestControlFixtureExportsBeforeDrivingActualNativeCallbacks(t *testing.T) {
	out := t.TempDir()
	if err := runControls(out); err != nil {
		t.Fatal(err)
	}
	sceneBytes, err := os.ReadFile(filepath.Join(out, "scene.json"))
	if err != nil {
		t.Fatal(err)
	}
	var scene reverse.Document
	if err := json.Unmarshal(sceneBytes, &scene); err != nil {
		t.Fatal(err)
	}
	if len(scene.Roots) != 2 || scene.Roots[0].ID != "native-canvas-background" || scene.Roots[0].Style.Width != 320 || scene.Roots[0].Style.Height != 240 {
		t.Fatalf("native canvas background omitted: %+v", scene.Roots)
	}
	nodes := scene.Roots[len(scene.Roots)-1].Children
	if len(nodes) != 2 || nodes[0].ID != "edit" || nodes[0].Value != "" || nodes[1].ID != "save" || nodes[0].Events.Input != "input" || nodes[0].Events.Change != "commit" || nodes[1].Events.Tap != "tap" {
		t.Fatalf("initial unfocused scene/explicit bindings incorrect: %+v", nodes)
	}
	if !reflect.DeepEqual(scene.RequiredActions, []string{"commit", "input", "tap"}) {
		t.Fatalf("wrong required actions: %v", scene.RequiredActions)
	}
	traceBytes, err := os.ReadFile(filepath.Join(out, "native-behavior.json"))
	if err != nil {
		t.Fatal(err)
	}
	var trace behaviorTrace
	if err := json.Unmarshal(traceBytes, &trace); err != nil {
		t.Fatal(err)
	}
	x, xy := "x", "xy"
	want := []behaviorEvent{{Action: "input", Value: &x}, {Action: "commit", Value: &x}, {Action: "tap"}, {Action: "input", Value: &xy}, {Action: "commit", Value: &xy}}
	if trace.Schema != 1 || !reflect.DeepEqual(trace.Events, want) || trace.FinalValue != "xy" || trace.Disabled.Edit || trace.Disabled.Save {
		t.Fatalf("native callbacks/Return+blur dedupe diverged: %+v", trace)
	}
	if _, err := os.Stat(filepath.Join(out, "native.png")); !os.IsNotExist(err) {
		t.Fatal("behavior-only fixture unexpectedly makes a font visual claim")
	}
}
