// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package reverse

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"math"
	"reflect"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"
	webui "github.com/thinkddr/astro-fyne/native"
)

func options() Options {
	return Options{Viewport: Viewport{320, 240, 1}, CanvasBackground: theme.Color(theme.ColorNameBackground)}
}
func content(doc Document) Node { return doc.Roots[len(doc.Roots)-1] }
func app(t *testing.T)          { t.Helper(); a := test.NewApp(); t.Cleanup(a.Quit) }
func place(object fyne.CanvasObject, x, y, width, height float32) {
	object.Move(fyne.NewPos(x, y))
	object.Resize(fyne.NewSize(width, height))
}
func bitmap(t *testing.T) fyne.Resource {
	t.Helper()
	i := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	i.SetNRGBA(0, 0, color.NRGBA{R: 255, A: 255})
	i.SetNRGBA(1, 0, color.NRGBA{G: 255, A: 255})
	i.SetNRGBA(0, 1, color.NRGBA{B: 255, A: 255})
	i.SetNRGBA(1, 1, color.NRGBA{R: 255, G: 255, A: 255})
	var b bytes.Buffer
	if err := png.Encode(&b, i); err != nil {
		t.Fatal(err)
	}
	return fyne.NewStaticResource("pixel.png", b.Bytes())
}

func TestExportFreezesActualParentGeometryAndBitmaps(t *testing.T) {
	app(t)
	fill := canvas.NewRectangle(color.NRGBA{R: 32, G: 64, B: 128, A: 127})
	place(fill, 1.25, 2.75, 100.5, 40.25)
	r := bitmap(t)
	one, two := canvas.NewImageFromResource(r), canvas.NewImageFromResource(r)
	place(one, 120, 5, 2, 2)
	place(two, 125, 5, 2, 2)
	nested := container.NewWithoutLayout(fill, one, two)
	place(nested, 12.5, 9.25, 200, 100)
	root := container.NewWithoutLayout(nested)
	place(root, 0, 0, 320, 240)
	opts := options()
	opts.Tokens = map[string]string{"--accent": "#123456"}
	doc, err := Export(root, opts)
	if err != nil {
		t.Fatal(err)
	}
	n := content(doc).Children[0]
	if n.Style.X != 12.5 || n.Style.Y != 9.25 || n.Children[0].Style.X != 1.25 || n.Children[0].Style.Width != 100.5 {
		t.Fatalf("local fractional geometry lost: %+v", n)
	}
	if len(doc.Resources) != 1 || n.Children[1].Resource != n.Children[2].Resource {
		t.Fatalf("identical bitmap was not deduplicated: %+v", doc.Resources)
	}
	asset := doc.Resources[0]
	if asset.Hash != fmtHash(r.Content()) || asset.Width != 2 || asset.Height != 2 || asset.Path != "assets/"+asset.Hash+".png" {
		t.Fatalf("incorrect bitmap metadata: %+v", asset)
	}
	before := append([]byte(nil), asset.Content...)
	r.(*fyne.StaticResource).StaticContent[0] = 0
	fill.FillColor = color.Black
	fill.Move(fyne.NewPos(88, 88))
	opts.Tokens["--accent"] = "red"
	if !bytes.Equal(doc.Resources[0].Content, before) || doc.Tokens["--accent"] != "#123456" || n.Children[0].Style.X != 1.25 {
		t.Fatal("export aliases mutable input")
	}
	encoded, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Document
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(doc, decoded) {
		t.Fatal("scene JSON round trip changed data")
	}
	if strings.Contains(string(encoded), "visualVerified") {
		t.Fatal("export incorrectly claims visual verification")
	}
}
func fmtHash(content []byte) string {
	hash := sha256.Sum256(content)
	const hex = "0123456789abcdef"
	out := make([]byte, 64)
	for i, b := range hash {
		out[2*i], out[2*i+1] = hex[b>>4], hex[b&15]
	}
	return string(out)
}

