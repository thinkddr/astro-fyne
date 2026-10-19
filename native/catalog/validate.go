// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package catalog

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/fontresource"
	"github.com/thinkddr/astro-fyne/native/javascript"
	"github.com/thinkddr/astro-fyne/native/motion"
	"github.com/thinkddr/astro-fyne/native/reverse"
)

var identifier = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,127}$`)
var relativePath = regexp.MustCompile(`^[A-Za-z0-9_./-]+$`)
var familyName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9 _-]{0,79}$`)

func digest(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func validDigest(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32 && strings.ToLower(value) == value
}

func validText(value string, maximum int) bool {
	return value != "" && len(value) <= maximum && utf8.ValidString(value) && !strings.ContainsRune(value, 0)
}

func safePath(value string) bool {
	if !relativePath.MatchString(value) || strings.HasPrefix(value, "/") || len(value) > 4096 {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func decode(data []byte, target any) error {
	if len(data) == 0 || len(data) > 128*1024*1024 || !utf8.Valid(data) {
		return fmt.Errorf("catalog: JSON requires valid UTF-8 within 128MiB")
	}
	if err := uniqueJSONFields(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("catalog: invalid JSON: %w", err)
	}
	if err := requiredFields(data, reflect.TypeOf(target).Elem()); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("catalog: expected one JSON document")
	}
	return nil
}

func requiredFields(data []byte, kind reflect.Type) error {
	if kind == reflect.TypeOf(json.RawMessage{}) {
		return nil
	}
	if kind.Kind() == reflect.Pointer {
		return requiredFields(data, kind.Elem())
	}
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) && kind.Kind() != reflect.Interface {
		return fmt.Errorf("catalog: null is not a declared value")
	}
	if kind.Kind() == reflect.Struct {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
			return fmt.Errorf("catalog: JSON object required")
		}
		if kind == reflect.TypeOf(Island{}) {
			payload, hasPayload := fields["statePayload"]
			hash, hasHash := fields["stateHash"]
			if hasPayload != hasHash || hasPayload && (bytes.Equal(bytes.TrimSpace(payload), []byte(`""`)) || bytes.Equal(bytes.TrimSpace(hash), []byte(`""`))) {
				return fmt.Errorf("catalog: island statePayload/stateHash must be present together and nonempty")
			}
		}
		if kind == reflect.TypeOf(Component{}) {
			for _, name := range []string{"theme", "layout"} {
				if value, exists := fields[name]; exists {
					var reference string
					if err := json.Unmarshal(value, &reference); err != nil || reference == "" {
						return fmt.Errorf("catalog: optional reference %s must be nonempty when present", name)
					}
				}
			}
		}
		if kind == reflect.TypeOf(javascript.Archive{}) {
			var schema int
			if err := json.Unmarshal(fields["schema"], &schema); err != nil {
				return fmt.Errorf("catalog: JavaScript schema must be an integer")
			}
			_, animated := fields["animation"]
			if schema == 1 && animated || schema == 2 && !animated {
				return fmt.Errorf("catalog: JavaScript animation state must match its schema")
			}
			var events []map[string]json.RawMessage
			if err := json.Unmarshal(fields["events"], &events); err != nil {
				return fmt.Errorf("catalog: JavaScript events must be an array")
			}
			for _, event := range events {
				_, timed := event["timeMs"]
				if schema == 1 && timed || schema == 2 && !timed {
					return fmt.Errorf("catalog: JavaScript event timeMs must match its schema")
				}
			}
		}
		allowed := map[string]bool{}
		for i := 0; i < kind.NumField(); i++ {
			field := kind.Field(i)
			tag := strings.Split(field.Tag.Get("json"), ",")
			if tag[0] == "-" || !field.IsExported() {
				continue
			}
			name := tag[0]
			if name == "" {
				name = field.Name
			}
			allowed[name] = true
			value, exists := fields[name]
			if !exists {
				if !slices.Contains(tag[1:], "omitempty") {
					return fmt.Errorf("catalog: missing JSON field %q", name)
				}
				continue
			}
			if err := requiredFields(value, field.Type); err != nil {
				return fmt.Errorf("catalog: %s: %w", name, err)
			}
		}
		for name := range fields {
			if !allowed[name] {
				return fmt.Errorf("catalog: unknown field %q", name)
			}
		}
	} else if kind.Kind() == reflect.Map {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
			return fmt.Errorf("catalog: JSON object required")
		}
		for _, value := range fields {
			if err := requiredFields(value, kind.Elem()); err != nil {
				return err
			}
		}
	} else if kind.Kind() == reflect.Slice && kind.Elem().Kind() != reflect.Uint8 {
		var items []json.RawMessage
		if err := json.Unmarshal(data, &items); err != nil || items == nil {
			return fmt.Errorf("catalog: JSON array required")
		}
		for _, item := range items {
			if err := requiredFields(item, kind.Elem()); err != nil {
				return err
			}
		}
	} else if kind.Kind() == reflect.Slice && kind.Elem().Kind() == reflect.Uint8 {
		var value string
		if err := json.Unmarshal(data, &value); err != nil {
			return fmt.Errorf("catalog: base64 string required")
		}
	}
	return nil
}

