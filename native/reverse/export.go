// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package reverse

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"math"
	"os"
	"reflect"
	"sort"
	"strings"
	"unicode/utf16"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"
	webui "github.com/thinkddr/astro-fyne/native"
)

type snapshotter interface {
	Snapshot() (webui.ViewSnapshot, error)
}

type exporter struct {
	opts           Options
	doc            Document
	objects        map[fyne.CanvasObject]bool
	ids            map[string]bool
	usedBindings   map[fyne.CanvasObject]bool
	usedIDBindings map[string]bool
	usedIDs        map[fyne.CanvasObject]bool
	usedFonts      map[string]bool
	actions        map[string]bool
	resources      map[string]string
}

// Export copies an already laid-out tree. The caller owns the UI goroutine and
// must keep it unchanged during this call. Layout managers become fixed measured
// coordinates at this viewport; their Go algorithms and callbacks are not copied.
func Export(root fyne.CanvasObject, opts Options) (Document, error) {
	if !finite(opts.Viewport.Width) || !finite(opts.Viewport.Height) || !finite(opts.Viewport.Scale) || opts.Viewport.Width <= 0 || opts.Viewport.Height <= 0 || opts.Viewport.Scale <= 0 {
		return Document{}, fmt.Errorf("reverse: viewport width, height and scale must be positive and finite")
	}
	if opts.Canvas != nil {
		if opts.Canvas.Size() != fyne.NewSize(opts.Viewport.Width, opts.Viewport.Height) || opts.Canvas.Scale() != opts.Viewport.Scale {
			return Document{}, fmt.Errorf("reverse: declared viewport does not match the native canvas")
		}
		if opts.Canvas.Focused() != nil {
			return Document{}, fmt.Errorf("reverse: active focus/caret/selection is not represented by scene schema 1; export an unfocused frame")
		}
	}
	e := &exporter{opts: opts, doc: Document{Schema: 1, Viewport: opts.Viewport, Roots: []Node{}, Tokens: map[string]string{}, Resources: []Resource{}, RequiredActions: []string{}}, objects: map[fyne.CanvasObject]bool{}, ids: map[string]bool{}, usedBindings: map[fyne.CanvasObject]bool{}, usedIDBindings: map[string]bool{}, usedIDs: map[fyne.CanvasObject]bool{}, usedFonts: map[string]bool{}, actions: map[string]bool{}, resources: map[string]string{}}
	for name, value := range opts.Tokens {
		if !validTokenName(name) {
			return Document{}, fmt.Errorf("reverse: invalid custom property %q", name)
		}
		e.doc.Tokens[name] = value
	}
	node, err := e.object(root, "native-root")
	if err != nil {
		return Document{}, err
	}
	e.doc.Roots = append(e.doc.Roots, node)
	if err := validateNodes(e.doc.Roots); err != nil {
		return Document{}, err
	}
	for object := range opts.Bindings {
		if !e.usedBindings[object] {
			return Document{}, fmt.Errorf("reverse: binding targets an object outside the exported tree")
		}
	}
	for id := range opts.IDBindings {
		if !e.usedIDBindings[id] {
			return Document{}, fmt.Errorf("reverse: binding targets unknown ID %q", id)
		}
	}
	for object := range opts.IDs {
		if !e.usedIDs[object] {
			return Document{}, fmt.Errorf("reverse: ID targets an object outside the exported tree")
		}
	}
	for id := range opts.NodeFontFamilies {
		if !e.usedFonts[id] {
			return Document{}, fmt.Errorf("reverse: font-family assertion targets an absent or non-text ID %q", id)
		}
	}
	if opts.CanvasBackground != nil && reflect.ValueOf(opts.CanvasBackground).Kind() == reflect.Pointer && reflect.ValueOf(opts.CanvasBackground).IsNil() {
		return Document{}, fmt.Errorf("reverse: CanvasBackground is a nil color")
	}
	if !coversViewport(e.doc.Roots, opts.Viewport, 0, 0) {
		if opts.CanvasBackground == nil {
			return Document{}, fmt.Errorf("reverse: tree does not guarantee opaque viewport coverage; CanvasBackground must explicitly assert the actual canvas background or color.Transparent")
		}
		id := "native-canvas-background"
		for suffix := 1; e.ids[id]; suffix++ {
			id = fmt.Sprintf("native-canvas-background-%d", suffix)
		}
		style := webui.Style{Width: opts.Viewport.Width, Height: opts.Viewport.Height, Background: cssColor(opts.CanvasBackground), Color: "transparent", BorderColor: "transparent", FontWeight: 400, FontStyle: "normal", TextAlign: "left", WhiteSpace: "normal", Opacity: 1, Measured: true}
		if err := validateStyle(style); err != nil {
			return Document{}, fmt.Errorf("reverse: invalid CanvasBackground: %w", err)
		}
		background := Node{ID: id, Kind: "container", Style: style, Children: []Node{}}
		e.doc.Roots = append([]Node{background}, e.doc.Roots...)
	}
	for action := range e.actions {
		e.doc.RequiredActions = append(e.doc.RequiredActions, action)
	}
	sort.Strings(e.doc.RequiredActions)
	return e.doc, nil
}

