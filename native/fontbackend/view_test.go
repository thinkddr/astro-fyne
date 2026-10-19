// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontbackend_test

import (
	"encoding/json"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/catalog"
	"github.com/thinkddr/astro-fyne/native/fontbackend"
	"github.com/thinkddr/astro-fyne/native/javascript"
)

func TestNominalBackendViewsUseInheritedFontsAndPreserveRejectedFrames(t *testing.T) {
	app := test.NewApp()
	t.Cleanup(app.Quit)
	resource := &mutableResource{data: fontBytes(t, "Regular")}
	backend := requireBackend(t, map[string]map[webui.Font]fyne.Resource{
		"Host":    {{Weight: 400}: resource},
		"Limited": {{Weight: 400}: &mutableResource{data: mappedFont(t, nominalMapping{' ', 1}, nominalMapping{'A', 2}, nominalMapping{'H', 3})}},
	})
	bad := false
	view := webui.NewView(func() []webui.Node {
		text, height := "Supported", float32(120)
		if bad {
			text, height = "\U0010ffff", 220
		}
		return []webui.Node{{ID: "root", Kind: "container", Style: webui.Style{Height: height, FontFamily: "Host", FontSize: 14, LineHeight: 20, FontWeight: 400}, Children: []webui.Node{
			{ID: "caption", Kind: "text", Text: text, Style: webui.Style{WhiteSpace: "nowrap"}},
			{ID: "button", Kind: "button", Text: "Action", Style: webui.Style{WhiteSpace: "nowrap"}},
		}}}
	}, backend)
	if err := view.Error(); err != nil {
		t.Fatalf("descendant font inheritance was rejected before resolution: %v", err)
	}
	view.SetViewport(320, 160)
	if err := view.SetCaptureScale(1); err != nil {
		t.Fatal(err)
	}
	window := test.NewWindow(view)
	t.Cleanup(window.Close)
	window.SetPadded(false)
	window.Resize(fyne.NewSize(320, 160))
	if err := view.BindCanvas(window.Canvas()); err != nil {
		t.Fatal(err)
	}
	window.Canvas().Capture()
	root, caption, button := view.Object("root"), view.Object("caption"), view.Object("button")
	painted := paintedText(t, caption, "Supported")
	font := painted.FontSource
	if fontHash(font.Content()) != fontHash(resource.data) {
		t.Fatal("native widget painted different bytes from its admitted font")
	}
	snapshot, err := view.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Roots[0].Children[0].Node.Style.FontFamily != "Host" || snapshot.Roots[0].Children[1].Node.Style.FontWeight != 400 {
		t.Fatal("native frame lost inherited family or button weight")
	}
	profile := map[string]webui.Style{}
	var collect func([]webui.SnapshotNode)
	collect = func(nodes []webui.SnapshotNode) {
		for _, node := range nodes {
			profile[node.Node.ID] = node.Node.Style
			collect(node.Children)
		}
	}
	collect(snapshot.Roots)
	if err := view.ApplyMeasurements(profile); err != nil {
		t.Fatal(err)
	}
	rootSize, captionPosition, buttonPosition := root.Size(), caption.Position(), button.Position()
	missingFace := make(map[string]webui.Style, len(profile))
	for id, style := range profile {
		missingFace[id] = style
	}
	unknown := missingFace["caption"]
	unknown.FontFamily = "Missing"
	missingFace["caption"] = unknown
	if err := view.ApplyMeasurements(missingFace); err == nil || !strings.Contains(err.Error(), "no exact bound face") || view.Error() != nil {
		t.Fatalf("generic profile style preflight did not preserve the previous valid frame: %v", err)
	}
	if retained, err := view.Snapshot(); err != nil || retained.Roots[0].Children[0].Node.Style.FontFamily != "Host" || painted.FontSource != font {
		t.Fatalf("uncommitted style request replaced the valid profile: %v", err)
	}
	limited := make(map[string]webui.Style, len(profile))
	for id, style := range profile {
		limited[id] = style
	}
	style := limited["caption"]
	style.FontFamily = "Limited"
	limited["caption"] = style
	if err := view.ApplyMeasurements(limited); err == nil || !strings.Contains(err.Error(), "missing glyph") || view.Error() == nil {
		t.Fatalf("new measured face bypassed actual text coverage: %v", err)
	}
	if root.Size() != rootSize || caption.Position() != captionPosition || button.Position() != buttonPosition || painted.Text != "Supported" || painted.FontSource != font {
		t.Fatal("failed measured coverage changed the existing native frame")
	}
	view.Refresh()
	if err := view.Error(); err != nil {
		t.Fatalf("valid retained measurement could not recover: %v", err)
	}
	bad = true
	view.Refresh()
	if view.Error() == nil || !strings.Contains(view.Error().Error(), "missing glyph") || view.Object("root") != root || view.Object("caption") != caption || view.Object("button") != button || root.Size() != rootSize || painted.Text != "Supported" || painted.FontSource != font {
		t.Fatalf("unsupported source mutated a retained widget: %v", view.Error())
	}
	if _, err := webui.ExportProgram(`{"actions":[]}`, strings.Repeat("a", 64), webui.Scope{}, webui.Scope{}, view); err == nil {
		t.Fatal("rejected nominal text was exported")
	}
	bad = false
	view.Refresh()
	window.Canvas().Capture()
	if err := view.Error(); err != nil || view.Object("caption") != caption || paintedText(t, caption, "Supported").FontSource != font || resource.reads != 1 {
		t.Fatalf("valid recovery remounted or reread its font: %v", err)
	}
}

