<!-- SPDX-License-Identifier: Apache-2.0 -->

# Native text admission

A host backend can implement `webui.LegacyTextValidator` to check text before a
legacy or Goja view commits its native tree. Existing backends keep their current
behavior. Responsive text continues to use `webui.TextValidator`.

```go
type LegacyText struct {
    Kind, Field, Text string
    Style             Style
}

type LegacyTextValidator interface {
    ValidateLegacyText(LegacyText) error
}
```

The request contains the node kind, the `text`, `value` or `placeholder` field,
its exact string and its effective native style. Inherited defaults and fresh
measurement overrides are already resolved. `Style` is copied and `Style.Flex`
is nil; the request exposes no callbacks, resources or mutable source metadata.
Validators must be read-only and return an error when their adapter cannot
render the request.

Checks run for hidden and disabled nodes, empty text roles, and both editor
fields even when empty. A strict font adapter can select its exact bound face
and call `fontresource.StaticFace.ValidateText`. The hook itself does not select
fonts, load browser resources or enable another typography profile.

The entire candidate frame is checked before native factories or existing
objects are updated. Rejection keeps the previous objects, styles and hierarchy
and makes the rejected frame unavailable for snapshot or export. Measurement
and scene-layout admission also happens before replacing their stored profile.
A later successfully admitted refresh can recover. Reading errors, snapshots
or exports does not rerun admission callbacks.

Frame admission does not cover native editor keystrokes. Primitive editors can
change text and selection before their change callback, and opaque editors need
their own adapter. An adapter that requires typing admission must reject `input`
and `textarea` during the empty value-field check until it provides a separate
prospective-edit mechanism. It must also diagnose unsupported multiline text
rather than infer layout from nominal glyph coverage.

Preflight preserves the native frame. It does not roll back Preact state,
animation time, event history or host actions that already ran. Animation
refresh failures use the existing timeline fault handling. Source CSS, browser
font admission, outline validation, shaping and pixel equivalence remain
separate contracts.

Hosted conformance CI retains a focused race-test JSON trace for the admission
cases, its command, Go version and committed source hashes under
`artifacts/text-admission`. The gate requires every named case and both package
results to pass without skips; the normal full native suite also remains required.
