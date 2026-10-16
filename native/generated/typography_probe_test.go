// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package generated

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

type typographyProbeConfig struct {
	Schema   int    `json:"schema"`
	ID       string `json:"id"`
	Fixture  string `json:"fixture"`
	Viewport struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"viewport"`
	Scales []int `json:"scales"`
	Font   struct {
		Family     string  `json:"family"`
		WebSrc     string  `json:"webSrc"`
		Path       string  `json:"path"`
		Weight     int     `json:"weight"`
		Style      string  `json:"style"`
		Size       float32 `json:"size"`
		LineHeight float32 `json:"lineHeight"`
	} `json:"font"`
	Foreground string                  `json:"foreground"`
	Background string                  `json:"background"`
	Samples    []typographyProbeSample `json:"samples"`
}

type typographyProbeSample struct {
	ID       string   `json:"id"`
	Text     string   `json:"text"`
	X        float32  `json:"x"`
	Y        float32  `json:"y"`
	Width    float32  `json:"width"`
	Height   float32  `json:"height"`
	FontSize *float32 `json:"fontSize,omitempty"`
}

type typographyPoint struct {
	X float32 `json:"x"`
	Y float32 `json:"y"`
}

type typographySize struct {
	Width  float32 `json:"width"`
	Height float32 `json:"height"`
}

type typographyDriverMetrics struct {
	Width    float32 `json:"width"`
	Height   float32 `json:"height"`
	Baseline float32 `json:"baseline"`
}

type typographyPixelOrigin struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type typographyTextEvidence struct {
	NodeID                    string                  `json:"nodeID"`
	Text                      string                  `json:"text"`
	FontHash                  string                  `json:"fontHash"`
	FontResourceName          string                  `json:"fontResourceName"`
	FontSize                  float32                 `json:"fontSize"`
	LineHeight                float32                 `json:"lineHeight"`
	TextStyle                 fyne.TextStyle          `json:"textStyle"`
	LineBox                   typographyProbeSample   `json:"lineBox"`
	LocalPosition             typographyPoint         `json:"localPosition"`
	AbsolutePosition          typographyPoint         `json:"absolutePosition"`
	CanvasTextSize            typographySize          `json:"canvasTextSize"`
	BackendMeasure            typographySize          `json:"backendMeasure"`
	DriverText                typographyDriverMetrics `json:"driverText"`
	DriverH                   typographyDriverMetrics `json:"driverH"`
	DriverSpace               typographyDriverMetrics `json:"driverSpace"`
	RoundedProbeAscent        float32                 `json:"roundedProbeAscent"`
	ProbeHeightMinusBaseline  float32                 `json:"probeHeightMinusBaseline"`
	RoundedProbeDescentAndGap float32                 `json:"roundedProbeDescentAndGap"`
	HalfLeading               float32                 `json:"halfLeading"`
	IntendedLogicalBaseline   float32                 `json:"intendedLogicalBaseline"`
	PlacedProbeBaseline       float32                 `json:"placedProbeBaseline"`
	ScaledPosition            typographyPoint         `json:"scaledPosition"`
	PhysicalOrigin            *typographyPixelOrigin  `json:"physicalOrigin,omitempty"`
	OriginDerivation          string                  `json:"originDerivation"`
	CeilOrigin                typographyPixelOrigin   `json:"ceilOrigin"`
	NearestOrigin             typographyPixelOrigin   `json:"nearestOrigin"`
}

type typographyProbeFrame struct {
	Schema               int                      `json:"schema"`
	ID                   string                   `json:"id"`
	FrameID              string                   `json:"frameID"`
	SourceHash           string                   `json:"sourceHash"`
	ProbeHash            string                   `json:"probeHash"`
	FixtureHash          string                   `json:"fixtureHash"`
	FontHash             string                   `json:"fontHash"`
	Variant              string                   `json:"variant"`
	OriginQuantization   string                   `json:"originQuantization"`
	Viewport             flexViewport             `json:"viewport"`
	Texts                []typographyTextEvidence `json:"texts"`
	PNGHash              string                   `json:"pngHash"`
	RGBAHash             string                   `json:"rgbaHash"`
	DiagnosticOnly       bool                     `json:"diagnosticOnly"`
	PixelPerfectVerified bool                     `json:"pixelPerfectVerified"`
}

// The sidecar receives actual canvas.Text inputs, not guessed nominal glyph IDs.
type typographyTraceCase struct {
	FrameID         string                  `json:"frameID"`
	NodeID          string                  `json:"nodeID"`
	Purpose         string                  `json:"purpose"`
	Text            string                  `json:"text"`
	FontSize        float32                 `json:"fontSize"`
	Scale           float32                 `json:"scale"`
	TextStyle       fyne.TextStyle          `json:"textStyle"`
	ExpectedMetrics typographyDriverMetrics `json:"expectedMetrics"`
	PhysicalOrigin  *typographyPixelOrigin  `json:"physicalOrigin,omitempty"`
}

type typographyTraceInput struct {
	Schema               int                   `json:"schema"`
	ID                   string                `json:"id"`
	SourceHash           string                `json:"sourceHash"`
	ProbeHash            string                `json:"probeHash"`
	FixtureHash          string                `json:"fixtureHash"`
	FontHash             string                `json:"fontHash"`
	FontPath             string                `json:"fontPath"`
	FontResourceName     string                `json:"fontResourceName"`
	Variant              string                `json:"variant"`
	OriginQuantization   string                `json:"originQuantization"`
	DiagnosticOnly       bool                  `json:"diagnosticOnly"`
	PixelPerfectVerified bool                  `json:"pixelPerfectVerified"`
	Cases                []typographyTraceCase `json:"cases"`
}

func typographyHash(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func typographyFinite(value float32) bool {
	return !math.IsNaN(float64(value)) && !math.IsInf(float64(value), 0)
}

func typographyRepositoryFile(t *testing.T, relative string) string {
	t.Helper()
	clean := filepath.Clean(relative)
	if relative == "" || filepath.IsAbs(relative) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean != relative {
		t.Fatalf("typography input must be a repository-relative file: %q", relative)
	}
	absolute, err := filepath.Abs(filepath.Join("../..", relative))
	if err != nil {
		t.Fatal(err)
	}
	return absolute
}

func typographyValidateConfig(t *testing.T, config typographyProbeConfig) {
	t.Helper()
	if config.Schema != 1 || config.ID != "typography-probe" || config.Viewport.Width != 512 || config.Viewport.Height != 256 ||
		len(config.Scales) != 2 || config.Scales[0] != 1 || config.Scales[1] != 2 || config.Font.Family == "" ||
		config.Font.Weight != 400 || config.Font.Style != "normal" || config.Font.WebSrc != "/fonts/NotoSans-Regular.ttf" ||
		!typographyFinite(config.Font.Size) || config.Font.Size <= 0 || !typographyFinite(config.Font.LineHeight) || config.Font.LineHeight <= 0 || len(config.Samples) != 7 {
		t.Fatal("typography probe requires its explicit 512x256, scale 1/2, seven-row font contract")
	}
	seen := map[string]bool{}
	fractional := false
	for _, sample := range config.Samples {
		if sample.ID == "" || seen[sample.ID] || sample.Text == "" || !utf8.ValidString(sample.Text) || strings.ContainsAny(sample.Text, "\r\n\t") {
			t.Fatal("typography samples require unique IDs and nonempty single-line UTF-8 text")
		}
		seen[sample.ID] = true
		for _, value := range []float32{sample.X, sample.Y, sample.Width, sample.Height} {
			if !typographyFinite(value) || value < 0 {
				t.Fatal("typography sample geometry must be finite and nonnegative")
			}
		}
		if sample.Width <= 0 || sample.Height != config.Font.LineHeight || sample.X+sample.Width > float32(config.Viewport.Width) || sample.Y+sample.Height > float32(config.Viewport.Height) {
			t.Fatal("typography sample line box must fit the explicit viewport")
		}
		if sample.FontSize != nil {
			if !typographyFinite(*sample.FontSize) || *sample.FontSize <= 0 {
				t.Fatal("typography font-size overrides must be finite and positive")
			}
			fractional = fractional || *sample.FontSize == 14.5
		}
	}
	if !fractional {
		t.Fatal("typography evidence must include the 14.5px shaping probe")
	}
}

func TestTypographyProbeSoftwareCanvasEvidence(t *testing.T) {
	configBytes, err := os.ReadFile("../../typography-probe.json")
	if err != nil {
		t.Fatal(err)
	}
	var config typographyProbeConfig
	if err := decodeFlexJSON(configBytes, &config); err != nil {
		t.Fatal(err)
	}
	typographyValidateConfig(t, config)
	fontPath := typographyRepositoryFile(t, config.Font.Path)
	fontBytes, err := os.ReadFile(fontPath)
	if err != nil {
		t.Fatal(err)
	}
	fixtureBytes, err := os.ReadFile(typographyRepositoryFile(t, config.Fixture))
	if err != nil {
		t.Fatal(err)
	}
	probeHash, fixtureHash, fontHash := typographyHash(configBytes), typographyHash(fixtureBytes), typographyHash(fontBytes)
	identityBytes, err := json.Marshal([]string{probeHash, fixtureHash, fontHash})
	if err != nil {
		t.Fatal(err)
	}
	sourceHash := typographyHash(identityBytes)
	resource := fyne.NewStaticResource(config.Font.Path+"#sha256="+fontHash, bytes.Clone(fontBytes))
	backend := webui.FyneBackend{Fonts: map[string]map[webui.Font]fyne.Resource{config.Font.Family: {{Weight: config.Font.Weight}: resource}}}
	validator, ok := any(backend).(webui.TextValidator)
	if !ok {
		t.Fatal("the native typography backend must validate glyph coverage")
	}
	foreground, err := webui.ParseColor(config.Foreground)
	if err != nil || foreground.A != 255 {
		t.Fatal("typography foreground must be a supported opaque color")
	}
	background, err := webui.ParseColor(config.Background)
	if err != nil || background.A != 255 {
		t.Fatal("typography background must be a supported opaque color")
	}
	out := os.Getenv("ASTRO_FYNE_TYPOGRAPHY_ARTIFACTS")
	variant := os.Getenv("ASTRO_FYNE_TEXT_VARIANT")
	quantization := os.Getenv("ASTRO_FYNE_TEXT_ORIGIN")
	if quantization != "" && quantization != "ceil" && quantization != "nearest" {
		t.Fatal("ASTRO_FYNE_TEXT_ORIGIN must be ceil or nearest")
	}
	if out != "" && (variant == "" || quantization == "") {
		t.Fatal("exported typography evidence requires an explicit CI variant and origin policy")
	}
	app := test.NewApp()
	t.Cleanup(app.Quit)
	trace := typographyTraceInput{Schema: 1, ID: config.ID, SourceHash: sourceHash, ProbeHash: probeHash, FixtureHash: fixtureHash,
		FontHash: fontHash, FontPath: fontPath, FontResourceName: resource.Name(), Variant: variant, OriginQuantization: quantization,
		DiagnosticOnly: true, PixelPerfectVerified: false, Cases: []typographyTraceCase{}}
	for _, scale := range config.Scales {
		t.Run(fmt.Sprintf("scale-%d", scale), func(t *testing.T) {
			target := software.NewCanvas()
			target.SetPadded(false)
			target.SetScale(float32(scale))
			target.Resize(fyne.NewSize(float32(config.Viewport.Width), float32(config.Viewport.Height)))
			fill := canvas.NewRectangle(background)
			fill.Resize(target.Size())
			objects := []fyne.CanvasObject{fill}
			texts := make([]*canvas.Text, len(config.Samples))
			styles := make([]webui.Style, len(config.Samples))
			for index, sample := range config.Samples {
				size := config.Font.Size
				if sample.FontSize != nil {
					size = *sample.FontSize
				}
				style := webui.Style{Measured: true, FontFamily: config.Font.Family, FontWeight: float32(config.Font.Weight), FontStyle: config.Font.Style,
					FontSize: size, LineHeight: config.Font.LineHeight, Color: config.Foreground, WhiteSpace: "nowrap", TextAlign: "left", Opacity: 1}
				if err := backend.Validate(style, true); err != nil {
					t.Fatal(err)
				}
				for _, text := range []string{sample.Text, "H", " "} {
					if err := validator.ValidateText(text, style); err != nil {
						t.Fatalf("%s: %v", sample.ID, err)
					}
				}
				measured := backend.Measure(sample.Text, style)
				if measured.Width > sample.Width {
					t.Fatalf("%s exceeds its controlled line box", sample.ID)
				}
				text := backend.Text(sample.Text, style)
				backend.PlaceText(text, style, sample.X, sample.Y)
				texts[index], styles[index] = text, style
				objects = append(objects, text)
			}
			root := container.NewWithoutLayout(objects...)
			target.SetContent(root)
			capture := target.Capture()
			if capture.Bounds() != image.Rect(0, 0, config.Viewport.Width*scale, config.Viewport.Height*scale) {
				t.Fatalf("physical typography viewport differs: %v", capture.Bounds())
			}
			frameID := fmt.Sprintf("scale-%d", scale)
			frame := typographyProbeFrame{Schema: 1, ID: config.ID, FrameID: frameID, SourceHash: sourceHash, ProbeHash: probeHash,
				FixtureHash: fixtureHash, FontHash: fontHash, Variant: variant, OriginQuantization: quantization,
				Viewport: flexViewport{config.Viewport.Width, config.Viewport.Height, scale}, Texts: []typographyTextEvidence{},
				DiagnosticOnly: true, PixelPerfectVerified: false}
			for index, text := range texts {
				sample, style := config.Samples[index], styles[index]
				if text.FontSource == nil || typographyHash(text.FontSource.Content()) != fontHash || text.Text != sample.Text || color.NRGBAModel.Convert(text.Color) != foreground {
					t.Fatal("captured typography text, color or resource differs from the requested input")
				}
				metric := func(value string) typographyDriverMetrics {
					size, baseline := app.Driver().RenderedTextSize(value, text.TextSize, text.TextStyle, text.FontSource)
					return typographyDriverMetrics{size.Width, size.Height, baseline}
				}
				textMetric, hMetric, spaceMetric := metric(text.Text), metric("H"), metric(" ")
				position, size := text.Position(), text.Size()
				absolute := position.Add(root.Position())
				if text.Alignment != fyne.TextAlignLeading || size.Width != textMetric.Width || size.Height != textMetric.Height {
					t.Fatal("the controlled text acquired a painter alignment offset")
				}
				if absolute.X < 0 || absolute.Y < 0 || absolute.X+size.Width > target.Size().Width || absolute.Y+size.Height > target.Size().Height {
					t.Fatal("the natural canvas.Text box extends outside the physical viewport")
				}
				measure := backend.Measure(text.Text, style)
				ascent := float32(math.Round(float64(hMetric.Baseline)))
				descentAndGap := hMetric.Height - hMetric.Baseline
				roundedDescentAndGap := float32(math.Round(float64(descentAndGap)))
				halfLeading := float32(math.Floor(float64(style.LineHeight-ascent-roundedDescentAndGap) / 2))
				scaledX, scaledY := absolute.X*float32(scale), absolute.Y*float32(scale)
				ceilOrigin := typographyPixelOrigin{int(math.Ceil(float64(scaledX))), int(math.Ceil(float64(scaledY)))}
				nearestOrigin := typographyPixelOrigin{int(math.Round(float64(scaledX))), int(math.Round(float64(scaledY)))}
				var origin *typographyPixelOrigin
				if quantization == "ceil" {
					origin = &ceilOrigin
				} else if quantization == "nearest" {
					origin = &nearestOrigin
				}
				frame.Texts = append(frame.Texts, typographyTextEvidence{NodeID: sample.ID, Text: text.Text, FontHash: fontHash,
					FontResourceName: text.FontSource.Name(), FontSize: text.TextSize, LineHeight: style.LineHeight, TextStyle: text.TextStyle,
					LineBox: sample, LocalPosition: typographyPoint{position.X, position.Y}, AbsolutePosition: typographyPoint{absolute.X, absolute.Y},
					CanvasTextSize: typographySize{size.Width, size.Height}, BackendMeasure: typographySize{measure.Width, measure.Height},
					DriverText: textMetric, DriverH: hMetric, DriverSpace: spaceMetric, RoundedProbeAscent: ascent,
					ProbeHeightMinusBaseline: descentAndGap, RoundedProbeDescentAndGap: roundedDescentAndGap, HalfLeading: halfLeading,
					IntendedLogicalBaseline: root.Position().Y + sample.Y + halfLeading + ascent, PlacedProbeBaseline: absolute.Y + hMetric.Baseline,
					ScaledPosition: typographyPoint{scaledX, scaledY}, PhysicalOrigin: origin,
					OriginDerivation: "verified software painter formula applied to actual canvas.Text position; not inferred from ink bounds",
					CeilOrigin:       ceilOrigin, NearestOrigin: nearestOrigin})
				for _, probe := range []struct {
					purpose string
					value   string
					metrics typographyDriverMetrics
				}{{"text", text.Text, textMetric}, {"H", "H", hMetric}, {"space", " ", spaceMetric}} {
					var paintedOrigin *typographyPixelOrigin
					if probe.purpose == "text" {
						paintedOrigin = origin
					}
					trace.Cases = append(trace.Cases, typographyTraceCase{FrameID: frameID, NodeID: sample.ID, Purpose: probe.purpose,
						Text: probe.value, FontSize: text.TextSize, Scale: float32(scale), TextStyle: text.TextStyle,
						ExpectedMetrics: probe.metrics, PhysicalOrigin: paintedOrigin})
				}
			}
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, capture); err != nil {
				t.Fatal(err)
			}
			frame.PNGHash = typographyHash(encoded.Bytes())
			rgba := make([]byte, 0, capture.Bounds().Dx()*capture.Bounds().Dy()*4)
			for y := capture.Bounds().Min.Y; y < capture.Bounds().Max.Y; y++ {
				for x := capture.Bounds().Min.X; x < capture.Bounds().Max.X; x++ {
					pixel := color.NRGBAModel.Convert(capture.At(x, y)).(color.NRGBA)
					rgba = append(rgba, pixel.R, pixel.G, pixel.B, pixel.A)
				}
			}
			frame.RGBAHash = typographyHash(rgba)
			if out == "" {
				return
			}
			directory := filepath.Join(out, frameID)
			if err := os.MkdirAll(directory, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(directory, "native.png"), encoded.Bytes(), 0644); err != nil {
				t.Fatal(err)
			}
			if err := writeFlexJSON(filepath.Join(directory, "native-text.json"), frame); err != nil {
				t.Fatal(err)
			}
		})
	}
	if out != "" {
		if len(trace.Cases) != len(config.Scales)*len(config.Samples)*3 {
			t.Fatal("typography shaping sidecar input is incomplete")
		}
		if err := writeFlexJSON(filepath.Join(out, "texttrace-input.json"), trace); err != nil {
			t.Fatal(err)
		}
	}
}
