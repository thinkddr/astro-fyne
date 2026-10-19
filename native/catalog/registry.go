// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package catalog

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"

	"fyne.io/fyne/v2"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/javascript"
	"github.com/thinkddr/astro-fyne/native/motion"
)

func New(spec Spec) (*Registry, error) {
	if err := validate(spec); err != nil {
		return nil, err
	}
	copied := copySpec(spec)
	if copied.Resources == nil { copied.Resources = []Resource{} }
	if copied.Stylesheets == nil { copied.Stylesheets = []Stylesheet{} }
	if copied.FontFaces == nil { copied.FontFaces = []FontFace{} }
	if copied.Themes == nil { copied.Themes = []ThemeSpec{} }
	if copied.Layouts == nil { copied.Layouts = []LayoutSpec{} }
	if copied.Components == nil { copied.Components = []Component{} }
	if copied.Islands == nil { copied.Islands = []Island{} }
	for i := range copied.Stylesheets {
		if copied.Stylesheets[i].Content == nil { copied.Stylesheets[i].Content = []byte{} }
	}
	for i := range copied.Themes {
		if copied.Themes[i].Tokens == nil { copied.Themes[i].Tokens = map[string]string{} }
		if copied.Themes[i].FontFaces == nil { copied.Themes[i].FontFaces = []string{} }
	}
	for i := range copied.Components {
		if copied.Components[i].Stylesheets == nil { copied.Components[i].Stylesheets = []string{} }
		if copied.Components[i].FontFaces == nil { copied.Components[i].FontFaces = []string{} }
		if copied.Components[i].Actions == nil { copied.Components[i].Actions = []string{} }
	}
	return &Registry{spec: copied, factories: map[string]NativeFactory{}}, nil
}

func Parse(data []byte) (*Registry, error) {
	var spec Spec
	if err := decode(data, &spec); err != nil {
		return nil, err
	}
	return New(spec)
}

func (r *Registry) Spec() Spec {
	if r == nil {
		return Spec{}
	}
	return copySpec(r.spec)
}

func (r *Registry) Marshal() ([]byte, error) {
	if r == nil {
		return nil, fmt.Errorf("catalog: nil registry")
	}
	if err := validate(r.spec); err != nil {
		return nil, err
	}
	return json.Marshal(r.spec)
}

func (r *Registry) MarshalJSON() ([]byte, error) { return r.Marshal() }

// Clone copies portable metadata. Host factories must be bound explicitly again.
func (r *Registry) Clone() (*Registry, error) { return New(r.Spec()) }

func (r *Registry) Resources() []Resource { return r.Spec().Resources }

func (r *Registry) Component(id string) (Component, error) {
	for _, component := range r.Spec().Components {
		if component.ID == id {
			return component, nil
		}
	}
	return Component{}, fmt.Errorf("catalog: unknown component %q", id)
}

func (r *Registry) Layout(id string) (webui.Style, error) {
	for _, layout := range r.Spec().Layouts {
		if layout.ID == id {
			return layout.Style, nil
		}
	}
	return webui.Style{}, fmt.Errorf("catalog: unknown layout %q", id)
}

func (r *Registry) Motion(id string) (motion.Spec, error) {
	for _, spec := range r.Spec().Motions {
		if spec.ID == id {
			clip, err := motion.NewClip(spec)
			if err != nil {
				return motion.Spec{}, err
			}
			return clip.Spec(), nil
		}
	}
	return motion.Spec{}, fmt.Errorf("catalog: unknown motion %q", id)
}

func (r *Registry) Theme(id string, base fyne.Theme) (*webui.CapturedTheme, error) {
	spec := r.Spec()
	for _, item := range spec.Themes {
		if item.ID != id {
			continue
		}
		result, err := webui.NewCapturedTheme(item.Tokens, base)
		if err != nil {
			return nil, err
		}
		for _, faceID := range item.FontFaces {
			face, resource := findFont(spec, faceID)
			result.Fonts[fyne.TextStyle{Bold: face.Weight == 700, Italic: face.Style == "italic"}] = frozenResource{resource.Name, bytes.Clone(resource.Content)}
		}
		return result, result.Validate()
	}
	return nil, fmt.Errorf("catalog: unknown theme %q", id)
}

