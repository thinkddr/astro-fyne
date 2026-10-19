// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package motion

import (
	"fmt"
	"math"
	"reflect"
	"sort"

	"fyne.io/fyne/v2"
)

type LayoutOwnership uint8

// OwnGeometry asserts that a parent layout and other animations will not write
// the target's position or size for the lifetime of this binding.
const OwnGeometry LayoutOwnership = 1

type geometry struct {
	position fyne.Position
	size     fyne.Size
}

// FyneBinding copies targets and their original geometry on the UI goroutine.
// All target axes are planned together before any Move or Resize is performed.
type FyneBinding struct {
	clip    *Clip
	targets map[string]fyne.CanvasObject
	base    map[string]geometry
	order   []string
}

func validGeometry(g geometry) bool {
	for _, value := range []float32{g.position.X, g.position.Y, g.size.Width, g.size.Height} {
		if !finite(float64(value)) {
			return false
		}
	}
	return g.size.Width >= 0 && g.size.Height >= 0
}

func BindFyne(clip *Clip, targets map[string]fyne.CanvasObject, ownership LayoutOwnership) (*FyneBinding, error) {
	if err := clip.valid(); err != nil {
		return nil, err
	}
	if ownership != OwnGeometry {
		return nil, fmt.Errorf("motion: native geometry requires explicit layout ownership")
	}
	binding := &FyneBinding{clip: clip, targets: map[string]fyne.CanvasObject{}, base: map[string]geometry{}}
	seen := map[fyne.CanvasObject]bool{}
	for _, track := range clip.spec.Tracks {
		if binding.targets[track.Target] != nil {
			continue
		}
		object := targets[track.Target]
		value := reflect.ValueOf(object)
		if object == nil || value.Kind() != reflect.Pointer || value.IsNil() {
			return nil, fmt.Errorf("motion: target %q requires a nonnil native object pointer", track.Target)
		}
		if seen[object] {
			return nil, fmt.Errorf("motion: target aliases share a native object")
		}
		seen[object] = true
		g := geometry{object.Position(), object.Size()}
		if !validGeometry(g) {
			return nil, fmt.Errorf("motion: invalid original geometry on target %s", track.Target)
		}
		binding.targets[track.Target], binding.base[track.Target] = object, g
		binding.order = append(binding.order, track.Target)
	}
	sort.Strings(binding.order)
	return binding, nil
}

func (b *FyneBinding) plan(sample Sample) (map[string]geometry, error) {
	if b == nil || b.clip == nil {
		return nil, fmt.Errorf("motion: invalid native binding")
	}
	if !finite(sample.Progress) || sample.Progress < 0 || sample.Progress > 1 || sample.Active && len(sample.Values) != len(b.clip.spec.Tracks) || !sample.Active && len(sample.Values) != 0 {
		return nil, fmt.Errorf("motion: invalid sample")
	}
	plan := make(map[string]geometry, len(b.base))
	for id, original := range b.base {
		plan[id] = original
	}
	for i, value := range sample.Values {
		track := b.clip.spec.Tracks[i]
		if value.Track != track.ID || value.Target != track.Target || value.Property != track.Property || !finite(value.Value) || math.Abs(value.Value) > math.MaxFloat32 {
			return nil, fmt.Errorf("motion: sample does not match its native binding")
		}
		g := plan[value.Target]
		switch value.Property {
		case X:
			g.position.X = float32(value.Value)
		case Y:
			g.position.Y = float32(value.Value)
		case Width:
			g.size.Width = float32(value.Value)
		case Height:
			g.size.Height = float32(value.Value)
		}
		if !validGeometry(g) {
			return nil, fmt.Errorf("motion: sample produces invalid native geometry")
		}
		plan[value.Target] = g
	}
	return plan, nil
}

func (b *FyneBinding) apply(plan map[string]geometry) {
	for _, id := range b.order {
		object, g := b.targets[id], plan[id]
		object.Move(g.position)
		object.Resize(g.size)
	}
}
