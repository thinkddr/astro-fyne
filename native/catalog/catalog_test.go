// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package catalog

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/layout"
	"fyne.io/fyne/v2/test"
	"fyne.io/fyne/v2/widget"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/javascript"
	"github.com/thinkddr/astro-fyne/native/motion"
	"github.com/thinkddr/astro-fyne/native/reverse"
)

func fixture(t *testing.T) Spec {
	t.Helper()
	css := []byte("\xef\xbb\xbf/* source */\r\nbutton { color: #123456; }\r\n")
	code := `function(host,archive){var count=0,events=[];return {flush:function(){},finishReplay:function(){},dispose:function(){},snapshot:function(){return [{uid:"button",tag:"button",attrs:{id:"increment"},events:["clickfalse"],children:[{uid:"label",tag:"#text",text:String(count)}]}]},dispatch:function(event){count++;events.push(event);host("action","changed",JSON.stringify([count]));return true},replay:function(event){count++;events.push(event)},export:function(){var saved=JSON.parse(JSON.stringify(archive));saved.events=events.slice();return saved}}}`
	archive := javascript.Archive{Schema: 1, Kind: "astro-fyne-javascript", Code: code, CodeHash: digest([]byte(code)), Sources: []javascript.Source{{Path: "fixture.js", Hash: digest([]byte(code))}, {Path: "../styles/main.css", Hash: digest(css)}}, Props: json.RawMessage(`{}`), Actions: []string{"changed"}, Events: []javascript.Event{}, Journal: []javascript.JournalEntry{}, Stylesheets: []javascript.Stylesheet{{Path: "../styles/main.css", Hash: digest(css), Text: string(css)}}}
	payload, err := json.Marshal(archive)
	if err != nil {
		t.Fatal(err)
	}
	return Spec{
		Schema: 1, Kind: "astro-fyne-catalogue", Name: "Components",
		Stylesheets: []Stylesheet{{ID: "main", Path: "../styles/main.css", Hash: digest(css), Content: css}},
		Themes:      []ThemeSpec{{ID: "light", Tokens: map[string]string{"--Accent": "#123456", "--color-primary": "#123456"}}},
		Layouts:     []LayoutSpec{{ID: "row", Style: webui.Style{Height: 80, Display: "flex", Direction: "row", Opacity: 1, Flex: &webui.FlexStyle{WidthSet: true, WidthPercent: webui.FlexValue(100), HeightSet: true, BoxSizing: "border-box", AlignItems: "stretch"}}}},
		Components:  []Component{{ID: "Counter", Kind: "javascript", Payload: string(payload), Hash: digest(payload), Theme: "light", Layout: "row", Stylesheets: []string{"main"}, Actions: []string{"changed"}}},
		Islands:     []Island{{ID: "left", Component: "Counter", Key: "same-key"}, {ID: "right", Component: "Counter", Key: "same-key"}},
	}
}

