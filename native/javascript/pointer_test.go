// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"reflect"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

func javascriptPointerWindow(t *testing.T, w *Widget) fyne.Window {
	t.Helper()
	window := test.NewWindow(w)
	t.Cleanup(window.Close)
	window.SetPadded(false)
	window.Resize(fyne.NewSize(280, 240))
	w.Resize(fyne.NewSize(280, 240))
	if err := w.BindCanvas(window.Canvas()); err != nil {
		t.Fatal(err)
	}
	test.WidgetRenderer(w)
	snapshot, err := w.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	var render func([]webui.SnapshotNode)
	render = func(nodes []webui.SnapshotNode) {
		for _, node := range nodes {
			test.WidgetRenderer(node.Object.(fyne.Widget))
			render(node.Children)
		}
	}
	render(snapshot.Roots)
	if err := w.Error(); err != nil {
		t.Fatal(err)
	}
	return window
}

func javascriptPointerPoint(t *testing.T, w *Widget, id string, local fyne.Position) fyne.Position {
	t.Helper()
	snapshot, err := w.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	var find func([]webui.SnapshotNode, fyne.Position) (fyne.Position, bool)
	find = func(nodes []webui.SnapshotNode, origin fyne.Position) (fyne.Position, bool) {
		for _, node := range nodes {
			position := origin.Add(node.Object.Position())
			if node.Node.ID == id {
				return position.Add(local), true
			}
			if point, found := find(node.Children, position); found {
				return point, true
			}
		}
		return fyne.Position{}, false
	}
	point, found := find(snapshot.Roots, w.Position())
	if !found {
		t.Fatalf("missing JavaScript pointer target %q", id)
	}
	return point
}

func TestJavascriptCanvasPointersUseElementUIDsWithoutLocalListeners(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	code := `function(){
let clicks=[], local=false;
return {
flush(){},finishReplay(){},
snapshot(){return [{uid:"root-uid",tag:"div",attrs:{id:"root"},style:{height:140,paddingTop:16,paddingLeft:16},children:[
{uid:"owner-uid",tag:"section",attrs:{id:"owner"},style:{height:32},children:[{uid:"raw-text-uid",tag:"#text",text:"Raw text"}]},
{uid:"span-uid",tag:"span",attrs:{id:"span"},style:{height:32},events:local?["clickfalse"]:[],children:[{uid:"span-text",tag:"#text",text:"Span"}]}
]}]},
dispatch(event){clicks.push(event.node);local=!local},
captured(){return clicks},export(){return {}}
}}`
	w, err := New(testArchive(code), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = w.Close() })
	window := javascriptPointerWindow(t, w)
	root, owner, span, raw := w.Object("root"), w.Object("owner"), w.Object("span"), w.Object("_afy_js_raw-text-uid")
	for _, target := range []struct {
		id    string
		point fyne.Position
	}{
		{"root", fyne.NewPos(4, 4)},
		{"owner", fyne.NewPos(4, 10)},
		{"span", fyne.NewPos(4, 10)},
		{"span", fyne.NewPos(4, 10)},
	} {
		test.TapCanvas(window.Canvas(), javascriptPointerPoint(t, w, target.id, target.point))
	}
	value, err := w.call("captured")
	if err != nil {
		t.Fatal(err)
	}
	var clicks []string
	if err = w.decode(value, &clicks); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(clicks, []string{"root-uid", "owner-uid", "span-uid", "span-uid"}) {
		t.Fatalf("physical pointer entry duplicated or used a text UID: %v", clicks)
	}
	if w.Object("root") != root || w.Object("owner") != owner || w.Object("span") != span || w.Object("_afy_js_raw-text-uid") != raw {
		t.Fatal("adding or removing virtual listeners replaced native objects")
	}
}

func TestJavascriptPointerLoweringCoversEverySupportedElement(t *testing.T) {
	w := &Widget{}
	for _, tag := range []string{"div", "main", "section", "header", "footer", "aside", "article", "nav", "ul", "ol", "li", "p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "label", "button", "a", "input", "textarea"} {
		for _, events := range [][]string{nil, {"clickfalse"}} {
			nodes, err := w.nodes([]Frame{{UID: "element", Tag: tag, Events: events}})
			if err != nil || len(nodes) != 1 || nodes[0].OnTap == nil {
				t.Fatalf("<%s> lost its pointer entry with listeners %v: %+v, %v", tag, events, nodes, err)
			}
		}
	}
	nodes, err := w.nodes([]Frame{{UID: "check", Tag: "input", Attrs: map[string]string{"type": "checkbox"}, Events: []string{"clickfalse"}}})
	if err != nil || len(nodes) != 1 || nodes[0].OnTap != nil || nodes[0].OnChecked == nil {
		t.Fatalf("checkbox activation acquired a duplicate pointer route: %+v, %v", nodes, err)
	}
}

