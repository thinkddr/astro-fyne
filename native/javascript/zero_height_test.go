// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"strings"
	"testing"
)

func TestCSSZeroHeightRequiresAnEmptyUndecoratedBlock(t *testing.T) {
	w := &Widget{}
	for _, value := range []any{float64(0), "0", "0px", "-0px", "0.00px", " \t\r\n\f0px\f\n\r\t "} {
		frame := Frame{UID: "panel", Tag: "section", CSS: true, Style: map[string]any{"height": value}}
		nodes, err := w.nodes([]Frame{frame})
		if err != nil || len(nodes) != 1 || nodes[0].Style.Height != 0 || nodes[0].Style.Flex == nil || !nodes[0].Style.Flex.HeightSet {
			t.Fatalf("authored zero lost presence: %v %+v %v", value, nodes, err)
		}
		frame.CSS = false
		if _, err = w.nodes([]Frame{frame}); err == nil || !strings.Contains(err.Error(), "inline-only zero") {
			t.Fatalf("inline zero silently acquired prototype sizing: %v %v", value, err)
		}
	}
	for _, frame := range []Frame{
		{Tag: "button"}, {Tag: "input"}, {Tag: "textarea"}, {Tag: "p"}, {Tag: "ul"},
		{Tag: "section", Children: []Frame{{UID: "child", Tag: "#text", Text: "overflow"}}},
		{Tag: "section", Style: map[string]any{"width": "10px"}},
		{Tag: "section", Style: map[string]any{"paddingTop": "1px"}},
		{Tag: "section", Style: map[string]any{"borderWidth": "1px"}},
		{Tag: "section", Style: map[string]any{"borderRadius": "1px"}},
		{Tag: "section", Style: map[string]any{"display": "none"}},
		{Tag: "section", Style: map[string]any{"flexDirection": "row"}},
	} {
		frame.UID, frame.CSS = "panel", true
		if frame.Style == nil { frame.Style = map[string]any{} }
		frame.Style["height"] = "0px"
		if _, err := w.nodes([]Frame{frame}); err == nil || !strings.Contains(err.Error(), "zero height") {
			t.Fatalf("unsupported zero-height frame was admitted: %+v %v", frame, err)
		}
	}
	for _, value := range []any{"1e-50px", "1e-500px", float64(1e-50)} {
		if _, err := w.nodes([]Frame{{UID: "panel", Tag: "section", CSS: true, Style: map[string]any{"height": value}}}); err == nil || !strings.Contains(err.Error(), "underflows") {
			t.Fatalf("positive authored height became zero: %v %v", value, err)
		}
	}
}

func TestCSSZeroHeightChecksAuthoredDecorationsBeforeNativeRounding(t *testing.T) {
	w := &Widget{}
	for _, height := range []any{float64(0), "0", "0px", " \t\r\n\f0.00px\f\n\r\t "} {
		for _, name := range []string{"padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderWidth", "borderRadius", "margin", "gap"} {
			for _, value := range []any{float64(1e-50), float64(-1e-50), "1e-50px", "1e-500px", " \t1e-50px\r\n\f", "0 px", "0/**/px", "\u00a00px", "0px\u2003"} {
				frame := Frame{UID: "panel", Tag: "section", CSS: true, Style: map[string]any{"height": height, name: value}}
				if _, err := w.nodes([]Frame{frame}); err == nil || !strings.Contains(err.Error(), "must be authored zero") {
					t.Fatalf("nonzero or invalid %s=%v became an admitted zero decoration: %v", name, value, err)
				}
			}
			if name == "borderRadius" {
				continue // Explicit zero radius retains its separate presence diagnostic.
			}
			for _, value := range []any{float64(0), "0", "0px", "-0px", "0.000e3px", " \t\r\n\f-0.00e-23px\f\n\r\t "} {
				frame := Frame{UID: "panel", Tag: "section", CSS: true, Style: map[string]any{"height": height, name: value}}
				if _, err := w.nodes([]Frame{frame}); err != nil {
					t.Fatalf("authored zero %s=%v was rejected: %v", name, value, err)
				}
			}
		}
	}
}
