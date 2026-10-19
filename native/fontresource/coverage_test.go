// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontresource_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime/debug"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"github.com/thinkddr/astro-fyne/native/fontresource"
)

func TestCoverageBuildContract(t *testing.T) {
	info, identified := debug.ReadBuildInfo()
	count, version, replaced := 0, "", false
	localReplacements := []string{}
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
					localReplacements = append(localReplacements, path)
				}
			}
		}
	}
	qualified := identified && count == 1 && version == "v0.3.4" && !replaced
	data := fontFixture(t, "Regular")
	before := bytes.Clone(data)
	face, err := fontresource.NewStaticFace(data, 400, "normal")
	if !bytes.Equal(data, before) {
		t.Fatal("build contract validation changed the licensed font bytes")
	}
	if qualified {
		if err != nil || face == nil {
			t.Fatalf("qualified parser build failed coverage construction: %v", err)
		}
		if face.Profile().Parser != "github.com/go-text/typesetting@"+version || !face.Contains('A') || face.ValidateText("Hello") != nil {
			t.Fatal("qualified parser build returned an unbound coverage profile")
		}
		t.Log("qualified parser build admitted")
		return
	}
	if err == nil || face != nil {
		t.Fatal("unqualified parser build advertised a coverage face")
	}
	for _, path := range localReplacements {
		if path != "" && strings.Contains(err.Error(), path) {
			t.Fatal("unqualified parser diagnostic exposed a local replacement path")
		}
	}
	if !strings.HasPrefix(err.Error(), "fontresource: coverage ") {
		t.Fatal("unqualified parser build did not return the generic coverage diagnostic")
	}
	t.Log("unqualified parser build rejected")
}

func TestStaticFaceLicensedFacesAndParserIdentity(t *testing.T) {
	module, err := os.ReadFile("../go.mod")
	if err != nil {
		t.Fatal(err)
	}
	parser := ""
	for _, line := range strings.Split(string(module), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == "github.com/go-text/typesetting" {
			parser = fields[0] + "@" + fields[1]
		}
	}
	if parser == "" {
		t.Fatal("font parser pin is missing from go.mod")
	}
	for _, descriptor := range []struct {
		name   string
		weight int
	}{{"Regular", 400}, {"Bold", 700}} {
		t.Run(descriptor.name, func(t *testing.T) {
			data := fontFixture(t, descriptor.name)
			before := bytes.Clone(data)
			face, err := fontresource.NewStaticFace(data, descriptor.weight, "normal")
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(data, before) {
				t.Fatal("coverage construction changed the licensed font bytes")
			}
			if !face.Contains('A') || !face.Contains('é') || face.Contains(utf8.MaxRune) {
				t.Fatal("unexpected public font coverage")
			}
			if err := face.ValidateText("Hello café"); err != nil {
				t.Fatal(err)
			}
			if err := face.ValidateText(string(utf8.MaxRune)); err == nil || !strings.Contains(err.Error(), "U+10FFFF") {
				t.Fatalf("missing supplementary glyph was accepted: %v", err)
			}
			profile := face.Profile()
			digest := sha256.Sum256(data)
			if profile.Schema != 1 || profile.FontHash != hex.EncodeToString(digest[:]) || profile.Weight != descriptor.weight || profile.Style != "normal" || profile.Parser != parser {
				t.Fatalf("coverage identity differs from source/parser: %+v", profile)
			}
			if len(profile.Ranges) == 0 {
				t.Fatal("public font has no scalar ranges")
			}
			for index, interval := range profile.Ranges {
				if interval.Start > interval.End || interval.End > utf8.MaxRune || interval.Start <= 0xdfff && interval.End >= 0xd800 || index > 0 && profile.Ranges[index-1].End+1 >= interval.Start {
					t.Fatalf("coverage ranges are not minimal disjoint scalar intervals: %+v", interval)
				}
			}
		})
	}
}