// A solid, visible, square background rectangle covering the viewport is enough
// to prove the canvas cannot show through. Coordinates remain native parent-local
// border-box coordinates; padding and CSS containing-block rules do not apply.
// Images, rounded edges and borders are deliberately not used as coverage proofs.
func coversViewport(nodes []Node, viewport Viewport, parentX, parentY float64) bool {
	for _, n := range nodes {
		s := n.Style
		if s.Display == "none" {
			continue
		}
		x, y := parentX+float64(s.X), parentY+float64(s.Y)
		fill, err := webui.ParseColor(s.Background)
		if n.Kind != "image" && err == nil && fill.A == 255 && s.Opacity == 1 && s.Radius == 0 && s.BorderWidth == 0 && x <= 0 && y <= 0 && x+float64(s.Width) >= float64(viewport.Width) && y+float64(s.Height) >= float64(viewport.Height) {
			return true
		}
		if coversViewport(n.Children, viewport, x, y) {
			return true
		}
	}
	return false
}

func (e *exporter) identify(object fyne.CanvasObject, fallback string) (string, error) {
	if object == nil || (reflect.ValueOf(object).Kind() == reflect.Pointer && reflect.ValueOf(object).IsNil()) {
		return "", fmt.Errorf("reverse: nil object at %q", fallback)
	}
	if !reflect.TypeOf(object).Comparable() {
		return "", fmt.Errorf("reverse: unsupported non-comparable object %T", object)
	}
	if e.objects[object] {
		return "", fmt.Errorf("reverse: cycle or shared object at %q", fallback)
	}
	e.objects[object] = true
	id := fallback
	if explicit, ok := e.opts.IDs[object]; ok {
		id = explicit
		e.usedIDs[object] = true
	}
	if id == "" || strings.TrimSpace(id) != id || strings.ContainsRune(id, '\x00') {
		return "", fmt.Errorf("reverse: invalid ID %q", id)
	}
	if e.ids[id] {
		return "", fmt.Errorf("reverse: duplicate ID %q", id)
	}
	e.ids[id] = true
	return id, nil
}

func geometry(object fyne.CanvasObject) webui.Style {
	p, s := object.Position(), object.Size()
	style := webui.Style{X: p.X, Y: p.Y, Width: s.Width, Height: s.Height, Background: "transparent", Color: "transparent", BorderColor: "transparent", FontWeight: 400, FontStyle: "normal", TextAlign: "left", WhiteSpace: "normal", Opacity: 1, Measured: true}
	if !object.Visible() {
		style.Display = "none"
	}
	return style
}

