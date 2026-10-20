// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

type javascriptFontResource struct {
	data  []byte
	reads int
}

func (*javascriptFontResource) Name() string             { panic("resource names are not identities") }
func (resource *javascriptFontResource) Content() []byte { resource.reads++; return resource.data }

type javascriptFontBinder func([]webui.FontResourceRequirement) (webui.Backend, error)

func (binder javascriptFontBinder) BindFontResources(items []webui.FontResourceRequirement) (webui.Backend, error) {
	return binder(items)
}

type javascriptFontCustom struct {
	webui.FyneBackend
	boxes int
}

func (backend *javascriptFontCustom) Box(style webui.Style) webui.Box {
	backend.boxes++
	return backend.FyneBackend.Box(style)
}

type javascriptFontChecked struct {
	webui.Backend
	owner *javascriptFontCustom
}

func (backend *javascriptFontChecked) Box(style webui.Style) webui.Box {
	backend.owner.boxes++
	return backend.Backend.Box(style)
}

func javascriptFontData(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile("../../example/public/fonts/NotoSans-Regular.ttf")
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func javascriptFontHash(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
func javascriptFontBackend(data []byte) (webui.FyneBackend, *javascriptFontResource) {
	resource := &javascriptFontResource{data: data}
	return webui.FyneBackend{Fonts: map[string]map[webui.Font]fyne.Resource{"Host": {{Weight: 400}: resource}}}, resource
}
func javascriptFontRequest(data []byte) string {
	encoded, _ := json.Marshal([]webui.FontResourceRequirement{{Family: "Host", Weight: 400, Style: "normal", Hash: javascriptFontHash(data)}})
	quoted, _ := json.Marshal(string(encoded))
	return `host("font-resources","1",` + string(quoted) + `);`
}
func javascriptFontArchive(request, later string) Archive {
	archive := testArchive(FontResourceFactoryHeader + `function(host,archive){` + request + `
let count=0,events=[];
globalThis.fontMutation=0;globalThis.fontExports=0;
function sample(){return [{uid:"root",tag:"div",attrs:{id:"root"},style:{width:220,height:90,backgroundColor:"#ffffff"},children:[{uid:"caption",tag:"p",attrs:{id:"caption"},style:{fontFamily:"Host",fontWeight:400,fontStyle:"normal",fontSize:16,lineHeight:20},events:["clickfalse"],children:[{uid:"text",tag:"#text",text:"Count:"+count}]}]}]}
` + later + `
return {flush(){},finishReplay(){if(archive.frame&&JSON.stringify(archive.frame)!==JSON.stringify(sample()))throw new Error("frame mismatch")},snapshot:sample,
dispatch(event){count++;events.push(event)},replay(event){count++;events.push(event)},
export(){globalThis.fontExports++;return {...archive,events,journal:archive.journal.slice(),frame:sample()}},dispose(){}}
}`)
	archive.Actions = []string{"after"}
	return archive
}
func javascriptFontPaint(t *testing.T, view *Widget, text string) *canvas.Text {
	t.Helper()
	object, ok := view.Object("caption").(fyne.Widget)
	if !ok {
		t.Fatal("missing native caption")
	}
	for _, child := range test.WidgetRenderer(object).Objects() {
		if painted, ok := child.(*canvas.Text); ok && painted.Text == text {
			return painted
		}
	}
	t.Fatal("missing actual native text painter")
	return nil
}
func javascriptFontWindow(t *testing.T, view *Widget) fyne.Window {
	t.Helper()
	window := test.NewWindow(view)
	t.Cleanup(window.Close)
	window.SetPadded(false)
	window.Resize(fyne.NewSize(240, 120))
	window.Canvas().Capture()
	return window
}

func TestJavascriptFontResourcesRecheckColdAndWarmWithoutNewJournalEntries(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	recorded := "1000"
	for _, seed := range [][]JournalEntry{{}, {{Kind: "now", Args: "[]", Value: &recorded}}} {
		data := javascriptFontData(t)
		backend, resource := javascriptFontBackend(bytes.Clone(data))
		actions := 0
		bindings := webui.Actions{"after": func(...any) any { actions++; return nil }}
		archive := javascriptFontArchive(javascriptFontRequest(data), "")
		archive.Journal = append([]JournalEntry{}, seed...)
		view, err := New(archive, bindings, backend)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = view.Close() })
		javascriptFontWindow(t, view)
		view.dispatch("caption", "click", nil)
		warm, err := view.ExportJavascript()
		if err != nil || !reflect.DeepEqual(warm.Journal, archive.Journal) || len(warm.Events) != 1 || actions != 0 || resource.reads != 1 {
			t.Fatalf("cold binding changed recorded history: %+v %v reads=%d", warm, err, resource.reads)
		}
		restored, err := New(warm, bindings, &backend)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = restored.Close() })
		javascriptFontWindow(t, restored)
		again, err := restored.ExportJavascript()
		if err != nil || !reflect.DeepEqual(again, warm) || !reflect.DeepEqual(again.Journal, archive.Journal) || resource.reads != 2 || actions != 0 {
			t.Fatalf("restore did not recheck outside history: %v reads=%d", err, resource.reads)
		}
		resource.data[0] ^= 0xff
		if failed, err := New(warm, bindings, backend); err == nil || failed != nil || actions != 0 {
			t.Fatalf("warm state bypassed changed bytes: %v", err)
		}
	}
}

