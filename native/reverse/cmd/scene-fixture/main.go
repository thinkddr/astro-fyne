// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// scene-fixture exports a genuine laid-out native tree and its software frame for
// the remote Fyne -> scene -> Astro differential gate. No page-sized raster is
// used as a substitute for the object tree: the only image is a 16x16 bitmap.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/reverse"
)

func main() {
	out := flag.String("out", "", "write scene.json and native.png in this directory; otherwise print the scene")
	controls := flag.Bool("controls", false, "export an initial input/button scene and native-behavior.json event oracle instead of PNG")
	flag.Parse()
	var err error
	if *controls {
		err = runControls(*out)
	} else {
		err = run(*out)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

type behaviorEvent struct {
	Action string  `json:"action"`
	Value  *string `json:"value,omitempty"`
}
type behaviorTrace struct {
	Schema     int             `json:"schema"`
	Events     []behaviorEvent `json:"events"`
	FinalValue string          `json:"finalValue"`
	Disabled   struct {
		Edit bool `json:"edit"`
		Save bool `json:"save"`
	} `json:"disabled"`
}

// runControls exports an unfocused initial frame, then exercises the actual native
// input and button through Fyne interfaces. Browser automation runs the same steps;
// these logs are produced by native callbacks, never by an expected-trace fixture.
func runControls(out string) error {
	if out == "" {
		return fmt.Errorf("--controls requires --out to write both the initial scene and the native behavior trace")
	}
	a := test.NewApp()
	defer a.Quit()
	value := ""
	trace := behaviorTrace{Schema: 1, Events: []behaviorEvent{}}
	appendValue := func(action, text string) {
		copy := text
		trace.Events = append(trace.Events, behaviorEvent{Action: action, Value: &copy})
	}
	v := webui.NewView(func() []webui.Node {
		return []webui.Node{{ID: "edit", Kind: "input", Value: value, Placeholder: "Edit", OnChange: func(text string) { value = text; appendValue("input", text) }, OnCommit: func(text string) { value = text; appendValue("commit", text) }}, {ID: "save", Kind: "button", Text: "Save", OnTap: func() { trace.Events = append(trace.Events, behaviorEvent{Action: "tap"}) }}}
	})
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(v)
	if err := v.BindCanvas(c); err != nil {
		return err
	}
	scene, err := reverse.Export(v, reverse.Options{Viewport: reverse.Viewport{Width: 320, Height: 240, Scale: 1}, Canvas: c, IDBindings: map[string]reverse.Events{"edit": {Input: "input", Change: "commit"}, "save": {Tap: "tap"}}, NodeFontFamilies: map[string]string{"edit": "sans-serif", "save": "sans-serif"}})
	if err != nil {
		return err
	}
	focusable, ok := v.Object("edit").(fyne.Focusable)
	if !ok {
		return fmt.Errorf("native edit is not focusable")
	}
	tappable, ok := v.Object("save").(fyne.Tappable)
	if !ok {
		return fmt.Errorf("native save is not tappable")
	}
	c.Focus(focusable)
	if c.Focused() != focusable {
		return fmt.Errorf("native editor did not acquire focus")
	}
	focusable.TypedRune('x')
	focusable.TypedKey(&fyne.KeyEvent{Name: fyne.KeyReturn})
	focusable.TypedKey(&fyne.KeyEvent{Name: fyne.KeyReturn})
	c.Unfocus()
	tappable.Tapped(&fyne.PointEvent{})
	c.Focus(focusable)
	if c.Focused() != focusable {
		return fmt.Errorf("native editor did not reacquire focus")
	}
	focusable.TypedRune('y')
	c.Unfocus()
	trace.FinalValue = value
	editDisabled, ok := v.Object("edit").(fyne.Disableable)
	if !ok {
		return fmt.Errorf("native editor disable state is missing")
	}
	saveDisabled, ok := v.Object("save").(fyne.Disableable)
	if !ok {
		return fmt.Errorf("native button disable state is missing")
	}
	trace.Disabled.Edit, trace.Disabled.Save = editDisabled.Disabled(), saveDisabled.Disabled()
	if err := os.MkdirAll(out, 0755); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(out, "scene.json"), scene); err != nil {
		return err
	}
	return writeJSON(filepath.Join(out, "native-behavior.json"), trace)
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}
func run(out string) error {
	a := test.NewApp()
	defer a.Quit()
	background := canvas.NewRectangle(color.NRGBA{R: 255, G: 255, B: 255, A: 255})
	background.Resize(fyne.NewSize(320, 240))
	box := canvas.NewRectangle(color.NRGBA{R: 36, G: 116, B: 238, A: 255})
	box.Move(fyne.NewPos(24, 30))
	box.Resize(fyne.NewSize(128, 64))
	pixels := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			c := color.NRGBA{R: 238, G: 80, B: 36, A: 255}
			if (x/4+y/4)%2 == 0 {
				c = color.NRGBA{R: 36, G: 200, B: 100, A: 255}
			}
			pixels.SetNRGBA(x, y, c)
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, pixels); err != nil {
		return err
	}
	bitmap := canvas.NewImageFromResource(fyne.NewStaticResource("fixture.png", encoded.Bytes()))
	bitmap.Move(fyne.NewPos(200, 30))
	bitmap.Resize(fyne.NewSize(16, 16))
	root := container.NewWithoutLayout(background, box, bitmap)
	root.Resize(fyne.NewSize(320, 240))
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(root)
	scene, err := reverse.Export(root, reverse.Options{Viewport: reverse.Viewport{Width: 320, Height: 240, Scale: 1}, Canvas: c, IDs: map[fyne.CanvasObject]string{root: "native-scene", background: "background", box: "box", bitmap: "bitmap"}})
	if err != nil {
		return err
	}
	jsonBytes, err := json.MarshalIndent(scene, "", "  ")
	if err != nil {
		return err
	}
	jsonBytes = append(jsonBytes, '\n')
	if out == "" {
		_, err = os.Stdout.Write(jsonBytes)
		return err
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(out, "scene.json"), jsonBytes, 0644); err != nil {
		return err
	}
	var frame bytes.Buffer
	if err := png.Encode(&frame, c.Capture()); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(out, "native.png"), frame.Bytes(), 0644)
}