func TestJavascriptPointerFrameBindingsRequireSupportedFamiliesAndPhases(t *testing.T) {
	w := &Widget{}
	for _, binding := range []string{"clicktrue", "clickfalse", "inputtrue", "inputfalse", "changetrue", "changefalse"} {
		if _, err := w.nodes([]Frame{{UID: "element", Tag: "div", Events: []string{binding}}}); err != nil {
			t.Fatalf("valid snapshot binding %q was rejected: %v", binding, err)
		}
	}
	for _, binding := range []string{"", "click", "click0", "clickFalse", "clickfalse ", "clickfalsefalse", "pointerdownfalse", "focustrue", "wheelfalse", "keydownfalse", "input", "change"} {
		if _, err := w.nodes([]Frame{{UID: "element", Tag: "div", Events: []string{binding}}}); err == nil || !strings.Contains(err.Error(), "unsupported event binding") {
			t.Fatalf("unsupported snapshot binding %q was accepted: %v", binding, err)
		}
	}
}

func TestJavascriptUnsupportedPointerBindingPreservesThePriorFrame(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	code := `function(){let broken=false;return {flush(){},finishReplay(){},snapshot(){return [{uid:"target",tag:"div",attrs:{id:"target"},style:{height:broken?80:32},events:broken?["pointerdownfalse"]:[]}]},dispatch(){broken=true},export(){return {}}}}`
	w, err := New(testArchive(code), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = w.Close() })
	window := javascriptPointerWindow(t, w)
	target := w.Object("target")
	before := target.Size()
	test.TapCanvas(window.Canvas(), javascriptPointerPoint(t, w, "target", fyne.NewPos(4, 4)))
	if w.Error() == nil || !strings.Contains(w.Error().Error(), "unsupported event binding") || w.Object("target") != target || target.Size() != before {
		t.Fatalf("an unsupported binding replaced the prior frame: %v", w.Error())
	}
	if _, err = w.ExportJavascript(); err == nil {
		t.Fatal("a frame with an unsupported pointer binding was exported")
	}
}

func TestJavascriptTopLevelTextDiagnosesOnlyActualPointerActivation(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	code := `function(){return {flush(){},finishReplay(){},snapshot(){return [{uid:"text",tag:"#text",text:"Unowned root"}]},dispatch(){throw new Error("top-level text invented an element target")},export(){return {}}}}`
	w, err := New(testArchive(code), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = w.Close() })
	window := javascriptPointerWindow(t, w)
	text := w.Object("_afy_js_text")
	if text == nil || text.Size().Height <= 0 {
		t.Fatal("top-level text stopped rendering before any pointer activation")
	}
	test.TapCanvas(window.Canvas(), javascriptPointerPoint(t, w, "_afy_js_text", fyne.NewPos(4, 8)))
	if w.Error() == nil || !strings.Contains(w.Error().Error(), "virtual-root pointer adapter") || w.Object("_afy_js_text") != text {
		t.Fatalf("top-level text invented an element target or lost its prior frame: %v", w.Error())
	}
	if _, err = w.ExportJavascript(); err == nil {
		t.Fatal("an unowned root pointer fault was exported")
	}
}

func TestJavascriptCanvasGapProducesAPointerDiagnostic(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	code := `function(){return {flush(){},finishReplay(){},snapshot(){return [{uid:"root",tag:"div",attrs:{id:"root"},style:{height:32}}]},dispatch(){throw new Error("an unowned click reached the virtual DOM")},export(){return {}}}}`
	w, err := New(testArchive(code), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = w.Close() })
	window := javascriptPointerWindow(t, w)
	root := w.Object("root")
	if root == nil || root.Size().Height >= 200 {
		t.Fatal("pointer diagnostic fixture has no unowned canvas gap")
	}
	test.TapCanvas(window.Canvas(), fyne.NewPos(20, 200))
	if w.Error() == nil || !strings.Contains(w.Error().Error(), "wrapper background requires a virtual-root pointer adapter") || w.Object("root") != root {
		t.Fatalf("unowned host background silently lost its pointer entry: %v", w.Error())
	}
	if _, err = w.ExportJavascript(); err == nil {
		t.Fatal("a pointer-faulted frame was exported")
	}
}
