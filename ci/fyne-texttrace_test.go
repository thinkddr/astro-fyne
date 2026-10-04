// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Copy this test into internal/painter in an exact temporary Fyne checkout.
// It calls the renderer's shaping kernel without changing that kernel.
package painter

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"fyne.io/fyne/v2"
	"github.com/go-text/typesetting/shaping"
)

type astroTextMetrics struct {
	Width float32 `json:"width"`
	Height float32 `json:"height"`
	Baseline float32 `json:"baseline"`
}

type astroPixelOrigin struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type astroTextCase struct {
	FrameID string `json:"frameID"`
	NodeID string `json:"nodeID"`
	Purpose string `json:"purpose"`
	Text string `json:"text"`
	FontSize float32 `json:"fontSize"`
	Scale float32 `json:"scale"`
	TextStyle fyne.TextStyle `json:"textStyle"`
	ExpectedMetrics astroTextMetrics `json:"expectedMetrics"`
	PhysicalOrigin *astroPixelOrigin `json:"physicalOrigin,omitempty"`
}

type astroTextInput struct {
	Schema int `json:"schema"`
	ID string `json:"id"`
	SourceHash string `json:"sourceHash"`
	ProbeHash string `json:"probeHash"`
	FixtureHash string `json:"fixtureHash"`
	FontHash string `json:"fontHash"`
	FontPath string `json:"fontPath"`
	FontResourceName string `json:"fontResourceName"`
	Variant string `json:"variant"`
	OriginQuantization string `json:"originQuantization"`
	DiagnosticOnly bool `json:"diagnosticOnly"`
	PixelPerfectVerified bool `json:"pixelPerfectVerified"`
	Cases []astroTextCase `json:"cases"`
}

type astroTextBounds struct {
	Ascent int32 `json:"ascent"`
	Descent int32 `json:"descent"`
	Gap int32 `json:"gap"`
}

type astroGlyphTrace struct {
	ID uint32 `json:"id"`
	TextIndex int `json:"textIndex"`
	RunesCount int `json:"runesCount"`
	GlyphsCount int `json:"glyphsCount"`
	Mask uint32 `json:"mask"`
	Advance int32 `json:"advance"`
	XAdvance int32 `json:"xAdvance"`
	YAdvance int32 `json:"yAdvance"`
	XOffset int32 `json:"xOffset"`
	YOffset int32 `json:"yOffset"`
	XBearing int32 `json:"xBearing"`
	YBearing int32 `json:"yBearing"`
	Width int32 `json:"width"`
	Height int32 `json:"height"`
}

type astroRunTrace struct {
	RuneOffset int `json:"runeOffset"`
	RuneCount int `json:"runeCount"`
	VisualIndex int32 `json:"visualIndex"`
	Direction uint8 `json:"direction"`
	Size int32 `json:"size"`
	Advance int32 `json:"advance"`
	LineBounds astroTextBounds `json:"lineBounds"`
	GlyphBounds astroTextBounds `json:"glyphBounds"`
	FontHash string `json:"fontHash"`
	UnitsPerEm uint16 `json:"unitsPerEm"`
	RunX float32 `json:"runX"`
	SharedScaledAscent float32 `json:"sharedScaledAscent"`
	TextureRunOrigin astroPixelOrigin `json:"textureRunOrigin"`
	ViewportRunBaseline *astroPixelOrigin `json:"viewportRunBaseline,omitempty"`
	Glyphs []astroGlyphTrace `json:"glyphs"`
}

type astroCaseTrace struct {
	Input astroTextCase `json:"input"`
	RequestedSize26_6 int32 `json:"requestedSize26_6"`
	EffectiveShaperPixels int `json:"effectiveShaperPixels"`
	Measured astroTextMetrics `json:"measured"`
	ScaledAdvance float32 `json:"scaledAdvance"`
	ReturnedLogicalHeight float32 `json:"returnedLogicalHeight"`
	ReturnedLogicalBaseline float32 `json:"returnedLogicalBaseline"`
	Runs []astroRunTrace `json:"runs"`
}

type astroFontExtents struct {
	UnitsPerEm uint16 `json:"unitsPerEm"`
	Available bool `json:"available"`
	Ascender float32 `json:"ascender"`
	Descender float32 `json:"descender"`
	LineGap float32 `json:"lineGap"`
}

type astroTextTrace struct {
	Schema int `json:"schema"`
	ID string `json:"id"`
	InputHash string `json:"inputHash"`
	SourceHash string `json:"sourceHash"`
	ProbeHash string `json:"probeHash"`
	FixtureHash string `json:"fixtureHash"`
	FontHash string `json:"fontHash"`
	FontResourceName string `json:"fontResourceName"`
	Variant string `json:"variant"`
	OriginQuantization string `json:"originQuantization"`
	MetricUnits string `json:"metricUnits"`
	RunPlacementUnits string `json:"runPlacementUnits"`
	FontExtentUnits string `json:"fontExtentUnits"`
	ShaperSizeDerivation string `json:"shaperSizeDerivation"`
	Kernel string `json:"kernel"`
	FontExtents astroFontExtents `json:"fontExtents"`
	Cases []astroCaseTrace `json:"cases"`
	DiagnosticOnly bool `json:"diagnosticOnly"`
	PixelPerfectVerified bool `json:"pixelPerfectVerified"`
}

