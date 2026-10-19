// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package reverse

import (
	"encoding/json"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	webui "github.com/thinkddr/astro-fyne/native"
)

func TestFrozenScenePreservesZeroBoxWithoutInventingBlockLayout(t *testing.T) {
	app(t)
	view := webui.NewView(func() []webui.Node {
		return []webui.Node{
			{ID: "zero", Kind: "container", Style: webui.Style{Flex: &webui.FlexStyle{HeightSet: true}}},
			{ID: "following", Kind: "container", Style: webui.Style{Height: 24}},
		}
	})
	canvas := software.NewCanvas()
	canvas.SetPadded(false)
	canvas.SetContent(view)
	canvas.Resize(fyne.NewSize(320, 240))
	if err := view.BindCanvas(canvas); err != nil {
		t.Fatal(err)
	}
	opts := options()
	opts.Canvas = canvas
	scene, err := Export(view, opts)
	if err != nil {
		t.Fatal(err)
	}
	nodes := content(scene).Children
	if scene.Schema != 1 || nodes[0].ID != "zero" || nodes[0].Style.Height != 0 || nodes[0].Style.Width != 320 || nodes[0].SourceStyle != nil || nodes[0].Style.Flex != nil || nodes[1].Style.Y != 0 {
		t.Fatalf("frozen scene lost the zero box: %+v", nodes)
	}
	bytes, err := json.Marshal(scene)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(bytes), "heightSet") {
		t.Fatal("frozen scene leaked source presence metadata")
	}
	opts.PreserveLayout = true
	if _, err = Export(view, opts); err == nil || !strings.Contains(err.Error(), "responsive") {
		t.Fatalf("block source layout was silently frozen: %v", err)
	}
}
