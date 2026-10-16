// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"crypto/sha256"
	"encoding/hex"
	"reflect"
	"testing"

	"fyne.io/fyne/v2/test"
)

func stylesheetArchive() Archive {
	archive := testArchive(`function(host,archive){return {flush(){},finishReplay(){},snapshot(){return [{uid:"1",tag:"p",children:[{uid:"2",tag:"#text",text:"Source"}]}]},export(){return archive}}}`)
	text := "\ufeff/* café */\r\np { color: red; }\r\n"
	digest := sha256.Sum256([]byte(text))
	sheet := Stylesheet{Path: "../styles/main.css", Hash: hex.EncodeToString(digest[:]), Text: text}
	archive.Sources = append(archive.Sources, Source{Path: sheet.Path, Hash: sheet.Hash})
	archive.Stylesheets = []Stylesheet{sheet}
	return archive
}

func TestStylesheetSourcesSurviveNativeExecutionExportAndRestore(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	archive := stylesheetArchive()
	view, err := New(archive, nil)
	if err != nil {
		t.Fatal(err)
	}
	exported, err := view.ExportJavascript()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(exported.Stylesheets, archive.Stylesheets) {
		t.Fatalf("native execution changed retained CSS bytes: %#v", exported.Stylesheets)
	}
	restored, err := New(exported, nil)
	if err != nil {
		t.Fatal(err)
	}
	continued, err := restored.ExportJavascript()
	if err != nil || !reflect.DeepEqual(continued.Stylesheets, archive.Stylesheets) {
		t.Fatalf("native restore changed retained CSS bytes: %#v, %v", continued.Stylesheets, err)
	}
}

func TestStylesheetSourceMetadataCannotContradictRetainedBytes(t *testing.T) {
	cases := map[string]func(*Archive){
		"changed text": func(a *Archive) { a.Stylesheets[0].Text += " " },
		"missing source": func(a *Archive) { a.Stylesheets[0].Path = "missing.css" },
		"duplicate stylesheet": func(a *Archive) { a.Stylesheets = append(a.Stylesheets, a.Stylesheets[0]) },
		"duplicate source": func(a *Archive) { a.Sources = append(a.Sources, a.Sources[1]) },
		"invalid UTF-8": func(a *Archive) { a.Stylesheets[0].Text = string([]byte{0xff}) },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			archive := stylesheetArchive()
			change(&archive)
			if err := Validate(archive); err == nil {
				t.Fatal("invalid stylesheet source was accepted")
			}
		})
	}
	legacy := stylesheetArchive()
	legacy.Stylesheets = nil
	if err := Validate(legacy); err != nil {
		t.Fatalf("old archive without CSS sources was rejected: %v", err)
	}
}
