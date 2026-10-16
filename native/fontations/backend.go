//go:build atf_fontations && linux && arm64 && cgo

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontations

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"math"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	webui "github.com/thinkddr/astro-fyne/native"
)

// ErrClosed reports use after the host closes the backend.
var ErrClosed = errors.New("fontations: backend is closed")

// Policy contains explicit native requests. It does not attest browser policy.
type Policy struct {
	Hinting         uint32  `json:"hinting"`
	AutoHint        uint32  `json:"auto_hint"`
	EmbeddedBitmaps uint32  `json:"embedded_bitmaps"`
	Subpixel        uint32  `json:"subpixel"`
	LinearMetrics   uint32  `json:"linear_metrics"`
	Edging          uint32  `json:"edging"`
	BaselineSnap    uint32  `json:"baseline_snap"`
	PixelGeometry   uint32  `json:"pixel_geometry"`
	Contrast        float32 `json:"contrast"`
	Gamma           float32 `json:"gamma"`
}

// LicensedFont retains the original font and its redistribution notice.
// Both resources are copied before the native font is opened.
type LicensedFont struct {
	Resource fyne.Resource
	License  fyne.Resource
}

// Options selects an explicit library, licensed static fonts and shaping policy.
type Options struct {
	LibraryPath string
	Fonts       map[string]map[webui.Font]LicensedFont
	Policy      Policy
}

// FontNotice is a fresh copy of a registered font's redistribution notice.
type FontNotice struct {
	Family        string
	Face          webui.Font
	FontName      string
	FontSHA256    string
	LicenseName   string
	LicenseSHA256 string
	Content       []byte
}

// Metrics records the native line in logical CSS pixels.
type Metrics struct {
	Advance  float32 `json:"advanceCSS"`
	Ascent   float32 `json:"ascentCSS"`
	Descent  float32 `json:"descentCSS"`
	Leading  float32 `json:"leadingCSS"`
	Baseline float32 `json:"baselineCSS"`
}

// Glyph is a copied native shaping record. Fixed fields use signed 16.16 units.
type Glyph struct {
	ID             uint32  `json:"glyph"`
	ClusterUTF8    uint32  `json:"clusterUTF8"`
	XAdvance       int32   `json:"xAdvance16_16"`
	YAdvance       int32   `json:"yAdvance16_16"`
	XOffset        int32   `json:"xOffset16_16"`
	YOffset        int32   `json:"yOffset16_16"`
	NominalAdvance float32 `json:"nominalAdvanceCSS"`
	X              float32 `json:"xCSS"`
	Y              float32 `json:"yCSS"`
}

// Snapshot contains only Go values. Glyphs is a fresh copy on every request.
type Snapshot struct {
	Text                string  `json:"text"`
	FontSize            float32 `json:"fontSizeCSS"`
	LineHeight          float32 `json:"lineHeightCSS"`
	SourceFontSHA256    string  `json:"sourceFontHash"`
	EffectiveFontSHA256 string  `json:"effectiveFontHash"`
	Policy              Policy  `json:"policy"`
	Metrics             Metrics `json:"metrics"`
	Glyphs              []Glyph `json:"glyphs"`
}

type fontKey struct {
	family string
	face   webui.Font
}

type fontEntry struct {
	family, sourceHash, effectiveHash string
	face                              webui.Font
	resource                          fyne.Resource
	licenseName, licenseHash          string
	license                           []byte
	native                            *nativeFont
}

// Backend owns the native engines and library. Close it only after its views
// stop painting. Existing canvas objects hold copied glyphs, not native runs.
// Hosts must retain FontNotices and the compiled engine's upstream notices.
type Backend struct {
	mu      sync.Mutex
	library *nativeLibrary
	fonts   map[fontKey]*fontEntry
	policy  Policy
	closed  bool
	err     error
	base    webui.FyneBackend
}

