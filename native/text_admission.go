// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import "fmt"

// LegacyText carries a proposed frame's raw text and resolved style. Field is
// text, value or placeholder. Style contains no mutable Flex metadata.
type LegacyText struct {
	Kind, Field, Text string
	Style             Style
}

// LegacyTextValidator optionally rejects a legacy frame before native mutation.
// Callbacks must be read-only. This does not validate subsequent editor edits;
// strict frame-only adapters must reject input and textarea, including empty ones.
// Default backends and responsive text retain their existing behavior.
type LegacyTextValidator interface {
	ValidateLegacyText(LegacyText) error
}

type legacyTextAdmissionError struct{ cause error }

func (e *legacyTextAdmissionError) Error() string { return e.cause.Error() }
func (e *legacyTextAdmissionError) Unwrap() error { return e.cause }

func validateLegacyText(nodes []Node, styles map[string]Style, backend Backend) error {
	validator, ok := backend.(LegacyTextValidator)
	if !ok {
		return nil
	}
	var walk func([]Node) error
	walk = func(nodes []Node) error {
		for _, node := range nodes {
			style := styles[node.ID]
			style.Flex = nil
			check := func(field, text string) error {
				if err := validator.ValidateLegacyText(LegacyText{Kind: node.Kind, Field: field, Text: text, Style: style}); err != nil {
					return &legacyTextAdmissionError{cause: fmt.Errorf("webui: legacy %s %q %s: %w", node.Kind, node.ID, field, err)}
				}
				return nil
			}
			if node.Kind != "image" && node.Kind != "checkbox" && (node.Text != "" ||
				node.Kind == "text" || node.Kind == "label" || node.Kind == "button" || node.Kind == "link") {
				if err := check("text", node.Text); err != nil {
					return err
				}
			}
			if node.Kind == "input" || node.Kind == "textarea" {
				if err := check("value", node.Value); err != nil {
					return err
				}
				if err := check("placeholder", node.Placeholder); err != nil {
					return err
				}
			}
			if err := walk(node.Children); err != nil {
				return err
			}
		}
		return nil
	}
	return walk(nodes)
}