func TestJavascriptFontResourcesPaintImmutableBytesAcrossUpdates(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	backend, resource := javascriptFontBackend(bytes.Clone(data))
	view, err := New(javascriptFontArchive(javascriptFontRequest(data), ""), webui.Actions{"after": func(...any) any { return nil }}, backend)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = view.Close() })
	window := javascriptFontWindow(t, view)
	object := view.Object("caption")
	painted := javascriptFontPaint(t, view, "Count:0")
	font := painted.FontSource
	if font == nil || javascriptFontHash(font.Content()) != javascriptFontHash(data) {
		t.Fatal("painter does not use the checked bytes")
	}
	resource.data[0] ^= 0xff
	backend.Fonts["Host"][webui.Font{Weight: 400}] = fyne.NewStaticResource("replacement", []byte("invalid"))
	font.Content()[0] ^= 0xff
	for index, text := range []string{"Count:1", "Count:2"} {
		view.dispatch("caption", "click", nil)
		window.Canvas().Capture()
		painted = javascriptFontPaint(t, view, text)
		if view.Error() != nil || view.Object("caption") != object || painted.FontSource != font || javascriptFontHash(font.Content()) != javascriptFontHash(data) {
			t.Fatalf("mutation or update %d changed the native binding: %v", index, view.Error())
		}
	}
}

func TestJavascriptFontResourcesProtocolFailuresBlockCaughtActionsAndTrees(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	good := javascriptFontRequest(data)
	for _, request := range []string{
		`host("font-resources","2","[]");`, `host("font-resources",1,"[]");`,
		`host(new String("font-resources"),"1","[]");`,
		`host("font-resources",new String("1"),"[]");`, `host("font-resources","1",[]);`,
		`host("font-resources","1");`, `host("font-resources","1","[]",true);`,
		`host("font-resources","1","{}");`, `host("font-resources","1","[null]");`,
		`host("font-resources","1"," ".repeat(16385));`,
		good + good,
	} {
		backend, _ := javascriptFontBackend(bytes.Clone(data))
		owner := &javascriptFontCustom{FyneBackend: backend}
		calls, bound := 0, 0
		binder := javascriptFontBinder(func(items []webui.FontResourceRequirement) (webui.Backend, error) {
			bound++
			checked, err := backend.BindFontResources(items)
			if err != nil {
				return nil, err
			}
			return &javascriptFontChecked{Backend: checked, owner: owner}, nil
		})
		archive := javascriptFontArchive(`try{`+request+`}catch(error){};`, `try{host("action","after","[]")}catch(error){};`)
		view, err := NewWithOptions(archive, webui.Actions{"after": func(...any) any { calls++; return nil }}, Options{FontResources: binder}, owner)
		if err == nil || view != nil || calls != 0 || owner.boxes != 0 || bound > 1 {
			t.Fatalf("caught request failure continued: %s: %v calls=%d boxes=%d", request, err, calls, owner.boxes)
		}
	}
}

