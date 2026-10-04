// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Sytue. Licensed under Apache-2.0.

package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/thinkddr/astro-fyne/native/visual"
)

func TestCLIRejectsOneChangedPixelAndWritesDiff(t *testing.T) {
	dir := t.TempDir()
	referencePath, nativePath, diffPath := filepath.Join(dir, "web.png"), filepath.Join(dir, "native.png"), filepath.Join(dir, "diff.png")
	web, native := image.NewNRGBA(image.Rect(0, 0, 2, 2)), image.NewNRGBA(image.Rect(0, 0, 2, 2))
	native.SetNRGBA(1, 1, color.NRGBA{A: 1})
	if err := writePNG(referencePath, web); err != nil {
		t.Fatal(err)
	}
	if err := writePNG(nativePath, native); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	code := run([]string{"--reference", referencePath, "--native", nativePath, "--out", diffPath}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("the process should fail on a difference: %d, %s", code, stderr.String())
	}
	var result visual.Result
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil || result.Exact || result.Accepted || result.ChangedPixels != 1 {
		t.Fatalf("incorrect report: %+v, %v", result, err)
	}
	if _, err := readPNG(diffPath); err != nil {
		t.Fatalf("the diff should be saved even when comparison fails: %v", err)
	}
}

func insertPNGChunk(encoded []byte, kind string, data []byte, afterPixels bool) []byte {
	chunk := make([]byte, len(data)+12)
	binary.BigEndian.PutUint32(chunk[:4], uint32(len(data)))
	copy(chunk[4:8], kind)
	copy(chunk[8:], data)
	binary.BigEndian.PutUint32(chunk[len(chunk)-4:], crc32.ChecksumIEEE(chunk[4:len(chunk)-4]))
	position := 33 // After IHDR, before IDAT.
	if afterPixels {
		position = len(encoded) - 12 // Before IEND, after IDAT.
	}
	result := append([]byte{}, encoded[:position]...)
	result = append(result, chunk...)
	return append(result, encoded[position:]...)
}

func staticPNG(t *testing.T) []byte {
	t.Helper()
	var encoded bytes.Buffer
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	img.SetNRGBA(1, 1, color.NRGBA{R: 100, G: 50, B: 25, A: 127})
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func TestCLIRejectsIgnoredMetadataEvenWhenPixelsMatch(t *testing.T) {
	// Valid CRCs isolate ignored metadata from pixel decoding errors.
	for _, kind := range []string{"acTL", "fcTL", "fdAT", "gAMA", "iCCP", "cHRM", "sRGB", "cICP", "mDCV", "cLLI", "eXIf", "sBIT", "bKGD", "vpAg"} {
		for _, afterPixels := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s-after-pixels-%v", kind, afterPixels), func(t *testing.T) {
				dir := t.TempDir()
				encoded := staticPNG(t)
				data := []byte{0, 0, 0, 2, 0, 0, 0, 0}
				marked := insertPNGChunk(encoded, kind, data, afterPixels)
				decoded, err := png.Decode(bytes.NewReader(marked))
				if err != nil {
					t.Fatalf("the standard decoder should demonstrate ignored metadata: %v", err)
				}
				plain, err := png.Decode(bytes.NewReader(encoded))
				if err != nil {
					t.Fatal(err)
				}
				result, _, err := visual.Compare(plain, decoded, visual.Tolerance{})
				if err != nil || !result.Exact {
					t.Fatalf("the negative fixture must retain its original channels: %+v, %v", result, err)
				}
				for _, markedSide := range []string{"reference", "native"} {
					referencePath, nativePath, diffPath := filepath.Join(dir, "web.png"), filepath.Join(dir, "native.png"), filepath.Join(dir, "diff.png")
					web, native := encoded, encoded
					if markedSide == "reference" {
						web = marked
					} else {
						native = marked
					}
					if err := os.WriteFile(referencePath, web, 0600); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(nativePath, native, 0600); err != nil {
						t.Fatal(err)
					}
					var stdout, stderr bytes.Buffer
					code := run([]string{"--reference", referencePath, "--native", nativePath, "--out", diffPath}, &stdout, &stderr)
					if code != 2 || stdout.Len() != 0 || !strings.Contains(stderr.String(), kind) {
						t.Fatalf("%s %s must not claim parity: code %d, stdout %s, stderr %s", markedSide, kind, code, stdout.String(), stderr.String())
					}
					if _, err := os.Stat(diffPath); !os.IsNotExist(err) {
						t.Fatalf("rejection must not produce a diff: %v", err)
					}
				}
			})
		}
	}
}

func TestCLIAllowsRGBAWithDescriptiveMetadata(t *testing.T) {
	dir := t.TempDir()
	encoded := staticPNG(t)
	referencePath, nativePath, diffPath := filepath.Join(dir, "web.png"), filepath.Join(dir, "native.png"), filepath.Join(dir, "diff.png")
	annotated := insertPNGChunk(encoded, "tEXt", []byte("Comment\x00Captured by CI"), false)
	if err := os.WriteFile(referencePath, annotated, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(nativePath, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if code := run([]string{"--reference", referencePath, "--native", nativePath, "--out", diffPath}, &stdout, &stderr); code != 0 {
		t.Fatalf("static RGBA PNG should remain supported: %d, %s", code, stderr.String())
	}
	var result visual.Result
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil || !result.Exact || !result.Accepted || result.ChangedPixels != 0 {
		t.Fatalf("descriptive metadata must not change RGBA samples: %+v, %v", result, err)
	}
}

func TestCLIRejectsTrailingDataAfterIEND(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "trailing.png")
	if err := os.WriteFile(path, append(staticPNG(t), []byte("hidden frame")...), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readPNG(path); err == nil {
		t.Fatal("PNG payload after IEND violates the static image contract")
	}
}

func TestCLIDoesNotOverwriteReference(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"--reference", "web.png", "--native", "native.png", "--out", "web.png"}, &stdout, &stderr); code != 2 {
		t.Fatalf("overwriting the reference is a usage error: %d", code)
	}
}

func TestCLIRejects16BitChannelsWithoutClaimingParity(t *testing.T) {
	dir := t.TempDir()
	referencePath, nativePath, diffPath := filepath.Join(dir, "web16.png"), filepath.Join(dir, "native16.png"), filepath.Join(dir, "diff.png")
	web, native := image.NewNRGBA64(image.Rect(0, 0, 1, 1)), image.NewNRGBA64(image.Rect(0, 0, 1, 1))
	web.SetNRGBA64(0, 0, color.NRGBA64{R: 0x0101, A: 0xffff})
	native.SetNRGBA64(0, 0, color.NRGBA64{R: 0x0102, A: 0xffff})
	if err := writePNG(referencePath, web); err != nil {
		t.Fatal(err)
	}
	if err := writePNG(nativePath, native); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if code := run([]string{"--reference", referencePath, "--native", nativePath, "--out", diffPath}, &stdout, &stderr); code != 2 {
		t.Fatalf("16-bit channels must be rejected before comparison: %d, %s", code, stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("a rejected format cannot publish an equality report: %s", stdout.String())
	}
	if _, err := os.Stat(diffPath); !os.IsNotExist(err) {
		t.Fatalf("a rejected format must not produce a diff: %v", err)
	}
}
