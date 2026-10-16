// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

var ErrProgramUnavailable = errors.New("webui: this widget has no portable declarative program")

// ProgramArchive preserves compiler IR and declared state, not arbitrary Go
// functions, native theme overrides, focus or a pixel-verification claim.
// Program is exact JSON text so its hash survives JSON encoder escaping.
type ProgramArchive struct {
	Schema      int          `json:"schema"`
	Kind        string       `json:"kind"`
	SourceHash  string       `json:"sourceHash"`
	ProgramHash string       `json:"programHash"`
	Program     string       `json:"program"`
	Props       ProgramValue `json:"props"`
	State       ProgramValue `json:"state"`
}

// ProgramValue preserves undefined, special numbers and shared/cyclic data.
// Objects have ordinary data properties; functions need explicit named actions.
type ProgramValue struct {
	Kind    string         `json:"kind"`
	ID      int            `json:"id,omitempty"`
	Value   any            `json:"value,omitempty"`
	Items   []ProgramValue `json:"items,omitempty"`
	Entries []ProgramEntry `json:"entries,omitempty"`
}
type ProgramEntry struct {
	Key   string       `json:"key"`
	Value ProgramValue `json:"value"`
}

type programReference struct {
	kind    reflect.Kind
	pointer uintptr
	length  int
}
type programEncoder struct {
	refs         map[programReference]int
	count, bytes int
}

func (e *programEncoder) encode(value any, depth int, bindings map[string]bool) (ProgramValue, error) {
	e.count++
	if depth > 100 || e.count > 100000 {
		return ProgramValue{}, fmt.Errorf("webui: portable state exceeds the depth/value limit")
	}
	if value == nil {
		return ProgramValue{Kind: "null"}, nil
	}
	if isUndefined(value) {
		return ProgramValue{Kind: "undefined"}, nil
	}
	v := reflect.ValueOf(value)
	switch v.Kind() {
	case reflect.String:
		text := v.String()
		e.bytes += len(text)
		if !utf8.ValidString(text) || e.bytes > 16*1024*1024 {
			return ProgramValue{}, fmt.Errorf("webui: portable data requires valid UTF-8 within 16MiB")
		}
		return ProgramValue{Kind: "string", Value: text}, nil
	case reflect.Bool:
		return ProgramValue{Kind: "boolean", Value: v.Bool()}, nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Float32, reflect.Float64:
		n := Number(value)
		text := strconv.FormatFloat(n, 'g', -1, 64)
		if math.IsInf(n, 1) {
			text = "Infinity"
		}
		if math.IsInf(n, -1) {
			text = "-Infinity"
		}
		e.bytes += len(text)
		if e.bytes > 16*1024*1024 {
			return ProgramValue{}, fmt.Errorf("webui: portable data exceeds 16MiB")
		}
		return ProgramValue{Kind: "number", Value: text}, nil
	case reflect.Map, reflect.Slice:
		if v.Kind() == reflect.Map && v.Type().Key().Kind() != reflect.String {
			return ProgramValue{}, fmt.Errorf("webui: portable records require string keys")
		}
		pointer := uintptr(0)
		if v.Kind() == reflect.Map {
			pointer = uintptr(v.UnsafePointer())
		} else {
			pointer = v.Pointer()
		}
		ref := programReference{v.Kind(), pointer, 0}
		if v.Kind() == reflect.Slice {
			ref.length = v.Len()
		}
		if id, ok := e.refs[ref]; ok {
			if v.Kind() == reflect.Slice && v.Len() == 0 && v.Cap() == 0 || v.Kind() == reflect.Map && v.IsNil() {
				return ProgramValue{}, fmt.Errorf("webui: repeated zero-capacity slices or nil maps require an explicit identity adapter")
			}
			return ProgramValue{Kind: "reference", ID: id}, nil
		}
		id := len(e.refs) + 1
		e.refs[ref] = id
		out := ProgramValue{Kind: "array", ID: id, Items: []ProgramValue{}}
		if v.Kind() == reflect.Slice {
			for i := 0; i < v.Len(); i++ {
				item, err := e.encode(v.Index(i).Interface(), depth+1, nil)
				if err != nil {
					return ProgramValue{}, err
				}
				out.Items = append(out.Items, item)
			}
			return out, nil
		}
		out.Kind = "object"
		out.Items = nil
		out.Entries = []ProgramEntry{}
		keys := v.MapKeys()
		sort.Slice(keys, func(i, j int) bool { return keys[i].String() < keys[j].String() })
		for _, key := range keys {
			e.bytes += len(key.String())
			if !utf8.ValidString(key.String()) || e.bytes > 16*1024*1024 {
				return ProgramValue{}, fmt.Errorf("webui: portable record keys require valid UTF-8 within 16MiB")
			}
			item := v.MapIndex(key).Interface()
			if bindings[key.String()] && item != nil && reflect.ValueOf(item).Kind() == reflect.Func && !reflect.ValueOf(item).IsNil() {
				e.count++
				e.bytes += len(key.String())
				if e.count > 100000 || e.bytes > 16*1024*1024 {
					return ProgramValue{}, fmt.Errorf("webui: portable data exceeds its value/byte limit")
				}
				out.Entries = append(out.Entries, ProgramEntry{key.String(), ProgramValue{Kind: "action", Value: key.String()}})
				continue
			}
			encoded, err := e.encode(item, depth+1, nil)
			if err != nil {
				return ProgramValue{}, err
			}
			out.Entries = append(out.Entries, ProgramEntry{key.String(), encoded})
		}
		return out, nil
	default:
		return ProgramValue{}, fmt.Errorf("webui: %T requires an explicit portable data adapter", value)
	}
}