func requireRegistry(t *testing.T, spec Spec) *Registry {
	t.Helper()
	r, err := New(spec)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func fontFixture(t *testing.T) Spec {
	t.Helper()
	spec := fixture(t)
	data, err := os.ReadFile("../../example/public/fonts/NotoSans-Regular.ttf")
	if err != nil {
		t.Fatal(err)
	}
	license, err := os.ReadFile("../../example/public/fonts/LICENSE-NotoSans.txt")
	if err != nil {
		t.Fatal(err)
	}
	spec.Resources = []Resource{{Name: "fonts/NotoSans-Regular.ttf", MediaType: "font/ttf", Hash: digest(data), Content: data, License: string(license)}}
	spec.FontFaces = []FontFace{{ID: "regular", Family: "AstroNoto", Weight: 400, Style: "normal", Resource: spec.Resources[0].Name, Hash: spec.Resources[0].Hash}}
	spec.Themes[0].FontFaces = []string{"regular"}
	spec.Components[0].FontFaces = []string{"regular"}
	return spec
}

func TestCatalogueOwnsResourcesCSSPayloadAndLayoutPointers(t *testing.T) {
	spec := fontFixture(t)
	spec.Components[0].Payload = "\n " + spec.Components[0].Payload + "\n"
	spec.Components[0].Hash = digest([]byte(spec.Components[0].Payload))
	wantPayload := spec.Components[0].Payload
	r := requireRegistry(t, spec)
	spec.Resources[0].Content[0] ^= 0xff
	spec.Stylesheets[0].Content[0] = 'X'
	*spec.Layouts[0].Style.Flex.WidthPercent = 20
	spec.Themes[0].Tokens["--Accent"] = "changed"
	copy := r.Spec()
	if copy.Components[0].Payload != wantPayload || !bytes.HasPrefix(copy.Stylesheets[0].Content, []byte{0xef, 0xbb, 0xbf}) || *copy.Layouts[0].Style.Flex.WidthPercent != 100 {
		t.Fatal("construction retained mutable source aliases")
	}
	resource := r.Resources()[0]
	resource.Content[0] ^= 0xff
	style, err := r.Layout("row")
	if err != nil {
		t.Fatal(err)
	}
	*style.Flex.WidthPercent = 30
	encoded, err := r.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	restored, err := Parse(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Spec().Components[0].Payload != wantPayload || !bytes.Equal(restored.Spec().Stylesheets[0].Content, copy.Stylesheets[0].Content) || restored.Spec().Resources[0].Hash != digest(restored.Spec().Resources[0].Content) || *restored.Spec().Layouts[0].Style.Flex.WidthPercent != 100 {
		t.Fatal("round trip changed source bytes, payload or layout presence")
	}
	clone, err := r.Clone()
	if err != nil {
		t.Fatal(err)
	}
	clone.Spec().Stylesheets[0].Content[0] = 'Z'
	if r.Spec().Stylesheets[0].Content[0] != 0xef {
		t.Fatal("clone getter leaked source storage")
	}
}

func TestCatalogueDiagnosesChangedHashesReferencesAndUnsafeResourcePaths(t *testing.T) {
	for name, change := range map[string]func(*Spec){
		"resource-path":  func(s *Spec) { s.Resources[0].Name = "../private.ttf" },
		"resource-bytes": func(s *Spec) { s.Resources[0].Content[0] ^= 0xff },
		"css-bytes":      func(s *Spec) { s.Stylesheets[0].Content[0] = 'X' },
		"css-utf8": func(s *Spec) {
			s.Stylesheets[0].Content = []byte{0xff}
			s.Stylesheets[0].Hash = digest(s.Stylesheets[0].Content)
		},
		"payload-bytes":            func(s *Spec) { s.Components[0].Payload += " " },
		"missing-theme":            func(s *Spec) { s.Components[0].Theme = "absent" },
		"missing-layout":           func(s *Spec) { s.Components[0].Layout = "absent" },
		"missing-font":             func(s *Spec) { s.Components[0].FontFaces = []string{"absent"} },
		"missing-css":              func(s *Spec) { s.Components[0].Stylesheets = []string{"absent"} },
		"duplicate-component":      func(s *Spec) { s.Components = append(s.Components, s.Components[0]) },
		"duplicate-island":         func(s *Spec) { s.Islands = append(s.Islands, s.Islands[0]) },
		"missing-island-component": func(s *Spec) { s.Islands[0].Component = "absent" },
		"unbound-action":           func(s *Spec) { s.Components[0].Actions = []string{} },
		"repeated-action":          func(s *Spec) { s.Components[0].Actions = []string{"changed", "changed"} },
		"repeated-css":             func(s *Spec) { s.Components[0].Stylesheets = []string{"main", "main"} },
	} {
		t.Run(name, func(t *testing.T) {
			spec := fontFixture(t)
			change(&spec)
			if _, err := New(spec); err == nil {
				t.Fatal("invalid catalogue was accepted")
			}
		})
	}
}

func TestCatalogueRequiresKnownFieldsAndExactCSSArchiveBindings(t *testing.T) {
	r := requireRegistry(t, fixture(t))
	data, err := r.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]json.RawMessage
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	value["unexpected"] = json.RawMessage(`true`)
	bad, _ := json.Marshal(value)
	if _, err := Parse(bad); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown fields were dropped: %v", err)
	}
	delete(value, "unexpected")
	delete(value, "resources")
	bad, _ = json.Marshal(value)
	if _, err := Parse(bad); err == nil || !strings.Contains(err.Error(), "missing JSON field") {
		t.Fatalf("missing collections were accepted: %v", err)
	}
	spec := r.Spec()
	spec.Stylesheets[0].Path = "other.css"
	if _, err := New(spec); err == nil || !strings.Contains(err.Error(), "CSS bytes") {
		t.Fatalf("CSS source identity was lost: %v", err)
	}
	spec = r.Spec()
	var archive map[string]json.RawMessage
	_ = json.Unmarshal([]byte(spec.Components[0].Payload), &archive)
	archive["dropped"] = json.RawMessage(`"callback"`)
	changed, _ := json.Marshal(archive)
	spec.Components[0].Payload, spec.Components[0].Hash = string(changed), digest(changed)
	if _, err := New(spec); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown payload fields were dropped: %v", err)
	}
	for _, replacement := range []string{
		`"name":"Components","Name":"Changed"`,
		`"name":"Components","name":"Changed"`,
	} {
		changed := bytes.Replace(data, []byte(`"name":"Components"`), []byte(replacement), 1)
		if _, err := Parse(changed); err == nil {
			t.Fatal("case aliases or repeated JSON keys changed catalogue identity")
		}
	}
	changed = bytes.Replace(data, []byte(`"theme":"light"`), []byte(`"theme":"light","Theme":"absent"`), 1)
	if _, err := Parse(changed); err == nil {
		t.Fatal("nested JSON aliases were accepted")
	}
	changed = bytes.Replace(data, []byte(`"--Accent":"#123456"`), []byte(`"--Accent":"\ud800"`), 1)
	if _, err := Parse(changed); err == nil {
		t.Fatal("unpaired JSON Unicode was replaced silently")
	}
}

