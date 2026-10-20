// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/test"
)

type bindingTestResource struct {
	data   []byte
	reads  int
	onRead func()
}

func (*bindingTestResource) Name() string { panic("caller names are not resource identities") }
func (resource *bindingTestResource) Content() []byte {
	resource.reads++
	if resource.onRead != nil {
		resource.onRead()
	}
	return resource.data
}

type bindingTestSliceResource []byte

func (bindingTestSliceResource) Name() string {
	panic("caller names are not resource identities")
}
func (resource bindingTestSliceResource) Content() []byte {
	return resource
}

func bindingTestBytes(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile("../example/public/fonts/NotoSans-Regular.ttf")
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func bindingTestHash(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func bindingTestRequirement(data []byte) FontResourceRequirement {
	return FontResourceRequirement{Family: "Host", Weight: 400, Style: "normal", Hash: bindingTestHash(data)}
}

func TestFontResourceRequirementsClosedJSON(t *testing.T) {
	item := bindingTestRequirement([]byte("resource identity"))
	encoded, err := json.Marshal([]FontResourceRequirement{item})
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseFontResourceRequirements(append([]byte(" \n"), append(encoded, '\n')...))
	if err != nil || !reflect.DeepEqual(parsed, []FontResourceRequirement{item}) {
		t.Fatalf("valid closed requirements changed: %+v %v", parsed, err)
	}
	if _, err := ParseFontResourceRequirements(append(bytes.Repeat([]byte(" "), 16*1024-len(encoded)), encoded...)); err != nil {
		t.Fatalf("exact JSON size bound was rejected: %v", err)
	}
	if parsed, err := ParseFontResourceRequirements([]byte(strings.Replace(string(encoded), `"family"`, `"fam\u0069ly"`, 1))); err != nil || parsed[0] != item {
		t.Fatalf("valid escaped JSON field changed its identity: %v", err)
	}
	for _, data := range [][]byte{
		nil, []byte(`null`), []byte(`{}`), []byte(`[]`), []byte(`[null]`),
		[]byte(`[{}]`), []byte(`[true]`), []byte(`[`), append(encoded, []byte(` null`)...),
		[]byte(strings.Replace(string(encoded), `"weight":400`, `"weight":400.0`, 1)),
		[]byte(strings.Replace(string(encoded), `"weight":400`, `"weight":null`, 1)),
		[]byte(strings.Replace(string(encoded), `"family":"Host"`, `"family":"Host","fam\u0069ly":"Other"`, 1)),
		[]byte(strings.Replace(string(encoded), `"family":"Host"`, `"family":"Host","unknown":true`, 1)),
		[]byte(strings.Replace(string(encoded), `"family":"Host"`, `"family":"Host\ud800"`, 1)),
		[]byte(strings.Replace(string(encoded), `"family":"Host"`, `"family":null`, 1)),
		[]byte(strings.Replace(string(encoded), `"style":"normal",`, ``, 1)),
		append(bytes.Repeat([]byte(" "), 16*1024), encoded...), []byte{'[', 0xff, ']'},
	} {
		if result, err := ParseFontResourceRequirements(data); err == nil || result != nil {
			t.Fatalf("invalid closed JSON was admitted: %q %v", data, err)
		}
	}
	for _, change := range []func(*FontResourceRequirement){
		func(item *FontResourceRequirement) { item.Family = " Host" },
		func(item *FontResourceRequirement) { item.Family = "Host,Other" },
		func(item *FontResourceRequirement) { item.Family = "1Host" },
		func(item *FontResourceRequirement) { item.Family = strings.Repeat("A", 81) },
		func(item *FontResourceRequirement) { item.Weight = 600 },
		func(item *FontResourceRequirement) { item.Style = "oblique" },
		func(item *FontResourceRequirement) { item.Hash = strings.ToUpper(item.Hash) },
		func(item *FontResourceRequirement) { item.Hash = strings.Repeat("g", 64) },
		func(item *FontResourceRequirement) { item.Hash = "" },
	} {
		invalid := item
		change(&invalid)
		if ValidateFontResourceRequirements([]FontResourceRequirement{invalid}) == nil {
			t.Fatalf("invalid descriptor was admitted: %+v", invalid)
		}
	}
	for _, aliases := range [][2]string{{"Host", "HOST"}, {"Σ", "ς"}, {"S", "ſ"}} {
		first, second := item, item
		first.Family, second.Family = aliases[0], aliases[1]
		if err := ValidateFontResourceRequirements([]FontResourceRequirement{first, second}); err == nil {
			t.Fatalf("EqualFold duplicate requirement was admitted: %q", aliases)
		}
		second.Weight = 700
		if err := ValidateFontResourceRequirements([]FontResourceRequirement{first, second}); err != nil {
			t.Fatalf("different static face was treated as a duplicate: %v", err)
		}
	}
	faces := make([]FontResourceRequirement, 17)
	for index := range faces {
		faces[index] = item
		faces[index].Family = fmt.Sprintf("Alias%d", index)
	}
	if ValidateFontResourceRequirements(faces[:16]) != nil || ValidateFontResourceRequirements(faces) == nil {
		t.Fatal("requirement count bounds changed")
	}
	encoded, err = json.Marshal(faces)
	if err != nil {
		t.Fatal(err)
	}
	if result, err := ParseFontResourceRequirements(encoded); err == nil || result != nil {
		t.Fatal("closed JSON parser bypassed the face count bound")
	}
}

func TestFontResourceBindingPreflight(t *testing.T) {
	data := bindingTestBytes(t)
	resource := &bindingTestResource{data: data}
	item := bindingTestRequirement(data)
	var typedNil *bindingTestResource
	for _, backend := range []FyneBackend{
		{}, {Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 700}: resource}}},
		{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: typedNil}}},
		{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: nil}}},
		{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: resource}, "host": {}}},
		{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: resource}, "Σ": {}, "ς": {}}},
	} {
		if result, err := backend.BindFontResources([]FontResourceRequirement{item}); err == nil || result != nil || resource.reads != 0 {
			t.Fatalf("invalid map reached resource reads or produced a backend: %v", err)
		}
	}
	backend := FyneBackend{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: resource}}}
	if result, err := backend.BindFontResources(nil); err == nil || result != nil || resource.reads != 0 {
		t.Fatal("invalid request performed resource work")
	}
	for _, tooManyFamilies := range []bool{false, true} {
		fonts := map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: resource}}
		for index := range 256 {
			if tooManyFamilies {
				fonts[fmt.Sprintf("Alias%d", index)] = nil
			} else {
				fonts["Host"][Font{Weight: 1000 + index}] = nil
			}
		}
		if result, err := (FyneBackend{Fonts: fonts}).BindFontResources([]FontResourceRequirement{item}); err == nil || result != nil || resource.reads != 0 {
			t.Fatalf("unbounded nil bindings reached resource work: %v", err)
		}
	}
	for _, manyFamilies := range []bool{false, true} {
		fonts := map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: resource}}
		for index := range 255 {
			if manyFamilies {
				fonts[fmt.Sprintf("Alias%d", index)] = nil
			} else {
				fonts["Host"][Font{Weight: 1000 + index}] = nil
			}
		}
		if result, err := (FyneBackend{Fonts: fonts}).BindFontResources([]FontResourceRequirement{item}); err != nil || result == nil {
			t.Fatalf("exact snapshot count bound was rejected: %v", err)
		}
	}
	if resource.reads != 2 {
		t.Fatal("snapshot count checks lost one Content read per actual binding")
	}
}