func TestNominalBackendRejectsEditorsAndDefaultButtonWeights(t *testing.T) {
	app := test.NewApp()
	t.Cleanup(app.Quit)
	backend := regularBackend(t)
	for _, kind := range []string{"input", "textarea"} {
		view := webui.NewView(func() []webui.Node {
			return []webui.Node{{ID: "edit", Kind: kind, Disabled: true, Style: webui.Style{Display: "none"}}}
		}, backend)
		if view.Error() == nil || !strings.Contains(view.Error().Error(), "prospective-edit") || view.Object("edit") != nil {
			t.Fatalf("empty hidden/disabled editor reached its native factory: %s %v", kind, view.Error())
		}
	}
	view := webui.NewView(func() []webui.Node {
		return []webui.Node{{ID: "button", Kind: "button", Text: "Action", Style: webui.Style{FontFamily: "Host", WhiteSpace: "nowrap"}}}
	}, backend)
	if view.Error() == nil || !strings.Contains(view.Error().Error(), "400/700") || view.Object("button") != nil {
		t.Fatalf("default weight 600 was silently synthesized or remapped: %v", view.Error())
	}
}

func TestNominalBackendCatalogueGojaIslandsRetainLicensedFonts(t *testing.T) {
	app := test.NewApp()
	t.Cleanup(app.Quit)
	code := `function(host,archive){let bad=false;
function snapshot(){return [{uid:"root",tag:"div",attrs:{id:"root"},style:{height:120,fontFamily:"Host",fontSize:14,lineHeight:20},children:[
{uid:"caption",tag:"p",attrs:{id:"caption"},style:{whiteSpace:"nowrap"},children:[{uid:"text",tag:"#text",text:bad?String.fromCodePoint(0x10ffff):"Supported"}]},
{uid:"button",tag:"button",attrs:{id:"button"},style:{whiteSpace:"nowrap"},children:[{uid:"label",tag:"#text",text:"Toggle"}]}]}]}
return {flush(){},finishReplay(){},snapshot,dispatch(){host("action","observed","[]");bad=!bad},export(){return archive},dispose(){}}}`
	archive := javascript.Archive{Schema: 1, Kind: "astro-fyne-javascript", Code: code, CodeHash: fontHash([]byte(code)), Sources: []javascript.Source{{Path: "nominal.js", Hash: fontHash([]byte(code))}}, Props: json.RawMessage(`{}`), Actions: []string{"observed"}, Events: []javascript.Event{}, Journal: []javascript.JournalEntry{}}
	payload, err := json.Marshal(archive)
	if err != nil {
		t.Fatal(err)
	}
	data, license := fontBytes(t, "Regular"), fontLicense(t)
	spec := catalog.Spec{Schema: 1, Kind: "astro-fyne-catalogue", Name: "NominalFonts",
		Resources:  []catalog.Resource{{Name: "fonts/NotoSans-Regular.ttf", MediaType: "font/ttf", Hash: fontHash(data), Content: data, License: license}},
		FontFaces:  []catalog.FontFace{{ID: "regular", Family: "Host", Weight: 400, Style: "normal", Resource: "fonts/NotoSans-Regular.ttf", Hash: fontHash(data)}},
		Components: []catalog.Component{{ID: "Counter", Kind: "javascript", Payload: string(payload), Hash: fontHash(payload), FontFaces: []string{"regular"}, Actions: []string{"observed"}}},
		Islands:    []catalog.Island{{ID: "left", Component: "Counter", Key: "same"}, {ID: "right", Component: "Counter", Key: "same"}},
	}
	registry, err := catalog.New(spec)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := registry.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	registry, err = catalog.Parse(encoded)
	if err != nil {
		t.Fatal(err)
	}
	var shared *fontbackend.Backend
	if err := registry.RegisterFactory("Counter", func(input catalog.Instance) (fyne.Widget, error) {
		if shared == nil {
			var err error
			shared, err = fontbackend.New(input.Backend.Fonts)
			if err != nil {
				return nil, err
			}
		}
		var program javascript.Archive
		if err := json.Unmarshal([]byte(input.Component.Payload), &program); err != nil {
			return nil, err
		}
		return javascript.New(program, input.Actions, shared)
	}); err != nil {
		t.Fatal(err)
	}
	hostActions := 0
	actions := webui.Actions{"observed": func(...any) any { hostActions++; return nil }}
	leftWidget, err := registry.NewIsland("left", actions)
	if err != nil {
		t.Fatal(err)
	}
	left := leftWidget.(*javascript.Widget)
	t.Cleanup(func() { _ = left.Close() })
	rightWidget, err := registry.NewIsland("right", actions)
	if err != nil {
		t.Fatal(err)
	}
	right := rightWidget.(*javascript.Widget)
	t.Cleanup(func() { _ = right.Close() })
	leftWindow := test.NewWindow(left)
	t.Cleanup(leftWindow.Close)
	leftWindow.SetPadded(false)
	leftWindow.Resize(fyne.NewSize(280, 160))
	rightWindow := test.NewWindow(right)
	t.Cleanup(rightWindow.Close)
	rightWindow.SetPadded(false)
	rightWindow.Resize(fyne.NewSize(280, 160))
	if err := left.BindCanvas(leftWindow.Canvas()); err != nil {
		t.Fatal(err)
	}
	if err := right.BindCanvas(rightWindow.Canvas()); err != nil {
		t.Fatal(err)
	}
	leftWindow.Canvas().Capture()
	rightWindow.Canvas().Capture()
	leftText, rightText := paintedText(t, left.Object("caption"), "Supported"), paintedText(t, right.Object("caption"), "Supported")
	if leftText.FontSource != rightText.FontSource || fontHash(leftText.FontSource.Content()) != fontHash(data) || shared.Profiles()[0].Coverage.FontHash != fontHash(data) {
		t.Fatal("catalogue islands did not reuse the same immutable admitted painter resource")
	}
	root, button := left.Object("root"), left.Object("button")
	point := left.Position().Add(root.Position()).Add(button.Position()).Add(fyne.NewPos(8, 8))
	test.TapCanvas(leftWindow.Canvas(), point)
	if left.Error() == nil || !strings.Contains(left.Error().Error(), "missing glyph") || hostActions != 1 || leftText.Text != "Supported" || right.Error() != nil || rightText.Text != "Supported" {
		t.Fatalf("actual Goja click escaped admission or contaminated another island: actions=%d error=%v", hostActions, left.Error())
	}
	if _, err := left.ExportJavascript(); err == nil {
		t.Fatal("rejected catalogue island text was exported")
	}
	test.TapCanvas(leftWindow.Canvas(), point)
	if left.Error() != nil || hostActions != 2 || left.Object("button") != button || paintedText(t, left.Object("caption"), "Supported").FontSource != rightText.FontSource {
		t.Fatalf("later source recovery changed shared font ownership: actions=%d error=%v", hostActions, left.Error())
	}
	retained := registry.Spec()
	if retained.Resources[0].License != license || retained.Resources[0].Hash != fontHash(data) || fontHash(retained.Resources[0].Content) != fontHash(data) || retained.FontFaces[0].Family != "Host" {
		t.Fatal("native font admission changed catalogue license, alias or exact resource bytes")
	}
}
