// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package motion

import (
	"errors"
	"fmt"
	"math"
	"reflect"
	"sync"
	"time"
)

var ErrClosed = errors.New("motion: controller is closed")

type Clock interface {
	Now() time.Time
}

type ClockFunc func() time.Time

func (f ClockFunc) Now() time.Time { return f() }

// Dispatch must call its task synchronously exactly once on the UI goroutine,
// returning the task's error. It may return an error without calling the task.
// A dispatcher must not return an error after successfully executing its task.
type Dispatch func(task func() error) error

// Direct is for callers already on Fyne's UI goroutine, or unbound controllers.
func Direct(task func() error) error { return task() }

// State contains logical animation time, never a wall-clock timestamp or callback.
// A restored running state starts advancing from the new clock at restoration.
type State struct {
	Schema        int      `json:"schema"`
	ClipID        string   `json:"clipId"`
	ClipHash      string   `json:"clipHash"`
	CurrentTimeMS *float64 `json:"currentTimeMs"`
	PlaybackRate  float64  `json:"playbackRate"`
	PlayState     string   `json:"playState"`
}

func copyState(state State) State {
	if state.CurrentTimeMS != nil {
		value := *state.CurrentTimeMS
		state.CurrentTimeMS = &value
	}
	return state
}

func timeValue(value float64) *float64 { return &value }

func validateState(state State) error {
	if state.Schema != 1 || !identifier.MatchString(state.ClipID) || len(state.ClipHash) != 64 || !finite(state.PlaybackRate) || math.Abs(state.PlaybackRate) > 1e6 {
		return fmt.Errorf("motion: invalid state identity or playback rate")
	}
	for _, c := range state.ClipHash {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return fmt.Errorf("motion: state digest must be lowercase SHA-256")
		}
	}
	switch state.PlayState {
	case "idle":
		if state.CurrentTimeMS != nil {
			return fmt.Errorf("motion: idle state cannot retain a current time")
		}
	case "running", "paused", "finished":
		if state.CurrentTimeMS == nil || !finite(*state.CurrentTimeMS) || math.Abs(*state.CurrentTimeMS) > maxTimeMS {
			return fmt.Errorf("motion: playback state requires a finite current time")
		}
	default:
		return fmt.Errorf("motion: unsupported play state %q", state.PlayState)
	}
	return nil
}

func ParseState(data []byte) (State, error) {
	var state State
	if err := strictJSON(data, &state); err != nil {
		return State{}, err
	}
	fields, err := requiredFields(data, "schema", "clipId", "clipHash", "playbackRate", "playState")
	if err != nil {
		return State{}, err
	}
	if err = onlyFields(fields, "schema", "clipId", "clipHash", "currentTimeMs", "playbackRate", "playState"); err != nil {
		return State{}, err
	}
	if _, ok := fields["currentTimeMs"]; !ok {
		return State{}, fmt.Errorf("motion: missing JSON field currentTimeMs")
	}
	if err := validateState(state); err != nil {
		return State{}, err
	}
	return copyState(state), nil
}

type Controller struct {
	mu        sync.Mutex
	clip      *Clip
	clock     Clock
	dispatch  Dispatch
	binding   *FyneBinding
	state     State
	anchor    time.Time
	closed    bool
}

func NewController(clip *Clip, clock Clock, binding *FyneBinding, dispatch Dispatch) (*Controller, error) {
	if err := clip.valid(); err != nil {
		return nil, err
	}
	if clock == nil || dispatch == nil {
		return nil, fmt.Errorf("motion: an explicit clock and synchronous dispatcher are required")
	}
	value := reflect.ValueOf(clock)
	if (value.Kind() == reflect.Pointer || value.Kind() == reflect.Func || value.Kind() == reflect.Interface) && value.IsNil() {
		return nil, fmt.Errorf("motion: clock is nil")
	}
	if binding != nil && (binding.clip == nil || binding.clip.Hash() != clip.Hash()) {
		return nil, fmt.Errorf("motion: native binding belongs to a different clip")
	}
	return &Controller{
		clip: clip, clock: clock, binding: binding, dispatch: dispatch,
		state: State{Schema: 1, ClipID: clip.spec.ID, ClipHash: clip.Hash(), PlaybackRate: 1, PlayState: "idle"},
	}, nil
}

