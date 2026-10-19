// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Package motion samples portable numeric keyframes and applies them to explicitly
// owned native geometry. It does not serialize Go callbacks or claim pixel parity.
package motion

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
)

type Property string

const (
	X      Property = "x"
	Y      Property = "y"
	Width  Property = "width"
	Height Property = "height"
)

const maxTimeMS = 1e12

var identifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.:/-]{0,255}$`)

// Keyframe uses an explicit normalized offset and a numeric CSS pixel value.
type Keyframe struct {
	Offset float64 `json:"offset"`
	Value  float64 `json:"value"`
}

type Track struct {
	ID        string     `json:"id"`
	Target    string     `json:"target"`
	Property  Property   `json:"property"`
	Keyframes []Keyframe `json:"keyframes"`
}

// Easing is linear or cubic-bezier with four CSS control-point coordinates.
// The curve applies within each keyframe interval, as in CSS animations.
type Easing struct {
	Kind   string    `json:"kind"`
	Points []float64 `json:"points,omitempty"`
}

type Timing struct {
	DurationMS float64 `json:"durationMs"`
	DelayMS    float64 `json:"delayMs"`
	Iterations float64 `json:"iterations"`
	Direction  string  `json:"direction"`
	Fill       string  `json:"fill"`
	Easing     Easing  `json:"easing"`
}

// Spec is construction data. NewClip and Spec() copy every mutable slice.
type Spec struct {
	Schema int     `json:"schema"`
	ID     string  `json:"id"`
	Tracks []Track `json:"tracks"`
	Timing Timing  `json:"timing"`
}

// Clip owns validated, immutable metadata. Its zero value is invalid.
type Clip struct {
	spec Spec
	hash string
}

type Value struct {
	Track    string   `json:"track"`
	Target   string   `json:"target"`
	Property Property `json:"property"`
	Value    float64  `json:"value"`
}

// An inactive sample has no values: a binding restores its owned base geometry.
type Sample struct {
	Active   bool    `json:"active"`
	Progress float64 `json:"progress"`
	Values   []Value `json:"values"`
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func copySpec(spec Spec) Spec {
	spec.Tracks = append([]Track(nil), spec.Tracks...)
	for i := range spec.Tracks {
		spec.Tracks[i].Keyframes = append([]Keyframe(nil), spec.Tracks[i].Keyframes...)
	}
	spec.Timing.Easing.Points = append([]float64(nil), spec.Timing.Easing.Points...)
	return spec
}

func NewClip(spec Spec) (*Clip, error) {
	spec = copySpec(spec)
	if spec.Schema != 1 || !identifier.MatchString(spec.ID) {
		return nil, fmt.Errorf("motion: clip requires schema 1 and a portable ID")
	}
	if len(spec.Tracks) == 0 || len(spec.Tracks) > 1000 {
		return nil, fmt.Errorf("motion: clip requires 1..1000 tracks")
	}
	if err := validateTiming(spec.Timing); err != nil {
		return nil, err
	}
	ids, properties := map[string]bool{}, map[string]bool{}
	frames := 0
	for _, track := range spec.Tracks {
		if !identifier.MatchString(track.ID) || !identifier.MatchString(track.Target) || ids[track.ID] {
			return nil, fmt.Errorf("motion: invalid or duplicate track ID/target %q", track.ID)
		}
		ids[track.ID] = true
		switch track.Property {
		case X, Y, Width, Height:
		default:
			return nil, fmt.Errorf("motion: property %q requires a native motion adapter", track.Property)
		}
		key := track.Target + "\x00" + string(track.Property)
		if properties[key] {
			return nil, fmt.Errorf("motion: duplicate property %s on target %s", track.Property, track.Target)
		}
		properties[key] = true
		frames += len(track.Keyframes)
		if len(track.Keyframes) < 2 || frames > 10000 || track.Keyframes[0].Offset != 0 || track.Keyframes[len(track.Keyframes)-1].Offset != 1 {
			return nil, fmt.Errorf("motion: track %s needs explicit 0/1 endpoints within 10000 total keyframes", track.ID)
		}
		previous := -1.0
		for _, frame := range track.Keyframes {
			if !finite(frame.Offset) || frame.Offset < 0 || frame.Offset > 1 || frame.Offset <= previous || !finite(frame.Value) || math.Abs(frame.Value) > math.MaxFloat32 {
				return nil, fmt.Errorf("motion: track %s has unordered, duplicate or nonfinite keyframes", track.ID)
			}
			if (track.Property == Width || track.Property == Height) && frame.Value < 0 {
				return nil, fmt.Errorf("motion: native dimensions cannot be negative")
			}
			previous = frame.Offset
		}
	}
	return &Clip{spec: spec, hash: fingerprint(spec)}, nil
}

// fingerprint is independent of JSON encoders, floating-point notation and HTML
// escaping. Counts and UTF-8 byte lengths are uint32 big-endian; numbers are their
// IEEE-754 float64 bits in big-endian order, with both zero signs encoded as +0.
// Zero signs have identical numeric geometry semantics and JSON encoders may
// normalize them; exact authored source bytes have a separate source digest.
func fingerprint(spec Spec) string {
	hash := sha256.New()
	hash.Write([]byte("astro-fyne-motion:1\x00"))
	count := func(value int) {
		var encoded [4]byte
		binary.BigEndian.PutUint32(encoded[:], uint32(value))
		hash.Write(encoded[:])
	}
	text := func(value string) {
		count(len([]byte(value)))
		hash.Write([]byte(value))
	}
	number := func(value float64) {
		var encoded [8]byte
		bits := math.Float64bits(value)
		if value == 0 {
			bits = 0
		}
		binary.BigEndian.PutUint64(encoded[:], bits)
		hash.Write(encoded[:])
	}
	text(spec.ID)
	number(spec.Timing.DurationMS)
	number(spec.Timing.DelayMS)
	number(spec.Timing.Iterations)
	text(spec.Timing.Direction)
	text(spec.Timing.Fill)
	text(spec.Timing.Easing.Kind)
	count(len(spec.Timing.Easing.Points))
	for _, value := range spec.Timing.Easing.Points {
		number(value)
	}
	count(len(spec.Tracks))
	for _, track := range spec.Tracks {
		text(track.ID)
		text(track.Target)
		text(string(track.Property))
		count(len(track.Keyframes))
		for _, frame := range track.Keyframes {
			number(frame.Offset)
			number(frame.Value)
		}
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func validateTiming(timing Timing) error {
	if !finite(timing.DurationMS) || timing.DurationMS < 0 || timing.DurationMS > maxTimeMS || !finite(timing.DelayMS) || math.Abs(timing.DelayMS) > maxTimeMS || !finite(timing.Iterations) || timing.Iterations < 0 || timing.Iterations > 1e9 {
		return fmt.Errorf("motion: duration, delay and finite iteration count exceed the supported range")
	}
	active := timing.DurationMS * timing.Iterations
	if !finite(active) || active > maxTimeMS || math.Abs(timing.DelayMS+active) > maxTimeMS {
		return fmt.Errorf("motion: effect duration exceeds the supported timeline")
	}
	switch timing.Direction {
	case "normal", "reverse", "alternate", "alternate-reverse":
	default:
		return fmt.Errorf("motion: unsupported direction %q", timing.Direction)
	}
	switch timing.Fill {
	case "none", "backwards", "forwards", "both":
	default:
		return fmt.Errorf("motion: unsupported fill %q", timing.Fill)
	}
	return timing.Easing.Validate()
}

func (e Easing) Validate() error {
	if e.Kind == "linear" && len(e.Points) == 0 {
		return nil
	}
	if e.Kind != "cubic-bezier" || len(e.Points) != 4 {
		return fmt.Errorf("motion: easing requires linear or four-point cubic-bezier")
	}
	for _, value := range e.Points {
		if !finite(value) || math.Abs(value) > 1e6 {
			return fmt.Errorf("motion: nonfinite or excessive easing coordinate")
		}
	}
	if e.Points[0] < 0 || e.Points[0] > 1 || e.Points[2] < 0 || e.Points[2] > 1 {
		return fmt.Errorf("motion: cubic-bezier x coordinates must be in [0,1]")
	}
	return nil
}

// Evaluate inverts the curve's x coordinate before sampling y. Endpoint values
// stay exact. Bisection also handles valid curves with zero endpoint derivatives.
func (e Easing) Evaluate(progress float64) (float64, error) {
	if err := e.Validate(); err != nil {
		return 0, err
	}
	if !finite(progress) || progress < 0 || progress > 1 {
		return 0, fmt.Errorf("motion: easing progress must be in [0,1]")
	}
	if e.Kind == "linear" || progress == 0 || progress == 1 {
		return progress, nil
	}
	axis := func(t, a, b float64) float64 {
		u := 1 - t
		return 3*u*u*t*a + 3*u*t*t*b + t*t*t
	}
	lo, hi := 0.0, 1.0
	for range 52 {
		mid := (lo + hi) / 2
		if axis(mid, e.Points[0], e.Points[2]) < progress {
			lo = mid
		} else {
			hi = mid
		}
	}
	return axis((lo+hi)/2, e.Points[1], e.Points[3]), nil
}

func (c *Clip) valid() error {
	if c == nil || c.hash == "" {
		return fmt.Errorf("motion: invalid clip")
	}
	return nil
}

func (c *Clip) Spec() Spec {
	if c == nil {
		return Spec{}
	}
	return copySpec(c.spec)
}

func (c *Clip) Hash() string {
	if c == nil {
		return ""
	}
	return c.hash
}

func (c *Clip) MarshalJSON() ([]byte, error) {
	if err := c.valid(); err != nil {
		return nil, err
	}
	return json.Marshal(c.spec)
}

func (c *Clip) EndTimeMS() float64 {
	if c == nil {
		return 0
	}
	return math.Max(0, c.spec.Timing.DelayMS+c.spec.Timing.DurationMS*c.spec.Timing.Iterations)
}

func (c *Clip) Sample(timeMS float64) (Sample, error) {
	result := Sample{Values: []Value{}}
	if err := c.valid(); err != nil {
		return result, err
	}
	if !finite(timeMS) || math.Abs(timeMS) > maxTimeMS {
		return result, fmt.Errorf("motion: sample time exceeds the finite timeline")
	}
	timing := c.spec.Timing
	activeDuration := timing.DurationMS * timing.Iterations
	before, after := timeMS < timing.DelayMS, timeMS >= timing.DelayMS+activeDuration
	if before && timing.Fill != "backwards" && timing.Fill != "both" || after && timing.Fill != "forwards" && timing.Fill != "both" {
		return result, nil
	}
	position := 0.0
	if after {
		position = timing.Iterations
	} else if !before && timing.DurationMS > 0 {
		position = (timeMS - timing.DelayMS) / timing.DurationMS
	}
	iteration, progress := math.Floor(position), position-math.Floor(position)
	if after && progress == 0 && position > 0 {
		iteration--
		progress = 1
	}
	reversed := timing.Direction == "reverse" || timing.Direction == "alternate-reverse"
	if (timing.Direction == "alternate" || timing.Direction == "alternate-reverse") && math.Mod(iteration, 2) == 1 {
		reversed = !reversed
	}
	if reversed {
		progress = 1 - progress
	}
	result.Active, result.Progress = true, progress
	for _, track := range c.spec.Tracks {
		index := sort.Search(len(track.Keyframes), func(i int) bool { return track.Keyframes[i].Offset >= progress })
		if index == 0 {
			index = 1
		}
		if index == len(track.Keyframes) {
			index--
		}
		a, b := track.Keyframes[index-1], track.Keyframes[index]
		local := (progress - a.Offset) / (b.Offset - a.Offset)
		eased, err := timing.Easing.Evaluate(local)
		if err != nil {
			return Sample{}, err
		}
		value := a.Value + (b.Value-a.Value)*eased
		if !finite(value) || math.Abs(value) > math.MaxFloat32 || (track.Property == Width || track.Property == Height) && value < 0 {
			return Sample{}, fmt.Errorf("motion: interpolated geometry exceeds the native range on track %s", track.ID)
		}
		result.Values = append(result.Values, Value{track.ID, track.Target, track.Property, value})
	}
	return result, nil
}
