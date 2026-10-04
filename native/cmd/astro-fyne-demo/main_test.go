//go:build ci

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package main

import (
	"bytes"
	"flag"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
)

func TestDemoArguments(t *testing.T) {
	for _, example := range []string{"counter", "responsive"} {
		got, err := parseExample([]string{"--example", example}, &bytes.Buffer{})
		if got != example || err != nil {
			t.Fatalf("example selection = %q, %v", got, err)
		}
	}
	if got, err := parseExample(nil, &bytes.Buffer{}); got != "counter" || err != nil {
		t.Fatalf("default example = %q, %v", got, err)
	}
	for _, args := range [][]string{{"--example", "unknown"}, {"counter"}, {"--unknown"}} {
		if _, err := parseExample(args, &bytes.Buffer{}); err == nil {
			t.Fatalf("invalid arguments accepted: %v", args)
		}
	}
	if _, err := parseExample([]string{"--help"}, &bytes.Buffer{}); err != flag.ErrHelp {
		t.Fatalf("help did not stop before opening a window: %v", err)
	}
}

func TestCounterDemoUsesTheGeneratedWidgetAndItsNativeState(t *testing.T) {
	a := app.NewWithID("org.astro-fyne.demo.test-counter")
	t.Cleanup(a.Quit)
	v, window, err := newDemoWindow(a, "counter")
	if err != nil {
		t.Fatal(err)
	}
	button, ok := v.Object("increment").(fyne.Tappable)
	if !ok {
		t.Fatal("demo did not mount the generated counter action")
	}
	button.Tapped(nil)
	snapshot, err := v.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if window.Content() == v || len(snapshot.Roots) == 0 || v.Object("changed") == nil {
		t.Fatal("demo replaced the generated widget wrapper or discarded its counter state")
	}
	if snapshot.Measured {
		t.Fatal("the source demo claimed a captured pixel certificate")
	}
}

func TestResponsiveDemoEmbedsFontsAndKeepsObjectsAcrossResize(t *testing.T) {
	a := app.NewWithID("org.astro-fyne.demo.test-responsive")
	t.Cleanup(a.Quit)
	v, window, err := newDemoWindow(a, "responsive")
	if err != nil {
		t.Fatal(err)
	}
	root := v.Object("responsive-controls")
	if root == nil {
		t.Fatal("demo did not mount its generated responsive source")
	}
	for _, width := range []float32{320, 640, 480} {
		window.Resize(fyne.NewSize(width, 240))
		if v.Error() != nil || v.Object("responsive-controls") != root {
			t.Fatalf("responsive demo failed at width %v: %v", width, v.Error())
		}
	}
}
