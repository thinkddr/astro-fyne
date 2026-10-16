// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"

	"fyne.io/fyne/v2/test"
)

func TestProgramArchivePreservesSpecialDataAndReferenceIdentity(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	builds, calls := 0, 0
	v := NewView(func() []Node { builds++; return []Node{{ID: "text", Kind: "text", Text: "portable"}} })
	shared := Scope{"zero": math.Copysign(0, -1), "nan": math.NaN(), "positive": math.Inf(1), "negative": math.Inf(-1), "missing": Undefined, "false": false, "empty": ""}
	shared["self"] = shared
	first, second := make([]any, 0, 1), make([]any, 0, 1)
	props := Scope{"shared": shared, "first": first, "second": second, "same": first, "save": func() { calls++ }}
	state := Scope{"slot": shared, "array": first, "site/@key-kind": byte('s')}
	program := `{"actions":["save"],"literal":"<>&` + "\u2028" + `"}`
	before := builds
	archive, err := ExportProgram(program, strings.Repeat("a", 64), props, state, v)
	if err != nil {
		t.Fatal(err)
	}
	if builds != before || calls != 0 {
		t.Fatal("export invoked the builder or callback")
	}
	data, err := json.Marshal(archive)
	if err != nil {
		t.Fatal(err)
	}
	restoredProps, restoredState, err := RestoreProgram(string(data), program, nil, Actions{"save": func(...any) any { return nil }})
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := restoredProps["save"]; !exists {
		t.Fatal("a named callback binding was lost")
	}
	left := restoredProps["shared"].(Scope)
	right := restoredState["slot"].(Scope)
	left["changed"] = "retained"
	if right["changed"] != "retained" || left["self"].(Scope)["changed"] != "retained" {
		t.Fatal("shared or cyclic data lost identity")
	}
	if !math.Signbit(left["zero"].(float64)) || !math.IsNaN(left["nan"].(float64)) || !math.IsInf(left["positive"].(float64), 1) || !math.IsInf(left["negative"].(float64), -1) || !isUndefined(left["missing"]) || left["false"] != false || left["empty"] != "" {
		t.Fatal("portable primitives changed meaning")
	}
	if restoredState["site/@key-kind"] != byte('s') {
		t.Fatal("restored list metadata changed its native type")
	}
	pointer := func(value any) uintptr { return reflect.ValueOf(value).Pointer() }
	if pointer(restoredProps["first"]) == pointer(restoredProps["second"]) || pointer(restoredProps["first"]) != pointer(restoredProps["same"]) || pointer(restoredProps["first"]) != pointer(restoredState["array"]) {
		t.Fatal("empty array identities changed")
	}
	left["nan"] = 7
	if !math.IsNaN(shared["nan"].(float64)) {
		t.Fatal("restored values alias live host data")
	}
}

func TestProgramArchiveRejectsDataWithoutAnExplicitContract(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	v := NewView(func() []Node { return []Node{{ID: "text", Kind: "text", Text: "portable"}} })
	for _, value := range []any{func() {}, make(chan int), "\xff", map[int]any{1: "x"}} {
		if _, err := ExportProgram(`{"actions":[]}`, strings.Repeat("a", 64), Scope{"value": value}, Scope{}, v); err == nil {
			t.Fatalf("unsupported portable data %T was accepted", value)
		}
	}
	archive, err := ExportProgram(`{"actions":[]}`, strings.Repeat("a", 64), Scope{}, Scope{}, v)
	if err != nil {
		t.Fatal(err)
	}
	archive.ProgramHash = strings.Repeat("b", 64)
	if _, err := ExportProgram(`{"actions":[]}`, strings.Repeat("a", 64), Scope{"one": []any{}, "two": []any{}}, Scope{}, v); err == nil {
		t.Fatal("ambiguous empty slice identities were silently conflated")
	}
	data, _ := json.Marshal(archive)
	if _, _, err := RestoreProgram(string(data), archive.Program, nil, nil); err == nil {
		t.Fatal("changed program identity was accepted")
	}
}

func TestProgramArchiveRequiresCommittedUnfocusedEditorValues(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	state := Scope{"value": "A"}
	v := NewView(func() []Node {
		return []Node{{ID: "field", Kind: "input", Value: String(state["value"]), OnCommit: func(s string) { state["value"] = s }}}
	})
	window, field := focusCommitField(t, v)
	if _, err := ExportProgram(`{"actions":[]}`, strings.Repeat("a", 64), Scope{}, state, v); err == nil {
		t.Fatal("focused editor was exported")
	}
	field.TypedRune('b')
	if _, err := ExportProgram(`{"actions":[]}`, strings.Repeat("a", 64), Scope{}, state, v); err == nil {
		t.Fatal("pending editor value was exported")
	}
	window.Canvas().Unfocus()
	if _, err := ExportProgram(`{"actions":[]}`, strings.Repeat("a", 64), Scope{}, state, v); err != nil {
		t.Fatal(err)
	}
	if state["value"] != "Ab" {
		t.Fatal("committed declared value was lost")
	}
}
