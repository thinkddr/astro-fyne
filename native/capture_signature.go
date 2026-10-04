// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strconv"
	"unicode/utf8"
)

// SnapshotAttributes encodes the tag and ordinary attributes as typed canonical
// JSON. The emitter excludes events/key; undefined, null and absence stay distinct.
// Unsupported values panic within builder recovery. No methods/getters/callbacks
// run. Call on the UI goroutine without concurrent attribute mutation.
func SnapshotAttributes(tag string, attrs Scope) string {
	if !validCaptureTag(tag) {
		panic(fmt.Errorf("webui: capture attributes require a fixed lowercase source HTML tag, got %q", tag))
	}
	encoder := attributeEncoder{active: map[attributeVisit]bool{}}
	value := []any{"element", tag, encoder.encode(attrs, 0)}
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(fmt.Errorf("webui: cannot encode captured attributes: %w", err))
	}
	return string(encoded)
}

type attributeVisit struct {
	kind    reflect.Kind
	pointer uintptr
	length  int
}
type attributeEncoder struct {
	active map[attributeVisit]bool
	count  int
}

func (e *attributeEncoder) encode(value any, depth int) any {
	e.count++
	if depth > 128 || e.count > 100000 {
		panic("webui: captured attributes exceed the supported depth/value limits")
	}
	if isUndefined(value) {
		return []any{"undefined"}
	}
	if value == nil {
		return []any{"null"}
	}
	r := reflect.ValueOf(value)
	switch r.Kind() {
	case reflect.Bool:
		return []any{"boolean", r.Bool()}
	case reflect.String:
		if !utf8.ValidString(r.String()) {
			panic("webui: captured attribute strings require valid UTF-8")
		}
		return []any{"string", r.String()}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Float32, reflect.Float64:
		number := Number(value)
		if math.IsNaN(number) || math.IsInf(number, 0) {
			panic("webui: captured attributes cannot contain nonfinite numbers")
		}
		return []any{"number", strconv.FormatFloat(number, 'g', -1, 64)}
	case reflect.Map:
		if r.Type().Key().Kind() != reflect.String {
			panic(fmt.Errorf("webui: captured object %T requires string property names", value))
		}
		visit := attributeVisit{kind: reflect.Map, pointer: uintptr(r.UnsafePointer())}
		if e.active[visit] {
			panic("webui: captured attributes cannot contain cycles")
		}
		e.active[visit] = true
		defer delete(e.active, visit)
		keys := r.MapKeys()
		sort.Slice(keys, func(i, j int) bool { return keys[i].String() < keys[j].String() })
		entries := make([]any, 0, len(keys))
		for _, key := range keys {
			if !utf8.ValidString(key.String()) {
				panic("webui: captured property names require valid UTF-8")
			}
			entries = append(entries, []any{key.String(), e.encode(r.MapIndex(key).Interface(), depth+1)})
		}
		return []any{"object", entries}
	case reflect.Slice, reflect.Array:
		if r.Kind() == reflect.Slice && r.Len() > 0 {
			visit := attributeVisit{kind: reflect.Slice, pointer: r.Pointer(), length: r.Len()}
			if e.active[visit] {
				panic("webui: captured attributes cannot contain cycles")
			}
			e.active[visit] = true
			defer delete(e.active, visit)
		}
		items := make([]any, r.Len())
		for i := range r.Len() {
			items[i] = e.encode(r.Index(i).Interface(), depth+1)
		}
		return []any{"array", items}
	default:
		panic(fmt.Errorf("webui: captured attribute value %T is unsupported; supply primitive, array or string-keyed object values", value))
	}
}

func validCaptureTag(tag string) bool {
	if tag == "" || tag[0] < 'a' || tag[0] > 'z' {
		return false
	}
	for _, r := range tag {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return true
}