func TestCatalogueThemesAreIndependentAndFontsMustMatchActualFaces(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	base := app.Settings().Theme()
	r := requireRegistry(t, fontFixture(t))
	first, err := r.Theme("light", base)
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.Theme("light", base)
	if err != nil {
		t.Fatal(err)
	}
	first.Tokens["--Accent"] = "changed"
	first.Fonts[fyne.TextStyle{}].Content()[0] ^= 0xff
	if value, _ := second.CSS("--Accent"); value != "#123456" || app.Settings().Theme() != base {
		t.Fatal("theme construction changed independent or global theme state")
	}
	if bytes.Equal(first.Fonts[fyne.TextStyle{}].Content(), []byte{}) || digest(second.Fonts[fyne.TextStyle{}].Content()) != r.Spec().Resources[0].Hash {
		t.Fatal("font resource bytes were not retained")
	}
	for _, change := range []func(*Spec){
		func(s *Spec) { s.FontFaces[0].Weight = 700 },
		func(s *Spec) { s.FontFaces[0].Style = "italic" },
		func(s *Spec) { s.FontFaces[0].Hash = strings.Repeat("0", 64) },
		func(s *Spec) {
			s.Resources[0].Content = []byte("not a font")
			s.Resources[0].Hash = digest(s.Resources[0].Content)
			s.FontFaces[0].Hash = s.Resources[0].Hash
		},
		func(s *Spec) {
			data := s.Resources[0].Content
			for i := 0; i < int(binary.BigEndian.Uint16(data[4:6])); i++ {
				table := data[12+i*16 : 28+i*16]
				if string(table[:4]) == "maxp" {
					copy(table[:4], "xxxx")
				}
			}
			s.Resources[0].Hash = digest(data)
			s.FontFaces[0].Hash = s.Resources[0].Hash
		},
	} {
		spec := fontFixture(t)
		change(&spec)
		if _, err := New(spec); err == nil {
			t.Fatal("font declaration bypassed actual face validation")
		}
	}
}