func TestJavascriptFontResourcesUseOnlyTheFirstBackendAndRejectMissingFaces(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	backend, _ := javascriptFontBackend(data)
	archive := javascriptFontArchive(javascriptFontRequest(data), `host("action","after","[]");`)
	for _, selected := range [][]webui.Backend{nil, {nil, backend}, {webui.FyneBackend{}, backend}, {(*webui.FyneBackend)(nil), backend}} {
		calls := 0
		view, err := New(archive, webui.Actions{"after": func(...any) any { calls++; return nil }}, selected...)
		if err == nil || view != nil || calls != 0 {
			t.Fatalf("missing first backend fell through or acted: %v", err)
		}
	}
	view, err := New(archive, webui.Actions{"after": func(...any) any { return nil }}, backend, webui.FyneBackend{})
	if err != nil {
		t.Fatal(err)
	}
	_ = view.Close()
	wrong := javascriptFontArchive(strings.Replace(javascriptFontRequest(data), javascriptFontHash(data), strings.Repeat("0", 64), 1), `host("action","after","[]");`)
	calls := 0
	if view, err := New(wrong, webui.Actions{"after": func(...any) any { calls++; return nil }}, backend); err == nil || view != nil || calls != 0 {
		t.Fatalf("wrong hash reached later host work: %v", err)
	}
}

func TestJavascriptFontResourcesRecheckExplicitFrozenBinders(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	backend, _ := javascriptFontBackend(data)
	checked, err := backend.BindFontResources([]webui.FontResourceRequirement{{Family: "Host", Weight: 400, Style: "normal", Hash: javascriptFontHash(data)}})
	if err != nil {
		t.Fatal(err)
	}
	archive := javascriptFontArchive(javascriptFontRequest(data), "")
	actions := webui.Actions{"after": func(...any) any { return nil }}
	if view, err := New(archive, actions, checked); err == nil || view != nil || !strings.Contains(err.Error(), "explicit") {
		t.Fatalf("private binder was selected implicitly: %v", err)
	}
	view, err := NewWithOptions(archive, actions, Options{FontResources: checked.(webui.FontResourceBinder)}, checked)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = view.Close() })
	javascriptFontWindow(t, view)
	if view.fontResources.backend != checked || javascriptFontHash(javascriptFontPaint(t, view, "Count:0").FontSource.Content()) != javascriptFontHash(data) {
		t.Fatal("explicit checked backend was replaced")
	}
}

func TestJavascriptFontResourcesRequireExplicitCustomBinders(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	backend, _ := javascriptFontBackend(data)
	owner := &javascriptFontCustom{FyneBackend: backend}
	archive := javascriptFontArchive(javascriptFontRequest(data), "")
	actions := webui.Actions{"after": func(...any) any { return nil }}
	if view, err := New(archive, actions, owner); err == nil || view != nil || !strings.Contains(err.Error(), "explicit") || owner.boxes != 0 {
		t.Fatalf("promoted binder discarded custom overrides: %v", err)
	}
	binder := javascriptFontBinder(func(items []webui.FontResourceRequirement) (webui.Backend, error) {
		checked, err := backend.BindFontResources(items)
		if err != nil {
			return nil, err
		}
		return &javascriptFontChecked{Backend: checked, owner: owner}, nil
	})
	view, err := NewWithOptions(archive, actions, Options{FontResources: binder}, owner)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = view.Close() })
	javascriptFontWindow(t, view)
	if owner.boxes == 0 || javascriptFontPaint(t, view, "Count:0").FontSource == nil {
		t.Fatal("explicit custom backend was not used")
	}
}

