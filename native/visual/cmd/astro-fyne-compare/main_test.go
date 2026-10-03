// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Sytue. Licensed under Apache-2.0.

package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"os"
	"path/filepath"
	"testing"

	"github.com/thinkddr/astro-fyne/native/visual"
)

func TestCLIRechazaUnPixelYCreaElDiff(t *testing.T) {
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
		t.Fatalf("el proceso debe fallar por la diferencia: %d, %s", code, stderr.String())
	}
	var result visual.Result
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil || result.Exact || result.Accepted || result.ChangedPixels != 1 {
		t.Fatalf("informe incorrecto: %+v, %v", result, err)
	}
	if _, err := readPNG(diffPath); err != nil {
		t.Fatalf("debe guardar el diff incluso cuando falla el gate: %v", err)
	}
}

func TestCLINoSobrescribeLaReferencia(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"--reference", "web.png", "--native", "native.png", "--out", "web.png"}, &stdout, &stderr); code != 2 {
		t.Fatalf("sobrescribir la referencia es un error de uso: %d", code)
	}
}

func TestCLIRechaza16BitsSinDeclararParidad(t *testing.T) {
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
		t.Fatalf("dieciséis bits deben rechazarse antes de comparar: %d, %s", code, stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("un formato rechazado no puede publicar un informe de igualdad: %s", stdout.String())
	}
	if _, err := os.Stat(diffPath); !os.IsNotExist(err) {
		t.Fatalf("el formato rechazado no debe generar un diff: %v", err)
	}
}
