// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Package javascript executes bundled Preact in Goja and renders native Fyne widgets.
package javascript

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"time"

	"fyne.io/fyne/v2"
	"github.com/dop251/goja"
	webui "github.com/thinkddr/astro-fyne/native"
)

type Source struct {
	Path string `json:"path"`
	Hash string `json:"hash"`
}
type Event struct {
	Node  string  `json:"node"`
	Type  string  `json:"type"`
	Value *string `json:"value,omitempty"`
}
type JournalEntry struct {
	Kind  string  `json:"kind"`
	Name  string  `json:"name"`
	Args  string  `json:"args"`
	Value *string `json:"value,omitempty"`
	Error *string `json:"error,omitempty"`
}
type Frame struct {
	UID      string            `json:"uid"`
	Tag      string            `json:"tag"`
	Text     string            `json:"text,omitempty"`
	Attrs    map[string]string `json:"attrs,omitempty"`
	Style    map[string]any    `json:"style,omitempty"`
	Value    string            `json:"value,omitempty"`
	Disabled bool              `json:"disabled,omitempty"`
	Events   []string          `json:"events,omitempty"`
	Children []Frame           `json:"children,omitempty"`
}

// Archive retains a program and its deterministic inputs, not a Goja heap snapshot.
type Archive struct {
	Schema   int             `json:"schema"`
	Kind     string          `json:"kind"`
	Code     string          `json:"code"`
	CodeHash string          `json:"codeHash"`
	Sources  []Source        `json:"sources"`
	Props    json.RawMessage `json:"props"`
	Actions  []string        `json:"actions"`
	Events   []Event         `json:"events"`
	Journal  []JournalEntry  `json:"journal"`
	// Raw frame JSON retains empty strings/arrays and field order for replay validation.
	Frame json.RawMessage `json:"frame,omitempty"`
}

func Validate(archive Archive) error {
	if archive.Schema != 1 || archive.Kind != "astro-fyne-javascript" || len(archive.Code) == 0 || len(archive.Code) > 64*1024*1024 {
		return errors.New("javascript: invalid program archive")
	}
	digest := sha256.Sum256([]byte(archive.Code))
	if hex.EncodeToString(digest[:]) != archive.CodeHash {
		return errors.New("javascript: program digest mismatch")
	}
	if len(archive.Events) > 10000 || len(archive.Journal) > 100000 || len(archive.Props) > 1024*1024 {
		return errors.New("javascript: archive exceeds history/data limits")
	}
	data, err := json.Marshal(archive)
	if err != nil || len(data) > 128*1024*1024 {
		return errors.New("javascript: archive exceeds 128MiB or contains invalid JSON")
	}
	if len(archive.Sources) == 0 {
		return errors.New("javascript: archive requires source digests")
	}
	for _, source := range archive.Sources {
		hash, err := hex.DecodeString(source.Hash)
		if source.Path == "" || err != nil || len(hash) != 32 {
			return errors.New("javascript: invalid source digest")
		}
		if source.Hash != strings.ToLower(source.Hash) {
			return errors.New("javascript: source digest requires lowercase hexadecimal")
		}
	}
	var props map[string]json.RawMessage
	if err := json.Unmarshal(archive.Props, &props); err != nil || props == nil {
		return errors.New("javascript: props must be a JSON record")
	}
	seen := map[string]bool{}
	for _, name := range archive.Actions {
		if name == "" || seen[name] || props[name] != nil || strings.HasPrefix(name, "_afy") {
			return errors.New("javascript: invalid or conflicting action binding")
		}
		seen[name] = true
	}
	for _, event := range archive.Events {
		if event.Node == "" || (event.Type != "click" && event.Type != "input" && event.Type != "change") {
			return errors.New("javascript: invalid history event")
		}
	}
	for _, entry := range archive.Journal {
		if entry.Kind != "random" && entry.Kind != "now" && entry.Kind != "action" || (entry.Value == nil) == (entry.Error == nil) {
			return errors.New("javascript: invalid journal entry")
		}
		var arguments []json.RawMessage
		if entry.Kind == "action" && !seen[entry.Name] || entry.Kind != "action" && entry.Name != "" || json.Unmarshal([]byte(entry.Args), &arguments) != nil || arguments == nil {
			return errors.New("javascript: invalid journal binding or arguments")
		}
		if entry.Value != nil && !json.Valid([]byte(*entry.Value)) {
			return errors.New("javascript: invalid recorded result")
		}
	}
	_, err = goja.Compile("astro-fyne-program.js", "("+archive.Code+")", false)
	return err
}

// Widget uses Fyne's event goroutine. Goja is never called from concurrent UI work.
type Widget struct {
	*webui.View
	vm      *goja.Runtime
	api     *goja.Object
	fault   error
	budget  time.Duration
	archive Archive
}