func TestJavascriptFontResourcesRejectNilErrorAndPanickingBinders(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	var typedNil *javascriptFontCustom
	var nilBinder javascriptFontBinder
	for _, binder := range []webui.FontResourceBinder{
		nilBinder,
		typedNil,
		javascriptFontBinder(func([]webui.FontResourceRequirement) (webui.Backend, error) { return nil, nil }),
		javascriptFontBinder(func([]webui.FontResourceRequirement) (webui.Backend, error) { return typedNil, nil }),
		javascriptFontBinder(func([]webui.FontResourceRequirement) (webui.Backend, error) { return nil, errors.New("refused") }),
		javascriptFontBinder(func([]webui.FontResourceRequirement) (webui.Backend, error) { panic("broken binder") }),
	} {
		calls := 0
		archive := javascriptFontArchive(`try{`+javascriptFontRequest(data)+`}catch(error){};`, `try{host("action","after","[]")}catch(error){};`)
		view, err := NewWithOptions(archive, webui.Actions{"after": func(...any) any { calls++; return nil }}, Options{FontResources: binder})
		if err == nil || view != nil || calls != 0 {
			t.Fatalf("invalid binder was accepted: %v", err)
		}
	}
}

func TestJavascriptFontResourcesRejectLateCallsAndKeepLastNativeFrame(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	backend, _ := javascriptFontBackend(data)
	base := javascriptFontArchive(javascriptFontRequest(data), "")
	code := strings.Replace(base.Code, `dispatch(event){count++;events.push(event)}`, `dispatch(event){try{host("font-resources","1","[]")}catch(error){};globalThis.fontMutation++;try{host("action","after","[]")}catch(error){};count++;events.push(event)}`, 1)
	archive := testArchive(code)
	archive.Actions = base.Actions
	calls := 0
	view, err := New(archive, webui.Actions{"after": func(...any) any { calls++; return nil }}, backend)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = view.Close() })
	javascriptFontWindow(t, view)
	object := view.Object("caption")
	view.dispatch("caption", "click", nil)
	if view.fault == nil || !strings.Contains(view.fault.Error(), "initialization") || calls != 0 || view.Object("caption") != object || view.vm.Get("fontMutation").ToInteger() != 1 {
		t.Fatalf("late request mutated native state or ran actions: %v", view.fault)
	}
	if _, err := view.call("flush"); err == nil {
		t.Fatal("sticky fault allowed flush")
	}
	if _, err := view.ExportJavascript(); err == nil || view.vm.Get("fontExports").ToInteger() != 0 {
		t.Fatal("sticky fault reached export")
	}
	view.dispatch("caption", "click", nil)
	if calls != 0 || view.vm.Get("fontMutation").ToInteger() != 1 {
		t.Fatal("failed widget ran another event")
	}
	if label, ok := object.(interface{ AccessibilityLabel() string }); !ok || label.AccessibilityLabel() != "Count:0" {
		t.Fatal("late request changed the last native text")
	}
	late := testArchive(strings.Replace(base.Code, `flush(){}`, `flush(){try{host("font-resources","1","[]")}catch(error){};try{host("action","after","[]")}catch(error){};}`, 1))
	late.Actions = base.Actions
	if failed, err := New(late, webui.Actions{"after": func(...any) any { calls++; return nil }}, backend); err == nil || failed != nil || calls != 0 {
		t.Fatalf("post-factory flush accepted a request: %v", err)
	}
}

