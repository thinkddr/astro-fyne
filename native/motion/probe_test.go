// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package motion_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/test"
	"github.com/thinkddr/astro-fyne/native/motion"
)

type probeGeometry struct {
	X      float32 `json:"x"`
	Y      float32 `json:"y"`
	Width  float32 `json:"width"`
	Height float32 `json:"height"`
}

type probeFrame struct {
	TimeMS   float64                  `json:"timeMs"`
	Sample   motion.Sample            `json:"sample"`
	Geometry map[string]probeGeometry `json:"geometry"`
}

type probeControl struct {
	Operation    string                   `json:"operation"`
	AdvanceMS    float64                  `json:"advanceMs"`
	Value        *float64                 `json:"value,omitempty"`
	RestoreState *motion.State            `json:"restoreState,omitempty"`
	State        motion.State             `json:"state"`
	Sample       motion.Sample            `json:"sample"`
	Geometry     map[string]probeGeometry `json:"geometry"`
}

type probeCase struct {
	Name     string                   `json:"name"`
	Spec     motion.Spec              `json:"spec"`
	Targets  map[string]probeGeometry `json:"targets"`
	Samples  []probeFrame             `json:"samples"`
	Controls []probeControl           `json:"controls"`
}

func objectGeometry(objects map[string]fyne.CanvasObject) map[string]probeGeometry {
	result := map[string]probeGeometry{}
	for name, object := range objects {
		p, s := object.Position(), object.Size()
		result[name] = probeGeometry{p.X, p.Y, s.Width, s.Height}
	}
	return result
}

