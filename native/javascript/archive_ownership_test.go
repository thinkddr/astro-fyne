// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"encoding/json"
	"reflect"
	"testing"

	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

func javascriptOwnedArchive(data []byte, schema int) Archive {
	archive := testArchive(FontResourceFactoryHeader + `function(host,archive){` + javascriptFontRequest(data) + `
let count=0,events=[],journal=[],state=archive.animation?{schema:1,timeMs:0,playState:"paused"}:null;
function copy(value){return JSON.parse(JSON.stringify(value))}
function sample(){return [{uid:"root",tag:"div",attrs:{id:"root"},style:{width:220,height:90,backgroundColor:"#ffffff"},children:[{uid:"caption",tag:"p",attrs:{id:"caption"},style:{fontFamily:"Host",fontWeight:400,fontStyle:"normal",fontSize:16,lineHeight:20},events:["clickfalse"],children:[{uid:"text",tag:"#text",text:archive.props.label+":"+count}]}]}]}
function event(input,replay){
  count++;
  const saved=copy(input),args=JSON.stringify([count]);
  if(state){if(replay)state.timeMs=input.timeMs;saved.timeMs=state.timeMs}
  events.push(saved);
  if(replay){const recorded=archive.journal[journal.length];if(!recorded||recorded.kind!=="action"||recorded.name!=="after"||recorded.args!==args)throw new Error("journal mismatch");journal.push(copy(recorded))}
  else journal.push({kind:"action",name:"after",args,value:JSON.stringify(host("action","after",args))});
}
return {flush(){},snapshot:sample,
dispatch(input){event(input,false)},replay(input){event(input,true)},
finishReplay(){if(JSON.stringify(events)!==JSON.stringify(archive.events))throw new Error("event mismatch");if(state)state=copy(archive.animation);if(archive.frame&&JSON.stringify(archive.frame)!==JSON.stringify(sample()))throw new Error("frame mismatch")},
animationState(){return copy(state)},advanceAnimations(ms){state.timeMs=ms},pauseAnimations(){state.playState="paused"},playAnimations(){state.playState="running"},
export(){return {...archive,events:copy(events),journal:copy(journal),frame:sample(),...(state?{animation:copy(state)}:{})}},dispose(){}}
}`)
	archive.Schema = schema
	archive.Props = json.RawMessage(`{"label":"Owned"}`)
	archive.Actions = []string{"after"}
	text := "\ufeff/* authored CSS */\r\np { font-family: Host; }\r\n"
	hash := javascriptFontHash([]byte(text))
	archive.Sources = append(archive.Sources, Source{Path: "owned.css", Hash: hash})
	archive.Stylesheets = []Stylesheet{{Path: "owned.css", Hash: hash, Text: text}}
	if schema == 2 {
		archive.Animation = &AnimationState{Schema: 1, PlayState: "paused"}
	}
	return archive
}

func TestJavascriptConstructorOwnsInputsBeforeFontCallbacks(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		schema int
	}{
		{"events-and-metadata", 1},
		{"timed-events-and-metadata", 2},
		{"animation-state", 2},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			app := test.NewApp()
			defer app.Quit()
			data := javascriptFontData(t)
			backend, _ := javascriptFontBackend(data)
			calls := 0
			actions := webui.Actions{"after": func(...any) any { calls++; return "recorded" }}
			view, err := NewWithOptions(javascriptOwnedArchive(data, scenario.schema), actions, Options{ManualAnimations: true}, backend)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = view.Close() })
			javascriptFontWindow(t, view)
			if scenario.schema == 2 {
				if err = view.AdvanceAnimations(25); err != nil {
					t.Fatal(err)
				}
			}
			value := "saved"
			view.dispatch("caption", "click", &value)
			if scenario.schema == 2 {
				if err = view.AdvanceAnimations(50); err != nil {
					t.Fatal(err)
				}
			}
			warm, err := view.ExportJavascript()
			if err != nil || calls != 1 || len(warm.Events) != 1 || len(warm.Journal) != 1 {
				t.Fatalf("failed to create a live checkpoint: %v calls=%d", err, calls)
			}
			raw, err := json.Marshal(warm)
			if err != nil {
				t.Fatal(err)
			}
			var expected Archive
			if err = json.Unmarshal(raw, &expected); err != nil {
				t.Fatal(err)
			}
			bindings := 0
			binder := javascriptFontBinder(func(items []webui.FontResourceRequirement) (webui.Backend, error) {
				bindings++
				warm.Sources[0].Path = "changed.js"
				warm.Sources[0].Hash = "changed"
				warm.Stylesheets[0].Path = "changed.css"
				warm.Stylesheets[0].Hash = "changed"
				warm.Stylesheets[0].Text = "p { color: red; }"
				warm.Props[0] = '['
				warm.Frame[0] = '{'
				warm.Actions[0] = "changed"
				*warm.Journal[0].Value = `"changed"`
				if scenario.name == "animation-state" {
					warm.Animation.TimeMS = 75
					warm.Animation.PlayState = "running"
				} else {
					warm.Events[0].Node = "changed"
					warm.Events[0].Type = "input"
					*warm.Events[0].Value = "changed"
					if warm.Events[0].TimeMS != nil {
						*warm.Events[0].TimeMS = 40
					}
				}
				return backend.BindFontResources(items)
			})
			restored, err := NewWithOptions(warm, actions, Options{ManualAnimations: true, FontResources: binder}, backend)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = restored.Close() })
			window := javascriptFontWindow(t, restored)
			again, err := restored.ExportJavascript()
			if err != nil || bindings != 1 || calls != 1 || !reflect.DeepEqual(again, expected) || !reflect.DeepEqual(restored.archive, expected) {
				t.Fatalf("callback changed the restored checkpoint: %v bindings=%d calls=%d", err, bindings, calls)
			}
			object := restored.Object("caption")
			font := javascriptFontPaint(t, restored, "Owned:1").FontSource
			if font == nil || javascriptFontHash(font.Content()) != javascriptFontHash(data) {
				t.Fatal("restoration lost the checked native font")
			}
			restored.dispatch("caption", "click", nil)
			window.Canvas().Capture()
			continued, err := restored.ExportJavascript()
			painted := javascriptFontPaint(t, restored, "Owned:2")
			if err != nil || calls != 2 || len(continued.Events) != 2 || len(continued.Journal) != 2 || restored.Object("caption") != object || painted.FontSource != font {
				t.Fatalf("restored native widget cannot continue: %v calls=%d", err, calls)
			}
		})
	}
}
