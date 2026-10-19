// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Package fontbackend admits bounded static text against explicit native fonts.
package fontbackend

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/fontresource"
)

const maximumFaceBytes = 20 * 1024 * 1024
const maximumTotalBytes = 128 * 1024 * 1024

// FaceProfile binds one native family alias to copied nominal coverage metadata.
type FaceProfile struct {
	Family   string                       `json:"family"`
	Coverage fontresource.CoverageProfile `json:"coverage"`
}

// Backend owns its font bytes and aliases. Construct it with New.
// Its admission checks do not certify shaping, outlines or raster parity.
type Backend struct {
	base     webui.FyneBackend
	bindings []binding
}

type binding struct {
	family string
	slot   webui.Font
	face   *fontresource.StaticFace
}

type frozenResource struct {
	name string
	data []byte
}

func (resource *frozenResource) Name() string    { return resource.name }
func (resource *frozenResource) Content() []byte { return bytes.Clone(resource.data) }

type sourceSnapshot struct {
	data []byte
	hash string
}

type preparedBinding struct {
	family string
	slot   webui.Font
	source sourceSnapshot
}

var _ webui.Backend = (*Backend)(nil)
var _ webui.LegacyTextValidator = (*Backend)(nil)

// New freezes 1..16 explicit faces. Input resources are read once per binding.
// Licenses remain the caller's responsibility, including catalogue metadata.
func New(fonts map[string]map[webui.Font]fyne.Resource) (*Backend, error) {
	if len(fonts) == 0 || len(fonts) > 16 {
		return nil, fmt.Errorf("fontbackend: require 1..16 explicit font faces")
	}
	families := make([]string, 0, len(fonts))
	count := 0
	for family, faces := range fonts {
		if !validFamily(family) || len(faces) == 0 {
			return nil, fmt.Errorf("fontbackend: invalid family or empty face bindings")
		}
		count += len(faces)
		families = append(families, family)
	}
	if count > 16 {
		return nil, fmt.Errorf("fontbackend: require 1..16 explicit font faces")
	}
	sort.Strings(families)
	for index, family := range families {
		for _, previous := range families[:index] {
			if strings.EqualFold(family, previous) {
				return nil, fmt.Errorf("fontbackend: conflicting family aliases %q and %q", previous, family)
			}
		}
	}
	prepared := make([]preparedBinding, 0, count)
	total := 0
	for _, family := range families {
		slots := make([]webui.Font, 0, len(fonts[family]))
		for slot := range fonts[family] {
			slots = append(slots, slot)
		}
		sort.Slice(slots, func(left, right int) bool {
			if slots[left].Weight != slots[right].Weight {
				return slots[left].Weight < slots[right].Weight
			}
			return !slots[left].Italic && slots[right].Italic
		})
		for _, slot := range slots {
			if slot.Weight != 400 && slot.Weight != 700 {
				return nil, fmt.Errorf("fontbackend: family %q requires exact weight 400/700", family)
			}
			resource := fonts[family][slot]
			if nilResource(resource) {
				return nil, fmt.Errorf("fontbackend: family %q requires a nonnil font resource", family)
			}
			data := resource.Content()
			if len(data) == 0 || len(data) > maximumFaceBytes {
				return nil, fmt.Errorf("fontbackend: family %q requires 1..20MiB of font bytes", family)
			}
			total += len(data)
			if total > maximumTotalBytes {
				return nil, fmt.Errorf("fontbackend: font bindings exceed 128MiB in total; repeated bindings count separately")
			}
			data = bytes.Clone(data)
			digest := sha256.Sum256(data)
			source := sourceSnapshot{data: data, hash: hex.EncodeToString(digest[:])}
			prepared = append(prepared, preparedBinding{family: family, slot: slot, source: source})
		}
	}
	backend := &Backend{base: webui.FyneBackend{Fonts: make(map[string]map[webui.Font]fyne.Resource)}}
	resources := make(map[string]*frozenResource)
	faces := make(map[string]*fontresource.StaticFace)
	for _, item := range prepared {
		style := "normal"
		if item.slot.Italic {
			style = "italic"
		}
		faceKey := fmt.Sprintf("%s/%d/%s", item.source.hash, item.slot.Weight, style)
		face := faces[faceKey]
		if face == nil {
			var err error
			face, err = fontresource.NewStaticFace(item.source.data, item.slot.Weight, style)
			if err != nil {
				return nil, fmt.Errorf("fontbackend: family %q: %w", item.family, err)
			}
			if err := face.ValidateText("H "); err != nil {
				return nil, fmt.Errorf("fontbackend: family %q requires H and SPACE for native metrics: %w", item.family, err)
			}
			faces[faceKey] = face
		}
		resource := resources[item.source.hash]
		if resource == nil {
			resource = &frozenResource{name: "astro-fyne-font-" + item.source.hash + ".ttf", data: item.source.data}
			resources[item.source.hash] = resource
		}
		if backend.base.Fonts[item.family] == nil {
			backend.base.Fonts[item.family] = make(map[webui.Font]fyne.Resource)
		}
		backend.base.Fonts[item.family][item.slot] = resource
		backend.bindings = append(backend.bindings, binding{family: item.family, slot: item.slot, face: face})
	}
	return backend, nil
}

