// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontbackend_test

import (
	"bytes"
	"fmt"
	"math"
	"path/filepath"
	"reflect"
	"runtime/debug"
	"strings"
	"sync"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/fontbackend"
)

func TestFontBackendBuildContract(t *testing.T) {
	info, identified := debug.ReadBuildInfo()
	count, version, replaced := 0, "", false
	localPaths := []string{}
	if identified {
		for _, dependency := range info.Deps {
			if dependency == nil || dependency.Path != "github.com/go-text/typesetting" {
				continue
			}
			count++
			version = dependency.Version
			if dependency.Replace != nil {
				replaced = true
				path := dependency.Replace.Path
				if filepath.IsAbs(path) || strings.HasPrefix(path, ".") || strings.Contains(path, "\\") {
					localPaths = append(localPaths, path)
				}
			}
		}
	}
	resource := &mutableResource{data: fontBytes(t, "Regular")}
	before := bytes.Clone(resource.data)
	backend, err := fontbackend.New(map[string]map[webui.Font]fyne.Resource{"Host": {{Weight: 400}: resource}})
	if !bytes.Equal(resource.data, before) || resource.reads != 1 {
		t.Fatal("constructor changed or reread its licensed input")
	}
	if identified && count == 1 && version == "v0.3.4" && !replaced {
		if err != nil || backend == nil || len(backend.Profiles()) != 1 || backend.Profiles()[0].Coverage.Parser != "github.com/go-text/typesetting@"+version {
			t.Fatalf("qualified parser failed nominal backend construction: %v", err)
		}
		if err := backend.ValidateLegacyText(webui.LegacyText{Kind: "text", Field: "text", Text: "Hello", Style: regularStyle()}); err != nil {
			t.Fatal(err)
		}
		t.Log("qualified nominal backend build admitted")
		return
	}
	if err == nil || backend != nil || !strings.Contains(err.Error(), "fontresource: coverage ") {
		t.Fatalf("unqualified parser advertised a nominal backend: %v", err)
	}
	for _, path := range localPaths {
		if path != "" && strings.Contains(err.Error(), path) {
			t.Fatal("unqualified parser diagnostic exposed a local replacement path")
		}
	}
	t.Log("unqualified nominal backend build rejected")
}

func TestNominalBackendResourceBinding(t *testing.T) {
	app := test.NewApp()
	t.Cleanup(app.Quit)
	regular := &mutableResource{data: fontBytes(t, "Regular")}
	bold := &mutableResource{data: fontBytes(t, "Bold")}
	backend := requireBackend(t, map[string]map[webui.Font]fyne.Resource{
		"Host": {{Weight: 400}: regular, {Weight: 700}: bold},
	})
	requirements := []webui.FontResourceRequirement{
		{Family: "hOsT", Weight: 400, Style: "normal", Hash: fontHash(regular.data)},
		{Family: "Host", Weight: 700, Style: "normal", Hash: fontHash(bold.data)},
	}
	profiles := backend.Profiles()
	regularFont := backend.Text("Stable", regularStyle()).FontSource
	for range 2 {
		selected, err := backend.BindFontResources(requirements)
		if err != nil || selected != backend || regular.reads != 1 || bold.reads != 1 || backend.Text("Stable", regularStyle()).FontSource != regularFont || !reflect.DeepEqual(profiles, backend.Profiles()) {
			t.Fatalf("resource binding replaced or reread immutable nominal ownership: %v", err)
		}
	}
	for _, change := range []func(*webui.FontResourceRequirement){
		func(item *webui.FontResourceRequirement) { item.Hash = strings.Repeat("0", 64) },
		func(item *webui.FontResourceRequirement) { item.Family = "Missing" },
		func(item *webui.FontResourceRequirement) { item.Style = "italic" },
		func(item *webui.FontResourceRequirement) { item.Weight = 600 },
	} {
		invalid := requirements[0]
		change(&invalid)
		if selected, err := backend.BindFontResources([]webui.FontResourceRequirement{invalid}); err == nil || selected != nil {
			t.Fatalf("nominal backend admitted an unsupported resource requirement: %+v %v", invalid, err)
		}
	}
	if selected, err := backend.BindFontResources(append(requirements, requirements[0])); err == nil || selected != nil {
		t.Fatal("nominal backend bypassed shared duplicate validation")
	}
	var nilBackend *fontbackend.Backend
	for _, invalid := range []*fontbackend.Backend{nilBackend, new(fontbackend.Backend)} {
		if selected, err := invalid.BindFontResources(requirements); err == nil || selected != nil {
			t.Fatal("unconstructed nominal backend advertised resources")
		}
	}
	if regular.reads != 1 || bold.reads != 1 || !reflect.DeepEqual(profiles, backend.Profiles()) {
		t.Fatal("failed nominal requirement checks changed ownership")
	}
}

