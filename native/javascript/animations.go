// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sync/atomic"
	"time"

	"fyne.io/fyne/v2"
)

const maximumAnimationTimeMS = 1e12

// AnimationState transports the sampled CSS timeline without a host clock.
type AnimationState struct {
	Schema    int     `json:"schema"`
	TimeMS    float64 `json:"timeMs"`
	PlayState string  `json:"playState"`
}

func validateAnimationState(state AnimationState) error {
	if state.Schema != 1 || math.IsNaN(state.TimeMS) || math.IsInf(state.TimeMS, 0) || state.TimeMS < 0 || state.TimeMS > maximumAnimationTimeMS || (state.PlayState != "running" && state.PlayState != "paused" && state.PlayState != "finished") {
		return errors.New("javascript: invalid animation state")
	}
	return nil
}

// UnmarshalJSON preserves the exact envelope instead of accepting aliases or nulls.
func (state *AnimationState) UnmarshalJSON(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return errors.New("javascript: animation state requires an object")
	}
	fields := map[string]json.RawMessage{}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return err
		}
		name, ok := key.(string)
		if !ok || (name != "schema" && name != "timeMs" && name != "playState") || fields[name] != nil {
			return fmt.Errorf("javascript: unknown or repeated animation field %q", key)
		}
		var value json.RawMessage
		if err = decoder.Decode(&value); err != nil {
			return err
		}
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("javascript: animation field %s cannot be null", name)
		}
		fields[name] = value
	}
	if _, err = decoder.Token(); err != nil {
		return err
	}
	if len(fields) != 3 {
		return errors.New("javascript: animation state requires schema, timeMs and playState")
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return errors.New("javascript: animation state requires one JSON document")
	}
	type rawState AnimationState
	var next rawState
	if err = json.Unmarshal(data, &next); err != nil {
		return err
	}
	if err = validateAnimationState(AnimationState(next)); err != nil {
		return err
	}
	*state = AnimationState(next)
	return nil
}

// Clock supplies a monotonic host time. Exported state never stores this clock.
type Clock interface{ Now() time.Time }

type ClockFunc func() time.Time

func (clock ClockFunc) Now() time.Time { return clock() }

type Options struct {
	ManualAnimations bool
	Clock            Clock
}

type animationScheduler struct {
	stop   chan struct{}
	queued atomic.Bool
}

func (w *Widget) AnimationState() (AnimationState, error) {
	if w.archive.Schema != 2 {
		return AnimationState{}, errors.New("javascript: program has no animation timeline")
	}
	value, err := w.call("animationState")
	if err != nil {
		return AnimationState{}, err
	}
	var state AnimationState
	if err = w.decode(value, &state); err != nil {
		return AnimationState{}, err
	}
	return state, validateAnimationState(state)
}

func (w *Widget) clockNow() (now time.Time, err error) {
	defer func() {
		if value := recover(); value != nil {
			err = fmt.Errorf("javascript: animation clock failed: %v", value)
		}
	}()
	if w.options.Clock == nil {
		return time.Time{}, errors.New("javascript: animation clock is unavailable")
	}
	return w.options.Clock.Now(), nil
}

func (w *Widget) anchorAnimations(state AnimationState) error {
	w.animationTime = state.TimeMS
	if state.PlayState != "running" {
		w.stopAnimations()
		return nil
	}
	now, err := w.clockNow()
	if err != nil {
		return err
	}
	w.animationAnchor, w.animationLast = now, now
	return w.scheduleAnimations()
}