var _ webui.Backend = (*Backend)(nil)
var _ webui.TextValidator = (*Backend)(nil)
var _ webui.EditorLineStyler = (*Backend)(nil)
var _ webui.EditorTextPlacer = (*Backend)(nil)

// NewBackend loads the explicitly selected library. No native run survives a
// shape call. The initial implementation has no shape cache; a Text reuses its
// immutable line for measurement and painting until text or font settings change.
func NewBackend(options Options) (*Backend, error) {
	if !filepath.IsAbs(options.LibraryPath) || strings.ContainsRune(options.LibraryPath, 0) {
		return nil, fmt.Errorf("fontations: library path must be absolute and contain no NUL")
	}
	if err := validatePolicy(options.Policy); err != nil {
		return nil, err
	}
	fonts, err := freezeFonts(options.Fonts)
	if err != nil {
		return nil, err
	}
	library, err := openLibrary(options.LibraryPath)
	if err != nil {
		return nil, err
	}
	b := &Backend{library: library, fonts: fonts, policy: options.Policy}
	for _, entry := range fonts {
		engine, effective, err := library.openFont(entry.resource.Content())
		if err != nil {
			closeErr := b.Close()
			return nil, errors.Join(fmt.Errorf("fontations: font %q: %w", entry.family, err), closeErr)
		}
		entry.native = engine
		entry.effectiveHash = digest(effective)
	}
	return b, nil
}

// Error returns the last failure until ClearError. It always reports ErrClosed
// after Close; successful metric queries cannot hide paint failures.
func (b *Backend) Error() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.err
}

// ClearError clears an earlier failure while the backend remains open.
func (b *Backend) ClearError() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.closed {
		b.err = nil
	}
}

// Close waits for shape/paint calls, then closes all engines before the library.
// It is idempotent. Lines reject subsequent measurement and paint requests.
func (b *Backend) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return nil
	}
	b.closed = true
	for _, entry := range b.fonts {
		if entry.native != nil && b.library != nil {
			b.library.closeFont(entry.native)
		}
	}
	var err error
	if b.library != nil {
		err = b.library.close()
	}
	b.library = nil
	b.err = errors.Join(ErrClosed, err)
	return err
}

// FontNotices returns independent notice bytes, also after Close.
func (b *Backend) FontNotices() []FontNotice {
	b.mu.Lock()
	defer b.mu.Unlock()
	result := make([]FontNotice, 0, len(b.fonts))
	for _, entry := range b.fonts {
		result = append(result, FontNotice{Family: entry.family, Face: entry.face, FontName: entry.resource.Name(),
			FontSHA256: entry.sourceHash, LicenseName: entry.licenseName, LicenseSHA256: entry.licenseHash, Content: bytes.Clone(entry.license)})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Family != result[j].Family {
			return result[i].Family < result[j].Family
		}
		if result[i].Face.Weight != result[j].Face.Weight {
			return result[i].Face.Weight < result[j].Face.Weight
		}
		return !result[i].Face.Italic && result[j].Face.Italic
	})
	return result
}

func (b *Backend) Defaults(n webui.Node) webui.Style { return b.base.Defaults(n) }
func (b *Backend) Box(s webui.Style) webui.Box       { return b.base.Box(s) }

func (b *Backend) Validate(s webui.Style, text bool) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return b.rememberLocked(ErrClosed)
	}
	if !text {
		return b.base.Validate(s, false)
	}
	_, err := b.fontLocked(s, false)
	return b.rememberLocked(err)
}

func (b *Backend) ValidateText(text string, s webui.Style) error {
	_, err := b.Shape(text, s)
	return err
}

func (b *Backend) Measure(text string, s webui.Style) fyne.Size {
	line, err := b.Shape(text, s)
	if err != nil {
		return fyne.Size{}
	}
	size, _, _ := line.Metrics()
	return size
}

