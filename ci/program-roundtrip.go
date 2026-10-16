// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// This probe is copied into native/.program-roundtrip with real generated Go.
package main

import (
	"encoding/json"
	"fmt"
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"os"
	"reflect"
)

type action struct {
	ID     string `json:"id"`
	Append string `json:"append,omitempty"`
	Focus  bool   `json:"focus,omitempty"`
}
type scenario struct {
	Name                   string   `json:"name"`
	IDs                    []string `json:"ids"`
	Prefix, Suffix, Follow []action
	Props                  webui.Scope         `json:"props"`
	Actions                []string            `json:"actions"`
	Lists                  map[string][]string `json:"lists"`
	Watch                  map[string][]string `json:"watch"`
}
type portable interface {
	fyne.Widget
	ExportProgram() (webui.ProgramArchive, error)
}
type factory func(webui.Scope, webui.Actions) (*webui.View, portable, error)
type frame struct {
	Nodes map[string]any      `json:"nodes"`
	Lists map[string][]string `json:"lists"`
	Same  map[string]bool     `json:"same"`
	Focus string              `json:"focus"`
}

func main() {
	if len(os.Args) != 3 {
		panic("usage: native program probe <manifest.json> <export|restore>")
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var scenarios []scenario
	if err = json.Unmarshal(raw, &scenarios); err != nil {
		panic(err)
	}
	app := test.NewApp()
	defer app.Quit()
	results := map[string]any{}
	for _, s := range scenarios {
		events := []any{}
		actions := webui.Actions{}
		for _, name := range s.Actions {
			name := name
			actions[name] = func(args ...any) any {
				if name == "inspect" {
					first, second := args[0], args[1]
					self := webui.Get(first, "self")
					linked := webui.Get(self, "self")
					same := func(a, b any) bool { return reflect.ValueOf(a).UnsafePointer() == reflect.ValueOf(b).UnsafePointer() }
					events = append(events, map[string]any{"action": name, "args": []bool{same(first, second), same(self, first), same(linked, second)}})
					return nil
				}
				if name == "t" {
					key := webui.String(args[0])
					if key == "forbidden-key" {
						panic("optional key evaluated")
					}
					if key == "first" || key == "second" || key == "third" {
						events = append(events, map[string]any{"action": name, "args": args})
					}
					return key
				}
				events = append(events, map[string]any{"action": name, "args": args})
				return nil
			}
		}
		props := webui.Scope{}
		for key, value := range s.Props {
			props[key] = value
		}
		if s.Name == "Identity" {
			seed := props["seed"].(map[string]any)
			seed["self"] = seed
		}
		for name, fn := range actions {
			props[name] = fn
		}
		constructor := originals[s.Name]
		steps := s.Suffix
		if os.Args[2] == "restore" {
			constructor = restored[s.Name]
			props = nil
			steps = s.Follow
		}
		view, program, err := constructor(props, actions)
		if err != nil {
			panic(fmt.Errorf("%s: %w", s.Name, err))
		}
		window := app.NewWindow(s.Name)
		window.SetPadded(false)
		window.Resize(fyne.NewSize(800, 1600))
		window.SetContent(program)
		if err = view.BindCanvas(window.Canvas()); err != nil {
			panic(err)
		}
		perform := func(a action) {
			object := view.Object(a.ID)
			if object == nil {
				panic("missing native action " + a.ID)
			}
			if a.Focus || a.Append != "" {
				input := object.(fyne.Focusable)
				window.Canvas().Focus(input)
				if a.Append != "" {
					input.TypedKey(&fyne.KeyEvent{Name: fyne.KeyEnd})
					for _, r := range a.Append {
						input.TypedRune(r)
					}
				}
			} else {
				object.(fyne.Tappable).Tapped(nil)
			}
			if err = view.Error(); err != nil {
				panic(fmt.Errorf("%s/%s: %w", s.Name, a.ID, err))
			}
		}
		if os.Args[2] == "export" {
			for _, a := range s.Prefix {
				perform(a)
			}
		}
		window.Canvas().Unfocus()
		archive, err := program.ExportProgram()
		if err != nil {
			panic(err)
		}
		events = []any{}
		references := map[string]fyne.CanvasObject{}
		find := func(ids []string) fyne.CanvasObject {
			for _, id := range ids {
				if object := view.Object(id); object != nil {
					return object
				}
			}
			return nil
		}
		for name, ids := range s.Watch {
			references[name] = find(ids)
		}
		capture := func() frame {
			f := frame{Nodes: map[string]any{}, Lists: map[string][]string{}, Same: map[string]bool{}}
			snapshot, err := view.Snapshot()
			if err != nil {
				panic(err)
			}
			all := map[string]webui.SnapshotNode{}
			var walk func([]webui.SnapshotNode)
			walk = func(nodes []webui.SnapshotNode) {
				for _, node := range nodes {
					all[node.Node.ID] = node
					if focusable, ok := node.Object.(fyne.Focusable); ok && window.Canvas().Focused() != nil && focusable == window.Canvas().Focused() {
						f.Focus = node.Node.ID
					}
					walk(node.Children)
				}
			}
			walk(snapshot.Roots)
			for _, id := range s.IDs {
				if node, exists := all[id]; exists {
					if node.Node.Kind == "input" || node.Node.Kind == "textarea" {
						f.Nodes[id] = node.Node.Value
					} else {
						f.Nodes[id] = node.Object.(interface{ AccessibilityLabel() string }).AccessibilityLabel()
					}
				} else {
					f.Nodes[id] = nil
				}
			}
			for id, wanted := range s.Lists {
				order := []string{}
				var children func([]webui.SnapshotNode)
				children = func(nodes []webui.SnapshotNode) {
					for _, node := range nodes {
						for _, name := range wanted {
							if node.Node.ID == name {
								order = append(order, name)
							}
						}
						children(node.Children)
					}
				}
				children(all[id].Children)
				f.Lists[id] = order
			}
			for name, ids := range s.Watch {
				object := find(ids)
				f.Same[name] = object != nil && object == references[name]
			}
			return f
		}
		frames := []frame{capture()}
		for _, a := range steps {
			perform(a)
			frames = append(frames, capture())
		}
		results[s.Name] = map[string]any{"archive": archive, "frames": frames, "events": events}
		window.Close()
	}
	if err = json.NewEncoder(os.Stdout).Encode(results); err != nil {
		panic(err)
	}
}
