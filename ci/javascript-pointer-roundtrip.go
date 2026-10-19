// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package pointerprobe

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	js "github.com/thinkddr/astro-fyne/native/javascript"
)

type pointerStep struct {
	ID     string `json:"id"`
	Corner bool   `json:"corner,omitempty"`
	Calls  int    `json:"calls"`
}

type pointerScenario struct {
	Prefix []pointerStep `json:"prefix"`
	Suffix []pointerStep `json:"suffix"`
	Follow []pointerStep `json:"follow"`
}

func TestJavascriptPointerRoundtrip(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	out, mode := os.Getenv("ASTRO_FYNE_POINTER_OUTPUT"), os.Getenv("ASTRO_FYNE_POINTER_MODE")
	if out == "" || mode != "prepare" && mode != "verify" {
		t.Fatal("missing pointer probe output or mode")
	}
	check := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	write := func(name string, value any) {
		data, err := json.MarshalIndent(value, "", "  ")
		check(err)
		check(os.WriteFile(filepath.Join(out, name), append(data, '\n'), 0644))
	}
	data, err := os.ReadFile(filepath.Join(out, "scenario.json"))
	check(err)
	var scenario pointerScenario
	check(json.Unmarshal(data, &scenario))
	calls := [][]any{}
	actions := webui.Actions{"observe": func(args ...any) any {
		calls = append(calls, append([]any(nil), args...))
		return nil
	}}
	var archive js.Archive
	check(json.Unmarshal([]byte(pointerProbeArchive), &archive))
	data, err = os.ReadFile(filepath.Join(out, "source.javascript.json"))
	check(err)
	var source js.Archive
	check(json.Unmarshal(data, &source))
	if archive.CodeHash != source.CodeHash || archive.Code != source.Code {
		t.Fatal("generated constructor changed the source program")
	}
	if mode == "verify" {
		data, err = os.ReadFile(filepath.Join(out, "browser.javascript.json"))
		check(err)
		var expected, embedded any
		check(json.Unmarshal(data, &expected))
		check(json.Unmarshal([]byte(pointerProbeArchive), &embedded))
		if !reflect.DeepEqual(expected, embedded) {
			t.Fatal("return constructor did not embed the browser checkpoint")
		}
	}
	w, err := newPointerProbe(actions)
	check(err)
	defer func() { check(w.Close()) }()
	if len(calls) != 0 {
		t.Fatal("restoration repeated an external effect")
	}
	window := test.NewWindow(w)
	defer window.Close()
	window.SetPadded(false)
	window.Resize(fyne.NewSize(800, 1400))
	check(w.BindCanvas(window.Canvas()))
	objects := map[string]fyne.CanvasObject{}
	var retain func([]webui.SnapshotNode)
	retain = func(nodes []webui.SnapshotNode) {
		for _, node := range nodes {
			objects[node.Node.ID] = node.Object
			retain(node.Children)
		}
	}
	snapshot, err := w.Snapshot()
	check(err)
	retain(snapshot.Roots)
	if len(objects) < 20 {
		t.Fatal("missing real native pointer objects")
	}
	stable := func() {
		for id, object := range objects {
			if w.Object(id) != object {
				t.Fatal("pointer interaction replaced a native object", id)
			}
		}
	}
	export := func() js.Archive {
		window.Canvas().Unfocus()
		stable()
		archive, err := w.ExportJavascript()
		check(err)
		return archive
	}
	perform := func(steps []pointerStep) map[string]any {
		archives := []js.Archive{export()}
		points := []map[string]any{}
		start := len(calls)
		for _, step := range steps {
			object := w.Object(step.ID)
			if object == nil {
				t.Fatal("missing pointer target", step.ID)
			}
			size := object.Size()
			local := fyne.NewPos(size.Width/2, size.Height/2)
			if step.ID == "pointer-check" || step.ID == "pointer-cancel" {
				local.X = object.MinSize().Width / 2
			}
			if step.Corner {
				local = fyne.NewPos(4, 4)
			}
			point := app.Driver().AbsolutePositionForObject(object).Add(local)
			before := len(calls)
			test.TapCanvas(window.Canvas(), point)
			check(w.Error())
			if len(calls)-before != step.Calls {
				t.Fatalf("%s dispatched %d effects, want %d: %#v", step.ID, len(calls)-before, step.Calls, calls[before:])
			}
			points = append(points, map[string]any{"id": step.ID, "local": local, "canvas": point, "size": size, "effects": len(calls) - before})
			archives = append(archives, export())
		}
		return map[string]any{"archives": archives, "calls": calls[start:], "points": points, "stableNativeObjects": len(objects), "actualCanvasHitTesting": true}
	}
	result := map[string]any{"schema": 1, "mode": mode, "constructor": pointerProbeConstructor, "actualGeneratedConstructor": true, "replayCalls": 0, "pixelPerfectVerified": false}
	if mode == "prepare" {
		result["prefix"] = perform(scenario.Prefix)
		write("native-checkpoint.javascript.json", export())
		result["suffix"] = perform(scenario.Suffix)
		result["follow"] = perform(scenario.Follow)
	} else {
		result["follow"] = perform(scenario.Follow)
		write("native-return.javascript.json", export())
	}
	write("native-"+mode+".json", result)
}
