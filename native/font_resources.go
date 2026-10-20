// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"github.com/go-text/typesetting/font"
	"github.com/thinkddr/astro-fyne/native/fontresource"
)

// FontResourceRequirement identifies exact bytes for one family and static face.
type FontResourceRequirement struct {
	Family string `json:"family"`
	Weight int    `json:"weight"`
	Style  string `json:"style"`
	Hash   string `json:"hash"`
}

// FontResourceBinder returns the backend that must paint the checked resources.
type FontResourceBinder interface {
	BindFontResources([]FontResourceRequirement) (Backend, error)
}

// ValidateFontResourceRequirements checks descriptors without reading resources.
func ValidateFontResourceRequirements(requirements []FontResourceRequirement) error {
	if len(requirements) == 0 || len(requirements) > 16 {
		return fmt.Errorf("font resources: require 1..16 explicit faces")
	}
	for index, item := range requirements {
		if !validFontResourceFamily(item.Family) || item.Weight != 400 && item.Weight != 700 || item.Style != "normal" && item.Style != "italic" {
			return fmt.Errorf("font resources: require a family alias, weight 400/700 and style normal/italic")
		}
		digest, err := hex.DecodeString(item.Hash)
		if err != nil || len(digest) != sha256.Size || item.Hash != strings.ToLower(item.Hash) {
			return fmt.Errorf("font resources: require lowercase SHA-256 hashes")
		}
		for _, previous := range requirements[:index] {
			if strings.EqualFold(item.Family, previous.Family) && item.Weight == previous.Weight && item.Style == previous.Style {
				return fmt.Errorf("font resources: duplicate family/weight/style requirement")
			}
		}
	}
	return nil
}

// ParseFontResourceRequirements accepts a closed JSON array up to 16 KiB.
func ParseFontResourceRequirements(data []byte) ([]FontResourceRequirement, error) {
	if len(data) == 0 || len(data) > 16*1024 || !utf8.Valid(data) {
		return nil, fmt.Errorf("font resources: require valid UTF-8 JSON within 16 KiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('[') {
		return nil, fmt.Errorf("font resources: require a JSON array")
	}
	var requirements []FontResourceRequirement
	for decoder.More() {
		if len(requirements) >= 16 {
			return nil, fmt.Errorf("font resources: require 1..16 explicit faces")
		}
		first, err := decoder.Token()
		if err != nil || first != json.Delim('{') {
			return nil, fmt.Errorf("font resources: require face objects")
		}
		var item FontResourceRequirement
		seen := map[string]bool{}
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return nil, fmt.Errorf("font resources: invalid JSON field")
			}
			name, ok := key.(string)
			if !ok || seen[name] {
				return nil, fmt.Errorf("font resources: duplicate or invalid JSON field")
			}
			seen[name] = true
			var target any
			switch name {
			case "family":
				target = &item.Family
			case "weight":
				target = &item.Weight
			case "style":
				target = &item.Style
			case "hash":
				target = &item.Hash
			default:
				return nil, fmt.Errorf("font resources: unknown JSON field %q", name)
			}
			if err := decoder.Decode(target); err != nil {
				return nil, fmt.Errorf("font resources: invalid JSON field %q", name)
			}
		}
		if last, err := decoder.Token(); err != nil || last != json.Delim('}') || len(seen) != 4 {
			return nil, fmt.Errorf("font resources: require every face field exactly once")
		}
		requirements = append(requirements, item)
	}
	if last, err := decoder.Token(); err != nil || last != json.Delim(']') {
		return nil, fmt.Errorf("font resources: invalid JSON array")
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, fmt.Errorf("font resources: trailing JSON data")
	}
	if err := ValidateFontResourceRequirements(requirements); err != nil {
		return nil, err
	}
	return requirements, nil
}

func validFontResourceFamily(family string) bool {
	if !utf8.ValidString(family) || utf8.RuneCountInString(family) > 80 || strings.TrimSpace(family) != family {
		return false
	}
	first := true
	for _, scalar := range family {
		if first && !unicode.IsLetter(scalar) || !unicode.IsLetter(scalar) && !unicode.IsDigit(scalar) && !unicode.IsMark(scalar) && scalar != ' ' && scalar != '_' && scalar != '-' {
			return false
		}
		first = false
	}
	return !first
}

type boundFontResource struct {
	hash string
	data []byte
}

func (resource *boundFontResource) Name() string    { return "astro-fyne-font-" + resource.hash + ".ttf" }
func (resource *boundFontResource) Content() []byte { return bytes.Clone(resource.data) }

type boundFontBackend struct {
	base FyneBackend
}

var _ FontResourceBinder = FyneBackend{}
var _ FontResourceBinder = (*boundFontBackend)(nil)
var _ TextValidator = (*boundFontBackend)(nil)

func nilFontResource(resource fyne.Resource) bool {
	if resource == nil {
		return true
	}
	value := reflect.ValueOf(resource)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return value.IsNil()
	}
	return false
}