func (b *Backend) Text(value string, s webui.Style) *canvas.Text {
	line, err := b.Shape(value, s)
	t := &canvas.Text{Text: value, TextSize: s.FontSize, TextStyle: fyne.TextStyle{Bold: s.FontWeight == 700, Italic: s.FontStyle == "italic"}}
	t.Color, _ = webui.ParseColor(s.Color)
	if err != nil {
		t.Layout = failedLine{err}
		return t
	}
	t.FontSource, t.Layout = line.font.resource, line
	return t
}

func (b *Backend) PlaceText(t *canvas.Text, s webui.Style, x, y float32) {
	if t == nil {
		b.mu.Lock()
		b.rememberLocked(fmt.Errorf("fontations: cannot place nil text"))
		b.mu.Unlock()
		return
	}
	if err := b.validatePlacementStyle(s, t.Text == ""); err != nil {
		t.Layout = failedLine{err}
		return
	}
	if t.Text != "" {
		if _, err := opaqueRGB(t.Color); err != nil {
			b.mu.Lock()
			b.rememberLocked(err)
			b.mu.Unlock()
			t.Layout = failedLine{err}
			return
		}
	}
	line, same := t.Layout.(*Line)
	if !same || line.backend != b || line.text != t.Text || line.style.FontSize != s.FontSize || line.style.LineHeight != s.LineHeight ||
		line.style.FontFamily != s.FontFamily || line.style.FontWeight != s.FontWeight || line.style.FontStyle != s.FontStyle {
		var err error
		line, err = b.Shape(t.Text, s)
		if err != nil {
			t.Layout = failedLine{err}
			return
		}
		t.Layout = line
	}
	if line.editorLineTopSnap {
		ordinary := *line
		ordinary.editorLineTopSnap = false
		line = &ordinary
		t.Layout = line
	}
	t.FontSource, t.TextSize = line.font.resource, s.FontSize
	t.TextStyle = fyne.TextStyle{Bold: s.FontWeight == 700, Italic: s.FontStyle == "italic",
		Underline: t.TextStyle.Underline, Strikethrough: t.TextStyle.Strikethrough}
	t.Move(fyne.NewPos(x, y))
	t.Resize(t.MinSize())
}

// PlaceEditorText retains the logical line box and enables whole-CSS-pixel line
// top rounding only when the immutable layout paints at its accumulated origin.
func (b *Backend) PlaceEditorText(t *canvas.Text, s webui.Style, x, y float32) {
	b.PlaceText(t, s, x, y)
	if t == nil {
		return
	}
	if line, ok := t.Layout.(*Line); ok && line.backend == b {
		editor := *line
		editor.editorLineTopSnap = true
		t.Layout = &editor
	}
}

func (b *Backend) Editor(multiline bool, s webui.Style, onChange func(string)) webui.Editor {
	if multiline {
		err := fmt.Errorf("fontations: multiline editors are unsupported")
		b.mu.Lock()
		b.rememberLocked(err)
		b.mu.Unlock()
		return webui.NewEditor(failedEditorBackend{Backend: b, err: err}, multiline, s, onChange)
	}
	return webui.NewEditor(b, false, s, onChange)
}

// EditorLineStyle follows the pinned Blink plain-input inner editor rule.
// The fixed height is authored border-box height, not the padded content height.
func (b *Backend) EditorLineStyle(s webui.Style) (webui.Style, error) {
	if s.Flex == nil || s.Flex.BoxSizing != "border-box" {
		return s, nil
	}
	if err := b.Validate(s, true); err != nil {
		return webui.Style{}, err
	}
	// Blink assigns ComputedLineHeight() to int before these comparisons.
	computed := float32(math.Trunc(float64(s.LineHeight)))
	if s.FontSize < computed && s.Flex.HeightPercent == nil && (!s.Flex.HeightSet || s.Height <= computed) {
		return s, nil
	}
	line, err := b.Shape("", s)
	if err != nil {
		return webui.Style{}, err
	}
	metrics := line.Snapshot().Metrics
	normal := float32(math.Round(float64(metrics.Ascent)) + math.Round(float64(metrics.Descent)) + math.Round(float64(metrics.Leading)))
	if !finite(normal) || normal <= 0 || normal > 1024 {
		err := fmt.Errorf("fontations: normal editor line height is outside 0..1024")
		b.mu.Lock()
		b.rememberLocked(err)
		b.mu.Unlock()
		return webui.Style{}, err
	}
	s.LineHeight = normal
	return s, nil
}

