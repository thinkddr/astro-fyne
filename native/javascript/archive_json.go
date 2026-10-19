// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

func archiveObject(data []byte, names ...string) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return nil, fmt.Errorf("javascript: JSON object required")
	}
	allowed := map[string]bool{}
	for _, name := range names { allowed[name] = true }
	fields := map[string]json.RawMessage{}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil { return nil, err }
		name, ok := key.(string)
		if !ok || !allowed[name] || fields[name] != nil {
			return nil, fmt.Errorf("javascript: unknown or repeated JSON field %q", key)
		}
		var value json.RawMessage
		if err = decoder.Decode(&value); err != nil { return nil, err }
		fields[name] = value
	}
	if _, err = decoder.Token(); err != nil { return nil, err }
	if err = decoder.Decode(new(any)); err != io.EOF { return nil, fmt.Errorf("javascript: expected one JSON object") }
	return fields, nil
}

// UnmarshalJSON keeps schema-dependent field presence visible before validation.
func (archive *Archive) UnmarshalJSON(data []byte) error {
	fields, err := archiveObject(data, "schema", "kind", "code", "codeHash", "sources", "props", "actions", "events", "journal", "frame", "stylesheets", "animation")
	if err != nil { return err }
	type rawArchive Archive
	var next rawArchive
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&next); err != nil { return err }
	_, animated := fields["animation"]
	if next.Schema == 1 && animated {
		return fmt.Errorf("javascript: schema 1 forbids animation state")
	}
	if next.Schema == 2 && (!animated || next.Animation == nil) {
		return fmt.Errorf("javascript: schema 2 requires animation state")
	}
	*archive = Archive(next)
	return nil
}

func (event *Event) UnmarshalJSON(data []byte) error {
	fields, err := archiveObject(data, "node", "type", "value", "timeMs")
	if err != nil { return err }
	if value, exists := fields["timeMs"]; exists && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
		return fmt.Errorf("javascript: event timeMs cannot be null")
	}
	type rawEvent Event
	var next rawEvent
	if err = json.Unmarshal(data, &next); err != nil { return err }
	*event = Event(next)
	return nil
}
