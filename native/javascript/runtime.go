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
	"math"
	"math/rand/v2"
	"strings"
	"time"
	"unicode/utf8"

	"fyne.io/fyne/v2"
	"github.com/dop251/goja"
	webui "github.com/thinkddr/astro-fyne/native"
)

type Source struct {
	Path string `json:"path"`
	Hash string `json:"hash"`
}
type Stylesheet struct {
	Path string `json:"path"`
	Hash string `json:"hash"`
	Text string `json:"text"`
}
type Event struct {
	Node   string   `json:"node"`
	Type   string   `json:"type"`
	Value  *string  `json:"value,omitempty"`
	TimeMS *float64 `json:"timeMs,omitempty"`
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
	Checked  bool              `json:"checked,omitempty"`
	CSS      bool              `json:"css,omitempty"`
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

	Stylesheets []Stylesheet    `json:"stylesheets,omitempty"`
	Animation   *AnimationState `json:"animation,omitempty"`
}

func Validate(archive Archive) error {
	if (archive.Schema != 1 && archive.Schema != 2) || archive.Kind != "astro-fyne-javascript" || len(archive.Code) == 0 || len(archive.Code) > 64*1024*1024 {
		return errors.New("javascript: invalid program archive")
	}
	if archive.Schema == 1 && archive.Animation != nil {
		return errors.New("javascript: schema 1 forbids animation state")
	}
	if archive.Schema == 2 {
		if archive.Animation == nil {
			return errors.New("javascript: schema 2 requires animation state")
		}
		if err := validateAnimationState(*archive.Animation); err != nil {
			return err
		}
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
	if len(archive.Stylesheets) > 10000 {
		return errors.New("javascript: stylesheet sources exceed 10000")
	}
	if len(archive.Stylesheets) > 0 {
		counts := map[string]int{}
		hashes := map[string]string{}
		for _, source := range archive.Sources {
			counts[source.Path]++
			hashes[source.Path] = source.Hash
		}
		seen := map[string]bool{}
		for _, sheet := range archive.Stylesheets {
			digest := sha256.Sum256([]byte(sheet.Text))
			if sheet.Path == "" || !utf8.ValidString(sheet.Path) || !utf8.ValidString(sheet.Text) || len(sheet.Text) > 16*1024*1024 || seen[sheet.Path] || counts[sheet.Path] != 1 || hashes[sheet.Path] != sheet.Hash || hex.EncodeToString(digest[:]) != sheet.Hash {
				return errors.New("javascript: stylesheet source digest mismatch or duplicate path")
			}
			seen[sheet.Path] = true
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
	previousTime := float64(0)
	for _, event := range archive.Events {
		if event.Node == "" || (event.Type != "click" && event.Type != "input" && event.Type != "change") {
			return errors.New("javascript: invalid history event")
		}
		if archive.Schema == 1 && event.TimeMS != nil {
			return errors.New("javascript: schema 1 forbids event timeMs")
		}
		if archive.Schema == 2 {
			if event.TimeMS == nil || math.IsNaN(*event.TimeMS) || math.IsInf(*event.TimeMS, 0) || *event.TimeMS < previousTime || *event.TimeMS > archive.Animation.TimeMS {
				return errors.New("javascript: event timeMs must be nondecreasing and within animation time")
			}
			previousTime = *event.TimeMS
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
	vm              *goja.Runtime
	api             *goja.Object
	fault           error
	budget          time.Duration
	archive         Archive
	options         Options
	animationAnchor time.Time
	animationTime   float64
	animationLast   time.Time
	scheduler       *animationScheduler
	closed          bool
	fontResources   *fontResourceRequest
}

func New(archive Archive, actions webui.Actions, backends ...webui.Backend) (*Widget, error) {
	return NewWithOptions(archive, actions, Options{}, backends...)
}

// NewWithOptions configures clock ownership and trusted resource binding.
func NewWithOptions(archive Archive, actions webui.Actions, options Options, backends ...webui.Backend) (*Widget, error) {
	if err := Validate(archive); err != nil {
		return nil, err
	}
	if err := webui.Require(actions, archive.Actions); err != nil {
		return nil, err
	}
	if options.Clock == nil {
		options.Clock = ClockFunc(time.Now)
	}
	w := &Widget{vm: goja.New(), budget: 500 * time.Millisecond, archive: archive, options: options, fontResources: &fontResourceRequest{marked: strings.HasPrefix(archive.Code, FontResourceFactoryHeader)}}
	w.vm.SetMaxCallStackSize(512)
	w.vm.SetPromiseRejectionTracker(func(_ *goja.Promise, operation goja.PromiseRejectionOperation) {
		if operation == goja.PromiseRejectionReject {
			w.fault = errors.New("javascript: unhandled Promise rejection; asynchronous host work needs an event-loop adapter")
		}
	})
	host := func(call goja.FunctionCall) goja.Value {
		fontFailure := func(err error) goja.Value {
			if w.fontResources.err == nil {
				w.fontResources.err = err
			}
			w.fault = w.fontResources.err
			panic(w.vm.NewGoError(w.fontResources.err))
		}
		if w.fontResources.err != nil {
			return fontFailure(w.fontResources.err)
		}
		kind := call.Argument(0).String()
		if kind == "font-resources" {
			if err := w.fontResources.bind(call, options.FontResources, backends); err != nil {
				return fontFailure(err)
			}
			return goja.Null()
		}
		if w.fontResources.marked && w.fontResources.backend == nil {
			return fontFailure(errors.New("javascript: marked font factory requires checked resources before other host work"))
		}
		name, args := call.Argument(1).String(), call.Argument(2).String()
		if w.fontResources.err != nil {
			return fontFailure(w.fontResources.err)
		}
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
	var owned Archive
	if err = json.Unmarshal(raw, &owned); err != nil {
		return nil, err
	}
	archive, w.archive = owned, owned
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
		if w.fontResources.marked {
			trampoline, trampolineErr := w.vm.RunString(`(function(factory,host,archive,finished){try{return factory(host,archive)}finally{finished()}})`)
			if trampolineErr != nil {
				return trampolineErr
			}
			initialize, _ := goja.AssertFunction(trampoline)
			w.fontResources.initializing = true
			finished := func() { w.fontResources.initializing = false }
			value, err = initialize(goja.Undefined(), code, w.vm.ToValue(host), value, w.vm.ToValue(finished))
			w.fontResources.initializing = false
			if err == nil && w.fontResources.err == nil && w.fontResources.backend == nil {
				w.fontResources.err = errors.New("javascript: marked font factory requires a synchronous font resource request")
				w.fault = w.fontResources.err
			}
		} else {
			value, err = factory(goja.Undefined(), w.vm.ToValue(host), value)
		}
		if w.fontResources.err != nil {
			return w.fontResources.err
		}
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
	viewBackends := backends
	if w.fontResources.backend != nil {
		viewBackends = []webui.Backend{w.fontResources.backend}
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
	}, viewBackends...)
	w.SetAutoRefreshEvents(false)
	if err = w.Error(); err != nil {
		return nil, err
	}
	if archive.Schema == 2 {
		state, stateErr := w.AnimationState()
		if stateErr != nil {
			return nil, stateErr
		}
		if state != *archive.Animation {
			return nil, errors.New("javascript: restored animation state differs from its archive")
		}
		if err = w.anchorAnimations(state); err != nil {
			return nil, err
		}
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
	if w.closed {
		return nil, errors.New("javascript: widget is closed")
	}
	if w.fontResources != nil && w.fontResources.err != nil {
		return nil, w.fontResources.err
	}
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
	if w.fontResources != nil && w.fontResources.err != nil {
		return nil, w.fontResources.err
	}
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
	if w.fontResources != nil && w.fontResources.err != nil {
		return w.fontResources.err
	}
	var encoded goja.Value
	err := w.limited(func() error { var err error; encoded, err = stringify(goja.Undefined(), value); return err })
	if w.fontResources != nil && w.fontResources.err != nil {
		return w.fontResources.err
	}
	if err != nil {
		return err
	}
	if w.fontResources != nil && w.fontResources.marked && !goja.IsString(encoded) {
		return errors.New("javascript: font factory JSON serialization requires a primitive string")
	}
	text := encoded.String()
	if w.fontResources != nil && w.fontResources.err != nil {
		return w.fontResources.err
	}
	return json.Unmarshal([]byte(text), target)
}
func (w *Widget) dispatch(node, kind string, value *string) {
	if w.closed || w.fault != nil {
		return
	}
	if w.archive.Schema == 2 && !w.options.ManualAnimations {
		if err := w.TickAnimations(); err != nil {
			w.animationFault(err)
			return
		}
	}
	_, w.fault = w.callJSON("dispatch", Event{Node: node, Type: kind, Value: value})
	if w.fault == nil {
		_, w.fault = w.call("flush")
	}
	w.Refresh()
	if w.fault != nil {
		w.stopAnimations()
	}
}

// Tapped diagnoses canvas gaps without assigning an invented virtual target.
func (w *Widget) Tapped(*fyne.PointEvent) {
	if w.closed || w.fault != nil {
		return
	}
	w.fault = errors.New("javascript: wrapper background requires a virtual-root pointer adapter")
	w.stopAnimations()
	w.Refresh()
}

func (w *Widget) ExportJavascript() (Archive, error) {
	if w.closed {
		return Archive{}, errors.New("javascript: widget is closed")
	}
	if w.fontResources != nil && w.fontResources.err != nil {
		return Archive{}, w.fontResources.err
	}
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
	if archive.Schema != w.archive.Schema {
		return Archive{}, errors.New("javascript: export changed its animation schema")
	}
	if archive.Schema == 2 {
		state, err := w.AnimationState()
		if err != nil {
			return Archive{}, err
		}
		if *archive.Animation != state {
			return Archive{}, errors.New("javascript: export differs from the committed animation state")
		}
	}
	return archive, nil
}

// Close stops scheduling and runs Preact effect cleanups on Fyne's event goroutine.
func (w *Widget) Close() error {
	if w.closed {
		return nil
	}
	w.stopAnimations()
	_, err := w.call("dispose")
	w.closed = true
	w.api, w.vm, w.options.Clock = nil, nil, nil
	return err
}