type failedEditorBackend struct {
	*Backend
	err error
}

func (b failedEditorBackend) Measure(string, webui.Style) fyne.Size { return fyne.Size{} }
func (b failedEditorBackend) Text(value string, style webui.Style) *canvas.Text {
	return &canvas.Text{Text: value, Layout: failedLine{b.err}}
}
func (b failedEditorBackend) PlaceText(t *canvas.Text, _ webui.Style, x, y float32) {
	t.Layout = failedLine{b.err}
	t.Move(fyne.NewPos(x, y))
}

type failedLine struct{ err error }

func (f failedLine) Metrics() (fyne.Size, float32, error)                      { return fyne.Size{}, 0, f.err }
func (f failedLine) PaintSoftware(*image.NRGBA, canvas.TextPaintContext) error { return f.err }

func (b *Backend) rememberLocked(err error) error {
	if err != nil {
		b.err = err
	}
	return err
}

func (b *Backend) validatePlacementStyle(s webui.Style, empty bool) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return b.rememberLocked(ErrClosed)
	}
	_, err := b.fontLocked(s, empty)
	return b.rememberLocked(err)
}

func (b *Backend) fontLocked(s webui.Style, empty bool) (*fontEntry, error) {
	if !finite(s.FontSize) || !finite(s.LineHeight) || s.FontSize <= 0 || s.FontSize > 256 || s.LineHeight <= 0 || s.LineHeight > 1024 ||
		(s.FontWeight != 400 && s.FontWeight != 700) || (s.FontStyle != "normal" && s.FontStyle != "italic") || s.WhiteSpace != "nowrap" ||
		(s.TextAlign != "" && s.TextAlign != "left" && s.TextAlign != "center" && s.TextAlign != "right") {
		return nil, fmt.Errorf("fontations: require font-size 0..256, line-height 0..1024, weight 400/700, normal/italic and one nowrap line")
	}
	color, err := webui.ParseColor(s.Color)
	if err != nil || (!empty && color.A != 255) {
		return nil, fmt.Errorf("fontations: text requires an explicit opaque solid color")
	}
	if !finite(s.Opacity) || (empty && (s.Opacity < 0 || s.Opacity > 1)) || (!empty && s.Opacity != 1) {
		return nil, fmt.Errorf("fontations: text opacity other than 1 is unsupported")
	}
	family := strings.Trim(strings.TrimSpace(s.FontFamily), "\"'")
	if family == "" || strings.Contains(family, ",") {
		return nil, fmt.Errorf("fontations: require one registered font family without fallback")
	}
	entry := b.fonts[fontKey{family: strings.ToLower(family), face: webui.Font{Weight: int(s.FontWeight), Italic: s.FontStyle == "italic"}}]
	if entry == nil {
		return nil, fmt.Errorf("fontations: no licensed font for %q weight %v style %q", family, s.FontWeight, s.FontStyle)
	}
	return entry, nil
}

func validatePolicy(p Policy) error {
	if p.Hinting > 3 || p.Edging > 2 || p.PixelGeometry > 2 || p.AutoHint > 1 || p.EmbeddedBitmaps > 1 || p.Subpixel > 1 || p.LinearMetrics > 1 || p.BaselineSnap > 1 ||
		!finite(p.Contrast) || p.Contrast < 0 || p.Contrast > 1 || !finite(p.Gamma) || p.Gamma < 0 || p.Gamma >= 4 {
		return fmt.Errorf("fontations: unsupported explicit policy")
	}
	return nil
}

