// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"strings"
	"unicode"

	"fyne.io/fyne/v2"
	"github.com/go-text/typesetting/font"
)

// TextValidator is the additional opt-in contract for responsive native text.
// Backend remains compatible with existing measured/prototype adapters. A source
// text backend must diagnose unavailable glyphs instead of silently substituting
// another font. This contract does not certify shaping or rasterization parity.
type TextValidator interface {
	ValidateText(string, Style) error
}

func validateResponsiveTextStyle(s Style) error {
	if s.FontSize <= 0 || s.LineHeight <= 0 || strings.TrimSpace(family(s)) == "" || strings.Contains(s.FontFamily, ",") ||
		(s.FontWeight != 400 && s.FontWeight != 700) || (s.FontStyle != "normal" && s.FontStyle != "italic") ||
		(s.TextAlign != "left" && s.TextAlign != "center" && s.TextAlign != "right") || s.WhiteSpace != "nowrap" || s.Color == "" {
		return fmt.Errorf("responsive text requires one font family, weight 400/700, normal/italic, positive pixel font-size/line-height, explicit color, left/center/right and nowrap")
	}
	return nil
}

func invalidSingleLineInput(text string) bool {
	for _, r := range text {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

// sourceNowrap collapses CSS ASCII whitespace for a single text-only leaf. It
// deliberately preserves NBSP and other Unicode spaces; strings.Fields would
// change their browser meaning. Input values do not use CSS whitespace collapse.
func sourceNowrap(text string) string {
	var out strings.Builder
	space := false
	for _, r := range text {
		switch r {
		case ' ', '\t', '\n', '\r', '\f':
			space = out.Len() > 0
		default:
			if space {
				out.WriteByte(' ')
			}
			space = false
			out.WriteRune(r)
		}
	}
	return out.String()
}

func responsiveHasText(n Node) bool {
	return n.Kind == "text" || n.Kind == "button" || n.Kind == "input"
}

// freezeResponsiveFonts clones public font registrations once per View. The
// caller's mutable maps/resource bytes therefore cannot change a painted frame
// behind Fyne's resource-identity font cache. Only used faces are parsed below.
func freezeResponsiveFonts(backend Backend) (Backend, error) {
	var b FyneBackend
	switch value := backend.(type) {
	case FyneBackend:
		b = value
	case *FyneBackend:
		if value == nil {
			return nil, fmt.Errorf("webui: responsive font backend cannot be nil")
		}
		b = *value
	default:
		return backend, nil
	}
	if b.fontsFrozen {
		return b, nil
	}
	fonts := make(map[string]map[Font]fyne.Resource, len(b.Fonts))
	seen := map[string]bool{}
	for family, faces := range b.Fonts {
		key := strings.ToLower(strings.TrimSpace(family))
		if key == "" || seen[key] {
			return nil, fmt.Errorf("webui: font registrations require unique nonempty families")
		}
		seen[key] = true
		fonts[family] = make(map[Font]fyne.Resource, len(faces))
		for face, resource := range faces {
			if resource == nil {
				continue
			}
			data := resource.Content()
			if len(data) == 0 || len(data) > 20*1024*1024 {
				return nil, fmt.Errorf("webui: font resource %q requires 1..20MiB of data", resource.Name())
			}
			frozen := bytes.Clone(data)
			hash := sha256.Sum256(frozen)
			suffix := fmt.Sprintf("#sha256=%x", hash)
			name := resource.Name()
			if !strings.HasSuffix(name, suffix) {
				name += suffix
			}
			fonts[family][face] = fyne.NewStaticResource(name, frozen)
		}
	}
	b.Fonts, b.fontsFrozen = fonts, true
	b.fontFaces = make(map[fyne.Resource]*font.Face)
	return b, nil
}

func (b FyneBackend) parsedFont(s Style) (*font.Face, error) {
	resource := b.font(s)
	if resource == nil {
		return nil, fmt.Errorf("font %q weight %v style %q requires an explicit matching resource", s.FontFamily, s.FontWeight, s.FontStyle)
	}
	if b.fontFaces != nil {
		if face := b.fontFaces[resource]; face != nil {
			return face, nil
		}
	}
	face, err := font.ParseTTF(bytes.NewReader(bytes.Clone(resource.Content())))
	if err != nil {
		return nil, fmt.Errorf("invalid font resource %q: %w", resource.Name(), err)
	}
	if b.fontFaces != nil {
		b.fontFaces[resource] = face
	}
	return face, nil
}

func (b FyneBackend) ValidateText(text string, s Style) error {
	face, err := b.parsedFont(s)
	if err != nil {
		return err
	}
	for _, r := range text {
		glyph, ok := face.NominalGlyph(r)
		if !ok || glyph == 0 {
			return fmt.Errorf("font %q has no glyph for U+%04X; implicit fallback is unsupported", s.FontFamily, r)
		}
	}
	return nil
}

func validateResponsiveBackend(nodes []Node, backend Backend) error {
	var walk func([]Node) error
	walk = func(nodes []Node) error {
		for _, n := range nodes {
			if responsiveHasText(n) {
				if err := backend.Validate(n.Style, true); err != nil {
					return fmt.Errorf("webui: %q: %w", n.ID, err)
				}
				validator, ok := backend.(TextValidator)
				if !ok {
					return fmt.Errorf("webui: responsive text backend for %q must implement TextValidator", n.ID)
				}
				texts := []string{sourceNowrap(n.Text)}
				if n.Kind == "input" {
					texts = []string{n.Value, n.Placeholder}
				}
				for _, text := range texts {
					if err := validator.ValidateText(text, n.Style); err != nil {
						return fmt.Errorf("webui: %q: %w", n.ID, err)
					}
				}
			}
			if err := walk(n.Children); err != nil {
				return err
			}
		}
		return nil
	}
	return walk(nodes)
}

// responsiveFrameError keeps the initial source text contract explicit: one
// fitted line, including pending input edits. This diagnostic does not resize a
// box, alter a minimum or replace missing text with a different font. Horizontal
// editing scroll and overflowing label paint need their own browser/native gate.
func (v *View) responsiveFrameError() error {
	if !v.responsive || v.Size().Width <= 0 || v.Size().Height <= 0 {
		return nil
	}
	validator, _ := v.backend.(TextValidator)
	for _, e := range v.elements {
		if !responsiveHasText(e.node) {
			continue
		}
		texts := []string{sourceNowrap(e.node.Text)}
		if e.input != nil {
			value := e.input.Text()
			if invalidSingleLineInput(value) {
				return fmt.Errorf("webui: responsive input %q contains an unsupported control character", e.node.ID)
			}
			texts = []string{value, e.node.Placeholder}
		}
		content := e.object.Size().SubtractWidthHeight(horizontalDecoration(e.style), verticalDecoration(e.style))
		for _, text := range texts {
			if validator != nil {
				if err := validator.ValidateText(text, e.style); err != nil {
					return fmt.Errorf("webui: %q: %w", e.node.ID, err)
				}
			}
			if text != "" && (v.backend.Measure(text, e.style).Width > max(content.Width, 0) || e.style.LineHeight > max(content.Height, 0)) {
				return fmt.Errorf("webui: responsive text on %q exceeds its content box; overflow and horizontal editing scroll are not supported", e.node.ID)
			}
		}
	}
	return nil
}
