// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package motion_test

import (
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/test"
	"github.com/thinkddr/astro-fyne/native/motion"
)

func specification() motion.Spec {
	return motion.Spec{
		Schema: 1, ID: "move",
		Tracks: []motion.Track{{ID: "horizontal", Target: "panel", Property: motion.X, Keyframes: []motion.Keyframe{{Offset: 0, Value: 0}, {Offset: 1, Value: 100}}}},
		Timing: motion.Timing{DurationMS: 1000, Iterations: 1, Direction: "normal", Fill: "both", Easing: motion.Easing{Kind: "linear"}},
	}
}

func clip(t *testing.T, spec motion.Spec) *motion.Clip {
	t.Helper()
	value, err := motion.NewClip(spec)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func closeNumber(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-8 {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func sample(t *testing.T, value *motion.Clip, at float64, want float64) {
	t.Helper()
	got, err := value.Sample(at)
	if err != nil || !got.Active || len(got.Values) != 1 {
		t.Fatalf("sample at %v: %+v, %v", at, got, err)
	}
	closeNumber(t, got.Values[0].Value, want)
}

func TestTimingBoundariesFractionalIterationsAndDirections(t *testing.T) {
	spec := specification()
	spec.Timing.DelayMS, spec.Timing.Iterations, spec.Timing.Direction = 100, 2.5, "alternate"
	value := clip(t, spec)
	for _, point := range []struct{ at, want float64 }{{0, 0}, {100, 0}, {600, 50}, {1100, 100}, {1600, 50}, {2100, 0}, {2600, 50}, {3000, 50}} {
		sample(t, value, point.at, point.want)
	}
	for _, item := range []struct{ direction string; want float64 }{{"normal", 25}, {"reverse", 75}, {"alternate", 75}, {"alternate-reverse", 25}} {
		spec.Timing.Direction = item.direction
		sample(t, clip(t, spec), 1350, item.want)
	}
	spec.Timing.Iterations, spec.Timing.Direction = 2, "alternate"
	sample(t, clip(t, spec), 2100, 0)
	spec.Timing.Iterations, spec.Timing.DelayMS, spec.Timing.Direction = 1, -250, "normal"
	sample(t, clip(t, spec), 0, 25)
	sample(t, clip(t, spec), 750, 100)
}

func TestFillZeroDurationZeroIterationsAndNoRepeat(t *testing.T) {
	for _, fill := range []string{"none", "backwards", "forwards", "both"} {
		spec := specification()
		spec.Timing.Fill, spec.Timing.DelayMS = fill, 100
		value := clip(t, spec)
		for _, item := range []struct{ at float64; active bool }{{99, fill == "backwards" || fill == "both"}, {100, true}, {1099, true}, {1100, fill == "forwards" || fill == "both"}} {
			got, err := value.Sample(item.at)
			if err != nil || got.Active != item.active || !item.active && len(got.Values) != 0 {
				t.Fatalf("%s at %v: %+v, %v", fill, item.at, got, err)
			}
		}
	}
	spec := specification()
	spec.Timing.DurationMS, spec.Timing.DelayMS = 0, 50
	sample(t, clip(t, spec), 49, 0)
	sample(t, clip(t, spec), 50, 100)
	spec.Timing.DurationMS, spec.Timing.Iterations = 1000, 0
	sample(t, clip(t, spec), 50, 0)
	sample(t, clip(t, specification()), 2000, 100)
}

func TestCSSBezierInversionUsesEachKeyframeInterval(t *testing.T) {
	easing := motion.Easing{Kind: "cubic-bezier", Points: []float64{0, 0, 0, 1}}
	got, err := easing.Evaluate(0.125)
	if err != nil {
		t.Fatal(err)
	}
	closeNumber(t, got, 0.5)
	for _, endpoint := range []float64{0, 1} {
		got, err := easing.Evaluate(endpoint)
		if err != nil || got != endpoint {
			t.Fatalf("endpoint %v: %v, %v", endpoint, got, err)
		}
	}
	spec := specification()
	spec.Timing.Easing = easing
	spec.Tracks[0].Keyframes = []motion.Keyframe{{Offset: 0, Value: 0}, {Offset: 0.5, Value: 50}, {Offset: 1, Value: 100}}
	sample(t, clip(t, spec), 62.5, 25)
	sample(t, clip(t, spec), 562.5, 75)
}

func TestClipOwnsMetadataAndStrictJSON(t *testing.T) {
	spec := specification()
	spec.Timing.Easing = motion.Easing{Kind: "cubic-bezier", Points: []float64{0, 0, 1, 1}}
	value := clip(t, spec)
	hash := value.Hash()
	spec.Tracks[0].Keyframes[1].Value = 900
	spec.Timing.Easing.Points[0] = 0.8
	copy := value.Spec()
	copy.Tracks[0].Keyframes[0].Value = 600
	copy.Timing.Easing.Points[1] = 9
	sample(t, value, 500, 50)
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := motion.ParseClip(encoded)
	if err != nil || parsed.Hash() != hash {
		t.Fatalf("roundtrip: %v", err)
	}
	for _, bad := range []string{
		strings.Replace(string(encoded), `"points":[0,0,1,1]`, `"points":[0,null,1,1]`, 1),
		strings.Replace(string(encoded), `"schema":1`, `"schema":1,"schema":1`, 1),
		strings.Replace(string(encoded), `"schema":1`, `"schema":1,"Schema":1`, 1),
		strings.Replace(string(encoded), `"durationMs":1000,`, "", 1),
		strings.Replace(string(encoded), `"offset":0,`, "", 1),
		strings.Replace(string(encoded), `"value":100`, `"value":null`, 1),
		strings.Replace(string(encoded), `"target":"panel"`, `"target":"panel","opacity":1`, 1),
		string(encoded) + `{}`,
	} {
		if _, err := motion.ParseClip([]byte(bad)); err == nil {
			t.Fatalf("accepted invalid JSON %s", bad)
		}
	}
}

func TestFingerprintIsIndependentOfJSONEncodingAndZeroSigns(t *testing.T) {
	negativeZero := math.Copysign(0, -1)
	spec := motion.Spec{
		Schema: 1, ID: "fingerprint",
		Tracks: []motion.Track{{ID: "fraction", Target: "panel", Property: motion.X, Keyframes: []motion.Keyframe{
			{Offset: negativeZero, Value: negativeZero},
			{Offset: 0.5, Value: math.SmallestNonzeroFloat64},
			{Offset: 1, Value: 1e20},
		}}},
		Timing: motion.Timing{DurationMS: 1000, DelayMS: negativeZero, Iterations: 2.5, Direction: "alternate-reverse", Fill: "backwards", Easing: motion.Easing{Kind: "cubic-bezier", Points: []float64{0, negativeZero, 1, 1}}},
	}
	const expected = "10fdd690d1ddb8c751f7cd998256407cad7bef25d5eaa9ff81afc96d37e4b416"
	value := clip(t, spec)
	if value.Hash() != expected {
		t.Fatalf("binary fingerprint %s, want %s", value.Hash(), expected)
	}
	spec.Timing.DelayMS, spec.Timing.Easing.Points[1] = 0, 0
	spec.Tracks[0].Keyframes[0] = motion.Keyframe{Offset: 0, Value: 0}
	if clip(t, spec).Hash() != expected {
		t.Fatal("zero normalization changed numeric identity")
	}
	spec.Tracks[0].Keyframes[1].Value = 0
	if clip(t, spec).Hash() == expected {
		t.Fatal("smallest nonzero IEEE-754 value lost its identity")
	}
}

func TestEasingJSONRejectsNullCoordinatesInsideOtherArchives(t *testing.T) {
	for _, source := range []string{
		`{"kind":"cubic-bezier","points":[0,null,1,1]}`,
		`{"kind":"linear","points":null}`,
	} {
		easing := motion.Easing{Kind: "linear"}
		if err := json.Unmarshal([]byte(source), &easing); err == nil {
			t.Fatal("null coordinates were coerced into numeric zero")
		}
		if easing.Kind != "linear" || len(easing.Points) != 0 {
			t.Fatal("failed easing decode mutated the previous value")
		}
	}
}

func TestInvalidMotionMetadataCannotCreateAClip(t *testing.T) {
	for name, change := range map[string]func(*motion.Spec){
		"schema": func(s *motion.Spec) { s.Schema = 2 },
		"id": func(s *motion.Spec) { s.ID = "bad id" },
		"opacity": func(s *motion.Spec) { s.Tracks[0].Property = "opacity" },
		"transform": func(s *motion.Spec) { s.Tracks[0].Property = "transform" },
		"duplicate ID": func(s *motion.Spec) { s.Tracks = append(s.Tracks, s.Tracks[0]) },
		"duplicate axis": func(s *motion.Spec) { track := s.Tracks[0]; track.ID = "other"; s.Tracks = append(s.Tracks, track) },
		"missing endpoint": func(s *motion.Spec) { s.Tracks[0].Keyframes[0].Offset = 0.1 },
		"duplicate offset": func(s *motion.Spec) { s.Tracks[0].Keyframes = []motion.Keyframe{{Offset: 0}, {Offset: 0}, {Offset: 1}} },
		"unordered": func(s *motion.Spec) { s.Tracks[0].Keyframes = []motion.Keyframe{{Offset: 0}, {Offset: 0.8}, {Offset: 0.2}, {Offset: 1}} },
		"NaN value": func(s *motion.Spec) { s.Tracks[0].Keyframes[0].Value = math.NaN() },
		"infinite duration": func(s *motion.Spec) { s.Timing.DurationMS = math.Inf(1) },
		"negative duration": func(s *motion.Spec) { s.Timing.DurationMS = -1 },
		"infinite repeat": func(s *motion.Spec) { s.Timing.Iterations = math.Inf(1) },
		"negative repeat": func(s *motion.Spec) { s.Timing.Iterations = -1 },
		"duration overflow": func(s *motion.Spec) { s.Timing.DurationMS = 1e12; s.Timing.Iterations = 1e9 },
		"invalid curve": func(s *motion.Spec) { s.Timing.Easing = motion.Easing{Kind: "cubic-bezier", Points: []float64{-1, 0, 0, 1}} },
		"negative dimension": func(s *motion.Spec) { s.Tracks[0].Property = motion.Width; s.Tracks[0].Keyframes[0].Value = -1 },
	} {
		t.Run(name, func(t *testing.T) {
			spec := specification()
			change(&spec)
			if _, err := motion.NewClip(spec); err == nil {
				t.Fatal("invalid motion accepted")
			}
		})
	}
}

type manualClock struct {
	mu sync.Mutex
	now time.Time
}

func (c *manualClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *manualClock) advance(duration time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(duration)
}

func controller(t *testing.T, value *motion.Clip, clock *manualClock, binding *motion.FyneBinding, dispatch motion.Dispatch) *motion.Controller {
	t.Helper()
	result, err := motion.NewController(value, clock, binding, dispatch)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func require(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestControllerPauseResumeReverseRateAndFinish(t *testing.T) {
	clock := &manualClock{now: time.Unix(0, 0)}
	control := controller(t, clip(t, specification()), clock, nil, motion.Direct)
	require(t, control.Play())
	clock.advance(250 * time.Millisecond)
	state, err := control.State()
	require(t, err)
	closeNumber(t, *state.CurrentTimeMS, 250)
	require(t, control.Pause())
	clock.advance(time.Second)
	state, err = control.State()
	require(t, err)
	closeNumber(t, *state.CurrentTimeMS, 250)
	require(t, control.Play())
	clock.advance(100 * time.Millisecond)
	require(t, control.Reverse())
	clock.advance(50 * time.Millisecond)
	state, err = control.State()
	require(t, err)
	closeNumber(t, *state.CurrentTimeMS, 300)
	require(t, control.SetPlaybackRate(2))
	clock.advance(100 * time.Millisecond)
	require(t, control.Tick())
	state, err = control.State()
	require(t, err)
	closeNumber(t, *state.CurrentTimeMS, 500)
	require(t, control.SetPlaybackRate(0))
	clock.advance(time.Second)
	state, err = control.State()
	require(t, err)
	closeNumber(t, *state.CurrentTimeMS, 500)
	if control.Finish() == nil || control.Reverse() == nil {
		t.Fatal("zero-rate finish/reverse accepted")
	}
	require(t, control.SetPlaybackRate(1))
	require(t, control.Finish())
	state, err = control.State()
	require(t, err)
	if state.PlayState != "finished" || *state.CurrentTimeMS != 1000 {
		t.Fatalf("finish: %+v", state)
	}
	require(t, control.Reverse())
	clock.advance(time.Second)
	require(t, control.Tick())
	state, err = control.State()
	require(t, err)
	if state.PlayState != "finished" || *state.CurrentTimeMS != 0 {
		t.Fatalf("reverse finish: %+v", state)
	}
}

func TestRealFyneGeometryIsBatchedAndFailuresAreAtomic(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	object := canvas.NewRectangle(nil)
	object.Move(fyne.NewPos(10, 20))
	object.Resize(fyne.NewSize(30, 40))
	spec := specification()
	for _, track := range []motion.Track{
		{ID: "vertical", Target: "panel", Property: motion.Y, Keyframes: []motion.Keyframe{{Offset: 0, Value: 20}, {Offset: 1, Value: 60}}},
		{ID: "width", Target: "panel", Property: motion.Width, Keyframes: []motion.Keyframe{{Offset: 0, Value: 30}, {Offset: 1, Value: 130}}},
		{ID: "height", Target: "panel", Property: motion.Height, Keyframes: []motion.Keyframe{{Offset: 0, Value: 40}, {Offset: 1, Value: 80}}},
	} {
		spec.Tracks = append(spec.Tracks, track)
	}
	value := clip(t, spec)
	targets := map[string]fyne.CanvasObject{"panel": object}
	binding, err := motion.BindFyne(value, targets, motion.OwnGeometry)
	require(t, err)
	targets["panel"] = canvas.NewRectangle(nil)
	clock := &manualClock{now: time.Unix(0, 0)}
	failed := false
	dispatches := 0
	control := controller(t, value, clock, binding, func(task func() error) error {
		if failed { return errors.New("dispatch unavailable") }
		dispatches++
		return task()
	})
	require(t, control.Seek(250))
	if object.Position() != fyne.NewPos(25, 30) || object.Size() != fyne.NewSize(55, 50) || dispatches != 1 {
		t.Fatalf("multi-axis geometry: %v, %v", object.Position(), object.Size())
	}
	before, err := control.State()
	require(t, err)
	for _, rate := range []float64{math.NaN(), math.Inf(1), 1e20} {
		if control.SetPlaybackRate(rate) == nil { t.Fatal("invalid rate accepted") }
	}
	if control.Seek(math.NaN()) == nil { t.Fatal("NaN seek accepted") }
	bad := before
	bad.ClipHash = strings.Repeat("0", 64)
	if control.RestoreState(bad) == nil { t.Fatal("foreign clip state accepted") }
	bad = before
	bad.CurrentTimeMS = new(float64)
	*bad.CurrentTimeMS = math.NaN()
	if control.RestoreState(bad) == nil { t.Fatal("nonfinite restored time accepted") }
	bad = before
	bad.PlayState = "unknown"
	if control.RestoreState(bad) == nil { t.Fatal("unknown playback state accepted") }
	failed = true
	if control.Seek(500) == nil { t.Fatal("failed dispatcher accepted") }
	failed = false
	after, err := control.State()
	require(t, err)
	if !reflect.DeepEqual(before, after) || object.Position() != fyne.NewPos(25, 30) || object.Size() != fyne.NewSize(55, 50) {
		t.Fatal("failed call changed state or native geometry")
	}
	require(t, control.Cancel())
	if object.Position() != fyne.NewPos(10, 20) || object.Size() != fyne.NewSize(30, 40) { t.Fatal("cancel did not restore owned geometry") }
	require(t, control.Play())
	clock.advance(-time.Second)
	if control.Tick() == nil { t.Fatal("backward clock accepted") }
	require(t, control.Close())
	require(t, control.Close())
	if object.Position() != fyne.NewPos(10, 20) || object.Size() != fyne.NewSize(30, 40) || !errors.Is(control.Tick(), motion.ErrClosed) { t.Fatal("close failed to restore/release playback") }
}

func TestStateTransportContinuesWithoutWallClockJump(t *testing.T) {
	value := clip(t, specification())
	clock := &manualClock{now: time.Unix(0, 0)}
	control := controller(t, value, clock, nil, motion.Direct)
	require(t, control.Seek(400))
	require(t, control.Play())
	state, err := control.State()
	require(t, err)
	data, err := json.Marshal(state)
	require(t, err)
	state, err = motion.ParseState(data)
	require(t, err)
	otherClock := &manualClock{now: time.Unix(1000000, 0)}
	restored := controller(t, value, otherClock, nil, motion.Direct)
	require(t, restored.RestoreState(state))
	*state.CurrentTimeMS = 900
	otherClock.advance(100 * time.Millisecond)
	got, err := restored.Sample()
	require(t, err)
	closeNumber(t, got.Values[0].Value, 50)
	for _, invalid := range []string{
		strings.Replace(string(data), `"playbackRate":1`, `"playbackRate":null`, 1),
		strings.Replace(string(data), `"schema":1`, `"schema":1,"schema":1`, 1),
		strings.Replace(string(data), `"currentTimeMs":400`, `"currentTimeMs":null`, 1),
	} {
		if _, err := motion.ParseState([]byte(invalid)); err == nil { t.Fatal("invalid transported state accepted") }
	}
}

func TestBindingReferencesOwnershipAndOvershootDiagnostics(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	object := canvas.NewRectangle(nil)
	object.Resize(fyne.NewSize(20, 30))
	value := clip(t, specification())
	if _, err := motion.BindFyne(value, map[string]fyne.CanvasObject{"panel": object}, 0); err == nil { t.Fatal("layout ownership was inferred") }
	if _, err := motion.BindFyne(value, nil, motion.OwnGeometry); err == nil { t.Fatal("missing target accepted") }
	var typedNil *canvas.Rectangle
	if _, err := motion.BindFyne(value, map[string]fyne.CanvasObject{"panel": typedNil}, motion.OwnGeometry); err == nil { t.Fatal("typed nil target accepted") }
	alias := specification()
	other := alias.Tracks[0]
	other.ID, other.Target = "second", "other"
	alias.Tracks = append(alias.Tracks, other)
	if _, err := motion.BindFyne(clip(t, alias), map[string]fyne.CanvasObject{"panel": object, "other": object}, motion.OwnGeometry); err == nil { t.Fatal("native target alias accepted") }
	spec := specification()
	spec.Tracks = append(spec.Tracks, motion.Track{ID: "size", Target: "panel", Property: motion.Width, Keyframes: []motion.Keyframe{{Offset: 0}, {Offset: 1, Value: 10}}})
	spec.Timing.Easing = motion.Easing{Kind: "cubic-bezier", Points: []float64{0.3, -5, 0.7, -5}}
	value = clip(t, spec)
	binding, err := motion.BindFyne(value, map[string]fyne.CanvasObject{"panel": object}, motion.OwnGeometry)
	require(t, err)
	control := controller(t, value, &manualClock{}, binding, motion.Direct)
	if control.Seek(500) == nil { t.Fatal("negative dimension overshoot accepted") }
	state, err := control.State()
	require(t, err)
	if state.PlayState != "idle" || object.Position() != fyne.NewPos(0, 0) || object.Size() != fyne.NewSize(20, 30) { t.Fatal("overshoot failure mutated the object or controller") }
}

func TestInactiveFillsRestoreUnderlyingNativeGeometry(t *testing.T) {
	app := test.NewApp()
	defer app.Quit()
	object := canvas.NewRectangle(nil)
	object.Move(fyne.NewPos(11, 12))
	object.Resize(fyne.NewSize(30, 40))
	spec := specification()
	spec.Timing.DelayMS, spec.Timing.Fill = 100, "none"
	value := clip(t, spec)
	binding, err := motion.BindFyne(value, map[string]fyne.CanvasObject{"panel": object}, motion.OwnGeometry)
	require(t, err)
	control := controller(t, value, &manualClock{}, binding, motion.Direct)
	require(t, control.Seek(600))
	if object.Position().X != 50 { t.Fatal("active frame was not applied") }
	for _, at := range []float64{99, 1100, 2000} {
		require(t, control.Seek(at))
		if object.Position() != fyne.NewPos(11, 12) || object.Size() != fyne.NewSize(30, 40) { t.Fatal("inactive fill retained animated geometry") }
	}
}