// ExportProgram runs on the host UI goroutine. It never reevaluates the builder
// or invokes callbacks; pending editor values must first enter declared state.
func ExportProgram(program, sourceHash string, props, state Scope, view *View) (ProgramArchive, error) {
	if view == nil {
		return ProgramArchive{}, ErrProgramUnavailable
	}
	if err := errors.Join(view.Error(), view.uncommittedInputError()); err != nil {
		return ProgramArchive{}, err
	}
	snapshot, err := view.Snapshot()
	if err != nil {
		return ProgramArchive{}, err
	}
	if snapshot.HasFocus {
		return ProgramArchive{}, fmt.Errorf("webui: export an unfocused program; focus/caret/selection are not portable state")
	}
	if len(program) > 64*1024*1024 || !json.Valid([]byte(program)) {
		return ProgramArchive{}, fmt.Errorf("webui: invalid portable program JSON")
	}
	var metadata struct {
		Actions []string `json:"actions"`
	}
	if err := json.Unmarshal([]byte(program), &metadata); err != nil {
		return ProgramArchive{}, err
	}
	bindings := map[string]bool{}
	for _, name := range metadata.Actions {
		bindings[name] = true
	}
	encoder := programEncoder{refs: map[programReference]int{}}
	p, err := encoder.encode(props, 0, bindings)
	if err != nil {
		return ProgramArchive{}, err
	}
	s, err := encoder.encode(state, 0, nil)
	if err != nil {
		return ProgramArchive{}, err
	}
	hash := sha256.Sum256([]byte(program))
	return ProgramArchive{1, "astro-fyne-program", sourceHash, hex.EncodeToString(hash[:]), program, p, s}, nil
}

type programDecoder struct {
	refs    map[int]any
	count   int
	actions Actions
}

