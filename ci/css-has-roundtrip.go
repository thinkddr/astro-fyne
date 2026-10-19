// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Copied beside generated widgets and executed only by hosted CI.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	js "github.com/thinkddr/astro-fyne/native/javascript"
)

type scenario struct {
	Prefix, Suffix, Follow, Targets []string
}

type usedStyle struct {
	PaddingLeft float32 `json:"paddingLeft"`
	Background  string  `json:"backgroundColor"`
}

func main() {
	if len(os.Args) != 3 || (os.Args[2] != "export" && os.Args[2] != "restore") {
		panic("usage: css-has probe <scenario> <export|restore>")
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var scenario scenario
	if err = json.Unmarshal(raw, &scenario); err != nil {
		panic(err)
	}
	app := test.NewApp()
	defer app.Quit()
	calls := [][]any{}
	actions := webui.Actions{"observe": func(args ...any) any { calls = append(calls, args); return nil }}
	var view *js.Widget
	if os.Args[2] == "export" {
		view, err = NewCSSHasProbe(nil, actions)
	} else {
		view, err = NewRestoredCSSHasProbe(nil, actions)
	}
	if err != nil {
		panic(err)
	}
	if os.Args[2] == "restore" && len(calls) != 0 {
		panic("replay repeated host effects")
	}
	window := app.NewWindow("CSS has")
	window.SetPadded(false)
	window.Resize(fyne.NewSize(800, 2000))
	window.SetContent(view)
	if err = view.BindCanvas(window.Canvas()); err != nil {
		panic(err)
	}
	identities := map[string]fyne.CanvasObject{}
	for _, id := range append(append([]string{}, scenario.Targets...), "has-marker", "has-checkbox") {
		object := view.Object(id)
		if object == nil {
			panic("missing native object " + id)
		}
		identities[id] = object
	}
	frames := []json.RawMessage{}
	used := []map[string]usedStyle{}
	labels := []string{}
	capture := func(label string) js.Archive {
		if err = view.Error(); err != nil {
			panic(err)
		}
		for id, object := range identities {
			if view.Object(id) != object {
				panic("native identity changed: " + id)
			}
		}
		archive, err := view.ExportJavascript()
		if err != nil {
			panic(err)
		}
		snapshot, err := view.Snapshot()
		if err != nil {
			panic(err)
		}
		styles := map[string]usedStyle{}
		wanted := map[string]bool{}
		for _, id := range scenario.Targets {
			wanted[id] = true
		}
		var visit func([]webui.SnapshotNode)
		visit = func(nodes []webui.SnapshotNode) {
			for _, node := range nodes {
				if wanted[node.Node.ID] {
					if _, duplicate := styles[node.Node.ID]; duplicate {
						panic("duplicate native target")
					}
					styles[node.Node.ID] = usedStyle{node.Node.Style.PaddingLeft, node.Node.Style.Background}
				}
				visit(node.Children)
			}
		}
		visit(snapshot.Roots)
		if len(styles) != len(scenario.Targets) {
			panic("missing used native style")
		}
		labels = append(labels, label)
		frames = append(frames, archive.Frame)
		used = append(used, styles)
		return archive
	}
	perform := func(id string) {
		object := view.Object(id)
		if object == nil {
			panic("missing control " + id)
		}
		object.(fyne.Tappable).Tapped(nil)
		if err = view.Error(); err != nil {
			panic(fmt.Errorf("%s: %w", id, err))
		}
	}
	checkpoint := capture("initial")
	if os.Args[2] == "export" {
		for _, id := range scenario.Prefix {
			perform(id)
			checkpoint = capture(id)
		}
	}
	steps := scenario.Suffix
	if os.Args[2] == "restore" {
		steps = scenario.Follow
	}
	for _, id := range steps {
		perform(id)
		capture(id)
	}
	final, err := view.ExportJavascript()
	if err != nil {
		panic(err)
	}
	data, err := json.Marshal(map[string]any{
		"schema": 1, "archive": checkpoint, "final": final, "frames": frames,
		"usedStyles": used, "labels": labels, "calls": calls,
		"identitiesChecked": len(identities), "hostEffectsRepeatedOnRestore": false,
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