func TestCatalogueRetainsFontAdmissionAndDiagnostics(t *testing.T) {
	resourceError := `catalog: invalid, duplicate or changed resource "fonts/NotoSans-Regular.ttf"`
	bindingError := `catalog: invalid, conflicting or missing font binding "regular"`
	for _, scenario := range []struct {
		name string
		change func(*Spec)
		want string
	}{
		{"actual-weight", func(s *Spec) { s.FontFaces[0].Weight = 700 }, `catalog: font "regular": declared font weight/style does not match actual face`},
		{"actual-style", func(s *Spec) { s.FontFaces[0].Style = "italic" }, `catalog: font "regular": declared font weight/style does not match actual face`},
		{"unsupported-weight", func(s *Spec) { s.FontFaces[0].Weight = 500 }, bindingError},
		{"unsupported-style", func(s *Spec) { s.FontFaces[0].Style = "oblique" }, bindingError},
		{"wrong-media", func(s *Spec) { s.Resources[0].MediaType = "application/octet-stream" }, bindingError},
		{"missing-license", func(s *Spec) { s.Resources[0].License = "" }, resourceError},
		{"blank-license", func(s *Spec) { s.Resources[0].License = " \r\n\t" }, resourceError},
		{"invalid-license-utf8", func(s *Spec) { s.Resources[0].License = string([]byte{0xff}) }, resourceError},
		{"changed-digest", func(s *Spec) { s.Resources[0].Content[0] ^= 0xff }, resourceError},
		{"font-format", func(s *Spec) {
			s.Resources[0].Content = []byte("not a font")
			s.Resources[0].Hash = digest(s.Resources[0].Content)
			s.FontFaces[0].Hash = s.Resources[0].Hash
		}, `catalog: font "regular": only static single-face TrueType resources are supported`},
		{"resource-limit", func(s *Spec) {
			data := make([]byte, 20*1024*1024+1)
			copy(data, s.Resources[0].Content)
			s.Resources[0].Content = data
			s.Resources[0].Hash = digest(data)
			s.FontFaces[0].Hash = s.Resources[0].Hash
		}, resourceError},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			spec := fontFixture(t)
			scenario.change(&spec)
			if _, err := New(spec); err == nil || err.Error() != scenario.want {
				t.Fatalf("catalogue font admission changed: got %v, want %q", err, scenario.want)
			}
		})
	}
}

func TestCatalogueRejectsOpaqueGoLayoutsAndRetainsPortableMotion(t *testing.T) {
	spec := fixture(t)
	spec.Layouts[0].Native = layout.NewVBoxLayout()
	if _, err := New(spec); err == nil || !strings.Contains(err.Error(), "Go algorithm") {
		t.Fatalf("layout callbacks were discarded: %v", err)
	}
	for _, change := range []func(*webui.FlexStyle){
		func(f *webui.FlexStyle) { f.BoxSizing = "" },
		func(f *webui.FlexStyle) { f.JustifyContent = "start" },
		func(f *webui.FlexStyle) { f.AlignItems = "end" },
		func(f *webui.FlexStyle) { f.AlignSelf = "start" },
	} {
		invalid := fixture(t)
		change(invalid.Layouts[0].Style.Flex)
		if _, err := New(invalid); err == nil {
			t.Fatal("unsupported portable layout was accepted")
		}
	}
	spec = fixture(t)
	spec.Motions = []motion.Spec{{Schema: 1, ID: "expand", Tracks: []motion.Track{{ID: "width", Target: "left", Property: motion.Width, Keyframes: []motion.Keyframe{{Offset: 0, Value: 20}, {Offset: 1, Value: 80}}}}, Timing: motion.Timing{DurationMS: 100, Iterations: 1, Direction: "normal", Fill: "both", Easing: motion.Easing{Kind: "linear"}}}}
	r := requireRegistry(t, spec)
	copy, err := r.Motion("expand")
	if err != nil {
		t.Fatal(err)
	}
	copy.Tracks[0].Keyframes[0].Value = 999
	retained, err := r.Motion("expand")
	if err != nil || retained.Tracks[0].Keyframes[0].Value != 20 {
		t.Fatalf("motion getter leaked mutable keyframes: %v", err)
	}
}

