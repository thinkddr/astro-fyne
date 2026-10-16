// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package reverse

import (
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	webui "github.com/thinkddr/astro-fyne/native"
)

func TestReverseDirectionsExportSourceOrderAndIndependentDeclarations(t *testing.T) {
	app(t)
	for _, direction := range []string{"row-reverse", "column-reverse"} {
		t.Run(direction, func(t *testing.T) {
			builds := 0
			item := func(id string, basis float32) webui.Node {
				return webui.Node{ID: id, Kind: "container", Style: webui.Style{Background: "#224466", Flex: &webui.FlexStyle{Basis: webui.FlexValue(basis), MinWidth: webui.FlexValue(0), MinHeight: webui.FlexValue(0), BoxSizing: "border-box"}}}
			}
			v := webui.NewView(func() []webui.Node {
				builds++
				return []webui.Node{{ID: "root", Kind: "container", Style: webui.Style{Display: "flex", Direction: direction, Height: 160, Background: "#ffffff", PaddingLeft: 11, PaddingRight: 19, PaddingTop: 7, PaddingBottom: 13, Flex: &webui.FlexStyle{WidthSet: true, WidthPercent: webui.FlexValue(100), HeightSet: true, BoxSizing: "border-box"}}, Children: []webui.Node{item("first", 40), item("second", 80)}}}
			})
			c := software.NewCanvas()
			c.SetPadded(false)
			c.SetContent(v)
			if err := v.BindCanvas(c); err != nil {
				t.Fatal(err)
			}
			first, second := v.Object("first"), v.Object("second")
			for _, width := range []float32{240, 384, 240} {
				c.Resize(fyne.NewSize(width, 160))
				c.Capture()
				before := builds
				opts := Options{Viewport: Viewport{width, 160, 1}, Canvas: c, PreserveLayout: true}
				doc, err := Export(v, opts)
				if err != nil {
					t.Fatal(err)
				}
				if builds != before || doc.Schema != 2 || doc.Roots[0].SourceStyle.Direction != direction || doc.Roots[0].Style.Direction != direction {
					t.Fatal("export rebuilt or lost reverse declarations")
				}
				children := doc.Roots[0].Children
				if len(children) != 2 || children[0].ID != "first" || children[1].ID != "second" || v.Object("first") != first || v.Object("second") != second {
					t.Fatal("reverse export reordered or remounted source children")
				}
				*children[0].SourceStyle.Flex.Basis = 999
				again, err := Export(v, opts)
				if err != nil || *again.Roots[0].Children[0].SourceStyle.Flex.Basis != 40 {
					t.Fatal("exported metadata aliases native source")
				}
				opts.PreserveLayout = false
				frozen, err := Export(v, opts)
				if err != nil {
					t.Fatal(err)
				}
				if frozen.Schema != 1 || frozen.Roots[0].Children[0].Children[0].Style.X != first.Position().X || frozen.Roots[0].Children[0].Children[0].Style.Y != first.Position().Y {
					t.Fatal("frozen export changed actual reverse positions")
				}
			}
		})
	}
}
