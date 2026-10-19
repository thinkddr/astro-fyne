// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/test"
	webui "github.com/thinkddr/astro-fyne/native"
)

func animatedArchive() Archive {
	archive := testArchive(`function(host,archive){
var state={schema:1,timeMs:0,playState:"running"},events=[],journal=[],count=0,replayed=0;
function copy(value){return JSON.parse(JSON.stringify(value))}
function sample(){return [{uid:"root",tag:"div",attrs:{id:"root"},css:true,style:{width:"200px",height:"300px",backgroundColor:"#ffffff"},children:[
{uid:"panel",tag:"div",attrs:{id:"panel"},css:true,style:{height:(20+Math.min(state.timeMs,1000)/10)+"px",backgroundColor:"#ff0000"}},
{uid:"following",tag:"div",attrs:{id:"following"},css:true,style:{height:"30px",backgroundColor:"#0000ff"}},
{uid:"button",tag:"button",attrs:{id:"button"},events:["click"],children:[{uid:"text",tag:"#text",text:String(count)}]}]}]}
function advance(ms){if(!Number.isFinite(ms)||ms<state.timeMs||ms>1e12)throw new Error("bad timeline");state.timeMs=ms;if(state.playState==="running"&&ms>=1000)state.playState="finished"}
function event(input,replay){count++;var saved=copy(input);saved.timeMs=state.timeMs;events.push(saved);if(replay){var recorded=archive.journal[replayed++];if(!recorded)throw new Error("missing journal");journal.push(copy(recorded))}else{var result=host("action","changed",JSON.stringify([count]));journal.push({kind:"action",name:"changed",args:JSON.stringify([count]),value:JSON.stringify(result)})}}
return {flush(){},snapshot:sample,animationState(){return copy(state)},advanceAnimations:advance,pauseAnimations(){if(state.playState==="running")state.playState="paused"},playAnimations(){if(state.playState==="paused")state.playState="running"},
dispatch(input){event(input,false)},replay(input){advance(input.timeMs);event(input,true)},finishReplay(){state=copy(archive.animation);if(archive.frame&&JSON.stringify(archive.frame)!==JSON.stringify(sample()))throw new Error("frame mismatch")},
export(){var saved=copy(archive);saved.animation=copy(state);saved.events=copy(events);saved.journal=copy(journal);saved.frame=sample();return saved},dispose(){}}}`)
	archive.Schema = 2
	archive.Animation = &AnimationState{Schema: 1, TimeMS: 0, PlayState: "running"}
	archive.Actions = []string{"changed"}
	return archive
}

func manualAnimatedWidget(t *testing.T, archive Archive, now *time.Time, actions webui.Actions) *Widget {
	t.Helper()
	if actions == nil {
		actions = webui.Actions{"changed": func(...any) any { return nil }}
	}
	w, err := NewWithOptions(archive, actions, Options{ManualAnimations: true, Clock: ClockFunc(func() time.Time { return *now })})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := w.Close(); err != nil {
			t.Error(err)
		}
	})
	return w
}

func animationFrame(t *testing.T, w *Widget, height float32) {
	t.Helper()
	if err := w.Error(); err != nil {
		t.Fatal(err)
	}
	panel, following := w.Object("panel"), w.Object("following")
	if panel == nil || following == nil || panel.Size().Height != height || following.Position().Y != height {
		t.Fatalf("height sample did not reflow the following sibling: panel=%v following=%v want=%v", panel, following, height)
	}
}

