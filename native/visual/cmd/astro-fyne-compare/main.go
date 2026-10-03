// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Sytue. Licensed under Apache-2.0.

// astro-fyne-compare exige paridad píxel a píxel salvo tolerancia explícita.
package main

import (
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
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
	referencePath := flags.String("reference", "", "PNG del navegador")
	nativePath := flags.String("native", "", "PNG del lienzo nativo")
	out := flags.String("out", "diff.png", "PNG de diferencias")
	channel := flags.Uint("channel-tolerance", 0, "diferencia máxima de canal aceptada (0–255; predeterminado 0)")
	pixels := flags.Uint64("pixel-tolerance", 0, "píxeles que pueden superar la tolerancia de canal (predeterminado 0)")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() == 2 && *referencePath == "" && *nativePath == "" {
		*referencePath, *nativePath = flags.Arg(0), flags.Arg(1)
	} else if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "uso: astro-fyne-compare --reference web.png --native native.png --out diff.png")
		return 2
	}
	if *referencePath == "" || *nativePath == "" || *out == "" || *channel > 255 {
		fmt.Fprintln(stderr, "se necesitan dos capturas, una salida y tolerancia de canal entre 0 y 255")
		return 2
	}
	if samePath(*out, *referencePath) || samePath(*out, *nativePath) {
		fmt.Fprintln(stderr, "el diff no puede sobrescribir una captura de entrada")
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
		return nil, fmt.Errorf("abrir %s: %w", path, err)
	}
	defer f.Close()
	var header [33]byte // firma PNG + IHDR completo, incluida su CRC.
	if _, err := io.ReadFull(f, header[:]); err != nil {
		return nil, fmt.Errorf("leer cabecera PNG %s: %w", path, err)
	}
	if string(header[:8]) != "\x89PNG\r\n\x1a\n" || string(header[12:16]) != "IHDR" || binary.BigEndian.Uint32(header[8:12]) != 13 {
		return nil, fmt.Errorf("cabecera PNG inválida en %s", path)
	}
	// Las profundidades inferiores representan sus valores sin pérdida en ocho
	// bits. Reducir dieciséis a ocho podría ocultar un cambio de un bit bajo.
	switch header[24] {
	case 1, 2, 4, 8:
	case 16:
		return nil, fmt.Errorf("PNG %s tiene 16 bits por canal; el gate exige capturas de hasta 8 bits", path)
	default:
		return nil, fmt.Errorf("PNG %s tiene una profundidad de bits inválida", path)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("leer %s: %w", path, err)
	}
	config, err := png.DecodeConfig(f)
	if err != nil {
		return nil, fmt.Errorf("leer PNG %s: %w", path, err)
	}
	if config.Width <= 0 || config.Height <= 0 || uint64(config.Width)*uint64(config.Height) > 100_000_000 {
		return nil, fmt.Errorf("PNG %s fuera del límite de 100 megapíxeles", path)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("leer %s: %w", path, err)
	}
	img, err := png.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("decodificar %s: %w", path, err)
	}
	return img, nil
}

func writePNG(path string, img image.Image) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".astro-fyne-diff-*.png")
	if err != nil {
		return fmt.Errorf("crear diff: %w", err)
	}
	defer os.Remove(f.Name())
	if err := png.Encode(f, img); err != nil {
		_ = f.Close()
		return fmt.Errorf("escribir diff: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("cerrar diff: %w", err)
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return fmt.Errorf("guardar diff: %w", err)
	}
	return nil
}

func samePath(a, b string) bool {
	aa, errA := filepath.Abs(a)
	ab, errB := filepath.Abs(b)
	return errA == nil && errB == nil && aa == ab
}
