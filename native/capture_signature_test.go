// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"math"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
)

func TestCaptureAttributeSignatureIsCanonicalTypedAndDetached(t *testing.T) {
	one := Scope{"style": Scope{"color": "red", "width": float64(100)}, "className": "box", "data-optional": Undefined}
	two := Scope{"data-optional": Undefined, "className": "box", "style": Scope{"width": 100, "color": "red"}}
	before := SnapshotAttributes("div", one)
	if before != SnapshotAttributes("div", two) {
		t.Fatal("map insertion order/native number representation changed signature")
	}
	one["style"].(Scope)["color"] = "blue"
	if before == SnapshotAttributes("div", one) {
		t.Fatal("signature failed to freeze evaluated style values")
	}
	values := []any{Undefined, nil, "undefined", "null", false, "false", float64(1), "1", []any{1}, Scope{"0": 1}, []any{}, Scope{}}
	seen := map[string]bool{}
	for _, value := range values {
		signature := SnapshotAttributes("div", Scope{"value": value})
		if seen[signature] {
			t.Fatalf("typed signature collision for %T %#v", value, value)
		}
		seen[signature] = true
	}
	if SnapshotAttributes("div", Scope{}) == SnapshotAttributes("div", Scope{"missing": Undefined}) {
		t.Fatal("undefined property collided with omission")
	}
	if SnapshotAttributes("div", Scope{"tag": "span"}) == SnapshotAttributes("span", Scope{"tag": "div"}) {
		t.Fatal("source tag collided with ordinary attribute")
	}
	shared := Scope{"color": "red"}
	SnapshotAttributes("div", Scope{"a": shared, "b": shared}) // Shared acyclic objects are legal.
}

type signatureStringer struct{ called *bool }

func (s signatureStringer) String() string { *s.called = true; return "callback" }

func TestCaptureAttributesRejectCallbacksCyclesAndNonfiniteValues(t *testing.T) {
	cyclicMap := Scope{}
	cyclicMap["self"] = cyclicMap
	cyclicSlice := make([]any, 1)
	cyclicSlice[0] = cyclicSlice
	called := false
	for name, value := range map[string]any{"function": func() { called = true }, "stringer": signatureStringer{&called}, "infinity": math.Inf(1), "nan": math.NaN(), "map cycle": cyclicMap, "array cycle": cyclicSlice, "nonstring keys": map[int]any{1: "a"}, "invalid UTF8": "\xff"} {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatal("unsupported captured attribute accepted")
				}
			}()
			SnapshotAttributes("div", Scope{"value": value})
		})
	}
	if called {
		t.Fatal("attribute snapshot invoked user code")
	}
}

func TestChangingCapturedClassOrStyleInvalidatesTheRealMeasuredView(t *testing.T) {
	a := test.NewApp()
	defer a.Quit()
	class, color := "red", "red"
	v := NewView(func() []Node {
		return []Node{{ID: "box", Kind: "container", CaptureSignature: SnapshotAttributes("div", Scope{"className": class, "style": Scope{"background": color}})}}
	})
	v.SetViewport(320, 240)
	if err := v.SetCaptureScale(1); err != nil {
		t.Fatal(err)
	}
	c := software.NewCanvas()
	c.SetPadded(false)
	c.Resize(fyne.NewSize(320, 240))
	c.SetContent(v)
	if err := v.BindCanvas(c); err != nil {
		t.Fatal(err)
	}
	profile := map[string]Style{"box": {Width: 320, Height: 240, Background: "#ff0000", Opacity: 1, Measured: true}}
	if err := v.ApplyMeasurements(profile); err != nil {
		t.Fatal(err)
	}
	if v.Error() != nil {
		t.Fatal(v.Error())
	}
	class = "blue"
	v.Refresh()
	if v.Error() == nil || !strings.Contains(v.Error().Error(), "visual state changed") {
		t.Fatalf("class-only update reused a stale profile: %v", v.Error())
	}
	if _, err := v.Snapshot(); err == nil {
		t.Fatal("stale measured frame was exported")
	}
	if err := v.ApplyMeasurements(profile); err != nil {
		t.Fatal(err)
	}
	color = "blue"
	v.Refresh()
	if v.Error() == nil {
		t.Fatal("style-only update reused a stale profile")
	}
}

func TestInvalidCaptureAttributesAreRecoveredAtBuilderBoundary(t *testing.T) {
	a := test.NewApp()
	defer a.Quit()
	invalid := false
	v := NewView(func() []Node {
		value := any("valid")
		if invalid {
			value = func() { t.Fatal("executed") }
		}
		return []Node{{ID: "box", Kind: "container", CaptureSignature: SnapshotAttributes("div", Scope{"data-value": value})}}
	})
	object := v.Object("box")
	invalid = true
	v.Refresh()
	if v.Error() == nil || !strings.Contains(v.Error().Error(), "generated render failed") {
		t.Fatalf("capture encoding failure escaped builder boundary: %v", v.Error())
	}
	if v.Object("box") != object {
		t.Fatal("invalid attributes partly mutated the previously valid tree")
	}
}
