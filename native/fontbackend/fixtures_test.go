// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontbackend_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/fontbackend"
)

type mutableResource struct {
	data  []byte
	reads int
}

func (*mutableResource) Name() string { panic("caller resource names must not be read") }
func (resource *mutableResource) Content() []byte {
	resource.reads++
	return resource.data
}

type uncomparableResource struct {
	data  []byte
	reads *int
}

func (uncomparableResource) Name() string { panic("caller resource names must not be read") }
func (resource uncomparableResource) Content() []byte {
	(*resource.reads)++
	return resource.data
}

func fontBytes(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile("../../example/public/fonts/NotoSans-" + name + ".ttf")
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func fontLicense(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile("../../example/public/fonts/LICENSE-NotoSans.txt")
	if err != nil || !strings.Contains(string(data), "SIL OPEN FONT LICENSE") {
		t.Fatalf("public font redistribution license is absent: %v", err)
	}
	return string(data)
}

func fontHash(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func regularStyle() webui.Style {
	return webui.Style{FontFamily: "Host", FontWeight: 400, FontStyle: "normal", FontSize: 14, LineHeight: 20, WhiteSpace: "nowrap", Color: "#112233", Opacity: 1}
}

func requireBackend(t *testing.T, fonts map[string]map[webui.Font]fyne.Resource) *fontbackend.Backend {
	t.Helper()
	backend, err := fontbackend.New(fonts)
	if err != nil {
		t.Fatal(err)
	}
	return backend
}

func regularBackend(t *testing.T) *fontbackend.Backend {
	t.Helper()
	return requireBackend(t, map[string]map[webui.Font]fyne.Resource{
		"Host": {{Weight: 400}: &mutableResource{data: fontBytes(t, "Regular")}},
	})
}

func mustPanic(t *testing.T, detail string, run func()) {
	t.Helper()
	defer func() {
		failure := recover()
		if failure == nil || !strings.Contains(fmt.Sprint(failure), detail) {
			t.Errorf("expected diagnostic containing %q, got %v", detail, failure)
		}
	}()
	run()
}

func paintedText(t *testing.T, object fyne.CanvasObject, content string) *canvas.Text {
	t.Helper()
	for _, child := range test.WidgetRenderer(object.(fyne.Widget)).Objects() {
		if text, ok := child.(*canvas.Text); ok && text.Text == content {
			return text
		}
	}
	t.Fatalf("native renderer has no text %q", content)
	return nil
}

type nominalMapping struct {
	scalar rune
	glyph  uint32
}

// Replace only cmap in the licensed fixture and repair its SFNT checksums.
func mappedFont(t *testing.T, mappings ...nominalMapping) []byte {
	t.Helper()
	data := bytes.Clone(fontBytes(t, "Regular"))
	sort.Slice(mappings, func(left, right int) bool { return mappings[left].scalar < mappings[right].scalar })
	cmap := make([]byte, 28+12*len(mappings))
	binary.BigEndian.PutUint16(cmap[2:4], 1)
	binary.BigEndian.PutUint16(cmap[4:6], 3)
	binary.BigEndian.PutUint16(cmap[6:8], 10)
	binary.BigEndian.PutUint32(cmap[8:12], 12)
	binary.BigEndian.PutUint16(cmap[12:14], 12)
	binary.BigEndian.PutUint32(cmap[16:20], uint32(len(cmap)-12))
	binary.BigEndian.PutUint32(cmap[24:28], uint32(len(mappings)))
	for index, mapping := range mappings {
		at := 28 + 12*index
		binary.BigEndian.PutUint32(cmap[at:at+4], uint32(mapping.scalar))
		binary.BigEndian.PutUint32(cmap[at+4:at+8], uint32(mapping.scalar))
		binary.BigEndian.PutUint32(cmap[at+8:at+12], mapping.glyph)
	}
	headAt, headOffset, headSize, cmapAt, cmapOffset, cmapSize := 0, 0, 0, 0, 0, 0
	for index := range int(binary.BigEndian.Uint16(data[4:6])) {
		at := 12 + index*16
		offset, size := int(binary.BigEndian.Uint32(data[at+8:at+12])), int(binary.BigEndian.Uint32(data[at+12:at+16]))
		switch string(data[at : at+4]) {
		case "head":
			headAt, headOffset, headSize = at, offset, size
		case "cmap":
			cmapAt, cmapOffset, cmapSize = at, offset, size
		}
	}
	if headAt == 0 || cmapAt == 0 || len(cmap) > cmapSize {
		t.Fatal("public font cannot hold the repaired cmap fixture")
	}
	clear(data[cmapOffset : cmapOffset+cmapSize])
	copy(data[cmapOffset:], cmap)
	binary.BigEndian.PutUint32(data[cmapAt+12:cmapAt+16], uint32(len(cmap)))
	binary.BigEndian.PutUint32(data[cmapAt+4:cmapAt+8], sfntChecksum(cmap))
	binary.BigEndian.PutUint32(data[headOffset+8:headOffset+12], 0)
	binary.BigEndian.PutUint32(data[headAt+4:headAt+8], sfntChecksum(data[headOffset:headOffset+headSize]))
	binary.BigEndian.PutUint32(data[headOffset+8:headOffset+12], 0xb1b0afba-sfntChecksum(data))
	return data
}

func sfntChecksum(data []byte) uint32 {
	var result uint32
	for at := 0; at < len(data); at += 4 {
		var word uint32
		for index := range 4 {
			word <<= 8
			if at+index < len(data) {
				word |= uint32(data[at+index])
			}
		}
		result += word
	}
	return result
}
