// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
package javascript

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
	"strings"
	"testing"
	"time"
)

func testArchive(code string) Archive {
	digest := sha256.Sum256([]byte(code))
	return Archive{Schema: 1, Kind: "astro-fyne-javascript", Code: code, CodeHash: hex.EncodeToString(digest[:]), Sources: []Source{{Path: "test.js", Hash: hex.EncodeToString(digest[:])}}, Props: json.RawMessage(`{}`), Actions: []string{}, Events: []Event{}, Journal: []JournalEntry{}}
}
func TestGojaExecutionIsInterruptedAndCanReleaseItsRuntime(t *testing.T) {
	started := time.Now()
	_, err := New(testArchive(`function(){while(true){}}`), nil)
	if err == nil || !strings.Contains(err.Error(), "exceeded") || time.Since(started) > 3*time.Second {
		t.Fatalf("infinite source did not produce a bounded diagnostic: %v", err)
	}
}
func TestJavascriptFailurePreservesTheLastValidNativeFrame(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	code := `function(){return {flush(){},finishReplay(){},snapshot(){return [{uid:"1",tag:"button",attrs:{id:"button"},children:[{uid:"2",tag:"#text",text:"Before"}]}]},dispatch(){throw new Error("source handler failed")},export(){return {}}}}`
	view, err := New(testArchive(code), webui.Actions{})
	if err != nil {
		t.Fatal(err)
	}
	original := view.Object("button")
	view.dispatch("1", "click", nil)
	if view.Error() == nil || !strings.Contains(view.Error().Error(), "source handler failed") || view.Object("button") != original {
		t.Fatalf("failed event did not retain its prior native object: %v", view.Error())
	}
	if _, err = view.ExportJavascript(); err == nil {
		t.Fatal("invalid native frame was exported")
	}
}
func TestJavascriptStylesAreIndependentOfMapIterationAndRejectUnknownRules(t *testing.T) {
	for range 100 {
		style, err := sourceStyle(map[string]any{"lineHeight": float64(1.5), "fontSize": "20px"})
		if err != nil || style.LineHeight != 30 {
			t.Fatalf("line height depended on map order: %+v, %v", style, err)
		}
	}
	for _, properties := range []map[string]any{{"position": "absolute"}, {"padding": "10px", "paddingLeft": "20px"}, {"background": "red", "backgroundColor": "blue"}, {"display": "grid"}, {"gap": "50%"}} {
		if _, err := sourceStyle(properties); err == nil {
			t.Fatalf("unsupported CSS was silently accepted: %v", properties)
		}
	}
}
func TestJavascriptDimensionStringsAllowOnlyOuterCSSWhitespace(t *testing.T) {
	for _, value := range []string{"120px", " 120px", "120px ", "\t120px\t", "\r120px\r", "\n120px\n", "\f120px\f", " \t\r\n\f120px\f\n\r\t "} {
		style, err := sourceStyle(map[string]any{"width": value, "height": value, "padding": value, "gap": value, "fontSize": value, "lineHeight": value, "borderWidth": value, "borderRadius": value})
		if err != nil || style.Width != 120 || style.Height != 120 || style.PaddingTop != 120 || style.PaddingRight != 120 || style.PaddingBottom != 120 || style.PaddingLeft != 120 || style.Gap != 120 || style.FontSize != 120 || style.LineHeight != 120 || style.BorderWidth != 120 || style.Radius != 120 {
			t.Fatalf("outer CSS whitespace changed dimension %q: %+v, %v", value, style, err)
		}
	}
	style, err := sourceStyle(map[string]any{"fontSize": " \t20px\r\n\f", "lineHeight": float64(1.5)})
	if err != nil || style.FontSize != 20 || style.LineHeight != 30 {
		t.Fatalf("padded font size did not determine the line-height multiplier: %+v, %v", style, err)
	}
	for _, value := range []string{"12 0px", "120 px", "12\t0px", "120p x", "1e 2px", "120\fpx", "\u00a0120px", "120px\u00a0", "\u2003120px\u2003", "\ufeff120px", "\v120px", "/* gap */120px", "120px/* gap */", "12/**/0px", "120/**/px", " \t120 px\r\n"} {
		if _, err := sourceStyle(map[string]any{"width": value}); err == nil {
			t.Fatalf("invalid dimension was joined or Unicode-trimmed: %q", value)
		}
	}
}