func TestOpaqueTreeCoverageDoesNotRequireAnInferredCanvasBackground(t *testing.T) {
	app(t)
	fill := canvas.NewRectangle(color.White)
	place(fill, 0, 0, 320, 240)
	opts := options()
	opts.CanvasBackground = nil
	doc, err := Export(fill, opts)
	if err != nil || len(doc.Roots) != 1 {
		t.Fatalf("opaque viewport rectangle should suffice without a canvas assertion: %+v %v", doc.Roots, err)
	}
	// Child coordinates are native parent-relative border boxes. The negative
	// child offset compensates the parent's offset and covers the entire viewport.
	place(fill, -12, -9, 320, 240)
	root := container.NewWithoutLayout(fill)
	place(root, 12, 9, 320, 240)
	doc, err = Export(root, opts)
	if err != nil || len(doc.Roots) != 1 {
		t.Fatalf("nested opaque coverage was not recognized: %+v %v", doc.Roots, err)
	}
}

func TestCanvasPaintMustBeExplicitWhenViewportCoverageIsNotGuaranteed(t *testing.T) {
	app(t)
	for name, configure := range map[string]func(*canvas.Rectangle){
		"transparent": func(r *canvas.Rectangle) { r.FillColor = color.Transparent },
		"translucent": func(r *canvas.Rectangle) { r.FillColor = color.NRGBA{R: 255, A: 127} },
		"rounded":     func(r *canvas.Rectangle) { r.CornerRadius = 4 },
		"hidden":      func(r *canvas.Rectangle) { r.Hide() },
		"too small":   func(r *canvas.Rectangle) { r.Resize(fyne.NewSize(319, 240)) },
		"offset gap":  func(r *canvas.Rectangle) { r.Move(fyne.NewPos(1, 0)) },
	} {
		t.Run(name, func(t *testing.T) {
			r := canvas.NewRectangle(color.White)
			place(r, 0, 0, 320, 240)
			configure(r)
			opts := options()
			opts.CanvasBackground = nil
			if _, err := Export(r, opts); err == nil || !strings.Contains(err.Error(), "CanvasBackground") {
				t.Fatalf("canvas paint was silently invented: %v", err)
			}
			opts.CanvasBackground = color.Transparent
			doc, err := Export(r, opts)
			if err != nil || len(doc.Roots) != 2 || doc.Roots[0].Style.Background != "rgba(0, 0, 0, 0)" {
				t.Fatalf("explicit transparent canvas assertion not preserved: %+v %v", doc.Roots, err)
			}
		})
	}
	button := widget.NewButton("Save", func() { t.Fatal("export executed callback") })
	place(button, 0, 0, 80, 32)
	opts := options()
	opts.CanvasBackground = nil
	opts.NodeFontFamilies = map[string]string{"native-root": "HostFont"}
	if _, err := Export(button, opts); err == nil || !strings.Contains(err.Error(), "tap") {
		t.Fatalf("background guard masked the missing native action binding: %v", err)
	}
}

func TestCanvasBackgroundNodeFreezesActualNativePaintWithoutIDCollisions(t *testing.T) {
	app(t)
	actual := color.NRGBA{R: 17, G: 34, B: 51, A: 255}
	fyne.CurrentApp().Settings().SetTheme(&webui.CapturedTheme{Base: theme.Current(), Colors: map[fyne.ThemeColorName]color.Color{theme.ColorNameBackground: actual}})
	fill := canvas.NewRectangle(color.White)
	place(fill, 10, 10, 40, 40)
	root := container.NewWithoutLayout(fill)
	place(root, 0, 0, 320, 240)
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(root)
	frame := c.Capture()
	opts := options()
	opts.Canvas = c
	opts.IDs = map[fyne.CanvasObject]string{root: "native-canvas-background"}
	doc, err := Export(root, opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Roots) != 2 || doc.Roots[0].ID != "native-canvas-background-1" || content(doc).ID != "native-canvas-background" {
		t.Fatalf("synthetic canvas paint collided with source IDs or paint order: %+v", doc.Roots)
	}
	background := doc.Roots[0]
	paint, err := webui.ParseColor(background.Style.Background)
	if err != nil || paint != color.NRGBAModel.Convert(frame.At(310, 230)).(color.NRGBA) || paint != actual {
		t.Fatalf("exported background differs from real native canvas paint: %v %+v", err, background)
	}
	if background.Style.X != 0 || background.Style.Y != 0 || background.Style.Width != 320 || background.Style.Height != 240 || background.Kind != "container" || len(background.Children) != 0 {
		t.Fatalf("incorrect native canvas background geometry: %+v", background)
	}
}