// BindFontResources freezes all bindings within 20 MiB each and 128 MiB total.
// Required faces also pass static TrueType and exact descriptor/hash validation.
func (backend FyneBackend) BindFontResources(requirements []FontResourceRequirement) (Backend, error) {
	if err := ValidateFontResourceRequirements(requirements); err != nil {
		return nil, err
	}
	requirements = append([]FontResourceRequirement(nil), requirements...)
	if len(backend.Fonts) > 256 {
		return nil, fmt.Errorf("font resources: snapshot exceeds 256 families or bindings")
	}
	families := make([]string, 0, len(backend.Fonts))
	sources := make(map[string]map[Font]fyne.Resource, len(backend.Fonts))
	count := 0
	for family, faces := range backend.Fonts {
		if len(faces) > 256-count {
			return nil, fmt.Errorf("font resources: snapshot exceeds 256 families or bindings")
		}
		count += len(faces)
		sources[family] = make(map[Font]fyne.Resource, len(faces))
		for slot, resource := range faces {
			sources[family][slot] = resource
		}
		families = append(families, family)
	}
	sort.Strings(families)
	for index, family := range families {
		for _, previous := range families[:index] {
			if strings.EqualFold(family, previous) {
				return nil, fmt.Errorf("font resources: ambiguous family aliases %q and %q", previous, family)
			}
		}
	}
	backend.Fonts = sources
	for _, item := range requirements {
		if nilFontResource(backend.font(Style{FontFamily: item.Family, FontWeight: float32(item.Weight), FontStyle: item.Style})) {
			return nil, fmt.Errorf("font resources: missing exact face for %q", item.Family)
		}
	}
	fonts := make(map[string]map[Font]fyne.Resource, len(backend.Fonts))
	resources := map[string]*boundFontResource{}
	total := 0
	for _, family := range families {
		fonts[family] = make(map[Font]fyne.Resource, len(backend.Fonts[family]))
		slots := make([]Font, 0, len(backend.Fonts[family]))
		for slot := range backend.Fonts[family] {
			slots = append(slots, slot)
		}
		sort.Slice(slots, func(left, right int) bool {
			if slots[left].Weight != slots[right].Weight {
				return slots[left].Weight < slots[right].Weight
			}
			return !slots[left].Italic && slots[right].Italic
		})
		for _, slot := range slots {
			resource := backend.Fonts[family][slot]
			if nilFontResource(resource) {
				fonts[family][slot] = nil
				continue
			}
			data := resource.Content()
			if len(data) == 0 || len(data) > 20*1024*1024 {
				return nil, fmt.Errorf("font resources: each binding requires 1..20 MiB")
			}
			total += len(data)
			if total > 128*1024*1024 {
				return nil, fmt.Errorf("font resources: bindings exceed 128 MiB; repeated bindings count separately")
			}
			data = bytes.Clone(data)
			digest := sha256.Sum256(data)
			hash := hex.EncodeToString(digest[:])
			frozen := resources[hash]
			if frozen == nil {
				frozen = &boundFontResource{hash: hash, data: data}
				resources[hash] = frozen
			} else if !bytes.Equal(frozen.data, data) {
				return nil, fmt.Errorf("font resources: equal hashes require identical bytes")
			}
			fonts[family][slot] = frozen
		}
	}
	bound := &boundFontBackend{base: FyneBackend{Fonts: fonts, fontsFrozen: true, fontFaces: make(map[fyne.Resource]*font.Face)}}
	return bound.BindFontResources(requirements)
}

func (backend *boundFontBackend) BindFontResources(requirements []FontResourceRequirement) (Backend, error) {
	if err := ValidateFontResourceRequirements(requirements); err != nil {
		return nil, err
	}
	if backend == nil {
		return nil, fmt.Errorf("font resources: a bound backend is required")
	}
	for _, item := range requirements {
		resource, ok := backend.base.font(Style{FontFamily: item.Family, FontWeight: float32(item.Weight), FontStyle: item.Style}).(*boundFontResource)
		if !ok || resource == nil || resource.hash != item.Hash {
			return nil, fmt.Errorf("font resources: missing or changed exact face for %q", item.Family)
		}
		if err := fontresource.Validate(resource.data, item.Weight, item.Style); err != nil {
			return nil, fmt.Errorf("font resources: %q: %w", item.Family, err)
		}
	}
	return backend, nil
}

func (backend *boundFontBackend) Defaults(node Node) Style { return backend.base.Defaults(node) }
func (backend *boundFontBackend) Validate(style Style, text bool) error {
	return backend.base.Validate(style, text)
}
func (backend *boundFontBackend) Measure(text string, style Style) fyne.Size {
	return backend.base.Measure(text, style)
}
func (backend *boundFontBackend) Text(text string, style Style) *canvas.Text {
	return backend.base.Text(text, style)
}
func (backend *boundFontBackend) PlaceText(text *canvas.Text, style Style, x, y float32) {
	backend.base.PlaceText(text, style, x, y)
}
func (backend *boundFontBackend) Box(style Style) Box { return backend.base.Box(style) }
func (backend *boundFontBackend) Editor(multiline bool, style Style, changed func(string)) Editor {
	return NewEditor(backend, multiline, style, changed)
}
func (backend *boundFontBackend) ValidateText(text string, style Style) error {
	return backend.base.ValidateText(text, style)
}