func TestStaticFaceUsesSelectedNominalMappingsAndMergesAdjacentScalars(t *testing.T) {
	data := coverageFont(t, []coverageGroup{
		{0, 0, 1},
		{'A', 'B', 1},
		{'C', 'C', 4},
		{'E', 'F', 0},
		{'G', 'G', 8},
		{0xfffd, 0xfffd, 1},
		{0x1f642, 0x1f642, 2},
		{utf8.MaxRune, utf8.MaxRune, 3},
	})
	before := bytes.Clone(data)
	face, err := fontresource.NewStaticFace(data, 400, "normal")
	if err != nil {
		t.Fatal(err)
	}
	want := []fontresource.ScalarRange{{Start: 0, End: 0}, {Start: 'A', End: 'C'}, {Start: 'F', End: 'G'}, {Start: 0xfffd, End: 0xfffd}, {Start: 0x1f642, End: 0x1f642}, {Start: utf8.MaxRune, End: utf8.MaxRune}}
	if !reflect.DeepEqual(face.Profile().Ranges, want) {
		t.Fatalf("selected mappings changed: %+v", face.Profile().Ranges)
	}
	for _, scalar := range []rune{0, 'A', 'B', 'C', 'F', 'G', 0xfffd, 0x1f642, utf8.MaxRune} {
		if !face.Contains(scalar) {
			t.Fatalf("mapped empty-outline glyph was lost: U+%04X", scalar)
		}
	}
	for _, scalar := range []rune{'D', 'E', 0x1f680, -1, 0xd800, 0xdfff, utf8.MaxRune + 1} {
		if face.Contains(scalar) {
			t.Fatalf("missing glyph or invalid scalar was admitted: U+%04X", scalar)
		}
	}
	if err := face.ValidateText("\x00ABCFG\ufffd\U0001f642" + string(utf8.MaxRune)); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"AD", "AE", "\U0001f680"} {
		if err := face.ValidateText(text); err == nil || !strings.Contains(err.Error(), "missing glyph") {
			t.Fatalf("missing nominal mapping was accepted: %q %v", text, err)
		}
	}
	for _, text := range []string{string([]byte{0xff}), string([]byte{0xc0, 0xaf}), string([]byte{0xed, 0xa0, 0x80}), string([]byte{0xf4, 0x90, 0x80, 0x80}), string([]byte{0xf0, 0x9f})} {
		if err := face.ValidateText(text); err == nil || !strings.Contains(err.Error(), "UTF-8") {
			t.Fatalf("invalid UTF-8 was accepted: %x %v", []byte(text), err)
		}
	}
	if !bytes.Equal(data, before) {
		t.Fatal("coverage lookup changed its source font")
	}
}

func TestStaticFaceSkipsSurrogatesWithoutJoiningTheirNeighbors(t *testing.T) {
	face, err := fontresource.NewStaticFace(coverageFont(t, []coverageGroup{
		{0xd7ff, 0xd7ff, 1},
		{0xd800, 0xdfff, 1},
		{0xe000, 0xe000, 2},
	}), 400, "normal")
	if err != nil {
		t.Fatal(err)
	}
	want := []fontresource.ScalarRange{{Start: 0xd7ff, End: 0xd7ff}, {Start: 0xe000, End: 0xe000}}
	if !reflect.DeepEqual(face.Profile().Ranges, want) {
		t.Fatalf("surrogate gap was advertised: %+v", face.Profile().Ranges)
	}
	for scalar := rune(0xd800); scalar <= 0xdfff; scalar++ {
		if face.Contains(scalar) {
			t.Fatalf("surrogate U+%04X was admitted", scalar)
		}
	}
}

func TestStaticFaceRejectsSelectedGlyphsOutsideMaxpCount(t *testing.T) {
	tables := indexTables(t, 1)
	glyphs := uint32(binary.BigEndian.Uint16(tables["maxp"][4:6]))
	for _, glyph := range []uint32{glyphs, glyphs + 1, 0xffffffff} {
		data := coverageFont(t, []coverageGroup{{'A', 'A', glyph}})
		before := bytes.Clone(data)
		face, err := fontresource.NewStaticFace(data, 400, "normal")
		if err == nil || face != nil || !strings.Contains(err.Error(), "U+0041 maps to glyph") || !strings.Contains(err.Error(), "outside") {
			t.Fatalf("out-of-range selected glyph %d was advertised: %v", glyph, err)
		}
		if !bytes.Equal(data, before) {
			t.Fatal("rejected coverage construction changed source bytes")
		}
	}
}

func TestStaticFaceEmptyCoverageIsPortable(t *testing.T) {
	face, err := fontresource.NewStaticFace(coverageFont(t, []coverageGroup{{'A', 'A', 0}}), 400, "normal")
	if err != nil {
		t.Fatal(err)
	}
	if face.Contains('A') || face.Profile().Ranges == nil || len(face.Profile().Ranges) != 0 {
		t.Fatal("glyph zero was advertised as coverage")
	}
	if err := face.ValidateText(""); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(face.Profile())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte(`"ranges":[]`)) {
		t.Fatalf("empty scalar ranges lost their array representation: %s", encoded)
	}
}

func TestStaticFaceAcceptsTheByteLimit(t *testing.T) {
	data := make([]byte, 20*1024*1024)
	copy(data, fontFixture(t, "Regular"))
	before := bytes.Clone(data)
	face, err := fontresource.NewStaticFace(data, 400, "normal")
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	if face.Profile().FontHash != hex.EncodeToString(digest[:]) || !face.Contains('A') || !bytes.Equal(data, before) {
		t.Fatal("the exact byte limit changed coverage, identity or input bytes")
	}
}