func TestNominalBackendOwnershipAndPainterIdentity(t *testing.T) {
	app := test.NewApp()
	t.Cleanup(app.Quit)
	regular := &mutableResource{data: fontBytes(t, "Regular")}
	bold := &mutableResource{data: fontBytes(t, "Bold")}
	digest, boldDigest := fontHash(regular.data), fontHash(bold.data)
	fonts := map[string]map[webui.Font]fyne.Resource{
		"Host":  {{Weight: 400}: regular, {Weight: 700}: bold},
		"Alias": {{Weight: 400}: regular},
	}
	backend := requireBackend(t, fonts)
	if regular.reads != 2 || bold.reads != 1 {
		t.Fatalf("constructor did not read exactly once per binding: regular=%d bold=%d", regular.reads, bold.reads)
	}
	style := regularStyle()
	text := backend.Text("Hello café", style)
	aliasStyle := style
	aliasStyle.FontFamily = "Alias"
	aliasText := backend.Text("Hello café", aliasStyle)
	if text.FontSource == nil || text.FontSource != aliasText.FontSource || fontHash(text.FontSource.Content()) != digest || text.TextStyle != (fyne.TextStyle{}) {
		t.Fatal("coverage and painter resources have different bytes, identities or synthesized styles")
	}
	backend.PlaceText(text, style, 3, 4)
	minimum, measured := text.MinSize(), backend.Measure("Hello café", style)
	if minimum.Width <= 0 || measured.Width <= 0 || measured.Height != 20 {
		t.Fatal("actual painter received no usable font metrics")
	}
	profile := backend.Profiles()
	expectedProfiles := backend.Profiles()
	if len(profile) != 3 || profile[0].Family != "Alias" || profile[1].Coverage.FontHash != digest || profile[2].Coverage.FontHash != boldDigest || profile[2].Coverage.Weight != 700 {
		t.Fatalf("face profiles do not bind sorted descriptors and bytes: %+v", profile)
	}
	profile[0].Family, profile[0].Coverage.FontHash = "Changed", "Changed"
	profile[0].Coverage.Ranges[0].Start = 0xffffffff
	regular.data[0] ^= 0xff
	bold.data[0] ^= 0xff
	delete(fonts["Host"], webui.Font{Weight: 400})
	fonts["Alias"] = nil
	content := text.FontSource.Content()
	content[0] ^= 0xff
	if fontHash(text.FontSource.Content()) != digest || backend.Text("Hello café", style).FontSource != text.FontSource || text.MinSize() != minimum || backend.Measure("Hello café", style) != measured || !reflect.DeepEqual(backend.Profiles(), expectedProfiles) {
		t.Fatal("caller mutation changed immutable resources, cached metrics or profiles")
	}
	style.FontWeight = 700
	boldText := backend.Text("Bold", style)
	if boldText.FontSource == text.FontSource || fontHash(boldText.FontSource.Content()) != boldDigest || boldText.TextStyle != (fyne.TextStyle{}) {
		t.Fatal("bold face was synthesized or selected from changed caller bytes")
	}
	var readers sync.WaitGroup
	for range 4 {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for range 8 {
				if err := backend.ValidateLegacyText(webui.LegacyText{Kind: "text", Field: "text", Text: "Stable", Style: regularStyle()}); err != nil {
					t.Error(err)
				}
				copy := backend.Profiles()
				copy[0].Coverage.Ranges[0].End ^= 0xffffffff
			}
		}()
	}
	readers.Wait()
	if regular.reads != 2 || bold.reads != 1 || !reflect.DeepEqual(backend.Profiles(), expectedProfiles) {
		t.Fatal("admission or inspection reread caller resources")
	}
}

