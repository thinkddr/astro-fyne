// SPDX-License-Identifier: Unlicense OR BSD-3-Clause

package shaping

import (
	"bytes"
	"fmt"
	"testing"

	"github.com/go-text/typesetting/di"
	"github.com/go-text/typesetting/font"
	ot "github.com/go-text/typesetting/font/opentype"
	"github.com/go-text/typesetting/harfbuzz"
	"github.com/go-text/typesetting/language"
	"golang.org/x/image/font/gofont/gomono"
	"golang.org/x/image/math/fixed"
)

func TestFractionalSizeAdvanceFromFontUnits(t *testing.T) {
	face, err := font.ParseTTF(bytes.NewReader(gomono.TTF))
	if err != nil {
		t.Fatal(err)
	}
	gid, ok := face.NominalGlyph('H')
	if !ok {
		t.Fatal("Go Mono does not cover H")
	}
	size := fixed.I(14) + 32
	in := fractionalSizeInput("H", face, di.DirectionLTR, language.Latin, "en")
	in.Size = size
	shaper := HarfbuzzShaper{}
	out := shaper.Shape(in)
	if len(out.Glyphs) != 1 || out.Glyphs[0].GlyphID != gid {
		t.Fatalf("unexpected glyphs: %+v", out.Glyphs)
	}
	advance := face.HorizontalAdvance(gid)
	if advance != float32(int64(advance)) {
		t.Fatalf("test font has a fractional font-unit advance: %v", advance)
	}
	want := fractionalSizeScaleFontUnits(int64(advance), size, face.Upem())
	if got := out.Glyphs[0].Advance; got != want {
		t.Fatalf("14.5px advance: got %d, want %d raw 26.6 from font units", got, want)
	}
	if out.Advance != want {
		t.Fatalf("run advance: got %d, want %d raw 26.6", out.Advance, want)
	}
	extents, ok := face.FontHExtents()
	if !ok {
		t.Fatal("Go Mono has no horizontal extents")
	}
	for _, metric := range []struct {
		name  string
		units float32
		got   fixed.Int26_6
	}{
		{"ascent", extents.Ascender, out.LineBounds.Ascent},
		{"descent", extents.Descender, out.LineBounds.Descent},
		{"gap", extents.LineGap, out.LineBounds.Gap},
	} {
		if metric.units != float32(int64(metric.units)) {
			t.Fatalf("test font has fractional %s font units: %v", metric.name, metric.units)
		}
		want := fractionalSizeScaleFontUnits(int64(metric.units), size, face.Upem())
		if metric.got != want {
			t.Errorf("%s: got %d, want %d raw 26.6 from font units", metric.name, metric.got, want)
		}
	}
}

func TestFractionalSizeMatchesHarfBuzz(t *testing.T) {
	featureFace := loadOpentypeFont(t, "../font/testdata/UbuntuMono-R.ttf")
	combiningFace := loadOpentypeFont(t, "../font/testdata/Roboto-Regular.ttf")
	cases := []struct {
		name string
		in   Input
	}{
		{"latin", fractionalSizeInput("AVATAR To Wa", benchEnFace, di.DirectionLTR, language.Latin, "en")},
		{"combining", fractionalSizeInput("q\u0301q\u0301", combiningFace, di.DirectionLTR, language.Latin, "en")},
		{"arabic-rtl", fractionalSizeInput("السَّلَامُ عَلَيْكُمْ", benchArFace, di.DirectionRTL, language.Arabic, "ar")},
		{"feature", fractionalSizeInput("1/2", featureFace, di.DirectionLTR, language.Latin, "en")},
		{"vertical", fractionalSizeInput("Hgx", benchEnFace, di.DirectionTTB, language.Latin, "en")},
	}
	cases[3].in.FontFeatures = []FontFeature{{Tag: ot.MustNewTag("frac"), Value: 1}}
	context := fractionalSizeInput("السَّلَامُ عَلَيْكُمْ", benchArFace, di.DirectionRTL, language.Arabic, "ar")
	context.RunStart = 1
	context.RunEnd--
	cases = append(cases, struct {
		name string
		in   Input
	}{"arabic-context", context})
	for _, tc := range cases {
		for _, size := range []fixed.Int26_6{fixed.I(14) + 1, fixed.I(14) + 32, fixed.I(14) + 63} {
			t.Run(fmt.Sprintf("%s/%d", tc.name, size), func(t *testing.T) {
				in := tc.in
				in.Size = size
				shaper := HarfbuzzShaper{}
				out := shaper.Shape(in)
				fractionalSizeAssertHarfBuzz(t, in, out, int32(size))
				if tc.name == "feature" && len(out.Glyphs) != 1 {
					t.Fatalf("frac feature did not form a ligature: %d glyphs", len(out.Glyphs))
				}
			})
		}
	}
}

