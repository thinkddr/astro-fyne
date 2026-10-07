// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"fmt"
	"math"
	"strings"
	"testing"
)

func TestNullishAccessDoesNotTreatFalsyPrimitivesAsMissing(t *testing.T) {
	for _, value := range []any{nil, Undefined} {
		if !IsNullish(value) {
			t.Fatalf("nullish value %T was not recognized", value)
		}
	}
	for _, value := range []any{false, 0, float64(0), "", Scope{}, []any{}} {
		if IsNullish(value) {
			t.Fatalf("ordinary value %T was incorrectly short-circuited", value)
		}
	}
	for _, value := range []any{false, 0, float32(0), float64(0)} {
		if !isUndefined(Get(value, "missing")) {
			t.Fatalf("boxed primitive %T fabricated a missing own property", value)
		}
		primitiveFailure(t, "prototype adapter", func() { Get(value, "toString") })
	}
	for _, value := range []any{0, float64(0)} {
		primitiveFailure(t, "prototype adapter", func() { Get(value, "toFixed") })
	}
}

func TestNumberRadixStringsRoundBeyondUint64LikeJavaScript(t *testing.T) {
	for _, value := range []string{
		"0x10000000000000000",
		"0X10000000000000000",
		"0b1" + strings.Repeat("0", 64),
		"0B1" + strings.Repeat("0", 64),
		"0o2" + strings.Repeat("0", 21),
		"0O2" + strings.Repeat("0", 21),
	} {
		if got := Number(value); got != math.Ldexp(1, 64) {
			t.Fatalf("Number(%q)=%g, expected2^64", value, got)
		}
	}
	// Exactly halfway between binary64 integers above 2^53 rounds to even.
	if got := Number("0x20000000000001"); got != math.Ldexp(1, 53) {
		t.Fatalf("large radix integer did not round once to nearest even: %g", got)
	}
	for _, value := range []string{
		"0x1" + strings.Repeat("0", 256),
		"0b1" + strings.Repeat("0", 1024),
		"0o1" + strings.Repeat("0", 342),
	} {
		if !math.IsInf(Number(value), 1) {
			t.Fatalf("Number(%q) should overflow to +Infinity", value)
		}
	}
}

func TestNumberDecimalOverflowAndUnderflowRemainNumeric(t *testing.T) {
	for _, value := range []string{"1e309", "+1e309", "Infinity", "+Infinity"} {
		if !math.IsInf(Number(value), 1) {
			t.Fatalf("Number(%q)=%g, expected+Infinity", value, Number(value))
		}
	}
	for _, value := range []string{"-1e309", "-Infinity"} {
		if !math.IsInf(Number(value), -1) {
			t.Fatalf("Number(%q)=%g, expected-Infinity", value, Number(value))
		}
	}
	if got := Number("-1e-4000"); got != 0 || !math.Signbit(got) {
		t.Fatalf("decimal underflow lost signed zero: %v", got)
	}
	for value, want := range map[string]float64{
		"": 0, "00012": 12, "+.5": 0.5, "1.": 1, "1.e2": 100,
		"\ufeff\u00a0\t12\u2028\u2029": 12,
	} {
		if got := Number(value); got != want {
			t.Fatalf("Number(%q)=%g, expected%g", value, got, want)
		}
	}
}

func TestNumberRejectsGoOnlyLiteralSpellingsAndSignedRadix(t *testing.T) {
	for _, value := range []string{
		"Inf", "+Inf", "-Inf", "inf", "infinity", "INFINITY", "0x1p2",
		"0x+1", "0x-1", "+0x1", "-0x1", "0b+1", "0o-1", "0b2", "0o8",
		"0x", "0b", "0o", "1_000", "1e", ".", "+", "12n", "\u008512\u0085",
	} {
		if got := Number(value); !math.IsNaN(got) {
			t.Fatalf("Number(%q)=%g, expectedNaN", value, got)
		}
	}
}