func TestCatalogueIslandsWithEqualKeysOwnIndependentGojaState(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	r := requireRegistry(t, fixture(t))
	if _, err := r.NewIsland("left", nil); err == nil || !strings.Contains(err.Error(), "missing native action") {
		t.Fatalf("unbound action was displayed: %v", err)
	}
	leftCalls, rightCalls := 0, 0
	leftObject, err := r.NewIsland("left", webui.Actions{"changed": func(...any) any { leftCalls++; return nil }})
	if err != nil {
		t.Fatal(err)
	}
	rightObject, err := r.NewIsland("right", webui.Actions{"changed": func(...any) any { rightCalls++; return nil }})
	if err != nil {
		t.Fatal(err)
	}
	left, right := leftObject.(*javascript.Widget), rightObject.(*javascript.Widget)
	defer left.Close()
	defer right.Close()
	button := left.Object("increment")
	if left == right || button == right.Object("increment") {
		t.Fatal("equal keys reused another island's native objects")
	}
	button.(fyne.Tappable).Tapped(nil)
	if err := left.Error(); err != nil {
		t.Fatal(err)
	}
	leftFrame, err := left.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	rightFrame, err := right.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if leftFrame.Roots[0].Node.Text != "1" || rightFrame.Roots[0].Node.Text != "0" || leftCalls != 1 || rightCalls != 0 || left.Object("increment") != button {
		t.Fatal("one island changed the other island's state, actions or object identity")
	}
	exported, err := left.ExportJavascript()
	if err != nil {
		t.Fatal(err)
	}
	if len(exported.Events) != 1 || len(exported.Stylesheets) != 1 || exported.Stylesheets[0].Text != string(r.Spec().Stylesheets[0].Content) {
		t.Fatal("island export lost state or exact CSS source")
	}
	data, err := r.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Parse(data); err != nil {
		t.Fatal(err)
	}
	exported.Props = json.RawMessage(`{"title":"Left instance"}`)
	payload, err := json.Marshal(exported)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint, err := r.WithIslandState("left", string(payload))
	if err != nil {
		t.Fatal(err)
	}
	data, err = checkpoint.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	restored, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	if r.Spec().Islands[0].StatePayload != "" || restored.Spec().Islands[0].StateHash != digest(payload) || restored.Spec().Islands[1].StatePayload != "" {
		t.Fatal("one checkpoint changed its prototype or another island")
	}
	leftReplayCalls, rightReplayCalls := 0, 0
	restoredLeftObject, err := restored.NewIsland("left", webui.Actions{"changed": func(...any) any { leftReplayCalls++; return nil }})
	if err != nil {
		t.Fatal(err)
	}
	restoredRightObject, err := restored.NewIsland("right", webui.Actions{"changed": func(...any) any { rightReplayCalls++; return nil }})
	if err != nil {
		t.Fatal(err)
	}
	restoredLeft, restoredRight := restoredLeftObject.(*javascript.Widget), restoredRightObject.(*javascript.Widget)
	defer restoredLeft.Close()
	defer restoredRight.Close()
	leftFrame, err = restoredLeft.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	rightFrame, err = restoredRight.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if leftFrame.Roots[0].Node.Text != "1" || rightFrame.Roots[0].Node.Text != "0" || leftReplayCalls != 0 || rightReplayCalls != 0 {
		t.Fatal("checkpoint restoration mixed independent state or repeated host effects")
	}
	leftExport, err := restoredLeft.ExportJavascript()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(leftExport.Props, exported.Props) || len(leftExport.Stylesheets) != 1 || leftExport.Stylesheets[0].Text != exported.Stylesheets[0].Text {
		t.Fatal("instance props or exact CSS bytes changed")
	}
}