func TestIntegerSizeMatchesPreviousScale(t *testing.T) {
	for _, size := range []int{1, 12, 14, 15, 32} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			for _, in := range []Input{
				fractionalSizeInput("AVATAR To Wa Hgx", benchEnFace, di.DirectionLTR, language.Latin, "en"),
				fractionalSizeInput("السَّلَامُ عَلَيْكُمْ", benchArFace, di.DirectionRTL, language.Arabic, "ar"),
			} {
				in.Size = fixed.I(size)
				previousScale := int32(in.Size.Ceil()) << 6
				if previousScale != int32(in.Size) {
					t.Fatal("integer input changed its HarfBuzz scale")
				}
				shaper := HarfbuzzShaper{}
				fractionalSizeAssertHarfBuzz(t, in, shaper.Shape(in), previousScale)
			}
		})
	}
}

func TestFractionalSizeFontCacheUpdatesScale(t *testing.T) {
	shaper := HarfbuzzShaper{}
	for _, size := range []fixed.Int26_6{fixed.I(14), fixed.I(14) + 32, fixed.I(15), fixed.I(14) + 1, fixed.I(14) + 32, fixed.I(14)} {
		in := fractionalSizeInput("AVATAR Hgx", benchEnFace, di.DirectionLTR, language.Latin, "en")
		in.Size = size
		fractionalSizeAssertHarfBuzz(t, in, shaper.Shape(in), int32(size))
	}
}

func TestFractionalSizeBidiRunsMatchHarfBuzz(t *testing.T) {
	in := fractionalSizeInput("AVATAR السلام To", benchEnFace, di.DirectionLTR, language.Latin, "en")
	in.Size = fixed.I(14) + 32
	segmenter := Segmenter{}
	runs := segmenter.Split(in, fixedFontmap{benchEnFace, benchArFace})
	shaper := HarfbuzzShaper{}
	var sawLTR, sawRTL bool
	for _, run := range runs {
		sawLTR = sawLTR || run.Direction == di.DirectionLTR
		sawRTL = sawRTL || run.Direction == di.DirectionRTL
		fractionalSizeAssertHarfBuzz(t, run, shaper.Shape(run), int32(in.Size))
	}
	if !sawLTR || !sawRTL {
		t.Fatalf("mixed-direction test did not exercise both directions: %+v", runs)
	}
}

func TestFractionalSizeFeaturesRemainEffective(t *testing.T) {
	face := loadOpentypeFont(t, "../font/testdata/UbuntuMono-R.ttf")
	in := fractionalSizeInput("1/2", face, di.DirectionLTR, language.Latin, "en")
	in.Size = fixed.I(14) + 32
	shaper := HarfbuzzShaper{}
	for _, enabled := range []bool{true, false, true} {
		in.FontFeatures = nil
		wantGlyphs := 3
		if enabled {
			in.FontFeatures = []FontFeature{{Tag: ot.MustNewTag("frac"), Value: 1}}
			wantGlyphs = 1
		}
		out := shaper.Shape(in)
		fractionalSizeAssertHarfBuzz(t, in, out, int32(in.Size))
		if len(out.Glyphs) != wantGlyphs {
			t.Fatalf("frac enabled %t: got %d glyphs, want %d", enabled, len(out.Glyphs), wantGlyphs)
		}
	}
}

func fractionalSizeInput(text string, face *font.Face, direction di.Direction, script language.Script, lang string) Input {
	runes := []rune(text)
	return Input{
		Text:      runes,
		RunStart:  0,
		RunEnd:    len(runes),
		Direction: direction,
		Face:      face,
		Script:    script,
		Language:  language.NewLanguage(lang),
	}
}

