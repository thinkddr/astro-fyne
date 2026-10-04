// SPDX-License-Identifier: Apache-2.0
package webui

import (
	"math"
	"strings"
	"testing"
)

func TestListKeyNormalizationIsInjectiveAndPathSafe(t *testing.T) {
	keys := NewListKeys()
	seen := map[string]bool{}
	for _, value := range []string{"", "a/b", "a", "b", "\x00", "a\x00b", "🙂", "s61", "n31"} {
		identity := keys.Add(value)
		if seen[identity] || strings.Contains(identity, "/") {
			t.Fatalf("unsafe or colliding key %q -> %q", value, identity)
		}
		seen[identity] = true
	}
}

func TestListKeyKindsRemainStableThroughEmptyFrames(t *testing.T) {
	state, active := Scope{}, map[string]bool{}
	numbers := NewListKeys()
	numbers.Add(float64(1))
	RememberListKeyKind(state, active, "parent/list", numbers)
	RememberListKeyKind(state, active, "parent/list", NewListKeys())
	strings := NewListKeys()
	strings.Add("1")
	defer func() {
		if recover() == nil {
			t.Fatal("cross-render number/string key coercion was silently approximated")
		}
	}()
	RememberListKeyKind(state, active, "parent/list", strings)
}

func TestListKeyContractRejectsInvalidDuplicateAndMixedKeys(t *testing.T) {
	for _, values := range [][]any{
		{nil}, {Undefined}, {true}, {Scope{"id": "a"}}, {[]any{"a"}},
		{math.NaN()}, {math.Inf(1)}, {"a", "a"}, {float64(1), float64(1)},
		{math.Copysign(0, -1), float64(0)}, {float64(1), "1"}, {"a", float64(2)},
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Fatalf("invalid list keys accepted: %#v", values)
				}
			}()
			keys := NewListKeys()
			for _, value := range values {
				keys.Add(value)
			}
		}()
	}
}