func TestNominalBackendAliasesAndResourceBudgets(t *testing.T) {
	data := fontBytes(t, "Regular")
	resource := &mutableResource{data: data}
	for _, aliases := range [][2]string{{"Host", "host"}, {"Σ", "ς"}, {"S", "ſ"}} {
		_, err := fontbackend.New(map[string]map[webui.Font]fyne.Resource{
			aliases[0]: {{Weight: 400}: resource}, aliases[1]: {{Weight: 400}: resource},
		})
		if err == nil || !strings.Contains(err.Error(), "conflicting family") {
			t.Fatalf("actual EqualFold alias collision was accepted: %q %v", aliases, err)
		}
	}
	if resource.reads != 0 {
		t.Fatal("ambiguous aliases read resource bytes before rejection")
	}
	for _, family := range []string{"", " Host", "Host ", "Host,Other", "\"Host\"", "Host\\Name", "1Host", string([]byte{0xff}), strings.Repeat("A", 81)} {
		if _, err := fontbackend.New(map[string]map[webui.Font]fyne.Resource{family: {{Weight: 400}: resource}}); err == nil {
			t.Fatalf("unsupported alias was accepted: %q", family)
		}
	}
	var typedNil *mutableResource
	for _, fonts := range []map[string]map[webui.Font]fyne.Resource{
		nil, {}, {"Host": {}}, {"Host": {{Weight: 400}: nil}}, {"Host": {{Weight: 400}: typedNil}},
		{"Host": {{Weight: 600}: resource}}, {"Host": {{Weight: 400}: &mutableResource{}}},
	} {
		if _, err := fontbackend.New(fonts); err == nil {
			t.Fatal("invalid or absent face bindings were accepted")
		}
	}
	maxFaces := map[string]map[webui.Font]fyne.Resource{}
	for index := range 16 {
		maxFaces[fmt.Sprintf("Alias%d", index)] = map[webui.Font]fyne.Resource{{Weight: 400}: resource}
	}
	if backend := requireBackend(t, maxFaces); len(backend.Profiles()) != 16 {
		t.Fatal("sixteen valid alias bindings were lost")
	}
	maxFaces["Extra"] = map[webui.Font]fyne.Resource{{Weight: 400}: resource}
	if _, err := fontbackend.New(maxFaces); err == nil {
		t.Fatal("seventeen faces were accepted")
	}
	reads := 0
	uncomparable := uncomparableResource{data: data, reads: &reads}
	backend := requireBackend(t, map[string]map[webui.Font]fyne.Resource{
		"Host": {{Weight: 400}: uncomparable}, "Alias": {{Weight: 400}: uncomparable},
	})
	style, alias := regularStyle(), regularStyle()
	alias.FontFamily = "Alias"
	if reads != 2 || backend.Text("A", style).FontSource != backend.Text("A", alias).FontSource {
		t.Fatal("noncomparable caller resources lost per-binding snapshots or canonical painter identity")
	}
	t.Run("face-size", func(t *testing.T) {
		exact := make([]byte, 20*1024*1024)
		copy(exact, data)
		if backend := requireBackend(t, map[string]map[webui.Font]fyne.Resource{"Host": {{Weight: 400}: &mutableResource{data: exact}}}); backend.Profiles()[0].Coverage.FontHash != fontHash(exact) {
			t.Fatal("exact 20MiB licensed font bytes were not retained")
		}
		if _, err := fontbackend.New(map[string]map[webui.Font]fyne.Resource{"Host": {{Weight: 400}: &mutableResource{data: make([]byte, 20*1024*1024+1)}}}); err == nil || !strings.Contains(err.Error(), "1..20MiB") {
			t.Fatalf("oversized font was not rejected before parsing: %v", err)
		}
	})
	t.Run("aggregate-size", func(t *testing.T) {
		large, remainder := make([]byte, 20*1024*1024), make([]byte, 8*1024*1024)
		copy(large, data)
		copy(remainder, data)
		fonts := map[string]map[webui.Font]fyne.Resource{}
		for index := range 6 {
			fonts[fmt.Sprintf("Alias%d", index)] = map[webui.Font]fyne.Resource{{Weight: 400}: &mutableResource{data: large}}
		}
		fonts["Remainder"] = map[webui.Font]fyne.Resource{{Weight: 400}: &mutableResource{data: remainder}}
		if backend := requireBackend(t, fonts); len(backend.Profiles()) != 7 {
			t.Fatal("exact 128MiB declared font budget was rejected")
		}
		fonts["Remainder"] = map[webui.Font]fyne.Resource{{Weight: 400}: &mutableResource{data: append(remainder, 0)}}
		if _, err := fontbackend.New(fonts); err == nil || !strings.Contains(err.Error(), "128MiB") {
			t.Fatalf("aggregate font budget was not enforced: %v", err)
		}
	})
}

