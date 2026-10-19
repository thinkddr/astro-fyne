// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontresource_test

import (
	"bytes"
	"encoding/binary"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/thinkddr/astro-fyne/native/fontresource"
)

func fontFixture(t *testing.T, name string) []byte {
	t.Helper()
	license, err := os.ReadFile("../../example/public/fonts/LICENSE-NotoSans.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(license, []byte("SIL OPEN FONT LICENSE Version 1.1")) {
		t.Fatal("public font fixture is missing its license notice")
	}
	data, err := os.ReadFile("../../example/public/fonts/NotoSans-" + name + ".ttf")
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func requireRejected(t *testing.T, data []byte, diagnostic string) {
	t.Helper()
	before := bytes.Clone(data)
	err := fontresource.Validate(data, 400, "normal")
	if err == nil || !strings.Contains(err.Error(), diagnostic) {
		t.Fatalf("expected %q, got %v", diagnostic, err)
	}
	if !bytes.Equal(data, before) {
		t.Fatal("validation changed rejected source bytes")
	}
}

func TestValidateLicensedStaticFacesWithoutChangingBytes(t *testing.T) {
	for _, face := range []struct {
		name   string
		weight int
	}{{"Regular", 400}, {"Bold", 700}} {
		t.Run(face.name, func(t *testing.T) {
			data := fontFixture(t, face.name)
			before := bytes.Clone(data)
			if err := fontresource.Validate(data, face.weight, "normal"); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(data, before) {
				t.Fatal("validation changed valid source bytes")
			}
		})
	}
	t.Run("repacked-Regular", func(t *testing.T) {
		data := assembleFont(t, fixtureTables(t))
		before := bytes.Clone(data)
		if err := fontresource.Validate(data, 400, "normal"); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(data, before) {
			t.Fatal("validation changed repacked source bytes")
		}
	})
}

func TestValidateRejectsSynthesizedFaces(t *testing.T) {
	for _, face := range []struct {
		name   string
		weight int
		style  string
	}{
		{"Regular", 700, "normal"},
		{"Regular", 400, "italic"},
		{"Bold", 400, "normal"},
		{"Bold", 700, "italic"},
	} {
		t.Run(face.name+"/"+face.style+"/"+strconv.Itoa(face.weight), func(t *testing.T) {
			data := fontFixture(t, face.name)
			before := bytes.Clone(data)
			err := fontresource.Validate(data, face.weight, face.style)
			if err == nil || !strings.Contains(err.Error(), "declared font weight/style") {
				t.Fatalf("synthesized face was accepted: %v", err)
			}
			if !bytes.Equal(data, before) {
				t.Fatal("face mismatch changed source bytes")
			}
		})
	}
}

func TestValidateRejectsOtherFontContainers(t *testing.T) {
	for _, signature := range []string{"wOFF", "wOF2", "OTTO", "ttcf"} {
		t.Run(signature, func(t *testing.T) {
			data := fontFixture(t, "Regular")
			copy(data[:4], signature)
			requireRejected(t, data, "static single-face TrueType")
		})
	}
	for _, data := range [][]byte{nil, {}, {0, 1, 0, 0}, make([]byte, 11)} {
		requireRejected(t, data, "static single-face TrueType")
	}
}

func TestValidateRejectsMalformedDirectories(t *testing.T) {
	for _, test := range []struct {
		name       string
		diagnostic string
		mutate     func([]byte) []byte
	}{
		{"empty", "invalid TrueType table directory", func(data []byte) []byte {
			binary.BigEndian.PutUint16(data[4:6], 0)
			return data
		}},
		{"too-many", "invalid TrueType table directory", func(data []byte) []byte {
			binary.BigEndian.PutUint16(data[4:6], 257)
			return data
		}},
		{"truncated", "invalid TrueType table directory", func(data []byte) []byte {
			count := int(binary.BigEndian.Uint16(data[4:6]))
			return data[:12+16*count-1]
		}},
		{"duplicate-tag", "resource bounds", func(data []byte) []byte {
			copy(data[28:32], data[12:16])
			return data
		}},
		{"unsorted-tags", "resource bounds", func(data []byte) []byte {
			first := bytes.Clone(data[12:28])
			copy(data[12:28], data[28:44])
			copy(data[28:44], first)
			return data
		}},
		{"non-printable-tag", "invalid TrueType table tag", func(data []byte) []byte {
			data[15] = 31
			return data
		}},
		{"unaligned-table", "resource bounds", func(data []byte) []byte {
			start := binary.BigEndian.Uint32(data[20:24])
			binary.BigEndian.PutUint32(data[20:24], start+1)
			return data
		}},
		{"table-inside-directory", "resource bounds", func(data []byte) []byte {
			binary.BigEndian.PutUint32(data[20:24], 12)
			return data
		}},
		{"empty-table", "resource bounds", func(data []byte) []byte {
			binary.BigEndian.PutUint32(data[24:28], 0)
			return data
		}},
		{"table-past-end", "resource bounds", func(data []byte) []byte {
			binary.BigEndian.PutUint32(data[24:28], uint32(len(data)))
			return data
		}},
		{"large-offset", "resource bounds", func(data []byte) []byte {
			binary.BigEndian.PutUint32(data[20:24], 0xfffffffc)
			binary.BigEndian.PutUint32(data[24:28], 8)
			return data
		}},
		{"overlapping-tables", "overlapping TrueType tables", func(data []byte) []byte {
			copy(data[32:44], data[16:28])
			return data
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			requireRejected(t, test.mutate(fontFixture(t, "Regular")), test.diagnostic)
		})
	}
}

func TestValidateRejectsCorruptChecksums(t *testing.T) {
	t.Run("table-bytes", func(t *testing.T) {
		data := fontFixture(t, "Regular")
		start := binary.BigEndian.Uint32(data[20:24])
		data[start] ^= 1
		requireRejected(t, data, "table checksum mismatch")
	})
	t.Run("directory-checksum", func(t *testing.T) {
		data := fontFixture(t, "Regular")
		data[19] ^= 1
		requireRejected(t, data, "table checksum mismatch")
	})
	t.Run("global-adjustment", func(t *testing.T) {
		data := fontFixture(t, "Regular")
		count := int(binary.BigEndian.Uint16(data[4:6]))
		for at := 12; at < 12+16*count; at += 16 {
			if string(data[at:at+4]) == "head" {
				start := binary.BigEndian.Uint32(data[at+8 : at+12])
				data[start+11] ^= 1
				requireRejected(t, data, "global TrueType checksum mismatch")
				return
			}
		}
		t.Fatal("fixture has no head table")
	})
}

func TestValidateRejectsVariableAndColorTables(t *testing.T) {
	for _, tag := range []string{"avar", "fvar", "gvar", "CFF ", "CFF2", "SVG ", "CBDT", "sbix", "COLR"} {
		t.Run(strings.TrimSpace(tag), func(t *testing.T) {
			tables := fixtureTables(t)
			tables[tag] = []byte{0, 0, 0, 0}
			requireRejected(t, assembleFont(t, tables), "variable or color fonts require a dedicated backend")
		})
	}
}

func TestValidateRequiresCoreTables(t *testing.T) {
	for _, tag := range []string{"hhea", "maxp", "OS/2", "cmap", "name", "loca", "glyf", "hmtx"} {
		t.Run(tag, func(t *testing.T) {
			tables := fixtureTables(t)
			delete(tables, tag)
			requireRejected(t, assembleFont(t, tables), "missing TrueType table "+tag)
		})
	}
	t.Run("short-head", func(t *testing.T) {
		tables := fixtureTables(t)
		tables["head"] = tables["head"][:53]
		requireRejected(t, assembleFont(t, tables), "missing TrueType table head")
	})
}

func TestValidateRejectsUnsupportedFaceMetadata(t *testing.T) {
	tables := fixtureTables(t)
	selection := binary.BigEndian.Uint16(tables["OS/2"][62:64])
	binary.BigEndian.PutUint16(tables["OS/2"][62:64], selection|512)
	requireRejected(t, assembleFont(t, tables), "declared font weight/style")
}

func TestValidateRejectsMalformedRequiredTablesAfterChecksums(t *testing.T) {
	t.Run("truncated-cmap-record", func(t *testing.T) {
		tables := fixtureTables(t)
		tables["cmap"] = []byte{0, 0, 0, 1}
		requireRejected(t, assembleFont(t, tables), "invalid TrueType glyph tables")
	})
	t.Run("unsupported-maxp-version", func(t *testing.T) {
		tables := fixtureTables(t)
		binary.BigEndian.PutUint32(tables["maxp"][:4], 0x00020000)
		requireRejected(t, assembleFont(t, tables), "invalid TrueType glyph tables")
	})
}

func fixtureTables(t *testing.T) map[string][]byte {
	t.Helper()
	data := fontFixture(t, "Regular")
	count := int(binary.BigEndian.Uint16(data[4:6]))
	tables := make(map[string][]byte, count)
	for at := 12; at < 12+16*count; at += 16 {
		start := binary.BigEndian.Uint32(data[at+8 : at+12])
		size := binary.BigEndian.Uint32(data[at+12 : at+16])
		tables[string(data[at:at+4])] = bytes.Clone(data[start : start+size])
	}
	return tables
}

// Assemble independently checksummed fixtures to reach semantic validation.
func assembleFont(t *testing.T, tables map[string][]byte) []byte {
	t.Helper()
	tags := make([]string, 0, len(tables))
	for tag := range tables {
		tags = append(tags, tag)
	}
	sort.Strings(tags)
	data := make([]byte, 12+16*len(tags))
	binary.BigEndian.PutUint32(data[:4], 0x00010000)
	binary.BigEndian.PutUint16(data[4:6], uint16(len(tags)))
	power, selector := 1, 0
	for power*2 <= len(tags) {
		power *= 2
		selector++
	}
	binary.BigEndian.PutUint16(data[6:8], uint16(power*16))
	binary.BigEndian.PutUint16(data[8:10], uint16(selector))
	binary.BigEndian.PutUint16(data[10:12], uint16(len(tags)*16-power*16))
	head := -1
	for i, tag := range tags {
		value := bytes.Clone(tables[tag])
		if tag == "head" {
			if len(value) < 12 {
				t.Fatal("fixture builder needs the head checksum field")
			}
			clear(value[8:12])
			head = len(data)
		}
		record := data[12+i*16 : 28+i*16]
		copy(record[:4], tag)
		binary.BigEndian.PutUint32(record[4:8], sfntSum(value))
		binary.BigEndian.PutUint32(record[8:12], uint32(len(data)))
		binary.BigEndian.PutUint32(record[12:16], uint32(len(value)))
		data = append(data, value...)
		data = append(data, make([]byte, (4-len(data)%4)%4)...)
	}
	if head < 0 {
		t.Fatal("fixture builder needs a head table")
	}
	binary.BigEndian.PutUint32(data[head+8:head+12], 0xb1b0afba-sfntSum(data))
	return data
}

func sfntSum(data []byte) uint32 {
	padded := append(bytes.Clone(data), make([]byte, (4-len(data)%4)%4)...)
	var sum uint32
	for at := 0; at < len(padded); at += 4 {
		sum += binary.BigEndian.Uint32(padded[at : at+4])
	}
	return sum
}
