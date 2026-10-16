// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// css-token-fixture exports literal root tokens with a real source-only View.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"image/png"
	"os"
	"path/filepath"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/reverse"
)

func hash(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}

func run(out string) error {
	if out == "" {
		return fmt.Errorf("--out is required")
	}
	fixture, err := os.ReadFile("reverse/cmd/css-token-fixture/main.go")
	if err != nil {
		return err
	}
	tokens := map[string]string{"--Accent": "#112233", "--accent": "#445566", "--space": "8px", "--color-primary": "#11232b"}
	a := test.NewApp()
	defer a.Quit()
	v := webui.NewView(func() []webui.Node {
		return []webui.Node{{ID: "css-token-root", Kind: "container", Style: webui.Style{
			Display: "flex", Direction: "row", Height: 80, Background: "#ffffff",
			PaddingTop: 16, PaddingRight: 16, PaddingBottom: 16, PaddingLeft: 16,
			Flex: &webui.FlexStyle{WidthSet: true, WidthPercent: webui.FlexValue(100), HeightSet: true, BoxSizing: "border-box", AlignItems: "flex-start"},
		}, Children: []webui.Node{{ID: "css-token-box", Kind: "container", Style: webui.Style{
			Display: "block", Direction: "row", Height: 32, Background: "#2464a8",
			Flex: &webui.FlexStyle{Basis: webui.FlexValue(80), Grow: webui.FlexValue(0), Shrink: webui.FlexValue(0), MinWidth: webui.FlexValue(0), MinHeight: webui.FlexValue(0), HeightSet: true, BoxSizing: "border-box"},
		}}}}}
	})
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(160, 80))
	c.SetContent(v)
	if err := v.BindCanvas(c); err != nil {
		return err
	}
	root, box := v.Object("css-token-root"), v.Object("css-token-box")
	if root == nil || box == nil {
		return fmt.Errorf("native token fixture objects are absent")
	}
	for _, scale := range []int{1, 2} {
		c.SetScale(float32(scale))
		c.Resize(fyne.NewSize(160, 80))
		frame := c.Capture()
		if frame.Bounds().Dx() != 160*scale || frame.Bounds().Dy() != 80*scale || v.Object("css-token-root") != root || v.Object("css-token-box") != box {
			return fmt.Errorf("native source-only viewport or object identity differs")
		}
		snapshot, err := v.Snapshot()
		if err != nil {
			return err
		}
		if !snapshot.Responsive || snapshot.Measured {
			return fmt.Errorf("native token fixture requires source-only responsive layout")
		}
		scene, err := reverse.Export(v, reverse.Options{Viewport: reverse.Viewport{Width: 160, Height: 80, Scale: float32(scale)}, Canvas: c, Tokens: tokens, PreserveLayout: true})
		if err != nil {
			return err
		}
		if scene.Schema != 2 || scene.Layout != "flex" || len(scene.Roots) != 1 || len(scene.Roots[0].Children) != 1 || scene.Roots[0].ID != "css-token-root" || scene.Roots[0].Children[0].ID != "css-token-box" {
			return fmt.Errorf("native token fixture scene inventory differs")
		}
		directory := filepath.Join(out, fmt.Sprintf("scale-%d", scale))
		if err := os.MkdirAll(directory, 0755); err != nil {
			return err
		}
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, frame); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(directory, "native.png"), encoded.Bytes(), 0644); err != nil {
			return err
		}
		if err := writeJSON(filepath.Join(directory, "scene.json"), scene); err != nil {
			return err
		}
		if err := writeJSON(filepath.Join(directory, "native.json"), map[string]any{"schema": 1, "sourceOnly": true, "fixtureHash": hash(fixture), "viewport": scene.Viewport, "tokens": scene.Tokens, "screenshotHash": hash(encoded.Bytes())}); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	out := flag.String("out", "", "write schema 2 scenes and actual native PNGs")
	flag.Parse()
	if err := run(*out); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
