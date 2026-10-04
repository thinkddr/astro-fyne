// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Package reverse freezes a supported, already laid out Fyne object tree into a
// portable scene. It never executes callbacks or translates Go functions to JS.
package reverse

import (
	"fyne.io/fyne/v2"
	webui "github.com/thinkddr/astro-fyne/native"
)

// Viewport is the canvas size in logical pixels and its device-pixel scale.
type Viewport struct {
	Width  float32 `json:"width"`
	Height float32 `json:"height"`
	Scale  float32 `json:"scale"`
}

// Events names caller-supplied actions. Input is immediate; Change is a commit
// on blur or Return in single-line inputs, deduplicated against the last commit.
type Events struct {
	Tap    string `json:"tap,omitempty"`
	Input  string `json:"input,omitempty"`
	Change string `json:"change,omitempty"`
	// Submit is single-line Return/Enter only, as in widget.Entry.OnSubmitted.
	Submit string `json:"submit,omitempty"`
}

// Node contains a visual snapshot, not a source-language component. Coordinates
// are relative to the parent's outside border; roots are viewport-relative.
type Node struct {
	ID               string      `json:"id"`
	Kind             string      `json:"kind"`
	Text             string      `json:"text,omitempty"`
	Value            string      `json:"value,omitempty"`
	Placeholder      string      `json:"placeholder,omitempty"`
	PlaceholderColor string      `json:"placeholderColor,omitempty"`
	Disabled         bool        `json:"disabled,omitempty"`
	AccessibleLabel  string      `json:"accessibleLabel,omitempty"`
	LabelFor         string      `json:"labelFor,omitempty"`
	Href             string      `json:"href,omitempty"`
	Style            webui.Style `json:"style"`
	Events           *Events     `json:"events,omitempty"`
	Children         []Node      `json:"children"`
	Resource         string      `json:"resource,omitempty"`
}

// Resource is an immutable bitmap. Content is JSON base64 via encoding/json.
// Hash is SHA-256 lowercase hex; Path is a safe relative public asset URL.
type Resource struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Hash      string `json:"hash"`
	MediaType string `json:"mediaType"`
	Content   []byte `json:"content"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
}

// Document has no visual-verification flag: an export is not a pixel-diff proof.
type Document struct {
	Schema          int               `json:"schema"`
	Viewport        Viewport          `json:"viewport"`
	Roots           []Node            `json:"roots"`
	Tokens          map[string]string `json:"tokens"`
	Resources       []Resource        `json:"resources"`
	RequiredActions []string          `json:"requiredActions"`
}

// Options makes external contracts explicit. Export must be called on Fyne's UI
// goroutine after layout. IDs default to deterministic tree paths; webui.View IDs
// are preserved. Reusing an object twice, duplicate IDs, unused bindings and
// callbacks without corresponding bindings are errors.
type Options struct {
	Viewport Viewport
	// Canvas, when supplied, verifies the declared viewport and scale against
	// the actual native canvas. A focused frame has no portable focus contract yet.
	Canvas     fyne.Canvas
	IDs        map[fyne.CanvasObject]string
	Bindings   map[fyne.CanvasObject]Events
	IDBindings map[string]Events
	Tokens     map[string]string
	// FontFamilies identifies a licensed browser font equivalent to a native font
	// resource. It is an assertion supplied by the host, not an inferred match.
	FontFamilies map[fyne.Resource]string
	// NodeFontFamilies permits explicit font-family assertions for custom View
	// backends which do not expose a font resource through the public interface.
	NodeFontFamilies map[string]string
}