func TestAnimationSamplesUseViewLayoutAndRetainNativeObjects(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	now := time.Unix(1000, 0)
	w := manualAnimatedWidget(t, animatedArchive(), &now, nil)
	window := test.NewWindow(w)
	defer window.Close()
	window.SetPadded(false)
	window.Resize(fyne.NewSize(200, 300))
	animationFrame(t, w, 20)
	panel, following := w.Object("panel"), w.Object("following")
	if err := w.AdvanceAnimations(500); err != nil {
		t.Fatal(err)
	}
	animationFrame(t, w, 70)
	if w.Object("panel") != panel || w.Object("following") != following {
		t.Fatal("sampling replaced an existing native object")
	}
	if err := w.PauseAnimations(); err != nil {
		t.Fatal(err)
	}
	if err := w.AdvanceAnimations(750); err != nil {
		t.Fatal(err)
	}
	animationFrame(t, w, 95)
	state, err := w.AnimationState()
	if err != nil || state.PlayState != "paused" || state.TimeMS != 750 {
		t.Fatalf("manual sampling changed pause state: %+v %v", state, err)
	}
	now = now.Add(10 * time.Second)
	if err = w.TickAnimations(); err != nil {
		t.Fatal(err)
	}
	animationFrame(t, w, 95)
	if err = w.PlayAnimations(); err != nil {
		t.Fatal(err)
	}
	now = now.Add(100 * time.Millisecond)
	if err = w.TickAnimations(); err != nil {
		t.Fatal(err)
	}
	animationFrame(t, w, 105)
	now = now.Add(150 * time.Millisecond)
	if err = w.TickAnimations(); err != nil {
		t.Fatal(err)
	}
	animationFrame(t, w, 120)
	state, err = w.AnimationState()
	if err != nil || state.PlayState != "finished" || state.TimeMS != 1000 {
		t.Fatalf("timeline did not finish: %+v %v", state, err)
	}
	now = now.Add(time.Hour)
	if err = w.PlayAnimations(); err != nil {
		t.Fatal(err)
	}
	if err = w.TickAnimations(); err != nil {
		t.Fatal(err)
	}
	state, _ = w.AnimationState()
	if state.PlayState != "finished" || state.TimeMS != 1000 {
		t.Fatal("finished timeline restarted or advanced")
	}
}

func TestAnimationExportRestoresLogicalTimeAndNeverReplaysHostEffects(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	now := time.Unix(1000, 0)
	calls := 0
	actions := webui.Actions{"changed": func(...any) any { calls++; return "recorded" }}
	w := manualAnimatedWidget(t, animatedArchive(), &now, actions)
	if err := w.AdvanceAnimations(350); err != nil {
		t.Fatal(err)
	}
	w.dispatch("button", "click", nil)
	saved, err := w.ExportJavascript()
	if err != nil {
		t.Fatal(err)
	}
	if saved.Animation == nil || saved.Animation.TimeMS != 350 || saved.Animation.PlayState != "running" || len(saved.Events) != 1 || saved.Events[0].TimeMS == nil || *saved.Events[0].TimeMS != 350 || calls != 1 {
		t.Fatalf("export omitted the committed timeline/event: %+v effects=%d", saved, calls)
	}
	now = now.Add(24 * time.Hour)
	restored := manualAnimatedWidget(t, saved, &now, actions)
	continued, err := restored.ExportJavascript()
	if err != nil || !reflect.DeepEqual(continued, saved) || calls != 1 {
		t.Fatalf("restore changed checkpoint or replayed effects: %v effects=%d", err, calls)
	}
	now = now.Add(100 * time.Millisecond)
	if err = restored.TickAnimations(); err != nil {
		t.Fatal(err)
	}
	state, _ := restored.AnimationState()
	if state.TimeMS != 450 {
		t.Fatalf("restore included elapsed travel time: %+v", state)
	}
	if err = restored.PauseAnimations(); err != nil {
		t.Fatal(err)
	}
	paused, err := restored.ExportJavascript()
	if err != nil {
		t.Fatal(err)
	}
	pausedRestore := manualAnimatedWidget(t, paused, &now, actions)
	now = now.Add(time.Hour)
	if err = pausedRestore.TickAnimations(); err != nil {
		t.Fatal(err)
	}
	state, _ = pausedRestore.AnimationState()
	if state.PlayState != "paused" || state.TimeMS != 450 {
		t.Fatalf("paused checkpoint advanced after restore: %+v", state)
	}
	if err = w.AdvanceAnimations(700); err != nil {
		t.Fatal(err)
	}
	other, _ := restored.AnimationState()
	if other.TimeMS != 450 {
		t.Fatal("separate native instances shared their timeline")
	}
}

