// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"encoding/hex"
	"fmt"
	"math"
	"reflect"
	"unicode/utf8"
)

// ListKeys validates one sibling list before any generated component is built.
// Preact matches keys with loose equality. Until mixed scalar coercion is part
// of the compiler contract, mixing numbers and strings is rejected explicitly.
type ListKeys struct {
	kind byte
	seen map[string]bool
}

func NewListKeys() *ListKeys { return &ListKeys{seen: map[string]bool{}} }

// Add accepts primitive strings and finite JavaScript numbers. Hex encoding is
// injective and contains no path delimiter: '/', NUL and nested-list names do
// not collide with generated component/state namespaces. Numeric -0 equals 0.
func (keys *ListKeys) Add(value any) string {
	var kind byte
	var text string
	if value != nil && reflect.ValueOf(value).Kind() == reflect.String {
		kind, text = 's', reflect.ValueOf(value).String()
		if !utf8.ValidString(text) {
			panic("webui: list key requires a valid Unicode string")
		}
	} else if numeric(value) {
		number := Number(value)
		if math.IsNaN(number) || math.IsInf(number, 0) {
			panic("webui: list key must be a finite number")
		}
		kind, text = 'n', String(number)
	} else {
		panic(fmt.Sprintf("webui: list key must be a string or finite number, got %T", value))
	}
	if keys.kind != 0 && keys.kind != kind {
		panic("webui: mixed string/number list keys require explicit Preact coercion semantics")
	}
	keys.kind = kind
	identity := string(kind) + hex.EncodeToString([]byte(text))
	if keys.seen[identity] {
		panic(fmt.Sprintf("webui: duplicate sibling list key %q", text))
	}
	keys.seen[identity] = true
	return identity
}

// RememberListKeyKind rejects cross-render scalar coercion until it has an
// explicit compiler contract. The metadata survives empty lists and is pruned
// with the owning generated component, using the same lifetime as hook state.
func RememberListKeyKind(state Scope, active map[string]bool, site string, keys *ListKeys) {
	name := site + "/@key-kind"
	active[name] = true
	if keys.kind == 0 {
		return
	}
	if previous, exists := state[name]; exists && previous != keys.kind {
		panic("webui: changing list keys between strings and numbers requires explicit Preact coercion semantics")
	}
	state[name] = keys.kind
}

// KeyedIdentity separates DOM/public IDs from reconciliation identity. Keys
// are never ordinary props. Nested lists already contain their own namespace
// and keep it, while all other descendants inherit this list item's identity.
func KeyedIdentity(nodes []Node, namespace string) []Node {
	for index := range nodes {
		node := &nodes[index]
		if node.Identity == "" {
			node.Identity = namespace + "/" + node.Kind + "/" + node.ID
		}
		node.Children = KeyedIdentity(node.Children, namespace)
	}
	return nodes
}