func (c *Controller) present(now time.Time) (State, error) {
	state := copyState(c.state)
	if state.PlayState != "running" {
		return state, nil
	}
	if now.Before(c.anchor) {
		return State{}, fmt.Errorf("motion: clock moved backwards")
	}
	elapsed := now.Sub(c.anchor).Seconds() * 1000
	current := *state.CurrentTimeMS + elapsed*state.PlaybackRate
	if !finite(current) || math.Abs(current) > maxTimeMS {
		return State{}, fmt.Errorf("motion: clock exceeded the supported timeline")
	}
	if state.PlaybackRate > 0 && current >= c.clip.EndTimeMS() {
		current, state.PlayState = c.clip.EndTimeMS(), "finished"
	} else if state.PlaybackRate < 0 && current <= 0 {
		current, state.PlayState = 0, "finished"
	}
	state.CurrentTimeMS = timeValue(current)
	return state, nil
}

func (c *Controller) sample(state State) (Sample, error) {
	if state.CurrentTimeMS == nil {
		return Sample{Values: []Value{}}, nil
	}
	return c.clip.Sample(*state.CurrentTimeMS)
}

// change dispatches before locking, so a background caller cannot hold the
// controller mutex while waiting for Fyne's UI goroutine to become available.
func (c *Controller) change(transform func(State) (State, error), closing bool, resetClock ...bool) error {
	if c == nil {
		return fmt.Errorf("motion: invalid controller")
	}
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		if closing {
			return nil
		}
		return ErrClosed
	}
	dispatch := c.dispatch
	valid := dispatch != nil && c.clip != nil && c.clock != nil
	c.mu.Unlock()
	if !valid {
		return fmt.Errorf("motion: invalid controller")
	}
	return dispatch(func() error {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.closed {
			if closing {
				return nil
			}
			return ErrClosed
		}
		now := c.clock.Now()
		current, err := c.present(now)
		if closing || len(resetClock) > 0 && resetClock[0] {
			current, err = copyState(c.state), nil
		}
		if err != nil {
			return err
		}
		next, err := transform(current)
		if err != nil {
			return err
		}
		if err = validateState(next); err != nil {
			return err
		}
		if next.ClipID != c.clip.spec.ID || next.ClipHash != c.clip.Hash() {
			return fmt.Errorf("motion: state belongs to a different clip")
		}
		if next.CurrentTimeMS != nil && next.PlayState == "running" && (next.PlaybackRate > 0 && *next.CurrentTimeMS >= c.clip.EndTimeMS() || next.PlaybackRate < 0 && *next.CurrentTimeMS <= 0) {
			return fmt.Errorf("motion: running state is outside its playback boundary")
		}
		if next.CurrentTimeMS != nil && next.PlayState == "finished" {
			t := *next.CurrentTimeMS
			if next.PlaybackRate > 0 && t != c.clip.EndTimeMS() || next.PlaybackRate < 0 && t != 0 || next.PlaybackRate == 0 && t != 0 && t != c.clip.EndTimeMS() {
				return fmt.Errorf("motion: finished state is not at its playback boundary")
			}
		}
		sample, err := c.sample(next)
		if err != nil {
			return err
		}
		if c.binding != nil {
			plan, err := c.binding.plan(sample)
			if err != nil {
				return err
			}
			c.binding.apply(plan)
		}
		c.state, c.anchor, c.closed = copyState(next), now, closing
		return nil
	})
}

func (c *Controller) State() (State, error) {
	if c == nil {
		return State{}, fmt.Errorf("motion: invalid controller")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return State{}, ErrClosed
	}
	if c.clip == nil || c.clock == nil {
		return State{}, fmt.Errorf("motion: invalid controller")
	}
	return c.present(c.clock.Now())
}

// Sample reads the current logical animation without writing native objects.
func (c *Controller) Sample() (Sample, error) {
	state, err := c.State()
	if err != nil {
		return Sample{}, err
	}
	return c.sample(state)
}

// Tick is the only scheduler operation needed. A host may call it from a Fyne
// animation tick; that animation supplies scheduling, never portable behavior.
func (c *Controller) Tick() error {
	return c.change(func(state State) (State, error) { return state, nil }, false)
}

