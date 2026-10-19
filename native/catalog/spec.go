// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Package catalog retains portable components and their explicit native bindings.
package catalog

import (
	"encoding/json"
	"sync"

	"fyne.io/fyne/v2"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/motion"
)

type Resource struct {
	Name      string `json:"name"`
	MediaType string `json:"mediaType"`
	Hash      string `json:"hash"`
	Content   []byte `json:"content"`
	License   string `json:"license"`
}

type Stylesheet struct {
	ID      string `json:"id"`
	Path    string `json:"path"`
	Hash    string `json:"hash"`
	Content []byte `json:"content"`
}

type FontFace struct {
	ID       string `json:"id"`
	Family   string `json:"family"`
	Weight   int    `json:"weight"`
	Style    string `json:"style"`
	Resource string `json:"resource"`
	Hash     string `json:"hash"`
}

type ThemeSpec struct {
	ID        string            `json:"id"`
	Tokens    map[string]string `json:"tokens"`
	FontFaces []string          `json:"fontFaces"`
}

type LayoutSpec struct {
	ID    string      `json:"id"`
	Style webui.Style `json:"style"`
	// Native algorithms need a declared Style before they can be exported.
	Native fyne.Layout `json:"-"`
}

// Payload is exact JSON text, so its digest survives Go and JavaScript encoders.
type Component struct {
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Payload     string   `json:"payload"`
	Hash        string   `json:"hash"`
	Theme       string   `json:"theme,omitempty"`
	Layout      string   `json:"layout,omitempty"`
	Stylesheets []string `json:"stylesheets"`
	FontFaces   []string `json:"fontFaces"`
	Actions     []string `json:"actions"`
}

type Island struct {
	ID           string `json:"id"`
	Component    string `json:"component"`
	Key          string `json:"key"`
	StatePayload string `json:"statePayload,omitempty"`
	StateHash    string `json:"stateHash,omitempty"`
}

type Spec struct {
	Schema      int           `json:"schema"`
	Kind        string        `json:"kind"`
	Name        string        `json:"name"`
	Resources   []Resource    `json:"resources"`
	Stylesheets []Stylesheet  `json:"stylesheets"`
	FontFaces   []FontFace    `json:"fontFaces"`
	Themes      []ThemeSpec   `json:"themes"`
	Layouts     []LayoutSpec  `json:"layouts"`
	Components  []Component   `json:"components"`
	Islands     []Island      `json:"islands"`
	Motions     []motion.Spec `json:"motions,omitempty"`
}

// Registry owns its metadata. Factories are host bindings, never archive fields.
type Registry struct {
	spec      Spec
	mu        sync.RWMutex
	factories map[string]NativeFactory
}

// Instance gives a factory independent metadata, resources and named actions.
// Theme and Layout are dependencies; applying them is an explicit host operation.
type Instance struct {
	Component Component
	Island    Island
	Theme     *webui.CapturedTheme
	Layout    *webui.Style
	Resources []Resource
	Actions   webui.Actions
	Backend   webui.FyneBackend
}

type NativeFactory func(Instance) (fyne.Widget, error)

func copySpec(spec Spec) Spec {
	data, _ := json.Marshal(spec)
	var copied Spec
	_ = json.Unmarshal(data, &copied)
	return copied
}