func TestFontResourceBindingOwnershipAndPaint(t *testing.T) {
	data := bindingTestBytes(t)
	original := bytes.Clone(data)
	resource := &bindingTestResource{data: data}
	fonts := map[string]map[Font]fyne.Resource{
		"Host": {{Weight: 400}: resource, {Weight: 600}: bindingTestSliceResource(data)},
		"Alias": {{Weight: 400}: resource}, "Unused": {{Weight: 400}: nil},
	}
	item, alias := bindingTestRequirement(data), bindingTestRequirement(data)
	alias.Family = "Alias"
	selected, err := (FyneBackend{Fonts: fonts}).BindFontResources([]FontResourceRequirement{item, alias})
	if err != nil || selected == nil || resource.reads != 2 {
		t.Fatalf("required resources did not bind with one read per binding: %v", err)
	}
	bound, ok := selected.(*boundFontBackend)
	if !ok || len(bound.base.Fonts) != 3 || bound.base.Fonts["Unused"][Font{Weight: 400}] != nil {
		t.Fatal("private backend lost unrelated bindings")
	}
	delete(fonts, "Alias")
	fonts["Host"][Font{Weight: 400}] = nil
	data[0] ^= 0xff
	item.Family, alias.Hash = "Changed", strings.Repeat("0", 64)
	app := test.NewApp()
	t.Cleanup(app.Quit)
	style := Style{FontFamily: "Host", FontWeight: 400, FontStyle: "normal", FontSize: 14, LineHeight: 20, WhiteSpace: "nowrap", Color: "#112233", Opacity: 1}
	first := selected.Text("Stable", style)
	if first.FontSource == nil || !bytes.Equal(first.FontSource.Content(), original) {
		t.Fatal("caller mutation changed the selected painter font")
	}
	first.FontSource.Content()[0] ^= 0xff
	if !bytes.Equal(first.FontSource.Content(), original) {
		t.Fatal("resource Content exposed its frozen bytes")
	}
	other := style
	other.FontFamily = "Alias"
	if selected.Text("Stable", other).FontSource != first.FontSource || len(map[fyne.Resource]bool{first.FontSource: true}) != 1 {
		t.Fatal("equal bytes did not use one comparable private resource")
	}
	legacy := style
	legacy.FontWeight = 600
	if selected.Text("Legacy", legacy).FontSource != first.FontSource {
		t.Fatal("unrelated legacy weight was lost or reread")
	}
	request := bindingTestRequirement(original)
	if repeated, err := selected.(FontResourceBinder).BindFontResources([]FontResourceRequirement{request}); err != nil || repeated != selected {
		t.Fatalf("rechecking frozen resources replaced their owner: %v", err)
	}
	caption := "Stable"
	view := NewView(func() []Node { return []Node{{ID: "caption", Kind: "text", Text: caption, Style: style}} }, selected)
	window := test.NewWindow(view)
	t.Cleanup(window.Close)
	window.Resize(fyne.NewSize(240, 80))
	window.Canvas().Capture()
	object := view.Object("caption")
	for _, text := range []string{"Updated", "Stable"} {
		caption = text
		view.Refresh()
		window.Canvas().Capture()
		if view.Error() != nil || view.Object("caption") != object {
			t.Fatalf("bound font changed native lifetime: %v", view.Error())
		}
		found := false
		for _, child := range test.WidgetRenderer(object.(fyne.Widget)).Objects() {
			if painted, ok := child.(*canvas.Text); ok && painted.Text == text {
				found = painted.FontSource == first.FontSource && bytes.Equal(painted.FontSource.Content(), original)
			}
		}
		if !found || resource.reads != 2 {
			t.Fatal("actual native text did not retain the checked resource pointer and bytes")
		}
	}
}