func (e *exporter) object(object fyne.CanvasObject, path string) (Node, error) {
	id, err := e.identify(object, path)
	if err != nil {
		return Node{}, err
	}
	n := Node{ID: id, Style: geometry(object), Children: []Node{}}
	if source, ok := object.(snapshotter); ok {
		snapshot, err := source.Snapshot()
		if err != nil {
			return Node{}, fmt.Errorf("reverse: View %q is invalid: %w", id, err)
		}
		if snapshot.HasFocus {
			return Node{}, fmt.Errorf("reverse: View %q has active focus/caret/selection not represented by scene schema 1; export an unfocused frame", id)
		}
		if snapshot.Measured && (snapshot.CaptureScale != e.opts.Viewport.Scale || snapshot.Size != fyne.NewSize(e.opts.Viewport.Width, e.opts.Viewport.Height)) {
			return Node{}, fmt.Errorf("reverse: View %q capture viewport or scale differs from export", id)
		}
		n.Kind = "container"
		for _, child := range snapshot.Roots {
			exported, err := e.snapshot(child)
			if err != nil {
				return Node{}, err
			}
			n.Children = append(n.Children, exported)
		}
		if err := e.events(&n, object, Events{}); err != nil {
			return Node{}, err
		}
		return n, validateStyle(n.Style)
	}
	var callbacks Events
	switch o := object.(type) {
	case *fyne.Container:
		n.Kind = "container"
		for i, child := range o.Objects {
			exported, err := e.object(child, fmt.Sprintf("%s-%d", id, i))
			if err != nil {
				return Node{}, err
			}
			n.Children = append(n.Children, exported)
		}
	case *canvas.Rectangle:
		n.Kind = "container"
		if o.StrokeWidth != 0 || o.Aspect != 0 || o.TopLeftCornerRadius != 0 || o.TopRightCornerRadius != 0 || o.BottomLeftCornerRadius != 0 || o.BottomRightCornerRadius != 0 || o.Shadow.Color != nil || o.Shadow.BlurRadius != 0 || o.Shadow.Spread != 0 || o.Shadow.Offset != (fyne.Position{}) {
			return Node{}, fmt.Errorf("reverse: rectangle %q uses unsupported centered stroke, aspect, per-corner radius or shadow", id)
		}
		n.Style.Background, n.Style.Radius = cssColor(o.FillColor), o.CornerRadius
	case *canvas.Text:
		n.Kind, n.Text = "text", o.Text
		if !portableSingleLine(o.Text) {
			return Node{}, fmt.Errorf("reverse: text %q requires literal whitespace/newline support not represented by schema 1", id)
		}
		font := o.FontSource
		if font == nil {
			font = theme.Current().Font(o.TextStyle)
		}
		if err := e.textStyle(&n, o.TextStyle, o.TextSize, o.Color, o.Alignment, font); err != nil {
			return Node{}, err
		}
	case *canvas.Image:
		n.Kind = "image"
		if o.FillMode != canvas.ImageFillStretch || o.ScaleMode != canvas.ImageScaleSmooth || o.CornerRadius != 0 || o.Translucency != 0 {
			return Node{}, fmt.Errorf("reverse: image %q requires stretch, smooth filtering, uniform opacity and no clipping", id)
		}
		n.Style.Opacity = float32(1 - o.Translucency)
		resource, err := imageResource(o)
		if err != nil {
			return Node{}, fmt.Errorf("reverse: image %q: %w", id, err)
		}
		n.Resource, err = e.bitmap(resource)
		if err != nil {
			return Node{}, fmt.Errorf("reverse: image %q: %w", id, err)
		}
	case *widget.Label:
		n.Kind, n.Text, n.AccessibleLabel = "text", o.Text, o.Text
		if o.Selectable || o.Wrapping != fyne.TextWrapOff || o.Truncation != fyne.TextTruncateOff || !portableSingleLine(o.Text) {
			return Node{}, fmt.Errorf("reverse: label %q requires single-line untruncated non-selectable text", id)
		}
		th := o.Theme()
		name := o.SizeName
		if name == "" {
			name = theme.SizeNameText
		}
		if err := e.textStyle(&n, o.TextStyle, th.Size(name), th.Color(labelColor(o.Importance), themeVariant()), o.Alignment, th.Font(o.TextStyle)); err != nil {
			return Node{}, err
		}
		pad := th.Size(theme.SizeNameInnerPadding)
		n.Style.PaddingTop, n.Style.PaddingRight, n.Style.PaddingBottom, n.Style.PaddingLeft = pad, pad, pad, pad
	case *widget.Button:
		n.Kind, n.Text, n.AccessibleLabel, n.Disabled = "button", o.Text, o.Text, o.Disabled()
		if o.Icon != nil || !portableSingleLine(o.Text) {
			return Node{}, fmt.Errorf("reverse: button %q icons/multiline text are unsupported", id)
		}
		th := o.Theme()
		foreground, background, err := buttonColors(o)
		if err != nil {
			return Node{}, err
		}
		align := fyne.TextAlignCenter
		switch o.Alignment {
		case widget.ButtonAlignLeading:
			align = fyne.TextAlignLeading
		case widget.ButtonAlignTrailing:
			align = fyne.TextAlignTrailing
		case widget.ButtonAlignCenter:
		default:
			return Node{}, fmt.Errorf("reverse: unsupported button alignment at %q", id)
		}
		if err := e.textStyle(&n, fyne.TextStyle{Bold: true}, th.Size(theme.SizeNameText), th.Color(foreground, themeVariant()), align, th.Font(fyne.TextStyle{Bold: true})); err != nil {
			return Node{}, err
		}
		if background != "" {
			n.Style.Background = cssColor(th.Color(background, themeVariant()))
		}
		n.Style.Radius = th.Size(theme.SizeNameButtonRadius)
		pad := th.Size(theme.SizeNameInnerPadding)
		n.Style.PaddingRight, n.Style.PaddingLeft = pad, pad
		// Fyne buttons vertically center their single line.
		n.Style.PaddingTop = max((n.Style.Height-n.Style.LineHeight)/2, 0)
		if o.OnTapped != nil {
			callbacks.Tap = "required"
		}
	case *widget.Entry:
		n.Kind, n.Value, n.Placeholder, n.Disabled = "input", o.Text, o.PlaceHolder, o.Disabled()
		if o.MultiLine {
			return Node{}, fmt.Errorf("reverse: textarea %q needs a shared hardline/softwrap contract not represented by schema 1 yet", id)
		}
		if o.Password || o.Validator != nil || o.AlwaysShowValidationError || o.ActionItem != nil || o.Icon != nil || o.OnCursorChanged != nil || (o.MultiLine && o.OnSubmitted != nil) {
			return Node{}, fmt.Errorf("reverse: entry %q password, validation, icons, cursor callbacks and multiline submit are unsupported", id)
		}
		if o.MultiLine && o.Wrapping != fyne.TextWrapWord {
			return Node{}, fmt.Errorf("reverse: textarea %q requires word wrapping", id)
		}
		th := o.Theme()
		col := theme.ColorNameForeground
		border := theme.ColorNameInputBorder
		if o.Disabled() {
			col, border = theme.ColorNameDisabled, theme.ColorNameDisabled
		}
		if err := e.textStyle(&n, o.TextStyle, th.Size(theme.SizeNameText), th.Color(col, themeVariant()), fyne.TextAlignLeading, th.Font(o.TextStyle)); err != nil {
			return Node{}, err
		}
		n.Style.Background, n.Style.BorderColor = cssColor(th.Color(theme.ColorNameInputBackground, themeVariant())), cssColor(th.Color(border, themeVariant()))
		if n.Placeholder != "" {
			placeholderColor := theme.ColorNamePlaceHolder
			if o.Disabled() {
				placeholderColor = theme.ColorNameDisabled
			}
			n.PlaceholderColor = cssColor(th.Color(placeholderColor, themeVariant()))
		}
		n.Style.BorderWidth, n.Style.Radius = th.Size(theme.SizeNameInputBorder), th.Size(theme.SizeNameInputRadius)
		if n.Style.BorderWidth != 0 {
			return Node{}, fmt.Errorf("reverse: entry %q has centered asymmetric native border chrome not represented by schema 1; use a borderless host theme", id)
		}
		pad := th.Size(theme.SizeNameInnerPadding)
		n.Style.PaddingTop, n.Style.PaddingRight, n.Style.PaddingBottom, n.Style.PaddingLeft = pad, pad, pad, pad
		if o.OnChanged != nil {
			callbacks.Input = "required"
		}
		if o.OnSubmitted != nil {
			callbacks.Submit = "required"
		}
	default:
		return Node{}, fmt.Errorf("reverse: unsupported object %T at %q", object, id)
	}
	if err := e.events(&n, object, callbacks); err != nil {
		return Node{}, err
	}
	if err := validateStyle(n.Style); err != nil {
		return Node{}, fmt.Errorf("reverse: %q: %w", id, err)
	}
	return n, nil
}