func TestStringRelationalOperatorsUseUTF16CodeUnitOrdering(t *testing.T) {
	for _, pair := range [][2]string{
		{"\U00010000", "\ue000"},
		{"\U00020000", "\ufffd"},
		{"prefix\U00010000", "prefix\ue000"},
		{"\U00010000", "\U00010001"},
		{"\U00010000", "\U00010000a"},
		{"", "a"},
	} {
		a, b := pair[0], pair[1]
		for operator, want := range map[string]bool{"<": true, "<=": true, ">": false, ">=": false} {
			if got := Binary(operator, a, b); got != want {
				t.Fatalf("%q %s %q=%v, expected%v", a, operator, b, got, want)
			}
		}
		if Binary(">", b, a) != true || Binary("<=", b, a) != false {
			t.Fatalf("reverse Unicode comparison did not reverse the order: %q,%q", a, b)
		}
	}
	for operator, want := range map[string]bool{"<": false, "<=": true, ">": false, ">=": true} {
		if got := Binary(operator, "\U00010000", "\U00010000"); got != want {
			t.Fatalf("equal strings %s = %v, expected%v", operator, got, want)
		}
	}
}

func TestStringNumberProjectionKeepsJavaScriptNotationThresholds(t *testing.T) {
	for _, value := range []struct {
		number float64
		want   string
	}{
		{math.Copysign(0, -1), "0"},
		{1e-6, "0.000001"},
		{-1e-6, "-0.000001"},
		{1e-7, "1e-7"},
		{-1e-7, "-1e-7"},
		{1e20, "100000000000000000000"},
		{-1e20, "-100000000000000000000"},
		{1e21, "1e+21"},
		{-1e21, "-1e+21"},
		{1.25e22, "1.25e+22"},
		{math.Inf(1), "Infinity"},
		{math.Inf(-1), "-Infinity"},
		{math.NaN(), "NaN"},
	} {
		if got := String(value.number); got != value.want {
			t.Fatalf("String(%g)=%q, expected%q", value.number, got, value.want)
		}
	}
}

func TestDenseArrayAndPlainObjectPrimitiveConversionsMatchJavaScript(t *testing.T) {
	for _, tc := range []struct {
		name   string
		value  any
		text   string
		number float64
	}{
		{"empty array", []any{}, "", 0},
		{"nil native array", []any(nil), "", 0},
		{"null element", []any{nil}, "", 0},
		{"undefined element", []any{Undefined}, "", 0},
		{"single number", []any{2}, "2", 2},
		{"single numeric string", []any{" 2 "}, " 2 ", 2},
		{"nested single number", []any{[]any{2}}, "2", 2},
		{"dense fixed array", [1]int{2}, "2", 2},
		{"two elements", []any{1, 2}, "1,2", math.NaN()},
		{"boolean element", []any{false}, "false", math.NaN()},
		{"null and undefined", []any{nil, Undefined}, ",", math.NaN()},
		{"nested empty arrays", []any{[]any{}, []any{}}, ",", math.NaN()},
		{"plain Scope", Scope{}, "[object Object]", math.NaN()},
		{"plain map", map[string]any{}, "[object Object]", math.NaN()},
		{"noncallable own valueOf", Scope{"valueOf": 7}, "[object Object]", math.NaN()},
		{"null own valueOf", Scope{"valueOf": nil}, "[object Object]", math.NaN()},
		{"object array element", []any{Scope{}}, "[object Object]", math.NaN()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := String(tc.value); got != tc.text {
				t.Fatalf("String(%#v)=%q, expected %q", tc.value, got, tc.text)
			}
			got := Number(tc.value)
			if math.IsNaN(tc.number) && !math.IsNaN(got) || !math.IsNaN(tc.number) && got != tc.number {
				t.Fatalf("Number(%#v)=%v, expected %v", tc.value, got, tc.number)
			}
		})
	}
}