func (w *Widget) scheduleAnimations() error {
	if w.options.ManualAnimations || w.scheduler != nil || w.closed {
		return nil
	}
	app := fyne.CurrentApp()
	if app == nil || app.Driver() == nil {
		return errors.New("javascript: automatic animations require a Fyne application")
	}
	driver := app.Driver()
	scheduler := &animationScheduler{stop: make(chan struct{})}
	w.scheduler = scheduler
	go func() {
		ticker := time.NewTicker(time.Second / 60)
		defer ticker.Stop()
		for {
			select {
			case <-scheduler.stop:
				return
			case <-ticker.C:
				if !scheduler.queued.CompareAndSwap(false, true) {
					continue
				}
				driver.DoFromGoroutine(func() {
					defer scheduler.queued.Store(false)
					if w.closed || w.scheduler != scheduler {
						return
					}
					if err := w.TickAnimations(); err != nil {
						w.animationFault(err)
					}
				}, false)
			}
		}
	}()
	return nil
}

func (w *Widget) stopAnimations() {
	if w.scheduler != nil {
		close(w.scheduler.stop)
		w.scheduler = nil
	}
}

func (w *Widget) animationFault(err error) {
	w.stopAnimations()
	w.fault = err
	if w.View != nil {
		w.Refresh()
	}
}

// AdvanceAnimations samples an absolute logical time on Fyne's event goroutine.
func (w *Widget) AdvanceAnimations(timeMS float64) error {
	state, err := w.AnimationState()
	if err != nil {
		return err
	}
	if math.IsNaN(timeMS) || math.IsInf(timeMS, 0) || timeMS < state.TimeMS || timeMS > maximumAnimationTimeMS {
		return errors.New("javascript: animation time must be finite, nondecreasing and within 1e12ms")
	}
	if err = w.advanceAnimations(timeMS); err != nil {
		return err
	}
	state, err = w.AnimationState()
	if err != nil {
		return err
	}
	return w.anchorAnimations(state)
}

func (w *Widget) advanceAnimations(timeMS float64) error {
	if _, err := w.call("advanceAnimations", w.vm.ToValue(timeMS)); err != nil {
		w.animationFault(err)
		return err
	}
	if _, err := w.call("flush"); err != nil {
		w.animationFault(err)
		return err
	}
	w.Refresh()
	if err := w.Error(); err != nil {
		w.animationFault(err)
		return err
	}
	state, err := w.AnimationState()
	if err != nil {
		w.animationFault(err)
		return err
	}
	if state.PlayState != "running" {
		w.stopAnimations()
	}
	return nil
}

// TickAnimations samples the injected host clock and leaves paused timelines still.
func (w *Widget) TickAnimations() error {
	state, err := w.AnimationState()
	if err != nil {
		return err
	}
	if state.PlayState != "running" {
		w.stopAnimations()
		return nil
	}
	now, err := w.clockNow()
	if err != nil {
		return err
	}
	if now.Before(w.animationLast) {
		return errors.New("javascript: animation clock moved backwards")
	}
	elapsed := now.Sub(w.animationAnchor).Seconds() * 1000
	timeMS := w.animationTime + elapsed
	if math.IsNaN(timeMS) || math.IsInf(timeMS, 0) || timeMS < state.TimeMS || timeMS > maximumAnimationTimeMS {
		return errors.New("javascript: animation clock exceeds the logical timeline")
	}
	if err = w.advanceAnimations(timeMS); err != nil {
		return err
	}
	w.animationLast = now
	return nil
}

func (w *Widget) PauseAnimations() error {
	if w.archive.Schema != 2 {
		return errors.New("javascript: program has no animation timeline")
	}
	if !w.options.ManualAnimations {
		if err := w.TickAnimations(); err != nil {
			return err
		}
	}
	if _, err := w.call("pauseAnimations"); err != nil {
		return err
	}
	w.stopAnimations()
	return nil
}

func (w *Widget) PlayAnimations() error {
	if w.archive.Schema != 2 {
		return errors.New("javascript: program has no animation timeline")
	}
	if !w.options.ManualAnimations {
		if err := w.TickAnimations(); err != nil {
			return err
		}
	}
	if _, err := w.call("playAnimations"); err != nil {
		return err
	}
	state, err := w.AnimationState()
	if err != nil {
		return err
	}
	return w.anchorAnimations(state)
}
