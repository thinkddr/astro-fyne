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