func (r *Registry) RegisterFactory(id string, factory NativeFactory) error {
	if _, err := r.Component(id); err != nil {
		return err
	}
	if factory == nil {
		return fmt.Errorf("catalog: nil native factory for %q", id)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.factories[id] != nil {
		return fmt.Errorf("catalog: native factory already registered for %q", id)
	}
	r.factories[id] = factory
	return nil
}

func (r *Registry) Factory(id string) (NativeFactory, bool) {
	if r == nil {
		return nil, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	factory := r.factories[id]
	return factory, factory != nil
}

// NewWidget and NewIsland run on the Fyne event goroutine. Each call owns a VM.
func (r *Registry) NewWidget(id string, actions webui.Actions) (fyne.Widget, error) {
	return r.newWidget(id, Island{}, actions)
}

func (r *Registry) NewIsland(id string, actions webui.Actions) (fyne.Widget, error) {
	for _, island := range r.Spec().Islands {
		if island.ID == id {
			return r.newWidget(island.Component, island, actions)
		}
	}
	return nil, fmt.Errorf("catalog: unknown island %q", id)
}

// WithIslandState records an explicit exported checkpoint without changing code.
// Factory bindings are host state and must be registered on the returned registry.
func (r *Registry) WithIslandState(id, payload string) (*Registry, error) {
	if payload == "" { return nil, fmt.Errorf("catalog: island state requires a complete JavaScript archive") }
	spec := r.Spec()
	for i := range spec.Islands {
		if spec.Islands[i].ID == id {
			spec.Islands[i].StatePayload = payload
			spec.Islands[i].StateHash = digest([]byte(payload))
			return New(spec)
		}
	}
	return nil, fmt.Errorf("catalog: unknown island %q", id)
}

func (r *Registry) newWidget(id string, island Island, actions webui.Actions) (fyne.Widget, error) {
	component, err := r.Component(id)
	if err != nil {
		return nil, err
	}
	if island.StatePayload != "" {
		component.Payload, component.Hash = island.StatePayload, island.StateHash
	}
	if err := webui.Require(actions, component.Actions); err != nil {
		return nil, err
	}
	bindings := webui.Actions{}
	for _, name := range component.Actions {
		bindings[name] = actions[name]
	}
	instance := Instance{Component: component, Island: island, Actions: bindings, Resources: r.Resources()}
	if component.Theme != "" {
		instance.Theme, err = r.Theme(component.Theme, nil)
		if err != nil {
			return nil, err
		}
	}
	if component.Layout != "" {
		style, err := r.Layout(component.Layout)
		if err != nil {
			return nil, err
		}
		instance.Layout = &style
	}
	instance.Backend = r.backend(component)
	if factory, ok := r.Factory(id); ok {
		widget, err := factory(instance)
		if err != nil {
			return nil, err
		}
		if widget == nil || reflect.ValueOf(widget).Kind() == reflect.Pointer && reflect.ValueOf(widget).IsNil() {
			return nil, fmt.Errorf("catalog: native factory returned a nil widget for %q", id)
		}
		return widget, nil
	}
	if component.Kind != "javascript" {
		return nil, fmt.Errorf("catalog: component %q requires a registered native factory; Go callbacks are not portable", id)
	}
	var archive javascript.Archive
	if err := decode([]byte(component.Payload), &archive); err != nil {
		return nil, err
	}
	return javascript.New(archive, bindings, instance.Backend)
}

func (r *Registry) backend(component Component) webui.FyneBackend {
	spec := r.Spec()
	ids := append([]string(nil), component.FontFaces...)
	for _, item := range spec.Themes {
		if item.ID == component.Theme {
			ids = append(ids, item.FontFaces...)
		}
	}
	fonts := map[string]map[webui.Font]fyne.Resource{}
	for _, id := range ids {
		face, resource := findFont(spec, id)
		if fonts[face.Family] == nil {
			fonts[face.Family] = map[webui.Font]fyne.Resource{}
		}
		fonts[face.Family][webui.Font{Weight: face.Weight, Italic: face.Style == "italic"}] = frozenResource{resource.Name, bytes.Clone(resource.Content)}
	}
	return webui.FyneBackend{Fonts: fonts}
}

type frozenResource struct {
	name string
	data []byte
}

func (r frozenResource) Name() string { return r.name }
func (r frozenResource) Content() []byte { return bytes.Clone(r.data) }

func findFont(spec Spec, id string) (FontFace, Resource) {
	for _, face := range spec.FontFaces {
		if face.ID == id {
			for _, resource := range spec.Resources {
				if resource.Name == face.Resource {
					return face, resource
				}
			}
		}
	}
	return FontFace{}, Resource{}
}