func TestJavascriptCSSZeroSizingCannotBypassThePresenceGuardWithWhitespace(t *testing.T) {
	w := &Widget{}
	for _, name := range []string{"width", "fontSize", "lineHeight", "borderRadius"} {
		for _, value := range []any{float64(0), "0px", " \t\r\n\f0px\f\n\r\t "} {
			_, err := w.nodes([]Frame{{UID: "1", Tag: "div", CSS: true, Style: map[string]any{name: value}}})
			if err == nil || !strings.Contains(err.Error(), "CSS zero "+name) {
				t.Fatalf("CSS zero %s=%v bypassed its presence diagnostic: %v", name, value, err)
			}
		}
	}
	nodes, err := w.nodes([]Frame{{UID: "1", Tag: "div", CSS: true, Style: map[string]any{"width": " 120px "}}})
	if err != nil || len(nodes) != 1 || nodes[0].Style.Width != 120 {
		t.Fatalf("padded positive CSS dimension was rejected: %+v, %v", nodes, err)
	}
	nodes, err = w.nodes([]Frame{{UID: "1", Tag: "div", Style: map[string]any{"width": " 0px "}}})
	if err != nil || len(nodes) != 1 || nodes[0].Style.Width != 0 {
		t.Fatalf("CSS-only presence guard changed legacy dimensions: %+v, %v", nodes, err)
	}
}

func TestJavascriptDisabledAttributeRequiresANativeControl(t *testing.T) {
	w := &Widget{}
	for _, tag := range []string{"div", "section", "span", "label", "a"} {
		if _, err := w.nodes([]Frame{{UID: "1", Tag: tag, Attrs: map[string]string{"disabled": "false"}}}); err == nil || !strings.Contains(err.Error(), "disabled requires") {
			t.Fatalf("disabled attribute was accepted on <%s>: %v", tag, err)
		}
	}
	for _, tag := range []string{"input", "textarea", "button"} {
		for _, disabled := range []bool{false, true} {
			nodes, err := w.nodes([]Frame{{UID: "1", Tag: tag, Attrs: map[string]string{"disabled": ""}, Disabled: disabled}})
			if err != nil || len(nodes) != 1 || nodes[0].Disabled != disabled {
				t.Fatalf("native <%s> lost resolved disabled=%v: %+v, %v", tag, disabled, nodes, err)
			}
		}
	}
}

func TestJavascriptInputTypesUseOnlyASCIICaseNormalization(t *testing.T) {
	w := &Widget{}
	for _, raw := range []string{"checkbox", "CHECKBOX", "ChEcKbOx"} {
		nodes, err := w.nodes([]Frame{{UID: "1", Tag: "input", Attrs: map[string]string{"type": raw, "checked": "", "disabled": ""}, Checked: true, Disabled: true}})
		if err != nil || len(nodes) != 1 || nodes[0].Kind != "checkbox" || !nodes[0].Checked || !nodes[0].Disabled || nodes[0].OnChecked == nil || nodes[0].OnChange != nil {
			t.Fatalf("ASCII checkbox type %q lost its native behavior: %+v, %v", raw, nodes, err)
		}
	}
	for _, raw := range []string{"", "text", "TEXT", "TeXt"} {
		nodes, err := w.nodes([]Frame{{UID: "1", Tag: "input", Attrs: map[string]string{"type": raw}, Value: "Draft"}})
		if err != nil || len(nodes) != 1 || nodes[0].Kind != "input" || nodes[0].Value != "Draft" || nodes[0].OnChange == nil || nodes[0].OnCommit == nil {
			t.Fatalf("ASCII text type %q lost its native behavior: %+v, %v", raw, nodes, err)
		}
	}
	for _, raw := range []string{"chec\u212abox", " TEXT ", "password"} {
		if _, err := w.nodes([]Frame{{UID: "1", Tag: "input", Attrs: map[string]string{"type": raw}}}); err == nil || !strings.Contains(err.Error(), "input type") {
			t.Fatalf("unsupported raw type was Unicode-folded or broadened: %q, %v", raw, err)
		}
	}
}