func TestFontResourceBindingRequirementSnapshot(t *testing.T) {
	original := bindingTestBytes(t)
	alternative := append(bytes.Clone(original), 0, 0, 0, 0)
	control := bindingTestRequirement(alternative)
	if selected, err := (FyneBackend{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: bindingTestSliceResource(alternative)}}}).BindFontResources([]FontResourceRequirement{control}); err != nil || selected == nil {
		t.Fatalf("valid trailing-padding control was rejected: %v", err)
	}
	for _, changedBytes := range []bool{true, false} {
		data := original
		if changedBytes {
			data = alternative
		}
		before := bytes.Clone(data)
		requirements := []FontResourceRequirement{bindingTestRequirement(original)}
		resource := &bindingTestResource{data: data, onRead: func() {
			requirements[0].Hash = control.Hash
			if !changedBytes {
				requirements[0].Family = "Changed"
			}
		}}
		backend := FyneBackend{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: resource}}}
		selected, err := backend.BindFontResources(requirements)
		if resource.reads != 1 || backend.Fonts["Host"][Font{Weight: 400}] != resource || !bytes.Equal(data, before) || requirements[0].Hash != control.Hash {
			t.Fatal("binding changed its source or did not exercise the reentrant mutation")
		}
		if changedBytes {
			if err == nil || selected != nil {
				t.Fatal("Content callback substituted a valid but different resource pin")
			}
		} else {
			if err != nil || selected == nil {
				t.Fatalf("caller mutation replaced the original valid requirements: %v", err)
			}
			if checked, err := selected.(FontResourceBinder).BindFontResources([]FontResourceRequirement{bindingTestRequirement(original)}); err != nil || checked != selected {
				t.Fatalf("successful binding did not retain its original requirement identity: %v", err)
			}
		}
	}
}

