// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Package fontresource validates embedded static TrueType data.
package fontresource

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"slices"

	"github.com/go-text/typesetting/font"
)

// Validate checks font bytes against caller-validated weight/style descriptors.
// Callers also own resource limits, hashes, licenses and family bindings.
func Validate(data []byte, weight int, style string) error {
	if len(data) < 12 || binary.BigEndian.Uint32(data[:4]) != 0x00010000 {
		return fmt.Errorf("only static single-face TrueType resources are supported")
	}
	count := int(binary.BigEndian.Uint16(data[4:6]))
	if count == 0 || count > 256 || count > (len(data)-12)/16 {
		return fmt.Errorf("invalid TrueType table directory")
	}
	var os2 []byte
	end := uint64(12 + count*16)
	previous := ""
	tables := map[string][]byte{}
	type tableRange struct{ start, end uint64 }
	ranges := []tableRange{}
	for i := 0; i < count; i++ {
		table := data[12+i*16 : 28+i*16]
		start, size := uint64(binary.BigEndian.Uint32(table[8:12])), uint64(binary.BigEndian.Uint32(table[12:16]))
		tag := string(table[:4])
		if tag <= previous || start%4 != 0 || start < end || size == 0 || start+size > uint64(len(data)) {
			return fmt.Errorf("TrueType table exceeds resource bounds")
		}
		for _, b := range table[:4] {
			if b < 32 || b > 126 {
				return fmt.Errorf("invalid TrueType table tag")
			}
		}
		previous = tag
		value := data[start : start+size]
		if checksum(value, tag == "head") != binary.BigEndian.Uint32(table[4:8]) {
			return fmt.Errorf("TrueType table checksum mismatch")
		}
		tables[tag] = value
		ranges = append(ranges, tableRange{start, start + size})
		switch tag {
		case "fvar", "gvar", "avar", "CFF ", "CFF2", "SVG ", "CBDT", "sbix", "COLR":
			return fmt.Errorf("variable or color fonts require a dedicated backend")
		case "OS/2":
			os2 = data[start : start+size]
		}
	}
	slices.SortFunc(ranges, func(a, b tableRange) int {
		if a.start < b.start {
			return -1
		}
		if a.start > b.start {
			return 1
		}
		return 0
	})
	for i := 1; i < len(ranges); i++ {
		if ranges[i].start < ranges[i-1].end {
			return fmt.Errorf("overlapping TrueType tables")
		}
	}
	if checksum(data, false) != 0xb1b0afba {
		return fmt.Errorf("global TrueType checksum mismatch")
	}
	for tag, minimum := range map[string]int{"head": 54, "hhea": 36, "maxp": 32, "OS/2": 78, "cmap": 4, "name": 6, "loca": 2, "glyf": 1, "hmtx": 4} {
		if len(tables[tag]) < minimum {
			return fmt.Errorf("missing TrueType table %s", tag)
		}
	}
	if len(os2) < 64 || int(binary.BigEndian.Uint16(os2[4:6])) != weight || (binary.BigEndian.Uint16(os2[62:64])&1 != 0) != (style == "italic") || binary.BigEndian.Uint16(os2[62:64])&512 != 0 {
		return fmt.Errorf("declared font weight/style does not match actual face")
	}
	if _, err := font.ParseTTF(bytes.NewReader(bytes.Clone(data))); err != nil {
		return fmt.Errorf("invalid TrueType glyph tables: %w", err)
	}
	return nil
}

func checksum(data []byte, head bool) uint32 {
	var result uint32
	for at := 0; at < len(data); at += 4 {
		var word uint32
		for i := 0; i < 4; i++ {
			word <<= 8
			if at+i < len(data) && !(head && at == 8) {
				word += uint32(data[at+i])
			}
		}
		result += word
	}
	return result
}