func TestAdditionUsesPrimitiveConversionBeforeChoosingStringOrNumber(t *testing.T) {
	for _, tc := range []struct {
		left, right any
		want        any
	}{
		{[]any{1}, 2, "12"},
		{2, []any{1}, "21"},
		{[]any{}, 2, "2"},
		{[]any{}, Scope{}, "[object Object]"},
		{Scope{}, []any{}, "[object Object]"},
		{[]any{1, 2}, []any{3, 4}, "1,23,4"},
		{Scope{"valueOf": 7}, 1, "[object Object]1"},
		{nil, []any{}, "null"},
		{Undefined, []any{}, "undefined"},
		{nil, 2, float64(2)},
		{true, 2, float64(3)},
	} {
		if got := Binary("+", tc.left, tc.right); got != tc.want {
			t.Fatalf("%#v + %#v = %#v, expected %#v", tc.left, tc.right, got, tc.want)
		}
	}
	if Binary("-", []any{2}, 1) != float64(1) || Binary("*", []any{2}, 3) != float64(6) || Unary("+", []any{}) != float64(0) {
		t.Fatal("numeric arithmetic did not use the same ordinary primitive conversion")
	}
}

func TestRelationalCollectionValuesChooseUTF16StringsOrNumericComparison(t *testing.T) {
	for _, tc := range []struct {
		op          string
		left, right any
		want        bool
	}{
		{"<", []any{2}, []any{10}, false},
		{">", []any{2}, []any{10}, true},
		{"<", []any{2}, 10, true},
		{"<=", []any{}, 0, true},
		{"<", []any{}, Scope{}, true},
		{"<=", Scope{}, "[object Object]", true},
		{"<", []any{"\U00010000"}, []any{"\ue000"}, true},
	} {
		if got := Binary(tc.op, tc.left, tc.right); got != tc.want {
			t.Fatalf("%#v %s %#v = %v, expected %v", tc.left, tc.op, tc.right, got, tc.want)
		}
	}
	for _, op := range []string{"<", "<=", ">", ">="} {
		if Binary(op, Scope{}, 2) != false || Binary(op, []any{1, 2}, 2) != false {
			t.Fatalf("NaN primitive comparison %s should be false", op)
		}
	}
}

func primitiveFailure(t *testing.T, message string, operation func()) {
	t.Helper()
	defer func() {
		failure := recover()
		if failure == nil || !strings.Contains(fmt.Sprint(failure), message) {
			t.Fatalf("expected failure containing %q, got %v", message, failure)
		}
	}()
	operation()
}

func TestOwnConversionOverridesRespectHintOrderWithoutCallingNativeFunctions(t *testing.T) {
	for _, override := range []any{nil, Undefined, 3, "x", Scope{}} {
		object := Scope{"toString": override}
		primitiveFailure(t, "TypeError", func() { String(object) })
		primitiveFailure(t, "TypeError", func() { Number(object) })
		primitiveFailure(t, "TypeError", func() { Binary("+", "prefix", object) })
		primitiveFailure(t, "TypeError", func() { Binary("<", object, 1) })
		primitiveFailure(t, "TypeError", func() { String([]any{object}) })
	}
	called := 0
	callback := func() any { called++; return 7 }
	object := Scope{"valueOf": callback}
	if String(object) != "[object Object]" || called != 0 {
		t.Fatal("string hint did not finish with inherited toString before the own valueOf function")
	}
	primitiveFailure(t, "property \"valueOf\"", func() { Number(object) })
	primitiveFailure(t, "property \"valueOf\"", func() { Binary("+", object, 1) })
	primitiveFailure(t, "property \"valueOf\"", func() { Binary("<", object, 1) })
	object["toString"] = nil
	primitiveFailure(t, "property \"valueOf\"", func() { String(object) })
	object["toString"] = callback
	primitiveFailure(t, "property \"toString\"", func() { String(object) })
	primitiveFailure(t, "property \"valueOf\"", func() { Number(object) })
	if called != 0 {
		t.Fatal("coercion implicitly ran a Go function stored as a JS method")
	}
	if !Truth(object) {
		t.Fatal("Boolean conversion incorrectly called object conversion methods")
	}
}