func uniqueJSONFields(data []byte) error {
	if err := jsonUnicode(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	count := 0
	var visit func(int) error
	visit = func(depth int) error {
		count++
		if depth > 256 || count > 1000000 {
			return fmt.Errorf("catalog: JSON depth/value limit exceeded")
		}
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, compound := token.(json.Delim)
		if !compound {
			return nil
		}
		switch delimiter {
		case '{':
			seen := map[string]bool{}
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return err
				}
				name, ok := key.(string)
				if !ok || seen[name] {
					return fmt.Errorf("catalog: duplicate JSON field %q", name)
				}
				seen[name] = true
				if err := visit(depth + 1); err != nil {
					return err
				}
			}
		case '[':
			for decoder.More() {
				if err := visit(depth + 1); err != nil {
					return err
				}
			}
		default:
			return fmt.Errorf("catalog: unexpected JSON delimiter")
		}
		_, err = decoder.Token()
		return err
	}
	if err := visit(0); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return fmt.Errorf("catalog: trailing JSON data")
	}
	return nil
}

func jsonUnicode(data []byte) error {
	for at := 0; at < len(data); at++ {
		if data[at] != '"' {
			continue
		}
		at++
		for at < len(data) && data[at] != '"' {
			if data[at] != '\\' {
				at++
				continue
			}
			if at+1 >= len(data) {
				return fmt.Errorf("catalog: invalid JSON string escape")
			}
			if data[at+1] != 'u' {
				at += 2
				continue
			}
			if at+6 > len(data) {
				return fmt.Errorf("catalog: invalid JSON Unicode escape")
			}
			value, err := strconv.ParseUint(string(data[at+2:at+6]), 16, 16)
			if err != nil {
				return err
			}
			at += 6
			if value >= 0xd800 && value <= 0xdbff {
				if at+6 > len(data) || string(data[at:at+2]) != `\u` {
					return fmt.Errorf("catalog: JSON strings require paired Unicode surrogates")
				}
				low, err := strconv.ParseUint(string(data[at+2:at+6]), 16, 16)
				if err != nil || low < 0xdc00 || low > 0xdfff {
					return fmt.Errorf("catalog: JSON strings require paired Unicode surrogates")
				}
				at += 6
			} else if value >= 0xdc00 && value <= 0xdfff {
				return fmt.Errorf("catalog: JSON strings require paired Unicode surrogates")
			}
		}
	}
	return nil
}