func TestStaticFaceOwnsProfilesAndSupportsConcurrentReads(t *testing.T) {
	data := coverageFont(t, []coverageGroup{{'A', 'C', 1}})
	before := bytes.Clone(data)
	face, err := fontresource.NewStaticFace(data, 400, "normal")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, before) {
		t.Fatal("coverage construction modified caller storage")
	}
	want := face.Profile()
	data[0] ^= 0xff
	var workers sync.WaitGroup
	for index := 0; index < 4; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for iteration := 0; iteration < 100; iteration++ {
				profile := face.Profile()
				if !reflect.DeepEqual(profile, want) || !face.Contains('B') || face.Contains('D') || face.ValidateText("ABC") != nil {
					t.Error("immutable coverage changed between readers")
					return
				}
				profile.Ranges[0] = fontresource.ScalarRange{Start: 0, End: utf8.MaxRune}
				profile.FontHash, profile.Weight, profile.Style, profile.Parser, profile.Schema = "changed", 700, "italic", "changed", 2
			}
		}()
	}
	workers.Wait()
	if !reflect.DeepEqual(face.Profile(), want) || face.Contains('D') {
		t.Fatal("profile or caller mutation changed private coverage")
	}
}

func TestStaticFaceRequiresExplicitDescriptorsAndValidatedBytes(t *testing.T) {
	regular := fontFixture(t, "Regular")
	for _, descriptor := range []struct {
		weight int
		style  string
	}{{0, "normal"}, {600, "normal"}, {400, ""}, {400, "Normal"}, {400, "oblique"}} {
		if _, err := fontresource.NewStaticFace(regular, descriptor.weight, descriptor.style); err == nil || !strings.Contains(err.Error(), "weight 400/700") {
			t.Fatalf("invalid descriptor was accepted: %+v %v", descriptor, err)
		}
	}
	for _, descriptor := range []struct {
		weight int
		style  string
	}{{700, "normal"}, {400, "italic"}} {
		if _, err := fontresource.NewStaticFace(regular, descriptor.weight, descriptor.style); err == nil || !strings.Contains(err.Error(), "declared font weight/style") {
			t.Fatalf("mismatched descriptor was accepted: %+v %v", descriptor, err)
		}
	}
	for _, data := range [][]byte{nil, {}, make([]byte, 20*1024*1024+1)} {
		if _, err := fontresource.NewStaticFace(data, 400, "normal"); err == nil || !strings.Contains(err.Error(), "1..20MiB") {
			t.Fatalf("invalid font size was accepted: %d %v", len(data), err)
		}
	}
	if _, err := fontresource.NewStaticFace([]byte("not a font"), 400, "normal"); err == nil || !strings.Contains(err.Error(), "invalid static face") {
		t.Fatalf("invalid font bytes were accepted: %v", err)
	}
	broken := bytes.Clone(regular)
	broken[len(broken)-1] ^= 1
	if _, err := fontresource.NewStaticFace(broken, 400, "normal"); err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Fatalf("unchecked font data was accepted: %v", err)
	}
	var empty fontresource.StaticFace
	for _, face := range []*fontresource.StaticFace{nil, &empty} {
		if face.Contains('A') || face.ValidateText("") == nil || face.Profile().Schema != 0 {
			t.Fatal("unconstructed face advertised a coverage profile")
		}
	}
}

type coverageGroup struct {
	start uint32
	end   uint32
	glyph uint32
}

func coverageFont(t *testing.T, groups []coverageGroup) []byte {
	t.Helper()
	tables := indexTables(t, 1)
	cmap := make([]byte, 28+12*len(groups))
	binary.BigEndian.PutUint16(cmap[2:4], 1)
	binary.BigEndian.PutUint16(cmap[4:6], 3)
	binary.BigEndian.PutUint16(cmap[6:8], 10)
	binary.BigEndian.PutUint32(cmap[8:12], 12)
	binary.BigEndian.PutUint16(cmap[12:14], 12)
	binary.BigEndian.PutUint32(cmap[16:20], uint32(len(cmap)-12))
	binary.BigEndian.PutUint32(cmap[24:28], uint32(len(groups)))
	for index, group := range groups {
		if group.start > group.end || index > 0 && groups[index-1].end >= group.start {
			t.Fatal("coverage fixture groups must be ordered and disjoint")
		}
		at := 28 + index*12
		binary.BigEndian.PutUint32(cmap[at : at+4], group.start)
		binary.BigEndian.PutUint32(cmap[at+4 : at+8], group.end)
		binary.BigEndian.PutUint32(cmap[at+8 : at+12], group.glyph)
	}
	tables["cmap"] = cmap
	return assembleFont(t, tables)
}