func TestAnimatedArchivesRejectInvalidStateAndEventTimes(t *testing.T) {
	value := func(number float64) *float64 { return &number }
	changes := map[string]func(*Archive){
		"missing animation":        func(a *Archive) { a.Animation = nil },
		"unknown animation schema": func(a *Archive) { a.Animation.Schema = 2 },
		"negative timeline":        func(a *Archive) { a.Animation.TimeMS = -1 },
		"nonfinite timeline":       func(a *Archive) { a.Animation.TimeMS = math.Inf(1) },
		"excessive timeline":       func(a *Archive) { a.Animation.TimeMS = 1e12 + 1 },
		"unknown play state":       func(a *Archive) { a.Animation.PlayState = "idle" },
		"missing event time":       func(a *Archive) { a.Events = []Event{{Node: "button", Type: "click"}} },
		"negative event time":      func(a *Archive) { a.Events = []Event{{Node: "button", Type: "click", TimeMS: value(-1)}} },
		"future event time":        func(a *Archive) { a.Events = []Event{{Node: "button", Type: "click", TimeMS: value(101)}} },
		"decreasing event time": func(a *Archive) {
			a.Events = []Event{{Node: "button", Type: "click", TimeMS: value(50)}, {Node: "button", Type: "click", TimeMS: value(49)}}
		},
		"nonfinite event time": func(a *Archive) { a.Events = []Event{{Node: "button", Type: "click", TimeMS: value(math.NaN())}} },
		"legacy animation":     func(a *Archive) { a.Schema = 1 },
		"legacy event time": func(a *Archive) {
			a.Schema = 1
			a.Animation = nil
			a.Events = []Event{{Node: "button", Type: "click", TimeMS: value(0)}}
		},
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			archive := animatedArchive()
			archive.Animation.TimeMS = 100
			change(&archive)
			if err := Validate(archive); err == nil {
				t.Fatal("invalid animation transport was accepted")
			}
		})
	}
	for _, raw := range []string{`null`, `{}`, `{"schema":1,"timeMs":0}`, `{"schema":1,"TimeMs":0,"playState":"running"}`, `{"schema":1,"timeMs":0,"playState":"running","extra":true}`, `{"schema":1,"timeMs":0,"timeMs":1,"playState":"running"}`, `{"schema":1,"timeMs":null,"playState":"running"}`} {
		var state AnimationState
		if err := json.Unmarshal([]byte(raw), &state); err == nil {
			t.Fatalf("invalid envelope accepted: %s", raw)
		}
	}
	for _, raw := range []string{`{"schema":1,"animation":null}`, `{"schema":2}`, `{"schema":2,"animation":null}`, `{"schema":2,"Animation":{"schema":1,"timeMs":0,"playState":"running"}}`, `{"schema":2,"schema":1}`, `{"schema":1,"events":[{"node":"1","type":"click","timeMs":null}]}`} {
		var archive Archive
		if err := json.Unmarshal([]byte(raw), &archive); err == nil {
			t.Fatalf("invalid archive field presence accepted: %s", raw)
		}
	}
	legacy := animatedArchive()
	legacy.Schema, legacy.Animation = 1, nil
	if err := Validate(legacy); err != nil {
		t.Fatalf("schema 1 regressed: %v", err)
	}
	encoded, err := json.Marshal(legacy)
	if err != nil || strings.Contains(string(encoded), `"animation"`) || strings.Contains(string(encoded), `"timeMs"`) {
		t.Fatalf("legacy serialization gained timeline fields: %s %v", encoded, err)
	}
}

func TestAnimationFrameFailurePreservesObjectsAndStopsExport(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	base := animatedArchive()
	archive := testArchive(strings.Replace(base.Code, `height:(20+Math.min(state.timeMs,1000)/10)+"px",backgroundColor`, `height:(20+Math.min(state.timeMs,1000)/10)+"px",unsupported:state.timeMs>=500?"invalid":"",backgroundColor`, 1))
	archive.Schema, archive.Animation, archive.Actions = base.Schema, base.Animation, base.Actions
	w, err := NewWithOptions(archive, webui.Actions{"changed": func(...any) any { return nil }}, Options{ManualAnimations: true})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	panel := w.Object("panel")
	position, size := panel.Position(), panel.Size()
	if err = w.AdvanceAnimations(500); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("invalid animated style was accepted: %v", err)
	}
	if w.Object("panel") != panel || panel.Position() != position || panel.Size() != size {
		t.Fatal("invalid animated style mutated the last valid native frame")
	}
	if _, err = w.ExportJavascript(); err == nil {
		t.Fatal("invalid animated frame was exported")
	}
}