func validate(spec Spec) error {
	if spec.Schema != 1 || spec.Kind != "astro-fyne-catalogue" || !identifier.MatchString(spec.Name) {
		return fmt.Errorf("catalog: schema 1, astro-fyne-catalogue kind and a portable name are required")
	}
	for _, count := range []int{len(spec.Resources), len(spec.Stylesheets), len(spec.Themes), len(spec.Layouts), len(spec.Components), len(spec.Islands)} {
		if count > 1024 {
			return fmt.Errorf("catalog: collections exceed 1024 entries")
		}
	}
	if len(spec.FontFaces) > 16 || len(spec.Motions) > 128 {
		return fmt.Errorf("catalog: at most 16 font faces and 128 motions are supported")
	}
	resources := map[string]Resource{}
	for _, resource := range spec.Resources {
		if !safePath(resource.Name) || resources[resource.Name].Name != "" || len(resource.Content) == 0 || len(resource.Content) > 20*1024*1024 || !validDigest(resource.Hash) || digest(resource.Content) != resource.Hash || !validText(resource.License, 1024*1024) || strings.TrimSpace(resource.License) == "" {
			return fmt.Errorf("catalog: invalid, duplicate or changed resource %q", resource.Name)
		}
		if !slices.Contains([]string{"font/ttf", "image/png", "image/jpeg", "text/css", "application/octet-stream"}, resource.MediaType) {
			return fmt.Errorf("catalog: unsupported resource media type %q", resource.MediaType)
		}
		resources[resource.Name] = resource
	}
	sheets := map[string]Stylesheet{}
	for _, sheet := range spec.Stylesheets {
		if !identifier.MatchString(sheet.ID) || sheets[sheet.ID].ID != "" || !validText(sheet.Path, 4096) || len(sheet.Content) > 16*1024*1024 || !utf8.Valid(sheet.Content) || !validDigest(sheet.Hash) || digest(sheet.Content) != sheet.Hash {
			return fmt.Errorf("catalog: invalid, duplicate or changed stylesheet %q", sheet.ID)
		}
		sheets[sheet.ID] = sheet
	}
	faces, keys, families := map[string]FontFace{}, map[string]bool{}, map[string]string{}
	for _, face := range spec.FontFaces {
		resource, ok := resources[face.Resource]
		key := fmt.Sprintf("%s/%d/%s", strings.ToLower(face.Family), face.Weight, face.Style)
		if !identifier.MatchString(face.ID) || faces[face.ID].ID != "" || !familyName.MatchString(face.Family) || strings.TrimSpace(face.Family) != face.Family || !ok || resource.MediaType != "font/ttf" || face.Hash != resource.Hash || (face.Weight != 400 && face.Weight != 700) || (face.Style != "normal" && face.Style != "italic") || keys[key] || families[strings.ToLower(face.Family)] != "" && families[strings.ToLower(face.Family)] != face.Family {
			return fmt.Errorf("catalog: invalid, conflicting or missing font binding %q", face.ID)
		}
		if err := validateFont(resource.Content, face); err != nil {
			return fmt.Errorf("catalog: font %q: %w", face.ID, err)
		}
		faces[face.ID], keys[key], families[strings.ToLower(face.Family)] = face, true, face.Family
	}
	themes := map[string]ThemeSpec{}
	for _, item := range spec.Themes {
		if !identifier.MatchString(item.ID) || themes[item.ID].ID != "" || len(item.Tokens) > 1024 {
			return fmt.Errorf("catalog: invalid or duplicate theme %q", item.ID)
		}
		for name, value := range item.Tokens {
			if !validText(name, 256) || !strings.HasPrefix(name, "--") || len(name) < 3 || strings.ContainsAny(name, "\t\r\n\f ") || !utf8.ValidString(value) || strings.ContainsRune(value, 0) || len(value) > 1024*1024 {
				return fmt.Errorf("catalog: invalid theme token %q", name)
			}
		}
		if _, err := webui.NewCapturedTheme(item.Tokens, nil); err != nil {
			return fmt.Errorf("catalog: theme %q: %w", item.ID, err)
		}
		if err := fontReferences(item.FontFaces, faces); err != nil {
			return err
		}
		slots := map[string]bool{}
		for _, id := range item.FontFaces {
			face := faces[id]
			slot := fmt.Sprintf("%d/%s", face.Weight, face.Style)
			if slots[slot] {
				return fmt.Errorf("catalog: theme %q has conflicting font slots", item.ID)
			}
			slots[slot] = true
		}
		themes[item.ID] = item
	}
	layouts := map[string]bool{}
	for _, item := range spec.Layouts {
		if !identifier.MatchString(item.ID) || layouts[item.ID] {
			return fmt.Errorf("catalog: invalid or duplicate layout %q", item.ID)
		}
		if item.Native != nil {
			return fmt.Errorf("catalog: layout %q contains a Go algorithm; supply portable source Style declarations", item.ID)
		}
		if item.Style.Measured || item.Style.Flex == nil {
			return fmt.Errorf("catalog: layout %q requires source Flex declarations, not measured geometry", item.ID)
		}
		f := item.Style.Flex
		if f.BoxSizing != "border-box" || !slices.Contains([]string{"", "flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"}, f.JustifyContent) || !slices.Contains([]string{"", "flex-start", "flex-end", "center", "stretch"}, f.AlignItems) || !slices.Contains([]string{"", "auto", "flex-start", "flex-end", "center", "stretch"}, f.AlignSelf) {
			return fmt.Errorf("catalog: layout %q requires portable border-box and alignment declarations", item.ID)
		}
		if err := validateStyle(item.Style); err != nil {
			return fmt.Errorf("catalog: layout %q: %w", item.ID, err)
		}
		layouts[item.ID] = true
	}
	components := map[string]Component{}
	for _, component := range spec.Components {
		if !identifier.MatchString(component.ID) || components[component.ID].ID != "" || len(component.Payload) == 0 || len(component.Payload) > 64*1024*1024 || !utf8.ValidString(component.Payload) || !validDigest(component.Hash) || digest([]byte(component.Payload)) != component.Hash {
			return fmt.Errorf("catalog: invalid, duplicate or changed component %q", component.ID)
		}
		if component.Theme != "" && themes[component.Theme].ID == "" || component.Layout != "" && !layouts[component.Layout] {
			return fmt.Errorf("catalog: component %q references an absent theme/layout", component.ID)
		}
		if err := fontReferences(component.FontFaces, faces); err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, id := range component.Stylesheets {
			if sheets[id].ID == "" || seen[id] {
				return fmt.Errorf("catalog: component %q references an absent or repeated stylesheet", component.ID)
			}
			seen[id] = true
		}
		if err := validateComponent(component, sheets); err != nil {
			return err
		}
		components[component.ID] = component
	}
	islands := map[string]bool{}
	for _, island := range spec.Islands {
		if !identifier.MatchString(island.ID) || islands[island.ID] || components[island.Component].ID == "" || !validText(island.Key, 1024) {
			return fmt.Errorf("catalog: invalid, duplicate or unbound island %q", island.ID)
		}
		if err := validateIslandState(island, components[island.Component]); err != nil {
			return err
		}
		islands[island.ID] = true
	}
	motions := map[string]bool{}
	for _, spec := range spec.Motions {
		if motions[spec.ID] {
			return fmt.Errorf("catalog: duplicate motion %q", spec.ID)
		}
		if _, err := motion.NewClip(spec); err != nil {
			return err
		}
		motions[spec.ID] = true
	}
	if data, err := json.Marshal(spec); err != nil || len(data) > 128*1024*1024 {
		return fmt.Errorf("catalog: encoded catalogue exceeds 128MiB or contains invalid data")
	}
	return nil
}