func validFamily(family string) bool {
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

func nilResource(resource fyne.Resource) bool {
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

func (backend *Backend) valid() error {
	if backend == nil || len(backend.bindings) == 0 {
		return fmt.Errorf("fontbackend: a constructed nominal backend is required")
	}
	return nil
}

// Profiles returns independent metadata in family/weight/style order.
func (backend *Backend) Profiles() []FaceProfile {
	if backend == nil || len(backend.bindings) == 0 {
		return nil
	}
	profiles := make([]FaceProfile, len(backend.bindings))
	for index, item := range backend.bindings {
		profiles[index] = FaceProfile{Family: item.family, Coverage: item.face.Profile()}
	}
	return profiles
}

func (backend *Backend) textFace(style webui.Style) (*fontresource.StaticFace, error) {
	if err := backend.valid(); err != nil {
		return nil, err
	}
	if style.Flex != nil && style.Flex.BoxSizing == "border-box" {
		return nil, fmt.Errorf("fontbackend: responsive text requires a separately qualified adapter")
	}
	if style.WhiteSpace != "nowrap" || style.FontSize <= 0 || style.FontSize > 256 || math.IsNaN(float64(style.FontSize)) ||
		style.LineHeight <= 0 || style.LineHeight > 1024 || math.IsNaN(float64(style.LineHeight)) {
		return nil, fmt.Errorf("fontbackend: static text requires nowrap, font-size in (0,256]px and line-height in (0,1024]px")
	}
	weight := style.FontWeight
	if weight == 0 {
		weight = 400
	}
	if weight != 400 && weight != 700 || style.FontStyle != "" && style.FontStyle != "normal" && style.FontStyle != "italic" {
		return nil, fmt.Errorf("fontbackend: text requires exact weight 400/700 and style normal/italic")
	}
	family := strings.Trim(style.FontFamily, " \t\r\n\f")
	if len(family) > 0 && (family[0] == '\'' || family[0] == '"') {
		if len(family) < 2 || family[len(family)-1] != family[0] {
			return nil, fmt.Errorf("fontbackend: text requires one registered family alias without escapes or a fallback stack")
		}
		family = family[1 : len(family)-1]
	}
	if !validFamily(family) {
		return nil, fmt.Errorf("fontbackend: text requires one registered family alias without escapes or a fallback stack")
	}
	for _, item := range backend.bindings {
		if strings.EqualFold(item.family, family) && item.slot.Weight == int(weight) && item.slot.Italic == (style.FontStyle == "italic") {
			return item.face, nil
		}
	}
	return nil, fmt.Errorf("fontbackend: family %q weight %v style %q has no exact bound face", family, weight, style.FontStyle)
}

func (backend *Backend) text(text string, style webui.Style) error {
	face, err := backend.textFace(style)
	if err != nil {
		return err
	}
	if !utf8.ValidString(text) {
		return fmt.Errorf("fontbackend: text requires valid UTF-8")
	}
	for _, scalar := range text {
		if unicode.IsControl(scalar) || unicode.Is(unicode.Zl, scalar) || unicode.Is(unicode.Zp, scalar) {
			return fmt.Errorf("fontbackend: control characters and multiline text require another adapter")
		}
	}
	if strings.HasPrefix(text, " ") || strings.HasSuffix(text, " ") || strings.Contains(text, "  ") {
		return fmt.Errorf("fontbackend: static text requires canonical single ASCII spaces")
	}
	if err := face.ValidateText(text); err != nil {
		return fmt.Errorf("fontbackend: %w", err)
	}
	return nil
}

// ValidateLegacyText rejects unsupported roles before View creates native objects.
func (backend *Backend) ValidateLegacyText(text webui.LegacyText) error {
	if err := backend.valid(); err != nil {
		return err
	}
	if text.Field != "text" || text.Kind != "text" && text.Kind != "label" && text.Kind != "button" && text.Kind != "link" {
		return fmt.Errorf("fontbackend: only static text, labels, buttons and links are admitted; editors require a prospective-edit adapter")
	}
	return backend.text(text.Text, text.Style)
}

func (backend *Backend) must(err error) {
	if err != nil {
		panic(err)
	}
}

func (backend *Backend) Defaults(node webui.Node) webui.Style {
	backend.must(backend.valid())
	return backend.base.Defaults(node)
}

func (backend *Backend) Validate(style webui.Style, text bool) error {
	if err := backend.valid(); err != nil {
		return err
	}
	if text {
		if _, err := backend.textFace(style); err != nil {
			return err
		}
	}
	return backend.base.Validate(style, text)
}

func (backend *Backend) Measure(text string, style webui.Style) fyne.Size {
	backend.must(backend.text(text, style))
	return backend.base.Measure(text, style)
}

func (backend *Backend) Text(text string, style webui.Style) *canvas.Text {
	backend.must(backend.text(text, style))
	return backend.base.Text(text, style)
}

func (backend *Backend) PlaceText(text *canvas.Text, style webui.Style, x, y float32) {
	if text == nil {
		panic(fmt.Errorf("fontbackend: a native text object is required"))
	}
	backend.must(backend.text(text.Text, style))
	backend.base.PlaceText(text, style, x, y)
}

func (backend *Backend) Box(style webui.Style) webui.Box {
	backend.must(backend.valid())
	return backend.base.Box(style)
}

func (backend *Backend) Editor(bool, webui.Style, func(string)) webui.Editor {
	panic(fmt.Errorf("fontbackend: editors require a prospective-edit adapter"))
}