// Seek pauses at the requested time, including before/after the active interval.
func (c *Controller) Seek(timeMS float64) error {
	return c.change(func(state State) (State, error) {
		if !finite(timeMS) || math.Abs(timeMS) > maxTimeMS {
			return State{}, fmt.Errorf("motion: seek time exceeds the finite timeline")
		}
		state.CurrentTimeMS, state.PlayState = timeValue(timeMS), "paused"
		return state, nil
	}, false)
}

func (c *Controller) start(state State) State {
	end := c.clip.EndTimeMS()
	if state.CurrentTimeMS == nil || state.PlaybackRate > 0 && (*state.CurrentTimeMS < 0 || *state.CurrentTimeMS >= end) {
		state.CurrentTimeMS = timeValue(0)
	}
	if state.PlaybackRate < 0 && (state.CurrentTimeMS == nil || *state.CurrentTimeMS <= 0 || *state.CurrentTimeMS > end) {
		state.CurrentTimeMS = timeValue(end)
	}
	state.PlayState = "running"
	if end == 0 && state.PlaybackRate != 0 {
		state.CurrentTimeMS, state.PlayState = timeValue(0), "finished"
	}
	return state
}

func (c *Controller) Play() error {
	return c.change(func(state State) (State, error) {
		if state.PlayState == "running" {
			return state, nil
		}
		return c.start(state), nil
	}, false)
}

func (c *Controller) Pause() error {
	return c.change(func(state State) (State, error) {
		if state.CurrentTimeMS != nil {
			state.PlayState = "paused"
		}
		return state, nil
	}, false)
}

func (c *Controller) Reverse() error {
	return c.change(func(state State) (State, error) {
		if state.PlaybackRate == 0 {
			return State{}, fmt.Errorf("motion: cannot reverse a zero playback rate")
		}
		state.PlaybackRate = -state.PlaybackRate
		return c.start(state), nil
	}, false)
}

func (c *Controller) Cancel() error {
	return c.change(func(state State) (State, error) {
		state.CurrentTimeMS, state.PlayState = nil, "idle"
		return state, nil
	}, false, true)
}

func (c *Controller) Finish() error {
	return c.change(func(state State) (State, error) {
		if state.PlaybackRate == 0 {
			return State{}, fmt.Errorf("motion: cannot finish a zero playback rate")
		}
		current := c.clip.EndTimeMS()
		if state.PlaybackRate < 0 {
			current = 0
		}
		state.CurrentTimeMS, state.PlayState = timeValue(current), "finished"
		return state, nil
	}, false)
}

func (c *Controller) SetPlaybackRate(rate float64) error {
	return c.change(func(state State) (State, error) {
		if !finite(rate) || math.Abs(rate) > 1e6 {
			return State{}, fmt.Errorf("motion: playback rate must be finite and within the supported range")
		}
		state.PlaybackRate = rate
		if state.CurrentTimeMS != nil {
			if state.PlayState == "finished" && (rate > 0 && *state.CurrentTimeMS < c.clip.EndTimeMS() || rate < 0 && *state.CurrentTimeMS > 0) {
				state.PlayState = "running"
			}
			if state.PlayState == "running" && rate > 0 && *state.CurrentTimeMS >= c.clip.EndTimeMS() {
				state.CurrentTimeMS, state.PlayState = timeValue(c.clip.EndTimeMS()), "finished"
			} else if state.PlayState == "running" && rate < 0 && *state.CurrentTimeMS <= 0 {
				state.CurrentTimeMS, state.PlayState = timeValue(0), "finished"
			}
		}
		return state, nil
	}, false)
}

func (c *Controller) RestoreState(state State) error {
	state = copyState(state)
	if err := validateState(state); err != nil {
		return err
	}
	return c.change(func(State) (State, error) { return copyState(state), nil }, false)
}

// Close restores original owned geometry and releases all native object references.
// Hosts must stop their scheduler before closing; Close is idempotent.
func (c *Controller) Close() error {
	err := c.change(func(state State) (State, error) {
		state.CurrentTimeMS, state.PlayState = nil, "idle"
		return state, nil
	}, true)
	if err == nil && c != nil {
		c.mu.Lock()
		c.binding = nil
		c.clock = nil
		c.dispatch = nil
		c.mu.Unlock()
	}
	return err
}