func (e *exporter) snapshot(source webui.SnapshotNode) (Node, error) {
	id, err := e.identify(source.Object, source.Node.ID)
	if err != nil {
		return Node{}, err
	}
	s := source.Node
	n := Node{ID: id, Kind: s.Kind, Text: s.Text, Value: s.Value, Placeholder: s.Placeholder, PlaceholderColor: source.PlaceholderColor, Disabled: s.Disabled, AccessibleLabel: s.AccessibleLabel, LabelFor: s.LabelFor, Style: s.Style, Children: []Node{}}
	if strings.ContainsAny(n.Text, "\r\n\t") || n.Style.WhiteSpace == "nowrap" && !portableSingleLine(n.Text) {
		return Node{}, fmt.Errorf("reverse: View %q literal whitespace/newlines are not represented by schema 1", id)
	}
	if n.Placeholder != "" && n.PlaceholderColor == "" {
		return Node{}, fmt.Errorf("reverse: View %q uses a custom editor whose placeholder paint is not exposed; use the public NewEditor factory", id)
	}
	switch n.Kind {
	case "container", "text", "button", "input", "textarea", "image":
	default:
		return Node{}, fmt.Errorf("reverse: unsupported View kind %q at %q", n.Kind, id)
	}
	if n.Kind == "textarea" {
		return Node{}, fmt.Errorf("reverse: View textarea %q needs a shared hardline/softwrap contract not represented by schema 1 yet", id)
	}
	if s.Href != "" {
		return Node{}, fmt.Errorf("reverse: View %q navigation requires an explicit tap action; href is not supported yet", id)
	}
	if s.Kind == "image" {
		n.Resource, err = e.bitmap(s.ImageResource)
		if err != nil {
			return Node{}, err
		}
	}
	if n.Text != "" || n.Kind == "input" || n.Kind == "textarea" {
		if family, ok := e.opts.NodeFontFamilies[id]; ok {
			n.Style.FontFamily = family
			e.usedFonts[id] = true
		}
		if strings.TrimSpace(n.Style.FontFamily) == "" {
			return Node{}, fmt.Errorf("reverse: View text %q requires an explicit equivalent browser font family", id)
		}
	}
	var callbacks Events
	if s.OnTap != nil {
		callbacks.Tap = "required"
	}
	if s.OnChange != nil {
		callbacks.Input = "required"
	}
	if s.OnCommit != nil {
		callbacks.Change = "required"
	}
	if err := e.events(&n, source.Object, callbacks); err != nil {
		return Node{}, err
	}
	for _, child := range source.Children {
		exported, err := e.snapshot(child)
		if err != nil {
			return Node{}, err
		}
		n.Children = append(n.Children, exported)
	}
	if err := validateStyle(n.Style); err != nil {
		return Node{}, fmt.Errorf("reverse: %q: %w", id, err)
	}
	return n, nil
}