func TestAnimationExportCannotForgeItsCommittedTimeline(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	base := animatedArchive()
	archive := testArchive(strings.Replace(base.Code, `saved.animation=copy(state)`, `saved.animation={schema:1,timeMs:999,playState:"paused"}`, 1))
	archive.Schema, archive.Animation, archive.Actions = base.Schema, base.Animation, base.Actions
	now := time.Unix(1000, 0)
	w := manualAnimatedWidget(t, archive, &now, nil)
	if _, err := w.ExportJavascript(); err == nil || !strings.Contains(err.Error(), "committed animation") {
		t.Fatalf("forged timeline was exported: %v", err)
	}
}

func TestInvalidAnimationRequestsAndClockReversalPreserveTheNativeFrame(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	now := time.Unix(1000, 0)
	w := manualAnimatedWidget(t, animatedArchive(), &now, nil)
	if err := w.AdvanceAnimations(250); err != nil {
		t.Fatal(err)
	}
	before, err := w.ExportJavascript()
	if err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []float64{-1, 249, math.NaN(), math.Inf(1), 1e12 + 1} {
		if err = w.AdvanceAnimations(invalid); err == nil {
			t.Fatalf("invalid manual time %v was accepted", invalid)
		}
	}
	now = now.Add(-time.Millisecond)
	if err = w.TickAnimations(); err == nil || !strings.Contains(err.Error(), "backwards") {
		t.Fatalf("clock reversal was not diagnosed: %v", err)
	}
	after, err := w.ExportJavascript()
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("rejected sampling mutated the committed frame: %v", err)
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	if err = w.Close(); err != nil {
		t.Fatal("close is not idempotent")
	}
	if err = w.AdvanceAnimations(500); err == nil {
		t.Fatal("closed widget accepted animation work")
	}
}

type queuedAnimationDriver struct {
	fyne.Driver
	tasks chan func()
}

func (driver *queuedAnimationDriver) DoFromGoroutine(task func(), _ bool) { driver.tasks <- task }

type queuedAnimationApp struct {
	fyne.App
	driver fyne.Driver
}

func (app *queuedAnimationApp) Driver() fyne.Driver { return app.driver }

func TestAutomaticAnimationQueuesOnlyUIWorkAndCancelsPendingTicks(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	driver := &queuedAnimationDriver{Driver: app.Driver(), tasks: make(chan func(), 4)}
	fyne.SetCurrentApp(&queuedAnimationApp{App: app, driver: driver})
	defer fyne.SetCurrentApp(app)
	now := time.Unix(1000, 0)
	w, err := NewWithOptions(animatedArchive(), webui.Actions{"changed": func(...any) any { return nil }}, Options{Clock: ClockFunc(func() time.Time { return now })})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	var task func()
	select {
	case task = <-driver.tasks:
	case <-time.After(time.Second):
		t.Fatal("automatic scheduler did not queue a Fyne task")
	}
	state, _ := w.AnimationState()
	if state.TimeMS != 0 {
		t.Fatal("scheduler executed Goja before UI dispatch")
	}
	now = now.Add(200 * time.Millisecond)
	task()
	state, err = w.AnimationState()
	if err != nil || state.TimeMS != 200 {
		t.Fatalf("queued UI task did not sample the monotonic clock: %+v %v", state, err)
	}
	scheduler := w.scheduler
	if err = w.PauseAnimations(); err != nil {
		t.Fatal(err)
	}
	if w.scheduler != nil {
		t.Fatal("pause retained automatic scheduling")
	}
	select {
	case <-scheduler.stop:
	default:
		t.Fatal("pause did not stop the worker")
	}
	if err = w.PlayAnimations(); err != nil {
		t.Fatal(err)
	}
	select {
	case task = <-driver.tasks:
	case <-time.After(time.Second):
		t.Fatal("resume did not queue another UI task")
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	task()
	if w.vm != nil || w.api != nil || w.scheduler != nil {
		t.Fatal("close retained runtime or scheduling resources")
	}
}
