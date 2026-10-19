// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package motion

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"unicode/utf8"
)

// strictJSON rejects duplicate fields as well as unknown fields and trailing data.
func strictJSON(data []byte, value any) error {
	if len(data) > 16*1024*1024 || !utf8.Valid(data) {
		return fmt.Errorf("motion: JSON exceeds 16 MiB or is not UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	count := 0
	var visit func(int) error
	visit = func(depth int) error {
		count++
		if depth > 32 || count > 100000 {
			return fmt.Errorf("motion: JSON depth/value limit exceeded")
		}
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, compound := token.(json.Delim)
		if !compound {
			return nil
		}
		switch delimiter {
		case '{':
			seen := map[string]bool{}
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return err
				}
				name, ok := key.(string)
				if !ok || seen[name] {
					return fmt.Errorf("motion: duplicate JSON field %q", name)
				}
				seen[name] = true
				if err := visit(depth + 1); err != nil {
					return err
				}
			}
		case '[':
			for decoder.More() {
				if err := visit(depth + 1); err != nil {
					return err
				}
			}
		default:
			return fmt.Errorf("motion: unexpected JSON delimiter")
		}
		_, err = decoder.Token()
		return err
	}
	if err := visit(0); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return fmt.Errorf("motion: trailing or invalid JSON data")
	}
	decoder = json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	return nil
}

func requiredFields(data json.RawMessage, names ...string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return nil, fmt.Errorf("motion: expected a JSON object")
	}
	for _, name := range names {
		value, ok := fields[name]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return nil, fmt.Errorf("motion: missing JSON field %s", name)
		}
	}
	return fields, nil
}

func onlyFields(fields map[string]json.RawMessage, names ...string) error {
	for name := range fields {
		found := false
		for _, allowed := range names {
			found = found || name == allowed
		}
		if !found {
			return fmt.Errorf("motion: unsupported JSON field %s", name)
		}
	}
	return nil
}

// Reject null coordinates before encoding/json can coerce them into numeric zero.
// This also applies when Easing appears inside another validated archive.
func (e *Easing) UnmarshalJSON(data []byte) error {
	if e == nil {
		return fmt.Errorf("motion: nil easing destination")
	}
	type easingJSON Easing
	var parsed easingJSON
	if err := strictJSON(data, &parsed); err != nil {
		return err
	}
	fields, err := requiredFields(data, "kind")
	if err != nil {
		return err
	}
	if err = onlyFields(fields, "kind", "points"); err != nil {
		return err
	}
	if points, present := fields["points"]; present {
		var values []json.RawMessage
		if err = json.Unmarshal(points, &values); err != nil || values == nil {
			return fmt.Errorf("motion: easing points require a numeric array")
		}
		for _, value := range values {
			if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				return fmt.Errorf("motion: easing coordinates cannot be null")
			}
		}
	}
	result := Easing(parsed)
	if err = result.Validate(); err != nil {
		return err
	}
	*e = result
	return nil
}

func ParseClip(data []byte) (*Clip, error) {
	var spec Spec
	if err := strictJSON(data, &spec); err != nil {
		return nil, err
	}
	fields, err := requiredFields(data, "schema", "id", "tracks", "timing")
	if err != nil {
		return nil, err
	}
	if err = onlyFields(fields, "schema", "id", "tracks", "timing"); err != nil {
		return nil, err
	}
	timing, err := requiredFields(fields["timing"], "durationMs", "delayMs", "iterations", "direction", "fill", "easing")
	if err != nil {
		return nil, err
	}
	if err = onlyFields(timing, "durationMs", "delayMs", "iterations", "direction", "fill", "easing"); err != nil {
		return nil, err
	}
	easing, err := requiredFields(timing["easing"], "kind")
	if err != nil {
		return nil, err
	}
	if err = onlyFields(easing, "kind", "points"); err != nil {
		return nil, err
	}
	if _, present := easing["points"]; present {
		if _, err = requiredFields(timing["easing"], "points"); err != nil {
			return nil, err
		}
	}
	var tracks []json.RawMessage
	if err = json.Unmarshal(fields["tracks"], &tracks); err != nil {
		return nil, err
	}
	for _, raw := range tracks {
		track, err := requiredFields(raw, "id", "target", "property", "keyframes")
		if err != nil {
			return nil, err
		}
		if err = onlyFields(track, "id", "target", "property", "keyframes"); err != nil {
			return nil, err
		}
		var frames []json.RawMessage
		if err = json.Unmarshal(track["keyframes"], &frames); err != nil {
			return nil, err
		}
		for _, frame := range frames {
			fields, err := requiredFields(frame, "offset", "value")
			if err != nil {
				return nil, err
			}
			if err = onlyFields(fields, "offset", "value"); err != nil {
				return nil, err
			}
		}
	}
	return NewClip(spec)
}