func (d *programDecoder) decode(v ProgramValue, depth int, topProps bool, actionKey string) (any, error) {
	d.count++
	if depth > 100 || d.count > 100000 {
		return nil, fmt.Errorf("webui: portable state exceeds the depth/value limit")
	}
	switch v.Kind {
	case "action":
		name, ok := v.Value.(string)
		if !ok || name == "" || name != actionKey || d.actions[name] == nil {
			return nil, fmt.Errorf("webui: portable callback requires named action %q", name)
		}
		return d.actions[name], nil
	case "null":
		return nil, nil
	case "undefined":
		return Undefined, nil
	case "string":
		s, ok := v.Value.(string)
		if !ok || !utf8.ValidString(s) {
			return nil, fmt.Errorf("webui: invalid portable string")
		}
		return s, nil
	case "boolean":
		b, ok := v.Value.(bool)
		if !ok {
			return nil, fmt.Errorf("webui: invalid portable Boolean")
		}
		return b, nil
	case "number":
		s, ok := v.Value.(string)
		if !ok {
			return nil, fmt.Errorf("webui: invalid portable number")
		}
		n, err := strconv.ParseFloat(s, 64)
		if err != nil && !(s == "Infinity" || s == "-Infinity") {
			return nil, err
		}
		return n, nil
	case "reference":
		value, ok := d.refs[v.ID]
		if !ok {
			return nil, fmt.Errorf("webui: unresolved portable reference %d", v.ID)
		}
		return value, nil
	case "array", "object":
		if v.ID <= 0 || d.refs[v.ID] != nil {
			return nil, fmt.Errorf("webui: invalid or duplicate portable identity")
		}
		if v.Kind == "array" {
			// A backing cell gives distinct empty JavaScript arrays distinct Go identities.
			out := make([]any, len(v.Items), max(1, len(v.Items)))
			d.refs[v.ID] = out
			for i, item := range v.Items {
				value, err := d.decode(item, depth+1, false, "")
				if err != nil {
					return nil, err
				}
				out[i] = value
			}
			return out, nil
		}
		out := Scope{}
		d.refs[v.ID] = out
		for _, entry := range v.Entries {
			if _, ok := out[entry.Key]; ok {
				return nil, fmt.Errorf("webui: duplicate portable property")
			}
			allowed := ""
			if topProps {
				allowed = entry.Key
			}
			value, err := d.decode(entry.Value, depth+1, false, allowed)
			if err != nil {
				return nil, err
			}
			out[entry.Key] = value
		}
		return out, nil
	default:
		return nil, fmt.Errorf("webui: unsupported portable value %q", v.Kind)
	}
}

// RestoreProgram seeds generated Go from an archive validated by the compiler.
// Caller props override exported data; named action implementations stay local.
func RestoreProgram(data, expectedProgram string, overrides Scope, actions Actions) (Scope, Scope, error) {
	var archive ProgramArchive
	if err := json.Unmarshal([]byte(data), &archive); err != nil {
		return nil, nil, err
	}
	hash := sha256.Sum256([]byte(expectedProgram))
	if archive.Schema != 1 || archive.Kind != "astro-fyne-program" || archive.Program != expectedProgram || archive.ProgramHash != hex.EncodeToString(hash[:]) {
		return nil, nil, fmt.Errorf("webui: portable program identity mismatch")
	}
	decoder := programDecoder{refs: map[int]any{}, actions: actions}
	p, err := decoder.decode(archive.Props, 0, true, "")
	if err != nil {
		return nil, nil, err
	}
	s, err := decoder.decode(archive.State, 0, false, "")
	if err != nil {
		return nil, nil, err
	}
	props, ok := p.(Scope)
	if !ok {
		return nil, nil, fmt.Errorf("webui: portable props must be a record")
	}
	state, ok := s.(Scope)
	if !ok {
		return nil, nil, fmt.Errorf("webui: portable state must be a record")
	}
	for key, value := range state {
		if strings.HasSuffix(key, "/@key-kind") {
			n, ok := value.(float64)
			if !ok || (n != float64('s') && n != float64('n')) {
				return nil, nil, fmt.Errorf("webui: invalid restored list key kind")
			}
			state[key] = byte(n)
		}
	}
	for key, value := range overrides {
		props[key] = value
	}
	return props, state, nil
}