func TestFontResourceBindingStaticFaceAndHash(t *testing.T) {
	data := bindingTestBytes(t)
	for _, change := range []func(*FontResourceRequirement, *[]byte){
		func(item *FontResourceRequirement, _ *[]byte) { item.Hash = strings.Repeat("0", 64) },
		func(item *FontResourceRequirement, _ *[]byte) { item.Weight = 700 },
		func(item *FontResourceRequirement, _ *[]byte) { item.Style = "italic" },
		func(item *FontResourceRequirement, data *[]byte) { (*data)[100] ^= 0xff; item.Hash = bindingTestHash(*data) },
	} {
		copy := bytes.Clone(data)
		item := bindingTestRequirement(copy)
		change(&item, &copy)
		resource := &bindingTestResource{data: copy}
		backend := FyneBackend{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: item.Weight, Italic: item.Style == "italic"}: resource}}}
		if result, err := backend.BindFontResources([]FontResourceRequirement{item}); err == nil || result != nil || resource.reads != 1 {
			t.Fatalf("wrong hash or malformed/mismatched static face was admitted: %v", err)
		}
	}
	app := test.NewApp()
	t.Cleanup(app.Quit)
	bold, err := os.ReadFile("../example/public/fonts/NotoSans-Bold.ttf")
	if err != nil {
		t.Fatal(err)
	}
	item := bindingTestRequirement(bold)
	item.Weight = 700
	selected, err := (FyneBackend{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 700}: bindingTestSliceResource(bold)}}}).BindFontResources([]FontResourceRequirement{item})
	if err != nil || selected == nil || bindingTestHash(selected.Text("Bold", Style{FontFamily: "Host", FontWeight: 700}).FontSource.Content()) != item.Hash {
		t.Fatalf("valid explicit bold face was not the selected resource: %v", err)
	}
	if (FyneBackend{}).Text("Legacy", Style{FontWeight: 600}).FontSource != nil {
		t.Fatal("optional binding changed the original legacy fallback")
	}
}

func TestFontResourceBindingResponsiveCache(t *testing.T) {
	data := bindingTestBytes(t)
	item := bindingTestRequirement(data)
	resource := &bindingTestResource{data: data}
	selected, err := (FyneBackend{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: resource}}}).BindFontResources([]FontResourceRequirement{item})
	if err != nil {
		t.Fatal(err)
	}
	bound := selected.(*boundFontBackend)
	app := test.NewApp()
	t.Cleanup(app.Quit)
	leaf := responsiveTestLeaf("caption", "text", 160)
	leaf.Text, leaf.Style.FontFamily = "Responsive", "Host"
	view := NewView(func() []Node { return []Node{flexTestRoot(64, leaf)} }, selected)
	window := responsiveTestWindow(t, view)
	window.Canvas().Capture()
	if len(bound.base.fontFaces) != 1 || resource.reads != 1 {
		t.Fatal("responsive native preflight lost its private parsed-font cache")
	}
	font := bound.base.font(leaf.Style)
	parsed := bound.base.fontFaces[font]
	for range 2 {
		view.Refresh()
		window.Canvas().Capture()
		if view.Error() != nil || len(bound.base.fontFaces) != 1 || bound.base.fontFaces[font] != parsed || bound.base.font(leaf.Style) != font || resource.reads != 1 {
			t.Fatalf("responsive refresh replaced or reread frozen fonts: %v", view.Error())
		}
	}
	second, err := (FyneBackend{Fonts: map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: resource}}}).BindFontResources([]FontResourceRequirement{item})
	if err != nil || len(second.(*boundFontBackend).base.fontFaces) != 0 || second.(*boundFontBackend).base.font(leaf.Style) == font {
		t.Fatalf("independent bindings shared a mutable native font cache: %v", err)
	}
}

func TestFontResourceBindingByteBudgets(t *testing.T) {
	data := bindingTestBytes(t)
	large, remainder := make([]byte, 20*1024*1024), make([]byte, 8*1024*1024)
	copy(large, data)
	copy(remainder, data)
	item := bindingTestRequirement(large)
	fonts := map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: bindingTestSliceResource(large)}}
	for index := range 5 {
		fonts[fmt.Sprintf("Alias%d", index)] = map[Font]fyne.Resource{{Weight: 400}: bindingTestSliceResource(large)}
	}
	fonts["Remainder"] = map[Font]fyne.Resource{{Weight: 400}: bindingTestSliceResource(remainder)}
	if selected, err := (FyneBackend{Fonts: fonts}).BindFontResources([]FontResourceRequirement{item}); err != nil || selected == nil {
		t.Fatalf("exact 20 MiB face / 128 MiB repeated-binding total was rejected: %v", err)
	}
	fonts["Remainder"][Font{Weight: 400}] = bindingTestSliceResource(append(remainder, 0))
	if _, err := (FyneBackend{Fonts: fonts}).BindFontResources([]FontResourceRequirement{item}); err == nil || !strings.Contains(err.Error(), "128 MiB") {
		t.Fatalf("repeated-resource aggregate budget was bypassed: %v", err)
	}
	for _, bytes := range [][]byte{nil, make([]byte, 20*1024*1024+1)} {
		fonts := map[string]map[Font]fyne.Resource{"Host": {{Weight: 400}: bindingTestSliceResource(bytes)}}
		if _, err := (FyneBackend{Fonts: fonts}).BindFontResources([]FontResourceRequirement{item}); err == nil {
			t.Fatal("empty or oversized resource was admitted")
		}
	}
}