func TestMotionBrowserEvidence(t *testing.T) {
	out := os.Getenv("ASTRO_FYNE_MOTION_ARTIFACTS")
	if out == "" {
		t.Skip("set ASTRO_FYNE_MOTION_ARTIFACTS to retain the native browser profile")
	}
	if !filepath.IsAbs(out) {
		t.Fatal("motion evidence path must be absolute")
	}
	app := test.NewApp()
	defer app.Quit()
	base := map[string]probeGeometry{"panel": {11, 12, 30, 40}, "other": {200, 80, 20, 25}}
	type input struct {
		name  string
		spec  motion.Spec
		times []float64
	}
	linear := specification()
	linear.ID, linear.Timing.DelayMS = "linear", 100
	linear.Tracks = append(linear.Tracks,
		motion.Track{ID: "vertical", Target: "panel", Property: motion.Y, Keyframes: []motion.Keyframe{{Offset: 0, Value: 20}, {Offset: 1, Value: 60}}},
		motion.Track{ID: "width", Target: "panel", Property: motion.Width, Keyframes: []motion.Keyframe{{Offset: 0, Value: 30}, {Offset: 1, Value: 130}}},
		motion.Track{ID: "height", Target: "panel", Property: motion.Height, Keyframes: []motion.Keyframe{{Offset: 0, Value: 40}, {Offset: 1, Value: 80}}},
		motion.Track{ID: "other-x", Target: "other", Property: motion.X, Keyframes: []motion.Keyframe{{Offset: 0, Value: 200}, {Offset: 1, Value: 300}}},
	)
	bezier := specification()
	bezier.ID = "intervals"
	bezier.Timing.Easing = motion.Easing{Kind: "cubic-bezier", Points: []float64{0, 0, 0, 1}}
	bezier.Tracks[0].Keyframes = []motion.Keyframe{{Offset: 0}, {Offset: 0.5, Value: 50}, {Offset: 1, Value: 100}}
	alternate := specification()
	alternate.ID, alternate.Timing.DelayMS, alternate.Timing.Iterations, alternate.Timing.Direction = "alternate", -250, 2.5, "alternate"
	zero := specification()
	zero.ID, zero.Timing.DurationMS, zero.Timing.DelayMS = "zero", 0, 50
	none := specification()
	none.ID, none.Timing.DelayMS, none.Timing.Fill = "inactive", 100, "none"
	reverse := specification()
	reverse.ID, reverse.Timing.Direction = "reverse", "reverse"
	alternateReverse := specification()
	alternateReverse.ID, alternateReverse.Timing.Direction, alternateReverse.Timing.Iterations = "alternate-reverse", "alternate-reverse", 2
	zeroIterations := specification()
	zeroIterations.ID, zeroIterations.Timing.Iterations, zeroIterations.Timing.DelayMS = "zero-iterations", 0, 50
	inputs := []input{
		{"linear", linear, []float64{-1, 0, 99, 100, 250, 500, 750, 1100, 1200}},
		{"intervals", bezier, []float64{0, 62.5, 500, 562.5, 1000}},
		{"alternate", alternate, []float64{0, 250, 750, 1250, 1750, 2250, 2300}},
		{"zero", zero, []float64{0, 49, 50, 51}},
		{"inactive", none, []float64{0, 99, 100, 600, 1100, 1200}},
		{"reverse", reverse, []float64{0, 250, 500, 1000}},
		{"alternate-reverse", alternateReverse, []float64{0, 250, 1000, 1250, 2000}},
		{"zero-iterations", zeroIterations, []float64{0, 49, 50, 51}},
	}
	cases := []probeCase{}
	for _, item := range inputs {
		value := clip(t, item.spec)
		objects := map[string]fyne.CanvasObject{}
		for name, g := range base {
			object := canvas.NewRectangle(nil)
			object.Move(fyne.NewPos(g.X, g.Y))
			object.Resize(fyne.NewSize(g.Width, g.Height))
			objects[name] = object
		}
		binding, err := motion.BindFyne(value, objects, motion.OwnGeometry)
		require(t, err)
		clock := &manualClock{now: time.Unix(0, 0)}
		control := controller(t, value, clock, binding, motion.Direct)
		result := probeCase{Name: item.name, Spec: value.Spec(), Targets: objectGeometry(objects), Samples: []probeFrame{}, Controls: []probeControl{}}
		for _, at := range item.times {
			require(t, control.Seek(at))
			sample, err := control.Sample()
			require(t, err)
			result.Samples = append(result.Samples, probeFrame{at, sample, objectGeometry(objects)})
		}
		require(t, control.Cancel())
		if item.name == "linear" {
			valueNumber := func(value float64) *float64 { return &value }
			for _, step := range []probeControl{
				{Operation: "play"}, {Operation: "tick", AdvanceMS: 250}, {Operation: "pause", AdvanceMS: 100},
				{Operation: "tick", AdvanceMS: 300}, {Operation: "play"}, {Operation: "rate", AdvanceMS: 50, Value: valueNumber(2)},
				{Operation: "tick", AdvanceMS: 50}, {Operation: "reverse"}, {Operation: "tick", AdvanceMS: 100},
				{Operation: "seek", Value: valueNumber(750)}, {Operation: "play"}, {Operation: "tick", AdvanceMS: 125},
				{Operation: "finish"}, {Operation: "cancel"},
				{Operation: "restore", AdvanceMS: 5000, RestoreState: &motion.State{Schema: 1, ClipID: value.Spec().ID, ClipHash: value.Hash(), CurrentTimeMS: valueNumber(400), PlaybackRate: 1, PlayState: "running"}},
				{Operation: "tick", AdvanceMS: 100},
			} {
				clock.advance(time.Duration(step.AdvanceMS * float64(time.Millisecond)))
				switch step.Operation {
				case "play":
					err = control.Play()
				case "tick":
					err = control.Tick()
				case "pause":
					err = control.Pause()
				case "rate":
					err = control.SetPlaybackRate(*step.Value)
				case "reverse":
					err = control.Reverse()
				case "seek":
					err = control.Seek(*step.Value)
				case "finish":
					err = control.Finish()
				case "cancel":
					err = control.Cancel()
				case "restore":
					err = control.RestoreState(*step.RestoreState)
				}
				require(t, err)
				step.State, err = control.State()
				require(t, err)
				step.Sample, err = control.Sample()
				require(t, err)
				step.Geometry = objectGeometry(objects)
				result.Controls = append(result.Controls, step)
			}
		}
		require(t, control.Close())
		if !reflectGeometry(result.Targets, objectGeometry(objects)) {
			t.Fatal("closed native profile retained animated geometry")
		}
		cases = append(cases, result)
	}
	require(t, os.MkdirAll(out, 0755))
	data, err := json.MarshalIndent(map[string]any{"schema": 1, "cases": cases, "nativeObjects": true, "pixelPerfectVerified": false}, "", "  ")
	require(t, err)
	require(t, os.WriteFile(filepath.Join(out, "native.json"), append(data, '\n'), 0644))
}

func reflectGeometry(a, b map[string]probeGeometry) bool {
	if len(a) != len(b) {
		return false
	}
	for id, g := range a {
		if b[id] != g {
			return false
		}
	}
	return true
}