func validateIslandState(island Island, component Component) error {
	if island.StatePayload == "" && island.StateHash == "" {
		return nil
	}
	if component.Kind != "javascript" || island.StatePayload == "" || len(island.StatePayload) > 64*1024*1024 || !utf8.ValidString(island.StatePayload) || !validDigest(island.StateHash) || digest([]byte(island.StatePayload)) != island.StateHash {
		return fmt.Errorf("catalog: island %q requires a bound JavaScript state archive", island.ID)
	}
	var prototype, state javascript.Archive
	if err := decode([]byte(component.Payload), &prototype); err != nil {
		return err
	}
	if err := decode([]byte(island.StatePayload), &state); err != nil {
		return err
	}
	if err := javascript.Validate(state); err != nil {
		return err
	}
	if state.Schema != prototype.Schema || state.Kind != prototype.Kind || state.Code != prototype.Code || state.CodeHash != prototype.CodeHash || !slices.Equal(state.Sources, prototype.Sources) || !slices.Equal(state.Stylesheets, prototype.Stylesheets) || !slices.Equal(state.Actions, prototype.Actions) {
		return fmt.Errorf("catalog: island %q state cannot replace component code, CSS, sources or action contracts", island.ID)
	}
	return nil
}

func fontReferences(ids []string, faces map[string]FontFace) error {
	seen := map[string]bool{}
	for _, id := range ids {
		if faces[id].ID == "" || seen[id] {
			return fmt.Errorf("catalog: absent or repeated font face %q", id)
		}
		seen[id] = true
	}
	return nil
}

func sameActions(a, b []string) bool {
	if len(a) != len(b) || len(a) > 1024 {
		return false
	}
	seen := map[string]bool{}
	for _, name := range a {
		if !validText(name, 4096) || seen[name] {
			return false
		}
		seen[name] = true
	}
	for _, name := range b {
		if !seen[name] {
			return false
		}
		delete(seen, name)
	}
	return true
}

