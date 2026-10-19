// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package catalog

import (
	"encoding/json"
	"strings"
	"testing"

	"fyne.io/fyne/v2/test"
	"github.com/thinkddr/astro-fyne/native/javascript"
)

func animatedCatalogue(t *testing.T) Spec {
	t.Helper()
	spec := fixture(t)
	code := `function(host,archive){var state={schema:1,timeMs:0,playState:"paused"};function copy(value){return JSON.parse(JSON.stringify(value))}function snapshot(){return [{uid:"panel",tag:"div",attrs:{id:"panel"},css:true,style:{height:(20+state.timeMs/10)+"px"}}]}return {flush(){},snapshot,finishReplay(){state=copy(archive.animation);if(archive.frame&&JSON.stringify(archive.frame)!==JSON.stringify(snapshot()))throw new Error("frame mismatch")},animationState(){return copy(state)},advanceAnimations(ms){if(ms<state.timeMs)throw new Error("backwards");state.timeMs=ms},pauseAnimations(){state.playState="paused"},playAnimations(){state.playState="running"},export(){var saved=copy(archive);saved.animation=copy(state);saved.frame=snapshot();return saved},dispose(){}}}`
	archive := javascript.Archive{Schema:2,Kind:"astro-fyne-javascript",Code:code,CodeHash:digest([]byte(code)),Sources:[]javascript.Source{{Path:"animation.js",Hash:digest([]byte(code))}},Props:json.RawMessage(`{}`),Actions:[]string{},Events:[]javascript.Event{},Journal:[]javascript.JournalEntry{},Animation:&javascript.AnimationState{Schema:1,TimeMS:0,PlayState:"paused"}}
	payload, err := json.Marshal(archive)
	if err != nil { t.Fatal(err) }
	spec.Components[0].Payload, spec.Components[0].Hash = string(payload), digest(payload)
	spec.Components[0].Stylesheets, spec.Components[0].Actions = []string{}, []string{}
	return spec
}

func TestAnimatedCatalogueIslandsKeepIndependentTimelineCheckpoints(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	registry := requireRegistry(t, animatedCatalogue(t))
	leftObject, err := registry.NewIsland("left", nil)
	if err != nil { t.Fatal(err) }
	left := leftObject.(*javascript.Widget)
	defer left.Close()
	rightObject, err := registry.NewIsland("right", nil)
	if err != nil { t.Fatal(err) }
	right := rightObject.(*javascript.Widget)
	defer right.Close()
	if left == right || left.Object("panel") == right.Object("panel") { t.Fatal("equal island keys shared a native timeline") }
	if err = left.AdvanceAnimations(250); err != nil { t.Fatal(err) }
	checkpoint, err := left.ExportJavascript()
	if err != nil { t.Fatal(err) }
	payload, err := json.Marshal(checkpoint)
	if err != nil { t.Fatal(err) }
	next, err := registry.WithIslandState("left", string(payload))
	if err != nil { t.Fatal(err) }
	encoded, err := next.Marshal()
	if err != nil { t.Fatal(err) }
	restored, err := Parse(encoded)
	if err != nil { t.Fatal(err) }
	for _, id := range []string{"left", "right"} {
		object, err := restored.NewIsland(id, nil)
		if err != nil { t.Fatal(err) }
		widget := object.(*javascript.Widget)
		defer widget.Close()
		state, err := widget.AnimationState()
		want := float64(0)
		if id == "left" { want = 250 }
		if err != nil || state.TimeMS != want || state.PlayState != "paused" { t.Fatalf("%s restored another island's clock: %+v %v", id, state, err) }
	}
	state, err := right.AnimationState()
	if err != nil || state.TimeMS != 0 { t.Fatalf("advancing left changed right: %+v %v", state, err) }
	if registry.Spec().Islands[0].StatePayload != "" { t.Fatal("checkpoint mutated its original registry") }
}

func TestAnimatedCatalogueCheckpointsCannotChangeTheirArchiveSchema(t *testing.T) {
	registry := requireRegistry(t, animatedCatalogue(t))
	var archive javascript.Archive
	if err := json.Unmarshal([]byte(registry.Spec().Components[0].Payload), &archive); err != nil { t.Fatal(err) }
	archive.Schema, archive.Animation = 1, nil
	data, err := json.Marshal(archive)
	if err != nil { t.Fatal(err) }
	if _, err = registry.WithIslandState("left", string(data)); err == nil || !strings.Contains(err.Error(), "cannot replace") { t.Fatalf("checkpoint replaced its animation schema: %v", err) }
}

func TestCatalogueRejectsMissingUnknownAndAliasedAnimationWireFields(t *testing.T) {
	changes := map[string]func(string) string{
		"missing animation":func(payload string) string{return strings.Replace(payload, `,"animation":{"schema":1,"timeMs":0,"playState":"paused"}`, "", 1)},
		"unknown animation field":func(payload string) string{return strings.Replace(payload, `"animation":{`, `"animation":{"unknown":true,`, 1)},
		"duplicate animation field":func(payload string) string{return strings.Replace(payload, `"animation":{"schema":1,`, `"animation":{"schema":1,"schema":1,`, 1)},
		"aliased animation field":func(payload string) string{return strings.Replace(payload, `"timeMs":0`, `"TimeMs":0`, 1)},
		"null animation time":func(payload string) string{return strings.Replace(payload, `"timeMs":0`, `"timeMs":null`, 1)},
		"missing event time":func(payload string) string{return strings.Replace(payload, `"events":[]`, `"events":[{"node":"panel","type":"click"}]`, 1)},
		"null event time":func(payload string) string{return strings.Replace(payload, `"events":[]`, `"events":[{"node":"panel","type":"click","timeMs":null}]`, 1)},
		"legacy null animation":func(payload string) string{return strings.Replace(strings.Replace(payload, `"schema":2`, `"schema":1`, 1), `"animation":{"schema":1,"timeMs":0,"playState":"paused"}`, `"animation":null`, 1)},
		"legacy null event time":func(payload string) string{payload=strings.Replace(payload, `"schema":2`, `"schema":1`, 1);payload=strings.Replace(payload, `,"animation":{"schema":1,"timeMs":0,"playState":"paused"}`, "", 1);return strings.Replace(payload, `"events":[]`, `"events":[{"node":"panel","type":"click","timeMs":null}]`, 1)},
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			spec := animatedCatalogue(t)
			original := spec.Components[0].Payload
			spec.Components[0].Payload = change(original)
			if spec.Components[0].Payload == original { t.Fatal("invalid wire fixture did not change its payload") }
			spec.Components[0].Hash = digest([]byte(spec.Components[0].Payload))
			if _, err := New(spec); err == nil { t.Fatal("invalid animation wire contract was accepted") }
		})
	}
}