func TestJavascriptCheckedStateSurvivesTextInputModeWithoutCheckboxPaint(t *testing.T) {
	w := &Widget{}
	frame := Frame{UID: "1", Tag: "input", Attrs: map[string]string{"type": "checkbox", "checked": ""}, Checked: true, Value: "Draft"}
	for _, kind := range []string{"checkbox", "TEXT", "checkbox"} {
		frame.Attrs["type"] = kind
		nodes, err := w.nodes([]Frame{frame})
		if err != nil || len(nodes) != 1 {
			t.Fatalf("retained checked attribute rejected in input mode %q: %v", kind, err)
		}
		node := nodes[0]
		if kind == "TEXT" {
			if node.Kind != "input" || node.Value != "Draft" || node.Checked || node.OnChecked != nil || node.OnChange == nil || node.OnCommit == nil {
				t.Fatalf("retained checked attribute changed native text behavior: %+v", node)
			}
		} else if node.Kind != "checkbox" || !node.Checked || node.OnChecked == nil {
			t.Fatalf("switching input modes lost checkbox state: %+v", node)
		}
		if _, checked := frame.Attrs["checked"]; !checked || !frame.Checked {
			t.Fatal("native lowering changed retained source checked state")
		}
	}
	for _, tag := range []string{"div", "button", "textarea", "a"} {
		if _, err := w.nodes([]Frame{{UID: "1", Tag: tag, Attrs: map[string]string{"checked": ""}}}); err == nil || !strings.Contains(err.Error(), "checked requires") {
			t.Fatalf("checked attribute was accepted on <%s>: %v", tag, err)
		}
	}
}

func TestJavascriptTextareaUsesResolvedValueWithoutChildNodes(t *testing.T) {
	w := &Widget{}
	for _, value := range []string{"Default\nvalue", "Edited", ""} {
		frame := Frame{UID: "1", Tag: "textarea", Value: value, Children: []Frame{{UID: "2", Tag: "#text", Text: "Default"}, {UID: "3", Tag: "#text", Text: "\nvalue"}}}
		nodes, err := w.nodes([]Frame{frame})
		if err != nil || len(nodes) != 1 || nodes[0].Kind != "textarea" || nodes[0].Value != value || nodes[0].Text != "" || len(nodes[0].Children) != 0 || nodes[0].OnChange == nil || nodes[0].OnCommit == nil {
			t.Fatalf("textarea default text replaced its resolved value or became child paint: %+v, %v", nodes, err)
		}
		if frame.Children[0].Text != "Default" || len(frame.Children) != 2 {
			t.Fatal("textarea lowering changed the source default text")
		}
	}
	for _, tag := range []string{"span", "div", "input"} {
		if _, err := w.nodes([]Frame{{UID: "1", Tag: "textarea", Value: "Text", Children: []Frame{{UID: "2", Tag: tag, Text: "Text"}}}}); err == nil || !strings.Contains(err.Error(), "rich text in <textarea>") {
			t.Fatalf("rich textarea child <%s> was silently discarded: %v", tag, err)
		}
	}
}

func TestJavascriptArchivesRejectChangedCodeAndUnboundJournalActions(t *testing.T) {
	archive := testArchive(`function(){return {}}`)
	archive.Code += " "
	if err := Validate(archive); err == nil {
		t.Fatal("changed code passed its recorded digest")
	}
	archive = testArchive(`function(){return {}}`)
	value := "null"
	archive.Journal = []JournalEntry{{Kind: "action", Name: "missing", Args: "[]", Value: &value}}
	if err := Validate(archive); err == nil {
		t.Fatal("journal accepted an undeclared action")
	}
}