func TestCatalogueIslandStatesCannotReplaceTheirComponentContract(t *testing.T) {
	r := requireRegistry(t, fixture(t))
	for name, mutate := range map[string]func(*javascript.Archive){
		"code":    func(a *javascript.Archive) { a.Code += " "; a.CodeHash = digest([]byte(a.Code)) },
		"source":  func(a *javascript.Archive) { a.Sources[0].Hash = strings.Repeat("0", 64) },
		"actions": func(a *javascript.Archive) { a.Actions = []string{} },
		"css": func(a *javascript.Archive) {
			a.Stylesheets[0].Text += " "
			a.Stylesheets[0].Hash = digest([]byte(a.Stylesheets[0].Text))
			a.Sources[1].Hash = a.Stylesheets[0].Hash
		},
	} {
		t.Run(name, func(t *testing.T) {
			var archive javascript.Archive
			if err := json.Unmarshal([]byte(r.Spec().Components[0].Payload), &archive); err != nil {
				t.Fatal(err)
			}
			mutate(&archive)
			payload, err := json.Marshal(archive)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := r.WithIslandState("left", string(payload)); err == nil || !strings.Contains(err.Error(), "cannot replace") {
				t.Fatalf("state replaced source contract: %v", err)
			}
		})
	}
	data, err := r.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	for _, fields := range []string{`"statePayload":""`, `"statePayload":"","stateHash":""`, `"stateHash":"abc"`} {
		changed := bytes.Replace(data, []byte(`"key":"same-key"`), []byte(`"key":"same-key",`+fields), 1)
		if _, err := Parse(changed); err == nil {
			t.Fatal("unpaired or explicitly empty state fields were accepted")
		}
	}
}