func TestNominalBackendDescriptorsAndMetricProbes(t *testing.T) {
	for _, slot := range []webui.Font{{Weight: 700}, {Weight: 400, Italic: true}} {
		_, err := fontbackend.New(map[string]map[webui.Font]fyne.Resource{"Host": {slot: &mutableResource{data: fontBytes(t, "Regular")}}})
		if err == nil || !strings.Contains(err.Error(), "does not match actual face") {
			t.Fatalf("declared descriptor bypassed actual static font validation: %+v %v", slot, err)
		}
	}
	for _, scenario := range []struct {
		name     string
		mappings []nominalMapping
		missing  string
	}{
		{"H", []nominalMapping{{' ', 1}, {'A', 2}}, "U+0048"},
		{"SPACE", []nominalMapping{{'A', 1}, {'H', 2}}, "U+0020"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			data := mappedFont(t, scenario.mappings...)
			before := bytes.Clone(data)
			_, err := fontbackend.New(map[string]map[webui.Font]fyne.Resource{"Host": {{Weight: 400}: &mutableResource{data: data}}})
			if err == nil || !strings.Contains(err.Error(), "requires H and SPACE") || !strings.Contains(err.Error(), scenario.missing) || !bytes.Equal(data, before) {
				t.Fatalf("missing hidden painter probe was admitted or changed bytes: %v", err)
			}
		})
	}
	limited := mappedFont(t, nominalMapping{' ', 1}, nominalMapping{'A', 2}, nominalMapping{'H', 3})
	backend := requireBackend(t, map[string]map[webui.Font]fyne.Resource{"Host": {{Weight: 400}: &mutableResource{data: limited}}})
	if err := backend.ValidateLegacyText(webui.LegacyText{Kind: "text", Field: "text", Text: "A", Style: regularStyle()}); err != nil {
		t.Fatalf("valid repaired-cmap probe control was rejected: %v", err)
	}
}