func New(archive Archive, actions webui.Actions, backends ...webui.Backend) (*Widget, error) {
	if err := Validate(archive); err != nil {
		return nil, err
	}
	if err := webui.Require(actions, archive.Actions); err != nil {
		return nil, err
	}
	w := &Widget{vm: goja.New(), budget: 500 * time.Millisecond, archive: archive}
	w.vm.SetMaxCallStackSize(512)
	w.vm.SetPromiseRejectionTracker(func(_ *goja.Promise, operation goja.PromiseRejectionOperation) {
		if operation == goja.PromiseRejectionReject {
			w.fault = errors.New("javascript: unhandled Promise rejection; asynchronous host work needs an event-loop adapter")
		}
	})
	host := func(call goja.FunctionCall) goja.Value {
		kind, name, args := call.Argument(0).String(), call.Argument(1).String(), call.Argument(2).String()
		var result any
		var err error
		switch kind {
		case "random":
			result = rand.Float64()
		case "now":
			result = time.Now().UnixMilli()
		case "action":
			var arguments []any
			if err = json.Unmarshal([]byte(args), &arguments); err == nil {
				if actions[name] == nil {
					err = fmt.Errorf("missing native action %q", name)
				} else {
					func() {
						defer func() {
							if value := recover(); value != nil {
								err = fmt.Errorf("native action %s: %v", name, value)
							}
						}()
						result = actions[name](arguments...)
					}()
				}
			}
		default:
			err = fmt.Errorf("unknown JavaScript host boundary %q", kind)
		}
		if err != nil {
			panic(w.vm.NewGoError(err))
		}
		data, err := json.Marshal(result)
		if err != nil {
			panic(w.vm.NewGoError(fmt.Errorf("native action data requires a JSON adapter: %w", err)))
		}
		parse, _ := goja.AssertFunction(w.vm.Get("JSON").ToObject(w.vm).Get("parse"))
		value, err := parse(goja.Undefined(), w.vm.ToValue(string(data)))
		if err != nil {
			panic(w.vm.NewGoError(err))
		}
		return value
	}
	raw, err := json.Marshal(archive)
	if err != nil {
		return nil, err
	}
	err = w.limited(func() error {
		code, err := w.vm.RunString("(" + archive.Code + ")")
		if err != nil {
			return err
		}
		factory, ok := goja.AssertFunction(code)
		if !ok {
			return errors.New("javascript: bundle must export a factory")
		}
		parse, _ := goja.AssertFunction(w.vm.Get("JSON").ToObject(w.vm).Get("parse"))
		value, err := parse(goja.Undefined(), w.vm.ToValue(string(raw)))
		if err != nil {
			return err
		}
		value, err = factory(goja.Undefined(), w.vm.ToValue(host), value)
		if err != nil {
			return err
		}
		w.api = value.ToObject(w.vm)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if _, err = w.call("flush"); err != nil {
		return nil, err
	}
	for _, event := range archive.Events {
		if _, err = w.callJSON("replay", event); err != nil {
			return nil, err
		}
		if _, err = w.call("flush"); err != nil {
			return nil, err
		}
	}
	if _, err = w.call("finishReplay"); err != nil {
		return nil, err
	}
	w.View = webui.NewViewForWidget(func(v *webui.View) fyne.Widget { w.View = v; return w }, func() []webui.Node {
		if w.fault != nil {
			panic(w.fault)
		}
		value, err := w.call("snapshot")
		if err != nil {
			panic(err)
		}
		var frames []Frame
		if err = w.decode(value, &frames); err != nil {
			panic(err)
		}
		nodes, err := w.nodes(frames)
		if err != nil {
			panic(err)
		}
		return nodes
	}, backends...)
	w.SetAutoRefreshEvents(false)
	if err = w.Error(); err != nil {
		return nil, err
	}
	return w, nil
}

func (w *Widget) limited(run func() error) error {
	done := make(chan struct{})
	timer := time.AfterFunc(w.budget, func() { w.vm.Interrupt("JavaScript execution exceeded 500ms"); close(done) })
	defer func() {
		if !timer.Stop() {
			<-done
		}
		w.vm.ClearInterrupt()
	}()
	return run()
}
func (w *Widget) call(name string, args ...goja.Value) (goja.Value, error) {
	var result goja.Value
	err := w.limited(func() error {
		function, ok := goja.AssertFunction(w.api.Get(name))
		if !ok {
			return fmt.Errorf("javascript: missing runtime operation %s", name)
		}
		var err error
		result, err = function(w.api, args...)
		return err
	})
	if err == nil && w.fault != nil {
		err = w.fault
	}
	return result, err
}
func (w *Widget) callJSON(name string, value any) (goja.Value, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var arg goja.Value
	err = w.limited(func() error {
		parse, _ := goja.AssertFunction(w.vm.Get("JSON").ToObject(w.vm).Get("parse"))
		var err error
		arg, err = parse(goja.Undefined(), w.vm.ToValue(string(data)))
		return err
	})
	if err != nil {
		return nil, err
	}
	return w.call(name, arg)
}
func (w *Widget) decode(value goja.Value, target any) error {
	stringify, _ := goja.AssertFunction(w.vm.Get("JSON").ToObject(w.vm).Get("stringify"))
	var encoded goja.Value
	err := w.limited(func() error { var err error; encoded, err = stringify(goja.Undefined(), value); return err })
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(encoded.String()), target)
}
func (w *Widget) dispatch(node, kind string, value *string) {
	_, w.fault = w.callJSON("dispatch", Event{Node: node, Type: kind, Value: value})
	if w.fault == nil {
		_, w.fault = w.call("flush")
	}
	w.Refresh()
}
func (w *Widget) ExportJavascript() (Archive, error) {
	// Reuse the scene/state transport's validation of the existing native frame.
	if _, err := webui.ExportProgram(`{"actions":[]}`, w.archive.CodeHash, webui.Scope{}, webui.Scope{}, w.View); err != nil {
		return Archive{}, err
	}
	value, err := w.call("export")
	if err != nil {
		return Archive{}, err
	}
	var archive Archive
	if err = w.decode(value, &archive); err != nil {
		return Archive{}, err
	}
	if err = Validate(archive); err != nil {
		return Archive{}, err
	}
	return archive, nil
}

// Close runs Preact effect cleanups. Call on Fyne's event goroutine before disposal.
func (w *Widget) Close() error { _, err := w.call("dispose"); return err }