func TestCatalogueFactoriesAreExplicitAndNeverSerialized(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	spec := fixture(t)
	scene := reverse.Document{Schema: 1, Viewport: reverse.Viewport{Width: 100, Height: 80, Scale: 1}, Roots: []reverse.Node{{ID: "root", Kind: "container", Style: webui.Style{Width: 100, Height: 80, Opacity: 1, Measured: true}, Children: []reverse.Node{}}}, Tokens: map[string]string{}, Resources: []reverse.Resource{}, RequiredActions: []string{}}
	payload, err := json.Marshal(scene)
	if err != nil {
		t.Fatal(err)
	}
	spec.Components = []Component{{ID: "Native", Kind: "scene", Payload: string(payload), Hash: digest(payload), Theme: "light", Layout: "row"}}
	spec.Islands = []Island{{ID: "native", Component: "Native", Key: "stable"}}
	r := requireRegistry(t, spec)
	if _, err := r.NewWidget("Native", nil); err == nil || !strings.Contains(err.Error(), "registered native factory") {
		t.Fatalf("scene factory was silently inferred: %v", err)
	}
	if err := r.RegisterFactory("Native", func(instance Instance) (fyne.Widget, error) {
		if instance.Theme == nil || instance.Layout == nil || instance.Island.ID != "native" {
			t.Fatal("factory dependencies or instance identity missing")
		}
		instance.Component.Payload = "changed"
		*instance.Layout.Flex.WidthPercent = 10
		return widget.NewLabel("Native implementation"), nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.NewIsland("native", nil); err != nil {
		t.Fatal(err)
	}
	if _, ok := r.Factory("Native"); !ok {
		t.Fatal("registered factory not found")
	}
	if *r.Spec().Layouts[0].Style.Flex.WidthPercent != 100 || r.Spec().Components[0].Payload != string(payload) {
		t.Fatal("native factory mutated catalogue metadata")
	}
	if err := r.RegisterFactory("Native", func(Instance) (fyne.Widget, error) { return nil, nil }); err == nil {
		t.Fatal("duplicate factory replaced an existing binding")
	}
	encoded, err := r.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	restored, err := Parse(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := restored.Factory("Native"); ok {
		t.Fatal("Go function survived portable serialization")
	}
	if _, err := restored.NewWidget("Native", nil); err == nil {
		t.Fatal("restored scene pretended to contain a Go implementation")
	}
}

func TestCataloguePortableProgramsRequireExplicitRestorationFactories(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	program := `{"entry":"Page","components":[{"name":"Page","props":[],"states":[],"constants":[],"initializers":[],"body":[]}],"sources":[],"actions":[]}`
	archive := webui.ProgramArchive{Schema: 1, Kind: "astro-fyne-program", SourceHash: digest([]byte("[]")), ProgramHash: digest([]byte(program)), Program: program, Props: webui.ProgramValue{Kind: "object", ID: 1, Entries: []webui.ProgramEntry{}}, State: webui.ProgramValue{Kind: "object", ID: 2, Entries: []webui.ProgramEntry{}}}
	payload, err := json.Marshal(archive)
	if err != nil {
		t.Fatal(err)
	}
	spec := fixture(t)
	spec.Components = []Component{{ID: "Program", Kind: "program", Payload: string(payload), Hash: digest(payload)}}
	spec.Islands = nil
	r := requireRegistry(t, spec)
	if _, err := r.NewWidget("Program", nil); err == nil || !strings.Contains(err.Error(), "registered native factory") {
		t.Fatalf("program implementation was inferred: %v", err)
	}
	if err := r.RegisterFactory("Program", func(instance Instance) (fyne.Widget, error) {
		props, state, err := webui.RestoreProgram(instance.Component.Payload, program, nil, instance.Actions)
		if err != nil {
			return nil, err
		}
		if len(props) != 0 || len(state) != 0 {
			t.Fatal("program state changed")
		}
		return widget.NewLabel("Explicit generated program"), nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.NewWidget("Program", nil); err != nil {
		t.Fatal(err)
	}
	spec.Components[0].Payload = strings.Replace(spec.Components[0].Payload, archive.ProgramHash, strings.Repeat("0", 64), 1)
	spec.Components[0].Hash = digest([]byte(spec.Components[0].Payload))
	if _, err := New(spec); err == nil || !strings.Contains(err.Error(), "identity mismatch") {
		t.Fatalf("program digest was not checked: %v", err)
	}
}

func TestCatalogueFontsWorkWithFyneTextMeasurement(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	registry := requireRegistry(t, fontFixture(t))
	component, err := registry.Component("Counter")
	if err != nil {
		t.Fatal(err)
	}
	backend := registry.backend(component)
	style := webui.Style{FontFamily: "AstroNoto", FontWeight: 400, FontSize: 14, LineHeight: 20, Measured: true}
	if err := backend.Validate(style, true); err != nil {
		t.Fatal(err)
	}
	text := backend.Text("Hgx", style)
	theme, err := registry.Theme("light", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, resource := range []fyne.Resource{backend.Fonts["AstroNoto"][webui.Font{Weight: 400}], theme.Font(fyne.TextStyle{})} {
		text.FontSource = resource
		before := text.MinSize()
		if before.Width <= 0 || before.Height <= 0 {
			t.Fatal("catalogue font produced empty text metrics")
		}
		copied := resource.Content()
		copied[0] ^= 0xff
		if text.MinSize() != before || !bytes.Equal(resource.Content(), registry.Resources()[0].Content) {
			t.Fatal("font cache identity or immutable font bytes changed")
		}
	}
}