func TestExportRecognizesTextAndControlsWithExplicitActions(t *testing.T) {
	app(t)
	th := theme.Current()
	a := fyne.CurrentApp()
	a.Settings().SetTheme(&webui.CapturedTheme{Base: th, Sizes: map[fyne.ThemeSizeName]float32{theme.SizeNameInputBorder: 0}})
	label := widget.NewLabel("Hello")
	place(label, 8, 4, 120, 32)
	button := widget.NewButton("Save", func() { t.Fatal("export called tap callback") })
	place(button, 8, 50, 120, 40)
	entry := widget.NewEntry()
	entry.PlaceHolder = "Native placeholder"
	entry.SetText("Draft")
	entry.OnChanged = func(string) { t.Fatal("export called input callback") }
	entry.OnSubmitted = func(string) { t.Fatal("export called submit callback") }
	place(entry, 8, 100, 200, 40)
	plain := canvas.NewText("World", color.Black)
	place(plain, 8, 180, 100, 24)
	root := container.NewWithoutLayout(label, button, entry, plain)
	place(root, 0, 0, 320, 240)
	opts := options()
	opts.FontFamilies = map[fyne.Resource]string{th.Font(fyne.TextStyle{}): "HostRegular", th.Font(fyne.TextStyle{Bold: true}): "HostBold"}
	opts.IDs = map[fyne.CanvasObject]string{label: "title", button: "save", entry: "draft", plain: "world"}
	opts.IDBindings = map[string]Events{"save": {Tap: "save:contact"}, "draft": {Input: "edit", Submit: "submit"}}
	doc, err := Export(root, opts)
	if err != nil {
		t.Fatal(err)
	}
	nodes := content(doc).Children
	if nodes[0].Kind != "text" || nodes[0].Style.FontFamily != "HostRegular" || nodes[1].Kind != "button" || nodes[2].Kind != "input" || nodes[3].Text != "World" {
		t.Fatalf("wrong semantic tree: %+v", nodes)
	}
	if nodes[2].Events.Change != "" || nodes[2].Events.Submit != "submit" || nodes[2].Value != "Draft" {
		t.Fatalf("submit was merged into change: %+v", nodes[2])
	}
	if nodes[2].PlaceholderColor != cssColor(th.Color(theme.ColorNamePlaceHolder, themeVariant())) {
		t.Fatalf("placeholder color lost: %+v", nodes[2])
	}
	if !reflect.DeepEqual(doc.RequiredActions, []string{"edit", "save:contact", "submit"}) {
		t.Fatalf("wrong actions: %v", doc.RequiredActions)
	}
	entry.OnChanged, entry.OnSubmitted = nil, nil
	delete(opts.IDBindings, "draft")
	doc, err = Export(root, opts)
	if err != nil {
		t.Fatal(err)
	}
	if content(doc).Children[2].Events != nil {
		t.Fatal("local editing requires no fake action")
	}
}

type namedView struct{ *webui.View }