func TestJavascriptFontResourcesDoNotChangeArchivesWithoutRequests(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	backend, _ := javascriptFontBackend(data)
	backend.Fonts["Host"][webui.Font{Weight: 400}] = fyne.NewStaticResource("legacy.ttf", data)
	owner := &javascriptFontCustom{FyneBackend: backend}
	called := 0
	binder := javascriptFontBinder(func([]webui.FontResourceRequirement) (webui.Backend, error) { called++; panic("unused option") })
	base := javascriptFontArchive("", "")
	legacy := testArchive(strings.TrimPrefix(base.Code, FontResourceFactoryHeader))
	legacy.Actions = base.Actions
	view, err := NewWithOptions(legacy, webui.Actions{"after": func(...any) any { return nil }}, Options{FontResources: binder}, owner)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = view.Close() })
	javascriptFontWindow(t, view)
	if called != 0 || owner.boxes == 0 {
		t.Fatal("no-request route replaced the original custom backend")
	}
	archive, err := view.ExportJavascript()
	if err != nil || len(archive.Journal) != 0 {
		t.Fatalf("no-request archive changed: %v", err)
	}
}

func TestJavascriptFontResourcesRequireTheVersionedFactoryABI(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	backend, _ := javascriptFontBackend(data)
	base := javascriptFontArchive(javascriptFontRequest(data), `host("action","after","[]");`)
	for _, code := range []string{
		strings.TrimPrefix(base.Code, FontResourceFactoryHeader),
		strings.Replace(base.Code, "font resources:1", "font resources:2", 1),
	} {
		archive := testArchive(code)
		archive.Actions = base.Actions
		calls := 0
		if view, err := New(archive, webui.Actions{"after": func(...any) any { calls++; return nil }}, backend); err == nil || view != nil || !strings.Contains(err.Error(), "FontResourceFactoryHeader") || calls != 0 {
			t.Fatalf("unmarked request was admitted: %v", err)
		}
	}
	if view, err := New(javascriptFontArchive("", ""), webui.Actions{"after": func(...any) any { return nil }}, backend); err == nil || view != nil || !strings.Contains(err.Error(), "synchronous") {
		t.Fatalf("marked factory omitted its check: %v", err)
	}
	calls := 0
	if view, err := New(javascriptFontArchive("", `try{host("action","after","[]")}catch(error){};`), webui.Actions{"after": func(...any) any { calls++; return nil }}, backend); err == nil || view != nil || calls != 0 {
		t.Fatalf("marked factory acted before checking resources: %v", err)
	}
}

func TestJavascriptFontResourcesRejectCaughtPromiseMicrotaskRequests(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	backend, _ := javascriptFontBackend(data)
	owner := &javascriptFontCustom{FyneBackend: backend}
	bound, calls := 0, 0
	binder := javascriptFontBinder(func(items []webui.FontResourceRequirement) (webui.Backend, error) {
		bound++
		checked, err := backend.BindFontResources(items)
		if err != nil {
			return nil, err
		}
		return &javascriptFontChecked{Backend: checked, owner: owner}, nil
	})
	request := `Promise.resolve().then(function(){try{` + javascriptFontRequest(data) + `}catch(error){};try{host("action","after","[]")}catch(error){};});`
	view, err := NewWithOptions(javascriptFontArchive(request, ""), webui.Actions{"after": func(...any) any { calls++; return nil }}, Options{FontResources: binder}, owner)
	if err == nil || view != nil || !strings.Contains(err.Error(), "initialization") || bound != 0 || calls != 0 || owner.boxes != 0 {
		t.Fatalf("microtask escaped the synchronous window: %v bound=%d actions=%d boxes=%d", err, bound, calls, owner.boxes)
	}
}