func TestNominalBackendSingleLineAdmissionAndDirectDiagnostics(t *testing.T) {
	app := test.NewApp()
	t.Cleanup(app.Quit)
	backend := regularBackend(t)
	style := regularStyle()
	for _, family := range []string{"Host", "hOsT", "'Host'", `"Host"`, " \tHost\r\n"} {
		alias := style
		alias.FontFamily = family
		if err := backend.Validate(alias, true); err != nil {
			t.Fatalf("one matching family alias was rejected: %q %v", family, err)
		}
	}
	for _, kind := range []string{"text", "label", "button", "link"} {
		for _, text := range []string{"", "Hello café", "a\u00a0b"} {
			if err := backend.ValidateLegacyText(webui.LegacyText{Kind: kind, Field: "text", Text: text, Style: style}); err != nil {
				t.Fatalf("supported nominal text was rejected: %q %v", text, err)
			}
		}
	}
	for _, text := range []string{" leading", "trailing ", "two  spaces", "a\tb", "a\nb", "\r", "\u0085", "\u2028", "\u2029", string([]byte{0xff}), "\U0010ffff"} {
		if err := backend.ValidateLegacyText(webui.LegacyText{Kind: "text", Field: "text", Text: text, Style: style}); err == nil {
			t.Fatalf("unsupported single-line content was admitted: %q", text)
		}
	}
	for _, role := range [][2]string{{"input", "value"}, {"input", "placeholder"}, {"textarea", "value"}, {"textarea", "placeholder"}, {"container", "text"}, {"text", "value"}} {
		if err := backend.ValidateLegacyText(webui.LegacyText{Kind: role[0], Field: role[1], Style: style}); err == nil || !strings.Contains(err.Error(), "prospective-edit") {
			t.Fatalf("unsupported or empty control role was admitted: %q %v", role, err)
		}
	}
	for _, change := range []func(*webui.Style){
		func(s *webui.Style) { s.FontFamily = "Missing" }, func(s *webui.Style) { s.FontFamily = "Host, Other" },
		func(s *webui.Style) { s.FontFamily = `"Host'` }, func(s *webui.Style) { s.FontFamily = "Host\\Name" },
		func(s *webui.Style) { s.FontFamily = "" }, func(s *webui.Style) { s.FontWeight = 600 },
		func(s *webui.Style) { s.FontWeight = 700 }, func(s *webui.Style) { s.FontStyle = "italic" },
		func(s *webui.Style) { s.WhiteSpace = "normal" }, func(s *webui.Style) { s.FontSize = 0 },
		func(s *webui.Style) { s.FontSize = 257 }, func(s *webui.Style) { s.FontSize = float32(math.NaN()) },
		func(s *webui.Style) { s.FontSize = float32(math.Inf(1)) }, func(s *webui.Style) { s.LineHeight = 1025 },
		func(s *webui.Style) { s.LineHeight = 0 }, func(s *webui.Style) { s.Flex = &webui.FlexStyle{BoxSizing: "border-box"} },
	} {
		bad := style
		change(&bad)
		if err := backend.Validate(bad, true); err == nil {
			t.Fatalf("unsupported text style was admitted: %+v", bad)
		}
	}
	defaults := style
	defaults.FontWeight, defaults.FontStyle = 0, ""
	if backend.Text("A", defaults).FontSource != backend.Text("A", style).FontSource || backend.Validate(webui.Style{}, false) != nil || backend.Defaults(webui.Node{Kind: "button"}).FontWeight != 600 {
		t.Fatal("actual Fyne matcher defaults or nontext defaults were changed")
	}
	mustPanic(t, "missing glyph", func() { backend.Text("\U0010ffff", style) })
	mustPanic(t, "missing glyph", func() { backend.Measure("\U0010ffff", style) })
	text := canvas.NewText("\U0010ffff", nil)
	mustPanic(t, "missing glyph", func() { backend.PlaceText(text, style, 0, 0) })
	mustPanic(t, "native text object", func() { backend.PlaceText(nil, style, 0, 0) })
	mustPanic(t, "prospective-edit", func() { backend.Editor(false, style, nil) })
}

func TestNominalBackendNilAndZeroValues(t *testing.T) {
	for _, backend := range []*fontbackend.Backend{nil, new(fontbackend.Backend)} {
		if backend.Profiles() != nil || backend.Validate(webui.Style{}, false) == nil || backend.ValidateLegacyText(webui.LegacyText{Kind: "text", Field: "text", Style: regularStyle()}) == nil {
			t.Fatal("unconstructed backend advertised a valid profile")
		}
		mustPanic(t, "constructed nominal backend", func() { backend.Text("A", regularStyle()) })
		mustPanic(t, "constructed nominal backend", func() { backend.Measure("A", regularStyle()) })
		mustPanic(t, "constructed nominal backend", func() { backend.Defaults(webui.Node{}) })
		mustPanic(t, "constructed nominal backend", func() { backend.Box(webui.Style{}) })
	}
}