func freezeFonts(source map[string]map[webui.Font]LicensedFont) (map[fontKey]*fontEntry, error) {
	fonts := map[fontKey]*fontEntry{}
	families := map[string]bool{}
	for family, faces := range source {
		name := strings.TrimSpace(family)
		key := strings.ToLower(name)
		if name == "" || strings.ContainsAny(name, ",\"'") || families[key] || len(faces) == 0 {
			return nil, fmt.Errorf("fontations: require unique nonempty font families and faces")
		}
		families[key] = true
		for face, licensed := range faces {
			if (face.Weight != 400 && face.Weight != 700) || licensed.Resource == nil || licensed.License == nil {
				return nil, fmt.Errorf("fontations: each face requires weight 400/700, a font and its license notice")
			}
			data, notice := bytes.Clone(licensed.Resource.Content()), bytes.Clone(licensed.License.Content())
			if len(data) == 0 || len(data) > 20*1024*1024 || len(notice) == 0 || len(notice) > 1024*1024 {
				return nil, fmt.Errorf("fontations: font bytes require 1..20MiB and notice 1..1MiB")
			}
			if err := validateStaticTTF(data); err != nil {
				return nil, err
			}
			hash := digest(data)
			resourceName := licensed.Resource.Name()
			if !strings.HasSuffix(resourceName, "#sha256="+hash) {
				resourceName += "#sha256=" + hash
			}
			resource := &frozenResource{name: resourceName, content: data}
			fonts[fontKey{family: key, face: face}] = &fontEntry{family: name, face: face, sourceHash: hash, resource: resource,
				licenseName: licensed.License.Name(), licenseHash: digest(notice), license: notice}
			if len(fonts) > 64 {
				return nil, fmt.Errorf("fontations: at most 64 explicit font faces are supported")
			}
		}
	}
	if len(fonts) == 0 {
		return nil, fmt.Errorf("fontations: at least one licensed font is required")
	}
	return fonts, nil
}

type frozenResource struct {
	name    string
	content []byte
}

func (r *frozenResource) Name() string    { return r.name }
func (r *frozenResource) Content() []byte { return bytes.Clone(r.content) }

func validateStaticTTF(data []byte) error {
	if len(data) < 12 || binary.BigEndian.Uint32(data[:4]) != 0x00010000 {
		return fmt.Errorf("fontations: only static single-face TrueType resources are supported")
	}
	count := int(binary.BigEndian.Uint16(data[4:6]))
	if count == 0 || count > (len(data)-12)/16 {
		return fmt.Errorf("fontations: invalid TrueType table directory")
	}
	for i := 0; i < count; i++ {
		table := data[12+i*16 : 28+i*16]
		start, length := uint64(binary.BigEndian.Uint32(table[8:12])), uint64(binary.BigEndian.Uint32(table[12:16]))
		if start+length > uint64(len(data)) {
			return fmt.Errorf("fontations: TrueType table is outside the resource")
		}
		switch string(table[:4]) {
		case "fvar", "gvar", "avar", "CFF2":
			return fmt.Errorf("fontations: variable fonts require an explicit future adapter")
		}
	}
	return nil
}

func validateText(text string) error {
	if len(text) > 4096 || !utf8.ValidString(text) {
		return fmt.Errorf("fontations: text requires valid UTF-8 and at most 4096 bytes")
	}
	for _, r := range text {
		if (r >= ' ' && r <= '~') || r == '\u0301' || r == '\u0308' {
			continue
		}
		return fmt.Errorf("fontations: unsupported U+%04X; only ASCII and acute/diaeresis marks are supported", r)
	}
	return nil
}

func digest(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }
func finite(value float32) bool { return !math.IsNaN(float64(value)) && !math.IsInf(float64(value), 0) }
