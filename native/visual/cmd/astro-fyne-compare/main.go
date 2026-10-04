// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Sytue. Licensed under Apache-2.0.

// astro-fyne-compare requires exact pixels unless tolerance is explicit.
package main

import (
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"hash/crc32"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"

	"github.com/thinkddr/astro-fyne/native/visual"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("astro-fyne-compare", flag.ContinueOnError)
	flags.SetOutput(stderr)
	referencePath := flags.String("reference", "", "browser PNG")
	nativePath := flags.String("native", "", "native canvas PNG")
	out := flags.String("out", "diff.png", "difference PNG")
	channel := flags.Uint("channel-tolerance", 0, "maximum accepted channel difference (0-255; default 0)")
	pixels := flags.Uint64("pixel-tolerance", 0, "pixels allowed above channel tolerance (default 0)")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() == 2 && *referencePath == "" && *nativePath == "" {
		*referencePath, *nativePath = flags.Arg(0), flags.Arg(1)
	} else if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: astro-fyne-compare --reference web.png --native native.png --out diff.png")
		return 2
	}
	if *referencePath == "" || *nativePath == "" || *out == "" || *channel > 255 {
		fmt.Fprintln(stderr, "two captures, an output path and channel tolerance between 0 and 255 are required")
		return 2
	}
	if samePath(*out, *referencePath) || samePath(*out, *nativePath) {
		fmt.Fprintln(stderr, "the diff cannot overwrite an input capture")
		return 2
	}
	reference, err := readPNG(*referencePath)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	native, err := readPNG(*nativePath)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	result, diff, err := visual.Compare(reference, native, visual.Tolerance{Channel: uint8(*channel), Pixels: *pixels})
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if err := writePNG(*out, diff); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if err := json.NewEncoder(stdout).Encode(result); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if !result.Accepted {
		return 1
	}
	return 0
}

func readPNG(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	var header [33]byte // PNG signature and complete IHDR, including CRC.
	if _, err := io.ReadFull(f, header[:]); err != nil {
		return nil, fmt.Errorf("read PNG header %s: %w", path, err)
	}
	if string(header[:8]) != "\x89PNG\r\n\x1a\n" || string(header[12:16]) != "IHDR" || binary.BigEndian.Uint32(header[8:12]) != 13 {
		return nil, fmt.Errorf("invalid PNG header in %s", path)
	}
	// Lower depths convert losslessly to 8 bits; 16-bit conversion loses detail.
	switch header[24] {
	case 1, 2, 4, 8:
	case 16:
		return nil, fmt.Errorf("PNG %s has 16-bit channels; captures must use at most 8 bits", path)
	default:
		return nil, fmt.Errorf("PNG %s has an invalid bit depth", path)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	config, err := png.DecodeConfig(f)
	if err != nil {
		return nil, fmt.Errorf("read PNG %s: %w", path, err)
	}
	if config.Width <= 0 || config.Height <= 0 || uint64(config.Width)*uint64(config.Height) > 100_000_000 {
		return nil, fmt.Errorf("PNG %s exceeds the 100-megapixel limit", path)
	}
	if _, err := f.Seek(8, io.SeekStart); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	if err := validatePNGChunks(f, path); err != nil {
		return nil, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	img, err := png.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}
	return img, nil
}

// image/png ignores animation and color management, so accept only known
// static chunks. tRNS affects decoded pixels and is supported.
// https://www.w3.org/TR/png-3/#4Concepts.ColorSpaces
func validatePNGChunks(reader io.Reader, path string) error {
	for {
		var header [8]byte
		if _, err := io.ReadFull(reader, header[:]); err != nil {
			return fmt.Errorf("read PNG chunks %s: %w", path, err)
		}
		length := int64(binary.BigEndian.Uint32(header[:4]))
		kind := string(header[4:])
		switch kind {
		case "IHDR", "PLTE", "tRNS", "IDAT", "IEND", "tEXt", "zTXt", "iTXt", "tIME", "pHYs":
		case "acTL", "fcTL", "fdAT":
			return fmt.Errorf("PNG %s contains %s: captures must be static, not APNG", path, kind)
		case "gAMA", "iCCP", "cHRM", "sRGB", "cICP", "mDCV", "cLLI", "eXIf", "sBIT", "bKGD":
			return fmt.Errorf("PNG %s contains %s: unsupported color, precision, background or orientation metadata", path, kind)
		default:
			return fmt.Errorf("PNG %s contains an unsupported chunk: %s", path, kind)
		}
		if kind == "IEND" && length != 0 {
			return fmt.Errorf("PNG %s contains a nonempty IEND", path)
		}
		checksum := crc32.NewIEEE()
		_, _ = checksum.Write(header[4:])
		if _, err := io.CopyN(checksum, reader, length); err != nil {
			return fmt.Errorf("read PNG chunk %s in %s: %w", kind, path, err)
		}
		var crc [4]byte
		if _, err := io.ReadFull(reader, crc[:]); err != nil {
			return fmt.Errorf("read PNG CRC %s in %s: %w", kind, path, err)
		}
		if checksum.Sum32() != binary.BigEndian.Uint32(crc[:]) {
			return fmt.Errorf("invalid PNG CRC for %s in %s", kind, path)
		}
		if kind == "IEND" {
			var trailing [1]byte
			if count, err := io.ReadFull(reader, trailing[:]); count != 0 || err != io.EOF {
				return fmt.Errorf("PNG %s contains trailing data after IEND", path)
			}
			return nil
		}
	}
}

func writePNG(path string, img image.Image) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".astro-fyne-diff-*.png")
	if err != nil {
		return fmt.Errorf("create diff: %w", err)
	}
	defer os.Remove(f.Name())
	if err := png.Encode(f, img); err != nil {
		_ = f.Close()
		return fmt.Errorf("write diff: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close diff: %w", err)
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return fmt.Errorf("save diff: %w", err)
	}
	return nil
}

func samePath(a, b string) bool {
	aa, errA := filepath.Abs(a)
	ab, errB := filepath.Abs(b)
	return errA == nil && errB == nil && aa == ab
}