func TestViewSnapshotNeverReevaluatesAndUsesResolvedCurrentFrame(t *testing.T) {
	app(t)
	builds := 0
	view := webui.NewView(func() []webui.Node {
		builds++
		return []webui.Node{{ID: "panel", Kind: "container", Style: webui.Style{Background: "#abcdef"}, Children: []webui.Node{{ID: "edit", Kind: "input", Value: "start", Placeholder: "hint", OnCommit: func(string) { t.Fatal("snapshot called commit") }}}}}
	})
	view.Resize(fyne.NewSize(320, 240))
	panel := view.Object("panel")
	edit := view.Object("edit")
	place(panel, 3.5, 5.75, 250, 100)
	place(edit, 9.25, 12.5, 140, 36)
	edit.(fyne.Focusable).TypedRune('!')
	before := builds
	opts := options()
	opts.IDBindings = map[string]Events{"edit": {Change: "commit"}}
	opts.NodeFontFamilies = map[string]string{"edit": "HostFont"}
	doc, err := Export(&namedView{view}, opts)
	if err != nil {
		t.Fatal(err)
	}
	if builds != before {
		t.Fatalf("export executed builder: %d -> %d", before, builds)
	}
	p := content(doc).Children[0]
	n := p.Children[0]
	if p.ID != "panel" || p.Style.X != 3.5 || n.Style.X != 9.25 || n.Style.Width != 140 || n.Style.FontSize != 14 || n.Style.BorderWidth != 1 || n.Value == "start" {
		t.Fatalf("snapshot omitted actual/resolved frame: %+v", n)
	}
	if n.Events.Change != "commit" || n.Events.Input != "" {
		t.Fatalf("callback semantics lost: %+v", n.Events)
	}
	if n.PlaceholderColor == "" {
		t.Fatal("public editor placeholder paint was not frozen")
	}
	place(edit, 44, 22, 180, 50)
	if n.Style.Width != 140 {
		t.Fatal("snapshot geometry aliases object")
	}
}

func TestInvalidViewsAndStaleMeasurementProfilesCannotBeExported(t *testing.T) {
	app(t)
	fail := false
	v := webui.NewView(func() []webui.Node {
		if fail {
			panic("render failed")
		}
		return []webui.Node{{ID: "box", Kind: "container", Style: webui.Style{Background: "#ffffff"}}}
	})
	place(v, 0, 0, 320, 240)
	fail = true
	v.Refresh()
	if _, err := Export(v, options()); err == nil || !strings.Contains(err.Error(), "render failed") {
		t.Fatalf("invalid builder tree exported: %v", err)
	}
	fail = false
	v.Refresh()
	v.SetViewport(320, 240)
	if err := v.SetCaptureScale(1); err != nil {
		t.Fatal(err)
	}
	profile := map[string]webui.Style{"box": {Width: 320, Height: 240, Background: "#ffffff", Opacity: 1, Measured: true}}
	if err := v.ApplyMeasurements(profile); err != nil {
		t.Fatal(err)
	}
	if _, err := Export(v, options()); err == nil {
		t.Fatal("unbound measurement profile exported")
	}
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(v)
	if err := v.BindCanvas(c); err != nil {
		t.Fatal(err)
	}
	if _, err := Export(v, options()); err != nil {
		t.Fatal(err)
	}
	c.SetScale(2)
	if _, err := Export(v, options()); err == nil {
		t.Fatal("stale canvas scale was ignored")
	}
}

func TestExportFailsClosedForUnsupportedObjectsAndContracts(t *testing.T) {
	app(t)
	for name, object := range map[string]fyne.CanvasObject{"unknown": canvas.NewCircle(color.Black), "stroke": &canvas.Rectangle{StrokeWidth: 1}, "image mode": &canvas.Image{Resource: bitmap(t), FillMode: canvas.ImageFillContain}, "bad image": canvas.NewImageFromResource(fyne.NewStaticResource("bad.png", []byte("not PNG")))} {
		t.Run(name, func(t *testing.T) {
			if _, err := Export(object, options()); err == nil {
				t.Fatal("unsupported contract exported")
			}
		})
	}
	text := canvas.NewText("font", color.Black)
	place(text, 0, 0, 80, 24)
	if _, err := Export(text, options()); err == nil || !strings.Contains(err.Error(), "font") {
		t.Fatalf("font substitution was allowed: %v", err)
	}
	fill := canvas.NewRectangle(color.Black)
	place(fill, 0, 0, float32(math.NaN()), 10)
	if _, err := Export(fill, options()); err == nil {
		t.Fatal("nonfinite geometry exported")
	}
	place(fill, 0, 0, 10, 10)
	root := container.NewWithoutLayout(fill, fill)
	place(root, 0, 0, 320, 240)
	if _, err := Export(root, options()); err == nil {
		t.Fatal("shared object exported twice")
	}
	root.Objects = []fyne.CanvasObject{root}
	if _, err := Export(root, options()); err == nil {
		t.Fatal("cycle exported")
	}
	opts := options()
	opts.IDBindings = map[string]Events{"missing": {Tap: "action"}}
	if _, err := Export(fill, opts); err == nil {
		t.Fatal("unused binding accepted")
	}
	opts = options()
	opts.Bindings = map[fyne.CanvasObject]Events{fill: {Tap: "action"}}
	if _, err := Export(fill, opts); err == nil {
		t.Fatal("fabricated callback binding accepted")
	}
}