func TestInheritedPropertiesFailExplicitlyButOwnDataAndMissingIndicesRemainReadable(t *testing.T) {
	for _, object := range []any{Scope{}, map[string]any{}, []any{}, "text"} {
		for _, property := range []string{"toString", "valueOf", "constructor", "hasOwnProperty", "__proto__"} {
			primitiveFailure(t, "prototype adapter", func() { Get(object, property) })
		}
	}
	for _, property := range []string{"map", "join", "at", "toSorted", "values"} {
		primitiveFailure(t, "prototype adapter", func() { Get([]any{}, property) })
	}
	for _, property := range []string{"slice", "charCodeAt", "trim", "isWellFormed", "substr"} {
		primitiveFailure(t, "prototype adapter", func() { Get("text", property) })
	}
	if String(Get(Scope{"toString": 3}, "toString")) != "3" || Get(Scope{"constructor": nil}, "constructor") != nil {
		t.Fatal("an own data property was rejected or replaced by its inherited method")
	}
	for _, value := range []any{Get(Scope{}, "missing"), Get(Scope{}, "map"), Get([]any{1}, "01"), Get([]any{1}, true), Get("x", 3)} {
		if !isUndefined(value) {
			t.Fatal("a genuinely missing data property or array/string index did not remain undefined")
		}
	}
	if Get([]any{1, 2}, "length") != 2 || Get("a😀b", "length") != 4 || Get("mañana", 2) != "ñ" {
		t.Fatal("prototype guards changed own length/index or Unicode behavior")
	}
}

type countedPrimitiveAdapter struct {
	calls *int
	text  string
}

func (adapter countedPrimitiveAdapter) String() string { *adapter.calls++; return adapter.text }

func TestExplicitStringAdapterRunsOncePerCoercionAndPropertyKey(t *testing.T) {
	calls := 0
	adapter := countedPrimitiveAdapter{calls: &calls, text: "2"}
	for _, operation := range []func(){
		func() {
			if String(adapter) != "2" {
				t.Fatal("string adapter result changed")
			}
		},
		func() {
			if Number(adapter) != 2 {
				t.Fatal("number adapter result changed")
			}
		},
		func() {
			if Binary("+", adapter, 3) != "23" {
				t.Fatal("addition adapter result changed")
			}
		},
		func() {
			if Binary("<", adapter, 3) != true {
				t.Fatal("relational adapter result changed")
			}
		},
		func() {
			if Get(Scope{"2": "found"}, adapter) != "found" {
				t.Fatal("key adapter result changed")
			}
		},
	} {
		calls = 0
		operation()
		if calls != 1 {
			t.Fatalf("one conversion invoked the explicit host adapter %d times", calls)
		}
	}
}

func TestArrayCoercionRejectsCyclesAndBoundsButAcceptsSharedAcyclicArrays(t *testing.T) {
	shared := []any{1, 2}
	if String([]any{shared, shared}) != "1,2,1,2" {
		t.Fatal("acyclic aliases were confused with recursive arrays")
	}
	cycle := []any{nil}
	cycle[0] = cycle
	primitiveFailure(t, "cyclic array", func() { String(cycle) })
	primitiveFailure(t, "cyclic array", func() { Number(cycle) })
	deep := any(1)
	for range 129 {
		deep = []any{deep}
	}
	primitiveFailure(t, "limit", func() { String(deep) })
	large := make([]any, 100001)
	primitiveFailure(t, "limit", func() { String(large) })
	failed := false
	v := NewView(func() []Node {
		value := any([]any{2})
		if failed {
			value = cycle
		}
		return []Node{{ID: "text", Kind: "text", Text: String(value)}}
	})
	initial := v.Object("text")
	failed = true
	v.Refresh()
	if v.Error() == nil || !strings.Contains(v.Error().Error(), "cyclic array") || v.Object("text") != initial {
		t.Fatal("invalid array coercion crashed or replaced the last valid native frame")
	}
}

func TestCoercionKeepsNamedNativeScalarsAndDoesNotBroadenObjectEquality(t *testing.T) {
	type text string
	type flag bool
	if Truth(text("")) || String(text("2")) != "2" || Number(text("2")) != 2 || Binary("+", text("2"), 3) != "23" {
		t.Fatal("named native strings did not remain JS string primitives")
	}
	if String(flag(false)) != "false" || Number(flag(true)) != 1 {
		t.Fatal("named native booleans did not remain JS boolean primitives")
	}
	primitiveFailure(t, "object equality", func() { Binary("===", []any{}, []any{}) })
	primitiveFailure(t, "object equality", func() { Binary("===", Scope{}, Scope{}) })
}
