// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontresource

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"runtime/debug"
	"sort"
	"unicode/utf8"

	"github.com/go-text/typesetting/font"
)

const coverageParserPath = "github.com/go-text/typesetting"
const coverageParserVersion = "v0.3.4"

// ScalarRange includes both endpoints and never includes Unicode surrogates.
type ScalarRange struct {
	Start uint32 `json:"start"`
	End   uint32 `json:"end"`
}

// CoverageProfile records nominal scalar coverage, not shaping or raster parity.
type CoverageProfile struct {
	Schema   int           `json:"schema"`
	FontHash string        `json:"fontHash"`
	Weight   int           `json:"weight"`
	Style    string        `json:"style"`
	Parser   string        `json:"parser"`
	Ranges   []ScalarRange `json:"ranges"`
}

// StaticFace owns immutable coverage derived from one validated static font.
// Construct it with NewStaticFace; no parsed font or caller-owned bytes survive.
type StaticFace struct {
	fontHash string
	weight   int
	style    string
	parser   string
	ranges   []ScalarRange
}

// NewStaticFace validates one face and freezes its selected nominal coverage.
func NewStaticFace(data []byte, weight int, style string) (*StaticFace, error) {
	if (weight != 400 && weight != 700) || (style != "normal" && style != "italic") {
		return nil, fmt.Errorf("fontresource: static face requires weight 400/700 and style normal/italic")
	}
	if len(data) == 0 || len(data) > 20*1024*1024 {
		return nil, fmt.Errorf("fontresource: static face requires 1..20MiB of font bytes")
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return nil, fmt.Errorf("fontresource: coverage requires identified parser build metadata")
	}
	parser, err := coverageParserIdentity(info)
	if err != nil {
		return nil, err
	}
	data = bytes.Clone(data)
	if err := Validate(data, weight, style); err != nil {
		return nil, fmt.Errorf("fontresource: invalid static face: %w", err)
	}
	parsed, err := font.ParseTTF(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("fontresource: parse static face: %w", err)
	}
	var glyphs uint32
	count := int(binary.BigEndian.Uint16(data[4:6]))
	for at := 12; at < 12+16*count; at += 16 {
		if string(data[at:at+4]) == "maxp" {
			start := int(binary.BigEndian.Uint32(data[at+8 : at+12]))
			glyphs = uint32(binary.BigEndian.Uint16(data[start+4 : start+6]))
			break
		}
	}
	ranges := make([]ScalarRange, 0)
	for scalar := rune(0); scalar <= utf8.MaxRune; scalar++ {
		if scalar >= 0xd800 && scalar <= 0xdfff {
			continue
		}
		glyph, found := parsed.NominalGlyph(scalar)
		if !found || glyph == 0 {
			continue
		}
		if uint32(glyph) >= glyphs {
			return nil, fmt.Errorf("fontresource: U+%04X maps to glyph %d outside %d glyphs", scalar, glyph, glyphs)
		}
		value := uint32(scalar)
		if len(ranges) > 0 && ranges[len(ranges)-1].End+1 == value {
			ranges[len(ranges)-1].End = value
		} else {
			ranges = append(ranges, ScalarRange{Start: value, End: value})
		}
	}
	digest := sha256.Sum256(data)
	return &StaticFace{fontHash: hex.EncodeToString(digest[:]), weight: weight, style: style, parser: parser, ranges: ranges}, nil
}

// Contains reports an in-range, nonzero selected nominal glyph for a scalar.
func (face *StaticFace) Contains(scalar rune) bool {
	if face == nil || !utf8.ValidRune(scalar) {
		return false
	}
	value := uint32(scalar)
	index := sort.Search(len(face.ranges), func(index int) bool {
		return face.ranges[index].End >= value
	})
	return index < len(face.ranges) && face.ranges[index].Start <= value
}

// ValidateText requires valid UTF-8 and a covered nominal glyph for every scalar.
func (face *StaticFace) ValidateText(text string) error {
	if face == nil || face.fontHash == "" {
		return fmt.Errorf("fontresource: a constructed static face is required")
	}
	if !utf8.ValidString(text) {
		return fmt.Errorf("fontresource: text requires valid UTF-8")
	}
	for _, scalar := range text {
		if !face.Contains(scalar) {
			return fmt.Errorf("fontresource: missing glyph for U+%04X", scalar)
		}
	}
	return nil
}

// Profile returns independent ranges; changing them cannot alter this face.
func (face *StaticFace) Profile() CoverageProfile {
	if face == nil || face.fontHash == "" {
		return CoverageProfile{}
	}
	ranges := make([]ScalarRange, len(face.ranges))
	copy(ranges, face.ranges)
	return CoverageProfile{Schema: 1, FontHash: face.fontHash, Weight: face.weight, Style: face.style, Parser: face.parser, Ranges: ranges}
}

func coverageParserIdentity(info *debug.BuildInfo) (string, error) {
	var selected *debug.Module
	if info != nil {
		for _, dependency := range info.Deps {
			if dependency == nil || dependency.Path != coverageParserPath {
				continue
			}
			if selected != nil {
				return "", fmt.Errorf("fontresource: coverage parser build metadata is ambiguous")
			}
			selected = dependency
		}
	}
	if selected == nil || selected.Version != coverageParserVersion || selected.Replace != nil {
		return "", fmt.Errorf("fontresource: coverage requires the original github.com/go-text/typesetting@v0.3.4 dependency; other or unidentified builds require an explicit adapter")
	}
	return selected.Path + "@" + selected.Version, nil
}