func TestCallbacksRequireBindingsAndUniqueIDs(t *testing.T) {
	app(t)
	button := widget.NewButton("Save", func() { t.Fatal("called") })
	place(button, 0, 0, 80, 32)
	opts := options()
	opts.NodeFontFamilies = map[string]string{"native-root": "HostFont"}
	if _, err := Export(button, opts); err == nil || !strings.Contains(err.Error(), "tap") {
		t.Fatalf("callback without binding exported: %v", err)
	}
	opts.Bindings = map[fyne.CanvasObject]Events{button: {Tap: "save"}}
	opts.IDBindings = map[string]Events{"native-root": {Tap: "save"}}
	if _, err := Export(button, opts); err == nil {
		t.Fatal("conflicting bindings accepted")
	}
	fill1, fill2 := canvas.NewRectangle(color.Black), canvas.NewRectangle(color.White)
	root := container.NewWithoutLayout(fill1, fill2)
	place(root, 0, 0, 320, 240)
	opts = options()
	opts.IDs = map[fyne.CanvasObject]string{fill1: "same", fill2: "same"}
	if _, err := Export(root, opts); err == nil {
		t.Fatal("duplicate ID accepted")
	}
}

func TestKeyedRemountAndRemovalReleaseTheDetachedEditorFocus(t *testing.T) {
	app(t)
	identity, visible := "first", true
	commits := 0
	v := webui.NewView(func() []webui.Node {
		if !visible {
			return []webui.Node{}
		}
		return []webui.Node{{ID: "edit", Identity: identity, Kind: "input", OnCommit: func(string) { commits++ }}}
	})
	v.SetAutoRefreshEvents(false)
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(v)
	if err := v.BindCanvas(c); err != nil {
		t.Fatal(err)
	}
	first := v.Object("edit").(fyne.Focusable)
	c.Focus(first)
	first.TypedRune('x')
	if c.Focused() != first {
		t.Fatal("input did not acquire focus")
	}
	identity = "second"
	v.Refresh()
	if v.Object("edit") == first.(fyne.CanvasObject) || c.Focused() != nil || commits != 0 {
		t.Fatalf("remount retained focus or committed abandoned value: focus=%v commits=%d", c.Focused(), commits)
	}
	second := v.Object("edit").(fyne.Focusable)
	c.Focus(second)
	v.Refresh()
	if v.Object("edit") != second.(fyne.CanvasObject) || c.Focused() != second {
		t.Fatal("stable identity lost editor or focus")
	}
	visible = false
	v.Refresh()
	if c.Focused() != nil || v.Object("edit") != nil {
		t.Fatal("removed editor remains focused")
	}
}

func TestStableSourceIdentitySurvivesDOMIDChangesAndRejectsDuplicates(t *testing.T) {
	app(t)
	id, value, duplicate := "first-id", "", false
	v := webui.NewView(func() []webui.Node {
		nodes := []webui.Node{{ID: id, Identity: "component/field-site", Kind: "input", Value: value, OnChange: func(text string) { value = text }}}
		if duplicate {
			nodes = append(nodes, webui.Node{ID: "another-id", Identity: "component/field-site", Kind: "input"})
		}
		return nodes
	})
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(v)
	if err := v.BindCanvas(c); err != nil {
		t.Fatal(err)
	}
	first := v.Object(id)
	focused := first.(fyne.Focusable)
	c.Focus(focused)
	focused.TypedRune('a')
	id = "renamed-id"
	v.Refresh()
	if v.Object(id) != first || v.Object("first-id") != nil || c.Focused() != focused || value != "a" {
		t.Fatal("DOM ID rename remounted an unchanged source identity")
	}
	duplicate = true
	v.Refresh()
	if v.Error() == nil || !strings.Contains(v.Error().Error(), "identity") {
		t.Fatalf("duplicate source identity accepted: %v", v.Error())
	}
	if v.Object(id) != first || c.Focused() != focused {
		t.Fatal("invalid tree partially mutated the previously valid frame")
	}
}

