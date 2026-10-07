// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package reverse

import (
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/driver/software"
	webui "github.com/thinkddr/astro-fyne/native"
)

func TestResponsiveExportPreservesDeclarationsInsteadOfUsedDimensions(t *testing.T) {
	app(t)
	builds := 0
	v := webui.NewView(func() []webui.Node {
		builds++
		return []webui.Node{{ID: "native-root", Kind: "container", Style: webui.Style{Display: "flex", Direction: "row", Height: 240, Background: "#ffffff", Flex: &webui.FlexStyle{WidthSet: true, WidthPercent: webui.FlexValue(100), HeightSet: true, BoxSizing: "border-box"}}, Children: []webui.Node{{ID: "box", Kind: "container", Style: webui.Style{Background: "#123456", Flex: &webui.FlexStyle{Basis: webui.FlexValue(0), Grow: webui.FlexValue(1), Shrink: webui.FlexValue(0), MinWidth: webui.FlexValue(0), MinHeight: webui.FlexValue(0), BoxSizing: "border-box"}}}}}}
	})
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(v)
	if err := v.BindCanvas(c); err != nil {
		t.Fatal(err)
	}
	opts := Options{Viewport: Viewport{320, 240, 1}, Canvas: c, PreserveLayout: true}
	before := builds
	doc, err := Export(v, opts)
	if err != nil {
		t.Fatal(err)
	}
	if builds != before || doc.Schema != 2 || doc.Layout != "flex" || len(doc.Roots) != 1 || doc.Roots[0].ID != "native-root" {
		t.Fatalf("responsive export rebuilt or wrapped its source root: %+v", doc)
	}
	root := doc.Roots[0]
	if root.Style.Width != 320 || root.SourceStyle.Width != 0 || *root.SourceStyle.Flex.WidthPercent != 100 || root.SourceStyle.Measured {
		t.Fatal("used root dimensions replaced source declarations")
	}
	box := root.Children[0]
	if box.Style.Width != 320 || *box.SourceStyle.Flex.Basis != 0 || *box.SourceStyle.Flex.Shrink != 0 || box.SourceStyle.Flex.WidthSet {
		t.Fatal("explicit zero or omitted width was lost")
	}
	*box.SourceStyle.Flex.Grow = 99
	c.Resize(fyne.NewSize(512, 240))
	v.Resize(fyne.NewSize(512, 240))
	opts.Viewport.Width = 512
	next, err := Export(v, opts)
	if err != nil {
		t.Fatal(err)
	}
	if *next.Roots[0].Children[0].SourceStyle.Flex.Grow != 1 || next.Roots[0].Children[0].Style.Width != 512 {
		t.Fatal("export metadata aliases the source or freezes resize geometry")
	}
	opts.PreserveLayout = false
	frozen, err := Export(v, opts)
	if err != nil {
		t.Fatal(err)
	}
	if frozen.Schema != 1 || frozen.Layout != "" || frozen.Roots[0].Children[0].SourceStyle != nil {
		t.Fatal("default export changed its schema 1 frozen contract")
	}
	// Native host placement is represented only by a frozen scene, not inferred
	// as a new responsive declaration or silently discarded during export.
	v.Object("box").Move(fyne.NewPos(1, 0))
	opts.PreserveLayout = true
	if _, err := Export(v, opts); err == nil {
		t.Fatal("manual native geometry override was discarded by responsive export")
	}
	opts.PreserveLayout = false
	frozen, err = Export(v, opts)
	if err != nil || frozen.Roots[0].Children[0].Children[0].Style.X != 1 {
		t.Fatalf("frozen export lost an actual host geometry override: %v", err)
	}
}

func TestResponsiveExportRejectsUnportableNativeLayoutsAndComposition(t *testing.T) {
	app(t)
	if _, err := Export(canvas.NewRectangle(nil), Options{Viewport: Viewport{320, 240, 1}, PreserveLayout: true}); err == nil {
		t.Fatal("native layout inferred without source metadata")
	}
	v := webui.NewView(func() []webui.Node {
		return []webui.Node{{ID: "root", Kind: "container", Style: webui.Style{Display: "flex", Height: 240, Background: "transparent", Flex: &webui.FlexStyle{WidthSet: true, WidthPercent: webui.FlexValue(100), HeightSet: true, BoxSizing: "border-box"}}}}
	})
	v.Resize(fyne.NewSize(320, 240))
	if _, err := Export(v, Options{Viewport: Viewport{320, 240, 1}, PreserveLayout: true}); err == nil {
		t.Fatal("canvas composition disappeared from responsive export")
	}
}