func astroTextHash(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func astroHashValid(value string) bool {
	bytes, err := hex.DecodeString(value)
	return err == nil && len(bytes) == sha256.Size && value == strings.ToLower(value)
}

func astroFixedBounds(bounds shaping.Bounds) astroTextBounds {
	return astroTextBounds{int32(bounds.Ascent), int32(bounds.Descent), int32(bounds.Gap)}
}

func TestAstroFyneTextTrace(t *testing.T) {
	inputPath, outputPath := os.Getenv("ASTRO_FYNE_TEXTTRACE_INPUT"), os.Getenv("ASTRO_FYNE_TEXTTRACE_OUTPUT")
	if inputPath == "" || outputPath == "" {
		t.Fatal("the text trace requires ASTRO_FYNE_TEXTTRACE_INPUT and ASTRO_FYNE_TEXTTRACE_OUTPUT")
	}
	inputBytes, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatal(err)
	}
	var input astroTextInput
	decoder := json.NewDecoder(bytes.NewReader(inputBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		t.Fatalf("text trace requires exactly one input object: %v", err)
	}
	if input.Schema != 1 || input.ID != "typography-probe" || !input.DiagnosticOnly || input.PixelPerfectVerified || input.Variant == "" ||
		(input.OriginQuantization != "ceil" && input.OriginQuantization != "nearest") || !filepath.IsAbs(input.FontPath) || input.FontResourceName == "" || len(input.Cases) != 42 {
		t.Fatal("the text trace input does not satisfy its explicit two-scale, seven-sample contract")
	}
	for _, value := range []string{input.SourceHash, input.ProbeHash, input.FixtureHash, input.FontHash} {
		if !astroHashValid(value) {
			t.Fatal("text trace identities require lowercase SHA-256 hashes")
		}
	}
	identityBytes, err := json.Marshal([]string{input.ProbeHash, input.FixtureHash, input.FontHash})
	if err != nil || astroTextHash(identityBytes) != input.SourceHash {
		t.Fatal("text trace source hash does not match the three declared input hashes")
	}
	fontBytes, err := os.ReadFile(input.FontPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(fontBytes) == 0 || len(fontBytes) > 20*1024*1024 || astroTextHash(fontBytes) != input.FontHash {
		t.Fatal("the sidecar font bytes differ from the captured native font")
	}
	resource := fyne.NewStaticResource(input.FontResourceName, bytes.Clone(fontBytes))
	parsed := loadMeasureFont(resource)
	if parsed == nil {
		t.Fatal("the Fyne font parser rejected the probe resource")
	}
	extents, extentsAvailable := parsed.FontHExtents()
	result := astroTextTrace{Schema: 1, ID: input.ID, InputHash: astroTextHash(inputBytes), SourceHash: input.SourceHash,
		ProbeHash: input.ProbeHash, FixtureHash: input.FixtureHash, FontHash: input.FontHash, FontResourceName: input.FontResourceName,
		Variant: input.Variant, OriginQuantization: input.OriginQuantization, MetricUnits: "signed integer 26.6 logical pixels",
		RunPlacementUnits: "physical pixels; runX/sharedScaledAscent are pre-integer values",
		FontExtentUnits: "unscaled font units", ShaperSizeDerivation: "typesetting v0.3.4 uses input.Size.Ceil() for its Harfbuzz scale",
		Kernel: "fyne.io/fyne/v2/internal/painter.walkString", FontExtents: astroFontExtents{parsed.Upem(), extentsAvailable, extents.Ascender, extents.Descender, extents.LineGap},
		Cases: []astroCaseTrace{}, DiagnosticOnly: true, PixelPerfectVerified: false}
	seen := map[string]bool{}
	groups := map[string]map[string]astroTextCase{}
	for _, item := range input.Cases {
		key := item.FrameID+"/"+item.NodeID+"/"+item.Purpose
		if seen[key] || item.NodeID == "" || !utf8.ValidString(item.Text) || item.Text == "" || strings.ContainsAny(item.Text, "\r\n\t") ||
			math.IsNaN(float64(item.FontSize)) || math.IsInf(float64(item.FontSize), 0) || item.FontSize <= 0 || item.FontSize > 128 ||
			(item.Scale != 1 && item.Scale != 2) || item.FrameID != fmt.Sprintf("scale-%d", int(item.Scale)) ||
			(item.Purpose != "text" && item.Purpose != "H" && item.Purpose != "space") || item.TextStyle != (fyne.TextStyle{}) {
			t.Fatalf("invalid or duplicate captured text case %q", key)
		}
		seen[key] = true
		groupKey := item.FrameID+"/"+item.NodeID
		if groups[groupKey] == nil {
			groups[groupKey] = map[string]astroTextCase{}
		}
		groups[groupKey][item.Purpose] = item
		if item.Purpose == "H" && item.Text != "H" || item.Purpose == "space" && item.Text != " " ||
			item.Purpose == "text" && item.PhysicalOrigin == nil || item.Purpose != "text" && item.PhysicalOrigin != nil {
			t.Fatalf("painted and metric-only origins are inconsistent for %q", key)
		}
		for _, r := range []rune(item.Text+"H ") {
			if glyph, ok := parsed.NominalGlyph(r); !ok || glyph == 0 {
				t.Fatalf("probe font lacks U+%04X; fallback would invalidate the trace", r)
			}
		}
		faces := CachedFontFace(item.TextStyle, resource, nil).Fonts
		primary := faces.ResolveFace(' ')
		for _, r := range item.Text+"H " {
			if faces.ResolveFace(r) != primary {
				t.Fatalf("the painter resolved an implicit fallback face for %q", key)
			}
		}
		measured, baseline := MeasureString(faces, item.Text, item.FontSize, item.TextStyle)
		metrics := astroTextMetrics{measured.Width, measured.Height, baseline}
		if metrics != item.ExpectedMetrics {
			t.Fatalf("%s: kernel metrics %+v differ from captured driver metrics %+v", key, metrics, item.ExpectedMetrics)
		}
		requestedSize := float32ToFixed266(item.FontSize)
		output := astroCaseTrace{Input: item, RequestedSize26_6: int32(requestedSize), EffectiveShaperPixels: requestedSize.Ceil(),
			Measured: metrics, Runs: []astroRunTrace{}}
		advance := float32(0)
		var traceError error
		size, base := walkString(faces, item.Text, requestedSize, item.TextStyle, &advance, item.Scale,
			func(run shaping.Output, x, y float32) {
				if run.Face != primary {
					traceError = fmt.Errorf("%s used an unrecorded fallback face", key)
					return
				}
				origin := astroPixelOrigin{int(x), int(math.Ceil(float64(y)))}
				var viewportBaseline *astroPixelOrigin
				if item.PhysicalOrigin != nil {
					viewportBaseline = &astroPixelOrigin{item.PhysicalOrigin.X+origin.X, item.PhysicalOrigin.Y+origin.Y}
				}
				record := astroRunTrace{RuneOffset: run.Runes.Offset, RuneCount: run.Runes.Count, VisualIndex: run.VisualIndex,
					Direction: uint8(run.Direction), Size: int32(run.Size), Advance: int32(run.Advance),
					LineBounds: astroFixedBounds(run.LineBounds), GlyphBounds: astroFixedBounds(run.GlyphBounds), FontHash: input.FontHash,
					UnitsPerEm: run.Face.Upem(), RunX: x, SharedScaledAscent: y, TextureRunOrigin: origin,
					ViewportRunBaseline: viewportBaseline, Glyphs: []astroGlyphTrace{}}
				for _, glyph := range run.Glyphs {
					if glyph.GlyphID == 0 {
						traceError = fmt.Errorf("%s produced a replacement glyph", key)
						return
					}
					record.Glyphs = append(record.Glyphs, astroGlyphTrace{ID: uint32(glyph.GlyphID), TextIndex: glyph.TextIndex(),
						RunesCount: glyph.RunesCount(), GlyphsCount: glyph.GlyphsCount(), Mask: glyph.Mask,
						Advance: int32(glyph.Advance), XAdvance: int32(glyph.XAdvance), YAdvance: int32(glyph.YAdvance),
						XOffset: int32(glyph.XOffset), YOffset: int32(glyph.YOffset), XBearing: int32(glyph.XBearing), YBearing: int32(glyph.YBearing),
						Width: int32(glyph.Width), Height: int32(glyph.Height)})
				}
				output.Runs = append(output.Runs, record)
			})
		if traceError != nil {
			t.Fatal(traceError)
		}
		if len(output.Runs) == 0 || advance != size.Width || size.Height != metrics.Height || base != metrics.Baseline {
			t.Fatalf("the shaping callback did not produce complete metrics for %q", key)
		}
		output.ScaledAdvance, output.ReturnedLogicalHeight, output.ReturnedLogicalBaseline = advance, size.Height, base
		result.Cases = append(result.Cases, output)
	}
	if len(result.Cases) != len(input.Cases) {
		t.Fatal("the shaping trace omitted an input case")
	}
	if len(groups) != 14 {
		t.Fatal("the shaping trace must contain seven samples at each scale")
	}
	for key, probes := range groups {
		text, textExists := probes["text"]
		h, hExists := probes["H"]
		space, spaceExists := probes["space"]
		if len(probes) != 3 || !textExists || !hExists || !spaceExists || h.FontSize != text.FontSize || space.FontSize != text.FontSize {
			t.Fatalf("the actual/H/space metric group is incomplete for %q", key)
		}
	}
	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outputPath, append(encoded, '\n'), 0644); err != nil {
		t.Fatal(err)
	}
	t.Logf("recorded %d real painter cases; font SHA-256 %s; typography remains uncertified", len(result.Cases), input.FontHash)
}