func validateComponent(component Component, sheets map[string]Stylesheet) error {
	if component.Kind != "javascript" && len(component.Stylesheets) != 0 {
		return fmt.Errorf("catalog: scene/program components cannot add a live stylesheet outside their compiled contract")
	}
	var actions []string
	switch component.Kind {
	case "javascript":
		var archive javascript.Archive
		if err := decode([]byte(component.Payload), &archive); err != nil {
			return err
		}
		if err := javascript.Validate(archive); err != nil {
			return err
		}
		actions = archive.Actions
		if len(archive.Stylesheets) != len(component.Stylesheets) {
			return fmt.Errorf("catalog: JavaScript stylesheet references differ from the archived sources")
		}
		for _, source := range archive.Stylesheets {
			matches := 0
			for _, id := range component.Stylesheets {
				sheet := sheets[id]
				if sheet.Path == source.Path && sheet.Hash == source.Hash && bytes.Equal(sheet.Content, []byte(source.Text)) {
					matches++
				}
			}
			if matches != 1 {
				return fmt.Errorf("catalog: JavaScript CSS bytes or source references changed")
			}
		}
	case "program":
		var archive webui.ProgramArchive
		if err := decode([]byte(component.Payload), &archive); err != nil {
			return err
		}
		if archive.Schema != 1 || archive.Kind != "astro-fyne-program" || !validDigest(archive.SourceHash) || !validDigest(archive.ProgramHash) || digest([]byte(archive.Program)) != archive.ProgramHash || len(archive.Program) > 64*1024*1024 {
			return fmt.Errorf("catalog: portable program identity mismatch")
		}
		var metadata struct {
			Actions []string `json:"actions"`
		}
		if err := uniqueJSONFields([]byte(archive.Program)); err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(archive.Program), &metadata); err != nil {
			return err
		}
		actions = metadata.Actions
		bindings := webui.Actions{}
		for _, name := range actions {
			bindings[name] = func(...any) any { return nil }
		}
		if _, _, err := webui.RestoreProgram(component.Payload, archive.Program, nil, bindings); err != nil {
			return err
		}
	case "scene":
		var document reverse.Document
		if err := decode([]byte(component.Payload), &document); err != nil {
			return err
		}
		if err := validateScene(document); err != nil {
			return err
		}
		actions = document.RequiredActions
	default:
		return fmt.Errorf("catalog: component kind %q requires a portable declaration adapter", component.Kind)
	}
	if !sameActions(component.Actions, actions) {
		return fmt.Errorf("catalog: component %q action bindings differ from its payload", component.ID)
	}
	return nil
}

func finite(value float32) bool { return !math.IsNaN(float64(value)) && !math.IsInf(float64(value), 0) }

func validateStyle(style webui.Style) error {
	for _, value := range []string{style.Direction, style.Background, style.Color, style.BorderColor, style.FontFamily, style.FontStyle, style.TextAlign, style.WhiteSpace, style.Display} {
		if !utf8.ValidString(value) || strings.ContainsRune(value, 0) || len(value) > 1024*1024 {
			return fmt.Errorf("invalid style string")
		}
	}
	for _, value := range []float32{style.X, style.Y, style.Width, style.Height, style.PaddingTop, style.PaddingRight, style.PaddingBottom, style.PaddingLeft, style.Gap, style.BorderWidth, style.Radius, style.FontSize, style.LineHeight, style.FontWeight, style.Opacity} {
		if !finite(value) {
			return fmt.Errorf("nonfinite style declaration")
		}
	}
	for _, value := range []float32{style.Width, style.Height, style.PaddingTop, style.PaddingRight, style.PaddingBottom, style.PaddingLeft, style.Gap, style.BorderWidth, style.Radius, style.FontSize, style.LineHeight} {
		if value < 0 {
			return fmt.Errorf("negative style dimensions")
		}
	}
	if style.Opacity < 0 || style.Opacity > 1 || style.Measured && style.Opacity != 1 || style.FontWeight < 0 || style.FontWeight > 1000 || float32(math.Trunc(float64(style.FontWeight))) != style.FontWeight {
		return fmt.Errorf("unsupported opacity or font weight")
	}
	for _, color := range []string{style.Background, style.Color, style.BorderColor} {
		if color != "" {
			if _, err := webui.ParseColor(color); err != nil {
				return err
			}
		}
	}
	if !slices.Contains([]string{"", "normal", "italic"}, style.FontStyle) || !slices.Contains([]string{"", "normal", "nowrap"}, style.WhiteSpace) || !slices.Contains([]string{"", "left", "right", "center", "start", "end"}, style.TextAlign) || !slices.Contains([]string{"", "block", "flex", "none"}, style.Display) || !slices.Contains([]string{"", "row", "column", "row-reverse", "column-reverse"}, style.Direction) {
		return fmt.Errorf("unsupported style keyword")
	}
	if f := style.Flex; f != nil {
		for _, value := range []*float32{f.Grow, f.Shrink, f.Basis, f.MinWidth, f.MinHeight, f.MaxWidth, f.MaxHeight, f.WidthPercent, f.HeightPercent, &f.MarginTop, &f.MarginRight, &f.MarginBottom, &f.MarginLeft} {
			if value != nil && (!finite(*value) || *value < 0) {
				return fmt.Errorf("invalid source Flex dimension")
			}
		}
		if f.Order < math.MinInt32 || f.Order > math.MaxInt32 || !slices.Contains([]string{"", "border-box"}, f.BoxSizing) || !slices.Contains([]string{"", "solid"}, f.BorderStyle) || !slices.Contains([]string{"", "none"}, f.Appearance) || !slices.Contains([]string{"", "start", "flex-start", "center", "end", "flex-end", "space-between", "space-around", "space-evenly"}, f.JustifyContent) || !slices.Contains([]string{"", "stretch", "start", "flex-start", "center", "end", "flex-end"}, f.AlignItems) || !slices.Contains([]string{"", "auto", "stretch", "start", "flex-start", "center", "end", "flex-end"}, f.AlignSelf) {
			return fmt.Errorf("unsupported source Flex keyword")
		}
	}
	return nil
}