func TestExportDetectsBoundViewFocusWithoutOptionalCanvas(t *testing.T) {
	app(t)
	v := webui.NewView(func() []webui.Node { return []webui.Node{{ID: "edit", Kind: "input"}} })
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(v)
	if err := v.BindCanvas(c); err != nil {
		t.Fatal(err)
	}
	c.Focus(v.Object("edit").(fyne.Focusable))
	opts := options()
	opts.NodeFontFamilies = map[string]string{"edit": "HostFont"}
	if _, err := Export(v, opts); err == nil || !strings.Contains(err.Error(), "focus") {
		t.Fatalf("focused native frame exported without caret/selection: %v", err)
	}
	c.Unfocus()
	if _, err := Export(v, opts); err != nil {
		t.Fatal(err)
	}
}

func TestSnapshotDetectsActivePublicEditorWithoutCanvasDiscovery(t *testing.T) {
	app(t)
	v := webui.NewView(func() []webui.Node { return []webui.Node{{ID: "edit", Kind: "input"}} })
	place(v, 0, 0, 320, 240)
	edit := v.Object("edit").(fyne.Focusable)
	edit.FocusGained()
	opts := options()
	opts.NodeFontFamilies = map[string]string{"edit": "HostFont"}
	if _, err := Export(v, opts); err == nil || !strings.Contains(err.Error(), "focus") {
		t.Fatalf("active renderer-only editor was omitted from scene: %v", err)
	}
	edit.FocusLost()
	if _, err := Export(v, opts); err != nil {
		t.Fatal(err)
	}
}

func TestExportAfterNativePaintPreservesResourceAndFreezesChangedDecodedCache(t *testing.T) {
	app(t)
	r := bitmap(t)
	object := canvas.NewImageFromResource(r)
	place(object, 20, 30, 2, 2)
	root := container.NewWithoutLayout(object)
	place(root, 0, 0, 320, 240)
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(root)
	c.Capture()
	if object.Image == nil {
		t.Fatal("native render did not materialize its bitmap cache")
	}
	opts := options()
	opts.Canvas = c
	doc, err := Export(root, opts)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Resources[0].Hash != fmtHash(r.Content()) || !bytes.Equal(doc.Resources[0].Content, r.Content()) {
		t.Fatal("unchanged native decoded cache replaced original resource bytes")
	}
	changed := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	changed.SetNRGBA(0, 0, color.NRGBA{R: 8, G: 16, B: 32, A: 255})
	object.Image = changed
	doc, err = Export(root, opts)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := png.Decode(bytes.NewReader(doc.Resources[0].Content))
	if err != nil {
		t.Fatal(err)
	}
	if doc.Resources[0].Hash == fmtHash(r.Content()) || color.NRGBAModel.Convert(decoded.At(0, 0)) != (color.NRGBA{R: 8, G: 16, B: 32, A: 255}) {
		t.Fatal("explicitly changed painted cache exported stale original bytes")
	}
	object.Image = image.NewNRGBA64(image.Rect(0, 0, 2, 2))
	if _, err := Export(root, opts); err == nil || !strings.Contains(err.Error(), "8-bit") {
		t.Fatalf("16-bit cached bitmap was silently quantized: %v", err)
	}
}

func TestDecoded16BitImagesCannotBecomeAn8BitSceneSilently(t *testing.T) {
	app(t)
	for _, pixels := range []image.Image{image.NewNRGBA64(image.Rect(0, 0, 2, 2)), image.NewRGBA64(image.Rect(0, 0, 2, 2)), image.NewGray16(image.Rect(0, 0, 2, 2)), image.NewAlpha16(image.Rect(0, 0, 2, 2))} {
		object := canvas.NewImageFromImage(pixels)
		place(object, 0, 0, 2, 2)
		if _, err := Export(object, options()); err == nil || !strings.Contains(err.Error(), "8-bit") {
			t.Fatalf("%T quantized without diagnostics: %v", pixels, err)
		}
	}
}