// Compare wrapper output with the public HarfBuzz API at an explicit 26.6 scale.
func fractionalSizeAssertHarfBuzz(t *testing.T, in Input, out Output, scale int32) {
	t.Helper()
	font := harfbuzz.NewFont(in.Face)
	font.XScale, font.YScale = scale, scale
	buf := harfbuzz.NewBuffer()
	buf.AddRunes(in.Text, in.RunStart, in.RunEnd-in.RunStart)
	buf.Props.Direction = in.Direction.Harfbuzz()
	buf.Props.Script = in.Script
	buf.Props.Language = in.Language
	features := make([]harfbuzz.Feature, len(in.FontFeatures))
	for i, feature := range in.FontFeatures {
		features[i] = harfbuzz.Feature{
			Tag:   feature.Tag,
			Value: feature.Value,
			Start: harfbuzz.FeatureGlobalStart,
			End:   harfbuzz.FeatureGlobalEnd,
		}
	}
	buf.Shape(font, features)
	if out.Size != in.Size || out.Face != in.Face || out.Direction != in.Direction || out.Runes != (Range{Offset: in.RunStart, Count: in.RunEnd - in.RunStart}) {
		t.Fatalf("run metadata changed: %+v", out)
	}
	if len(out.Glyphs) != len(buf.Info) {
		t.Fatalf("glyph count: got %d, want %d", len(out.Glyphs), len(buf.Info))
	}
	var advance fixed.Int26_6
	for i, info := range buf.Info {
		got := out.Glyphs[i]
		if info.Glyph == 0 {
			t.Fatalf("glyph %d is missing from the test font", i)
		}
		if got.GlyphID != info.Glyph || got.TextIndex() != info.Cluster || got.Mask != info.Mask {
			t.Errorf("glyph %d identity/cluster/mask differ from HarfBuzz: %+v vs %+v", i, got, info)
		}
		extents, ok := font.GlyphExtents(info.Glyph)
		if !ok {
			t.Fatalf("glyph %d has no test-font extents", i)
		}
		pos := buf.Pos[i]
		wantAdvance := fixed.Int26_6(pos.XAdvance)
		wantX, wantY := wantAdvance, fixed.Int26_6(0)
		if in.Direction.IsVertical() {
			wantAdvance = fixed.Int26_6(pos.YAdvance)
			wantX, wantY = 0, wantAdvance
		}
		for _, metric := range []struct {
			name      string
			got, want fixed.Int26_6
		}{
			{"advance", got.Advance, wantAdvance},
			{"xAdvance", got.XAdvance, wantX},
			{"yAdvance", got.YAdvance, wantY},
			{"xOffset", got.XOffset, fixed.Int26_6(pos.XOffset)},
			{"yOffset", got.YOffset, fixed.Int26_6(pos.YOffset)},
			{"xBearing", got.XBearing, fixed.Int26_6(extents.XBearing)},
			{"yBearing", got.YBearing, fixed.Int26_6(extents.YBearing)},
			{"width", got.Width, fixed.Int26_6(extents.Width)},
			{"height", got.Height, fixed.Int26_6(extents.Height)},
		} {
			if metric.got != metric.want {
				t.Errorf("glyph %d %s at scale %d: got %d, want %d raw 26.6", i, metric.name, scale, metric.got, metric.want)
			}
		}
		advance += wantAdvance
	}
	if out.Advance != advance {
		t.Errorf("run advance: got %d, want %d raw 26.6", out.Advance, advance)
	}
	extents := font.ExtentsForDirection(in.Direction.Harfbuzz())
	wantBounds := Bounds{
		Ascent:  fixed.Int26_6(extents.Ascender),
		Descent: fixed.Int26_6(extents.Descender),
		Gap:     fixed.Int26_6(extents.LineGap),
	}
	if out.LineBounds != wantBounds {
		t.Errorf("line bounds at scale %d: got %+v, want %+v raw 26.6", scale, out.LineBounds, wantBounds)
	}
}

func fractionalSizeScaleFontUnits(units int64, size fixed.Int26_6, upem uint16) fixed.Int26_6 {
	product := units * int64(size)
	denominator := int64(upem)
	if product < 0 {
		return -fixed.Int26_6((-product + denominator/2) / denominator)
	}
	return fixed.Int26_6((product + denominator/2) / denominator)
}
