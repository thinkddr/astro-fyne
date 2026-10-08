// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Copied into native/.javascript-probe alongside actual generated Go widgets.
package main

import (
	"encoding/json"
	"fmt"
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	js "github.com/thinkddr/astro-fyne/native/javascript"
	"os"
	"strings"
)

type step struct {
	ID    string  `json:"id"`
	Value *string `json:"value,omitempty"`
}
type rejection struct{ Path, Event, Contains string }
type scenario struct {
	Prefix, Suffix, Follow []step
	Rejects                []rejection
}

func main() {
	if len(os.Args) != 3 {
		panic("usage: javascript probe <scenario> <export|restore>")
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
	if os.Args[2] == "export" {
		for _, item := range scenario.Rejects {
			data, err := os.ReadFile(item.Path)
			if err != nil {
				panic(err)
			}
			var archive js.Archive
			if err = json.Unmarshal(data, &archive); err != nil {
				panic(err)
			}
			view, err := js.New(archive, webui.Actions{"observe": func(args ...any) any { panic("invalid JSON data reached host") }})
			if err == nil && item.Event != "" {
				view.Object(item.Event).(fyne.Tappable).Tapped(nil)
				err = view.Error()
				if _, exportErr := view.ExportJavascript(); exportErr == nil {
					panic("invalid program was exported")
				}
			}
			if err == nil || !strings.Contains(err.Error(), item.Contains) {
				panic(fmt.Errorf("missing platform diagnostic %s: %v", item.Path, err))
			}
		}
	}
	calls := [][]any{}
	actions := webui.Actions{"observe": func(args ...any) any { calls = append(calls, args); return nil }}
	var view *js.Widget
	if os.Args[2] == "export" {
		view, err = NewJavascriptProbe(nil, actions)
	} else {
		view, err = NewRestoredJavascriptProbe(nil, actions)
	}
	if err != nil {
		panic(err)
	}
	if os.Args[2] == "restore" && len(calls) > 0 {
		panic("restoring repeated external effects")
	}
	window := app.NewWindow("JavaScript")
	window.SetPadded(false)
	window.Resize(fyne.NewSize(800, 1400))
	window.SetContent(view)
	if err = view.BindCanvas(window.Canvas()); err != nil {
		panic(err)
	}
	perform := func(step step) {
		object := view.Object(step.ID)
		if object == nil {
			panic("missing native control " + step.ID)
		}
		if step.Value != nil {
			field := object.(fyne.Focusable)
			window.Canvas().Focus(field)
			object.(fyne.Shortcutable).TypedShortcut(&fyne.ShortcutSelectAll{})
			for _, r := range *step.Value {
				field.TypedRune(r)
			}
			window.Canvas().Unfocus()
		} else {
			object.(fyne.Tappable).Tapped(nil)
		}
		if err = view.Error(); err != nil {
			panic(fmt.Errorf("%s: %w", step.ID, err))
		}
	}
	if os.Args[2] == "export" {
		for _, step := range scenario.Prefix {
			perform(step)
		}
	}
	archive, err := view.ExportJavascript()
	if err != nil {
		panic(err)
	}
	calls = [][]any{}
	frames := []json.RawMessage{archive.Frame}
	steps := scenario.Suffix
	if os.Args[2] == "restore" {
		steps = scenario.Follow
	}
	for _, step := range steps {
		perform(step)
		snapshot, err := view.ExportJavascript()
		if err != nil {
			panic(err)
		}
		frames = append(frames, snapshot.Frame)
	}
	data, err := json.Marshal(map[string]any{"archive": archive, "frames": frames, "calls": calls})
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