func validActionName(name string) bool {
	if name == "" || len(utf16.Encode([]rune(name))) > 256 {
		return false
	}
	for _, r := range name {
		if r <= 0x1f || r == 0x7f {
			return false
		}
	}
	return true
}

func validTokenName(name string) bool {
	if !strings.HasPrefix(name, "--") || len(name) < 3 {
		return false
	}
	for _, r := range name[2:] {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}
func (e *exporter) events(n *Node, object fyne.CanvasObject, callbacks Events) error {
	bindings, hasObject := e.opts.Bindings[object]
	byID, hasID := e.opts.IDBindings[n.ID]
	if hasObject && hasID {
		return fmt.Errorf("reverse: %q has both object and ID event bindings", n.ID)
	}
	if hasObject {
		e.usedBindings[object] = true
	}
	if hasID {
		e.usedIDBindings[n.ID] = true
		bindings = byID
	}
	for _, pair := range []struct{ name, callback, binding string }{{"tap", callbacks.Tap, bindings.Tap}, {"input", callbacks.Input, bindings.Input}, {"change", callbacks.Change, bindings.Change}, {"submit", callbacks.Submit, bindings.Submit}} {
		if (pair.callback != "") != (pair.binding != "") {
			return fmt.Errorf("reverse: %q event %s requires exactly one named binding for its existing callback", n.ID, pair.name)
		}
		if pair.binding != "" {
			if !validActionName(pair.binding) {
				return fmt.Errorf("reverse: invalid action name %q", pair.binding)
			}
			e.actions[pair.binding] = true
		}
	}
	if bindings != (Events{}) {
		n.Events = &bindings
	}
	return nil
}

func (e *exporter) textStyle(n *Node, ts fyne.TextStyle, size float32, col color.Color, alignment fyne.TextAlign, font fyne.Resource) error {
	if ts.Symbol || ts.TabWidth != 0 || ts.Underline || ts.Strikethrough {
		return fmt.Errorf("reverse: text %q uses unsupported symbol font, tab width or decoration", n.ID)
	}
	family := ""
	if asserted, ok := e.opts.NodeFontFamilies[n.ID]; ok {
		family = asserted
		e.usedFonts[n.ID] = true
	} else if font == nil || reflect.TypeOf(font).Comparable() {
		family = e.opts.FontFamilies[font]
	}
	if strings.TrimSpace(family) == "" {
		return fmt.Errorf("reverse: text %q needs FontFamilies or NodeFontFamilies with an explicit equivalent licensed browser font", n.ID)
	}
	n.Style.FontFamily, n.Style.FontSize, n.Style.Color = family, size, cssColor(col)
	n.Style.FontWeight = 400
	if ts.Bold {
		n.Style.FontWeight = 700
	}
	if ts.Italic {
		n.Style.FontStyle = "italic"
	}
	n.Style.WhiteSpace = "nowrap"
	switch alignment {
	case fyne.TextAlignLeading:
		n.Style.TextAlign = "left"
	case fyne.TextAlignCenter:
		n.Style.TextAlign = "center"
	case fyne.TextAlignTrailing:
		n.Style.TextAlign = "right"
	default:
		return fmt.Errorf("reverse: unsupported text alignment at %q", n.ID)
	}
	if font == nil || fyne.CurrentApp() == nil {
		return fmt.Errorf("reverse: text %q requires a font resource and a Fyne application for native font metrics", n.ID)
	}
	metrics, _ := fyne.CurrentApp().Driver().RenderedTextSize("M", size, ts, font)
	n.Style.LineHeight = metrics.Height
	return nil
}

func (e *exporter) bitmap(resource fyne.Resource) (string, error) {
	if resource == nil || (reflect.ValueOf(resource).Kind() == reflect.Pointer && reflect.ValueOf(resource).IsNil()) {
		return "", fmt.Errorf("reverse: bitmap resource is missing")
	}
	content := resource.Content()
	if len(content) == 0 || len(content) > 20*1024*1024 {
		return "", fmt.Errorf("reverse: bitmap resource must contain 1..20 MiB of bytes")
	}
	content = append([]byte(nil), content...)
	frozen := fyne.NewStaticResource(resource.Name(), content)
	size, err := webui.ValidateBitmap(frozen)
	if err != nil {
		return "", fmt.Errorf("reverse: invalid bitmap: %w", err)
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(content))
	if name, ok := e.resources[hash]; ok {
		return name, nil
	}
	ext, media := "jpeg", "image/jpeg"
	if bytes.HasPrefix(content, []byte("\x89PNG\r\n\x1a\n")) {
		ext, media = "png", "image/png"
	}
	name := "bitmap-" + hash
	e.doc.Resources = append(e.doc.Resources, Resource{Name: name, Path: "assets/" + hash + "." + ext, Hash: hash, MediaType: media, Content: content, Width: int(size.Width), Height: int(size.Height)})
	e.resources[hash] = name
	return name, nil
}

func imageResource(o *canvas.Image) (fyne.Resource, error) {
	// Fyne's source reader prefers Resource over File; Refresh materializes that
	// source in Image, and the painter subsequently paints Image. These fields are
	// therefore not mutually exclusive. Compare the actual cached bitmap before
	// preserving original resource bytes, without calling Refresh during export.
	var source fyne.Resource
	if o.Resource != nil {
		source = o.Resource
	} else if o.File != "" {
		file, err := os.Open(o.File)
		if err != nil {
			return nil, err
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > 20*1024*1024 {
			return nil, fmt.Errorf("local bitmap must be a regular file of at most 20 MiB")
		}
		content, err := io.ReadAll(io.LimitReader(file, 20*1024*1024+1))
		if err != nil {
			return nil, err
		}
		if len(content) > 20*1024*1024 {
			return nil, fmt.Errorf("local bitmap exceeds 20 MiB")
		}
		source = fyne.NewStaticResource(o.File, content)
	}
	if source != nil {
		if reflect.ValueOf(source).Kind() == reflect.Pointer && reflect.ValueOf(source).IsNil() {
			return nil, fmt.Errorf("bitmap resource is nil")
		}
		content := source.Content()
		if len(content) == 0 || len(content) > 20*1024*1024 {
			return nil, fmt.Errorf("bitmap resource must contain 1..20 MiB of bytes")
		}
		source = fyne.NewStaticResource(source.Name(), append([]byte(nil), content...))
		if _, err := webui.ValidateBitmap(source); err != nil {
			return nil, err
		}
		if o.Image == nil {
			return source, nil
		}
		if err := validateDecodedBitmap(o.Image); err != nil {
			return nil, err
		}
		decoded, _, err := image.Decode(bytes.NewReader(source.Content()))
		if err != nil {
			return nil, err
		}
		if equalPixels(decoded, o.Image) {
			return source, nil
		}
		// A caller changed/replaced the decoded cache: export the bitmap currently
		// painted instead of stale Resource/File bytes, retaining no hidden asset.
	}
	if o.Image == nil {
		return nil, fmt.Errorf("bitmap source is missing")
	}
	if err := validateDecodedBitmap(o.Image); err != nil {
		return nil, err
	}
	bounds := o.Image.Bounds()
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 || bounds.Dx() > 16384 || bounds.Dy() > 16384 || int64(bounds.Dx())*int64(bounds.Dy()) > 64*1024*1024 {
		return nil, fmt.Errorf("decoded bitmap dimensions exceed the supported limits")
	}
	var encoded bytes.Buffer
	copy := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(copy, copy.Bounds(), o.Image, bounds.Min, draw.Src)
	if err := png.Encode(&encoded, copy); err != nil {
		return nil, err
	}
	return fyne.NewStaticResource("decoded.png", encoded.Bytes()), nil
}

func validateDecodedBitmap(bitmap image.Image) error {
	if bitmap == nil || (reflect.ValueOf(bitmap).Kind() == reflect.Pointer && reflect.ValueOf(bitmap).IsNil()) {
		return fmt.Errorf("decoded bitmap is nil")
	}
	switch bitmap := bitmap.(type) {
	case *image.NRGBA, *image.RGBA, *image.Gray, *image.Alpha, *image.CMYK, *image.YCbCr, *image.NYCbCrA:
	case *image.Paletted:
		for _, c := range bitmap.Palette {
			switch c.(type) {
			case color.NRGBA, color.RGBA, color.Gray, color.Alpha, color.CMYK:
			default:
				return fmt.Errorf("decoded palette requires standard 8-bit colors")
			}
		}
	default:
		return fmt.Errorf("decoded bitmap %T requires a standard 8-bit image; 16-bit and generic images cannot be quantized silently", bitmap)
	}
	bounds := bitmap.Bounds()
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 || bounds.Dx() > 16384 || bounds.Dy() > 16384 || int64(bounds.Dx())*int64(bounds.Dy()) > 64*1024*1024 {
		return fmt.Errorf("decoded bitmap dimensions exceed the supported limits")
	}
	return nil
}

func equalPixels(a, b image.Image) bool {
	ab, bb := a.Bounds(), b.Bounds()
	if ab.Size() != bb.Size() {
		return false
	}
	for y := 0; y < ab.Dy(); y++ {
		for x := 0; x < ab.Dx(); x++ {
			ac := color.NRGBAModel.Convert(a.At(ab.Min.X+x, ab.Min.Y+y)).(color.NRGBA)
			bc := color.NRGBAModel.Convert(b.At(bb.Min.X+x, bb.Min.Y+y)).(color.NRGBA)
			if ac != bc {
				return false
			}
		}
	}
	return true
}

func finite(v float32) bool { return !math.IsNaN(float64(v)) && !math.IsInf(float64(v), 0) }

func portableSingleLine(text string) bool {
	return !strings.ContainsAny(text, "\r\n\t") && strings.Trim(text, " ") == text && !strings.Contains(text, "  ")
}

func validateNodes(roots []Node) error {
	byID := map[string]Node{}
	var visit func([]Node, int) error
	visit = func(nodes []Node, depth int) error {
		if depth > 128 {
			return fmt.Errorf("reverse: tree exceeds depth limit 128")
		}
		for _, n := range nodes {
			byID[n.ID] = n
			if len(byID) > 100000 {
				return fmt.Errorf("reverse: tree exceeds node limit 100000")
			}
			if n.Kind != "container" && len(n.Children) != 0 {
				return fmt.Errorf("reverse: non-container %q cannot own child nodes in schema 1", n.ID)
			}
			if n.Kind == "container" && n.Text != "" && len(n.Children) != 0 {
				return fmt.Errorf("reverse: container %q combines text with children whose paint order is not represented by schema 1", n.ID)
			}
			if (n.Kind == "input" || n.Kind == "textarea" || n.Kind == "image") && n.Text != "" {
				return fmt.Errorf("reverse: %q combines a native control/image with overlay text", n.ID)
			}
			if n.Events != nil {
				if n.Events.Tap != "" && n.Kind != "button" {
					return fmt.Errorf("reverse: tap callback belongs to a button, at %q", n.ID)
				}
				if (n.Events.Input != "" || n.Events.Change != "" || n.Events.Submit != "") && n.Kind != "input" && n.Kind != "textarea" {
					return fmt.Errorf("reverse: text events belong to inputs, at %q", n.ID)
				}
			}
			if n.PlaceholderColor != "" {
				if n.Kind != "input" && n.Kind != "textarea" {
					return fmt.Errorf("reverse: placeholder belongs to text controls, at %q", n.ID)
				}
				if _, err := webui.ParseColor(n.PlaceholderColor); err != nil {
					return fmt.Errorf("reverse: invalid placeholder color at %q", n.ID)
				}
			}
			if err := visit(n.Children, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(roots, 0); err != nil {
		return err
	}
	for _, n := range byID {
		if n.LabelFor != "" {
			target, ok := byID[n.LabelFor]
			if n.Kind != "text" || !ok || (target.Kind != "input" && target.Kind != "textarea") {
				return fmt.Errorf("reverse: labelFor at %q must reference an exported input/textarea ID", n.ID)
			}
		}
	}
	return nil
}
func validateStyle(s webui.Style) error {
	for _, v := range []float32{s.X, s.Y, s.Width, s.Height, s.PaddingTop, s.PaddingRight, s.PaddingBottom, s.PaddingLeft, s.Gap, s.BorderWidth, s.Radius, s.FontSize, s.LineHeight, s.FontWeight, s.Opacity} {
		if !finite(v) {
			return fmt.Errorf("style contains a non-finite number")
		}
	}
	for _, v := range []float32{s.Width, s.Height, s.PaddingTop, s.PaddingRight, s.PaddingBottom, s.PaddingLeft, s.Gap, s.BorderWidth, s.Radius, s.FontSize, s.LineHeight, s.FontWeight} {
		if v < 0 {
			return fmt.Errorf("style contains a negative size")
		}
	}
	if s.Opacity != 1 {
		return fmt.Errorf("native group-opacity composition is unsupported by scene schema 1")
	}
	if s.FontWeight > 1000 || s.FontWeight != float32(math.Trunc(float64(s.FontWeight))) {
		return fmt.Errorf("unsupported font weight")
	}
	for name, pair := range map[string]struct {
		value   string
		allowed []string
	}{"direction": {s.Direction, []string{"", "row", "column"}}, "fontStyle": {s.FontStyle, []string{"", "normal", "italic"}}, "textAlign": {s.TextAlign, []string{"", "left", "start", "center", "right", "end"}}, "whiteSpace": {s.WhiteSpace, []string{"", "normal", "nowrap"}}, "display": {s.Display, []string{"", "none", "block", "flex", "inline", "inline-block"}}} {
		found := false
		for _, allowed := range pair.allowed {
			found = found || pair.value == allowed
		}
		if !found {
			return fmt.Errorf("unsupported %s %q", name, pair.value)
		}
	}
	for _, c := range []string{s.Background, s.Color, s.BorderColor} {
		if _, err := webui.ParseColor(c); err != nil {
			return fmt.Errorf("unsupported color %q: %w", c, err)
		}
	}
	return nil
}

func cssColor(c color.Color) string {
	if c == nil {
		return "transparent"
	}
	n := color.NRGBAModel.Convert(c).(color.NRGBA)
	return fmt.Sprintf("rgba(%d, %d, %d, %g)", n.R, n.G, n.B, float64(n.A)/255)
}
func themeVariant() fyne.ThemeVariant {
	if fyne.CurrentApp() != nil {
		return fyne.CurrentApp().Settings().ThemeVariant()
	}
	return theme.VariantLight
}
func labelColor(importance widget.Importance) fyne.ThemeColorName {
	switch importance {
	case widget.LowImportance:
		return theme.ColorNameDisabled
	case widget.HighImportance:
		return theme.ColorNamePrimary
	case widget.DangerImportance:
		return theme.ColorNameError
	case widget.WarningImportance:
		return theme.ColorNameWarning
	case widget.SuccessImportance:
		return theme.ColorNameSuccess
	default:
		return theme.ColorNameForeground
	}
}
func buttonColors(b *widget.Button) (fyne.ThemeColorName, fyne.ThemeColorName, error) {
	if b.Disabled() {
		background := theme.ColorNameDisabledButton
		if b.Importance == widget.LowImportance {
			background = ""
		}
		return theme.ColorNameDisabled, background, nil
	}
	switch b.Importance {
	case widget.LowImportance:
		return theme.ColorNameForeground, "", nil
	case widget.MediumImportance:
		return theme.ColorNameForeground, theme.ColorNameButton, nil
	case widget.HighImportance:
		return theme.ColorNameForegroundOnPrimary, theme.ColorNamePrimary, nil
	case widget.DangerImportance:
		return theme.ColorNameForegroundOnError, theme.ColorNameError, nil
	case widget.WarningImportance:
		return theme.ColorNameForegroundOnWarning, theme.ColorNameWarning, nil
	case widget.SuccessImportance:
		return theme.ColorNameForegroundOnSuccess, theme.ColorNameSuccess, nil
	default:
		return "", "", fmt.Errorf("reverse: unsupported button importance %v", b.Importance)
	}
}