func validateFont(data []byte, face FontFace) error {
	return fontresource.Validate(data, face.Weight, face.Style)
}

func validateScene(document reverse.Document) error {
	if (document.Schema != 1 && document.Schema != 2) || document.Schema == 2 && document.Layout != "flex" || document.Schema == 1 && document.Layout != "" || len(document.Roots) == 0 {
		return fmt.Errorf("catalog: invalid scene schema or roots")
	}
	for _, value := range []float32{document.Viewport.Width, document.Viewport.Height, document.Viewport.Scale} {
		if !finite(value) || value <= 0 {
			return fmt.Errorf("catalog: invalid scene viewport")
		}
	}
	ids, actions := map[string]bool{}, map[string]bool{}
	resources := map[string]bool{}
	for _, resource := range document.Resources {
		if !validText(resource.Name, 4096) || resources[resource.Name] || !safePath(resource.Path) || !validDigest(resource.Hash) || len(resource.Content) == 0 || len(resource.Content) > 20*1024*1024 || digest(resource.Content) != resource.Hash || !slices.Contains([]string{"image/png", "image/jpeg"}, resource.MediaType) {
			return fmt.Errorf("catalog: invalid scene bitmap resource")
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(resource.Content))
		if err != nil || config.Width != resource.Width || config.Height != resource.Height || config.Width <= 0 || config.Height <= 0 || config.Width > 16384 || config.Height > 16384 || (format == "png") != (resource.MediaType == "image/png") {
			return fmt.Errorf("catalog: scene bitmap dimensions or media type differ")
		}
		resources[resource.Name] = true
	}
	count := 0
	var walk func([]reverse.Node, int) error
	walk = func(nodes []reverse.Node, depth int) error {
		if depth > 100 {
			return fmt.Errorf("catalog: scene exceeds depth limit")
		}
		for _, node := range nodes {
			count++
			if count > 10000 || !validText(node.ID, 4096) || ids[node.ID] || !slices.Contains([]string{"container", "text", "button", "input", "textarea", "image"}, node.Kind) {
				return fmt.Errorf("catalog: invalid or duplicate scene node")
			}
			ids[node.ID] = true
			if !node.Style.Measured || node.Style.Flex != nil || node.Href != "" || node.Kind == "image" && !resources[node.Resource] || node.Kind != "image" && node.Resource != "" {
				return fmt.Errorf("catalog: scene geometry, navigation or bitmap reference requires an adapter")
			}
			if err := validateStyle(node.Style); err != nil {
				return err
			}
			if document.Schema == 2 {
				if node.SourceStyle == nil || node.SourceStyle.Measured || node.SourceStyle.Flex == nil {
					return fmt.Errorf("catalog: responsive scene requires source layout declarations")
				}
				if err := validateStyle(*node.SourceStyle); err != nil {
					return err
				}
			} else if node.SourceStyle != nil {
				return fmt.Errorf("catalog: fixed scene cannot contain responsive declarations")
			}
			if node.Events != nil {
				for _, name := range []string{node.Events.Tap, node.Events.Input, node.Events.Change, node.Events.Submit} {
					if name != "" {
						actions[name] = true
					}
				}
			}
			if err := walk(node.Children, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(document.Roots, 0); err != nil {
		return err
	}
	required := make([]string, 0, len(actions))
	for name := range actions {
		required = append(required, name)
	}
	if !sameActions(required, document.RequiredActions) {
		return fmt.Errorf("catalog: scene callback bindings differ from required actions")
	}
	return nil
}
