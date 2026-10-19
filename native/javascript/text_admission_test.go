// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"errors"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

type javascriptAdmissionBackend struct {
	webui.FyneBackend
	calls int
}

func (b *javascriptAdmissionBackend) ValidateLegacyText(text webui.LegacyText) error {
	b.calls++
	if text.Kind == "input" || text.Kind == "textarea" {
		return errors.New("editable text requires an edit admission adapter")
	}
	if strings.ContainsRune(text.Text, '\U0010ffff') {
		return errors.New("missing glyph U+10FFFF")
	}
	return nil
}

func TestJavascriptTextAdmissionKeepsNativeFrameWithoutRollingBackSourceActions(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	code := `function(host){
let bad=false,count=0,exports=0;
function sample(){return [{uid:"root",tag:"div",attrs:{id:"root"},style:{height:120},children:[
{uid:"caption",tag:"p",attrs:{id:"caption"},children:[{uid:"text",tag:"#text",text:bad?String.fromCodePoint(0x10ffff):"Supported"}]},
{uid:"button",tag:"button",attrs:{id:"button"},children:[{uid:"label",tag:"#text",text:"Toggle"}]}]}]}
return {flush(){},finishReplay(){},snapshot:sample,
dispatch(){host("action","observed","[]");count++;bad=!bad},
observations(){return {bad,count,exports}},export(){exports++;throw new Error("export callback ran")},dispose(){}}
}`
	archive := testArchive(code)
	archive.Actions = []string{"observed"}
	hostActions := 0
	backend := &javascriptAdmissionBackend{}
	w, err := New(archive, webui.Actions{"observed": func(...any) any { hostActions++; return nil }}, backend)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = w.Close() })
	window := javascriptPointerWindow(t, w)
	caption, button := w.Object("caption"), w.Object("button")
	position, size := caption.Position(), caption.Size()
	point := javascriptPointerPoint(t, w, "button", fyne.NewPos(8, 8))
	test.TapCanvas(window.Canvas(), point)
	if w.Error() == nil || !strings.Contains(w.Error().Error(), "missing glyph") || hostActions != 1 || w.Object("caption") != caption || w.Object("button") != button || caption.Position() != position || caption.Size() != size {
		t.Fatalf("rejected event partly committed or undid its host action: actions=%d error=%v", hostActions, w.Error())
	}
	label, ok := caption.(interface{ AccessibilityLabel() string })
	if !ok || label.AccessibilityLabel() != "Supported" {
		t.Fatal("rejected click changed the retained native caption text")
	}
	calls := backend.calls
	if _, err := w.Snapshot(); err == nil {
		t.Fatal("rejected native event frame was snapshotted")
	}
	if _, err := w.ExportJavascript(); err == nil || !strings.Contains(err.Error(), "missing glyph") || strings.Contains(err.Error(), "export callback ran") {
		t.Fatalf("invalid frame reached the VM export callback: %v", err)
	}
	value, err := w.call("observations")
	if err != nil {
		t.Fatal(err)
	}
	var state struct {
		Bad     bool
		Count   int
		Exports int
	}
	if err := w.decode(value, &state); err != nil || !state.Bad || state.Count != 1 || state.Exports != 0 || backend.calls != calls || w.fault != nil {
		t.Fatalf("inspection replayed admission, rolled back source or introduced a permanent fault: %+v %v", state, err)
	}
	test.TapCanvas(window.Canvas(), point)
	if err := w.Error(); err != nil || hostActions != 2 || w.Object("caption") != caption || w.Object("button") != button {
		t.Fatalf("a later valid source event did not recover the retained frame: actions=%d error=%v", hostActions, err)
	}
	snapshot, err := w.Snapshot()
	if err != nil || len(snapshot.Roots) != 1 || snapshot.Roots[0].Children[0].Node.Text != "Supported" {
		t.Fatalf("source recovery did not restore the valid native caption: %+v %v", snapshot, err)
	}
}

func TestJavascriptAnimationTextAdmissionPreservesFrameAndInvalidatesExport(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	base := animatedArchive()
	code := strings.Replace(base.Code, "text:String(count)", `text:state.timeMs>=500?String.fromCodePoint(0x10ffff):"Ready"`, 1)
	if code == base.Code {
		t.Fatal("animation regression did not change the sampled text")
	}
	archive := testArchive(code)
	archive.Schema, archive.Animation, archive.Actions = base.Schema, base.Animation, base.Actions
	backend := &javascriptAdmissionBackend{}
	w, err := NewWithOptions(archive, webui.Actions{"changed": func(...any) any { return nil }}, Options{ManualAnimations: true}, backend)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = w.Close() })
	window := test.NewWindow(w)
	t.Cleanup(window.Close)
	window.SetPadded(false)
	window.Resize(fyne.NewSize(200, 300))
	panel, following, button := w.Object("panel"), w.Object("following"), w.Object("button")
	position, size, followingPosition := panel.Position(), panel.Size(), following.Position()
	if err := w.AdvanceAnimations(500); err == nil || !strings.Contains(err.Error(), "missing glyph") {
		t.Fatalf("invalid sampled text was admitted: %v", err)
	}
	if w.Object("panel") != panel || w.Object("following") != following || w.Object("button") != button || panel.Position() != position || panel.Size() != size || following.Position() != followingPosition || w.fault == nil || w.scheduler != nil {
		t.Fatal("animation admission failure changed native geometry or lost its persistent fault")
	}
	calls := backend.calls
	if _, err := w.ExportJavascript(); err == nil || !strings.Contains(err.Error(), "missing glyph") || backend.calls != calls {
		t.Fatalf("invalid animated frame was exported or admission reran: %v", err)
	}
	w.Refresh()
	if w.Error() == nil || !strings.Contains(w.Error().Error(), "missing glyph") || backend.calls != calls {
		t.Fatal("refresh cleared an animation fault or reran admission through it")
	}
}

func TestJavascriptTextAdmissionDoesNotClearWrapperPointerFault(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	backend := &javascriptAdmissionBackend{}
	w, err := New(testArchive(`function(){return {flush(){},finishReplay(){},snapshot(){return [{uid:"caption",tag:"p",children:[{uid:"text",tag:"#text",text:"Caption"}]}]},export(){return {}},dispose(){}}}`), nil, backend)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = w.Close() })
	calls := backend.calls
	w.Tapped(nil)
	w.Refresh()
	if w.Error() == nil || !strings.Contains(w.Error().Error(), "virtual-root pointer adapter") || backend.calls != calls {
		t.Fatalf("text admission cleared a persistent pointer fault: %v", w.Error())
	}
}