func TestJavascriptFontResourcesRejectSnapshotSerializationBeforeNativeCreation(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	base := javascriptFontArchive(javascriptFontRequest(data), "")
	for _, item := range []struct{ code, diagnostic string }{
		{strings.Replace(base.Code, `snapshot:sample`, `snapshot(){return {toJSON(){try{host("font-resources","1","[]")}catch(error){};return sample()}}}`, 1), "initialization"},
		{strings.Replace(base.Code, `return {flush(){}`, `JSON.stringify=function(){return {toString(){try{host("font-resources","1","[]")}catch(error){};return "[]"}}};return {flush(){}`, 1), "primitive string"},
	} {
		backend, _ := javascriptFontBackend(bytes.Clone(data))
		owner := &javascriptFontCustom{FyneBackend: backend}
		bound := 0
		binder := javascriptFontBinder(func(items []webui.FontResourceRequirement) (webui.Backend, error) {
			bound++
			checked, err := backend.BindFontResources(items)
			if err != nil {
				return nil, err
			}
			return &javascriptFontChecked{Backend: checked, owner: owner}, nil
		})
		archive := testArchive(item.code)
		archive.Actions = base.Actions
		view, err := NewWithOptions(archive, webui.Actions{"after": func(...any) any { return nil }}, Options{FontResources: binder}, owner)
		if err == nil || view != nil || !strings.Contains(err.Error(), item.diagnostic) || bound != 1 || owner.boxes != 0 {
			t.Fatalf("serialization reached native creation: %v bound=%d boxes=%d", err, bound, owner.boxes)
		}
	}
}

func TestJavascriptFontResourcesKeepNativeFrameAfterSnapshotSerializationFailure(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	backend, _ := javascriptFontBackend(data)
	base := javascriptFontArchive(javascriptFontRequest(data), "")
	code := strings.Replace(base.Code, `snapshot:sample`, `snapshot(){if(!count)return sample();return {toJSON(){try{host("font-resources","1","[]")}catch(error){};return sample()}}}`, 1)
	archive := testArchive(code)
	archive.Actions = base.Actions
	view, err := New(archive, webui.Actions{"after": func(...any) any { return nil }}, backend)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = view.Close() })
	javascriptFontWindow(t, view)
	object := view.Object("caption")
	view.dispatch("caption", "click", nil)
	if view.Error() == nil || !strings.Contains(view.Error().Error(), "initialization") || view.Object("caption") != object {
		t.Fatalf("serialization failure committed native state: %v", view.Error())
	}
	if label, ok := object.(interface{ AccessibilityLabel() string }); !ok || label.AccessibilityLabel() != "Count:0" {
		t.Fatal("serialization failure changed the last native text")
	}
	if _, err := view.ExportJavascript(); err == nil || view.vm.Get("fontExports").ToInteger() != 0 {
		t.Fatal("serialization failure reached later export")
	}
}

func TestJavascriptFontResourcesRejectExportSerializationFailures(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	data := javascriptFontData(t)
	backend, _ := javascriptFontBackend(data)
	base := javascriptFontArchive(javascriptFontRequest(data), "")
	code := strings.Replace(base.Code, `export(){globalThis.fontExports++;return {...archive,events,journal:archive.journal.slice(),frame:sample()}}`, `export(){globalThis.fontExports++;return {toJSON(){try{host("font-resources","1","[]")}catch(error){};return {...archive,events,journal:archive.journal.slice(),frame:sample()}}}}`, 1)
	archive := testArchive(code)
	archive.Actions = base.Actions
	view, err := New(archive, webui.Actions{"after": func(...any) any { return nil }}, backend)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = view.Close() })
	javascriptFontWindow(t, view)
	if _, err := view.ExportJavascript(); err == nil || !strings.Contains(err.Error(), "initialization") || view.vm.Get("fontExports").ToInteger() != 1 {
		t.Fatalf("export serialization accepted a caught request: %v", err)
	}
	if _, err := view.ExportJavascript(); err == nil || view.vm.Get("fontExports").ToInteger() != 1 {
		t.Fatal("sticky serialization fault reran export")
	}
}
