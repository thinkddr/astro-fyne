<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bind native font resources

`webui.FontResourceBinder` is an optional native backend capability. It checks
explicit family/weight/style/SHA-256 requirements and returns the backend that
must render them. Use that returned backend for the view:

```go
requirements := []webui.FontResourceRequirement{
    {Family: "Host", Weight: 400, Style: "normal", Hash: expectedSHA256},
}
selected, err := backend.BindFontResources(requirements)
if err != nil {
    return err
}
view := webui.NewView(build, selected)
```

Requirements contain 1–16 unique static faces, weight 400/700, normal/italic
style and lowercase SHA-256 hashes. Family aliases use letters, digits, marks,
spaces, underscores and hyphens, start with a letter and fit within 80 Unicode
scalars. They have no surrounding whitespace, quoting, escapes or fallback lists.
Duplicate descriptors use Go's actual `strings.EqualFold` comparison.

`ValidateFontResourceRequirements` checks typed requirements without reading
resources. `ParseFontResourceRequirements` additionally accepts a closed JSON
array up to 16 KiB. It rejects duplicate, missing or unknown fields, trailing data,
invalid UTF-8 and unsupported values. These helpers do not execute native UI work.

## Fyne backend ownership

`FyneBackend.BindFontResources` checks the entire alias map for ambiguity before
reading resource content. Every required face must already exist. The returned
private backend snapshots all maps and reads each nonnil resource once per
binding. It preserves unrelated bindings, including nil entries and legacy
weights. All nonnil bytes are copied; equal bytes share a comparable private
resource pointer whose `Content()` returns a copy. Caller names are not read.
Requirements are copied before resource callbacks; changing the caller's slice
from `Content()` cannot replace the requested identity.

The complete snapshot allows at most 256 families and 256 bindings, 20 MiB per
nonnil binding and 128 MiB total. Repeated bindings count toward the byte total
even when they share one source resource. An unrelated resource exceeding these
bounds causes a diagnostic. Required bytes also pass the shared static TrueType
container, metric/index and native parser checks against their declared face;
unrelated resources keep their existing validation behavior.

The original backend, maps and resource bytes are unchanged. Mutating those
inputs or a returned `Content()` copy cannot change the selected resources.
Rechecking the returned backend returns the same owner and resource pointers.
Each independently bound backend has its own responsive parsed-font cache.
Reuse one selected backend on Fyne's event goroutine when shared ownership is
intended; the limits apply per binding operation, without a global cache bound
or resource cleanup guarantee.

The nominal `fontbackend.Backend` checks its already frozen private descriptors
and font hashes, then returns the same pointer. It keeps its existing text and
parser-provenance admission rules. Binding does not reconstruct it or read the
caller's original resources again.

## Scope

This capability is opt-in. Existing backends and views retain their behavior.
Licenses and catalogue metadata remain the caller's responsibility. The API
does not prove glyph coverage, shaping, outline validity, fallback-free rendering
or pixel equality. Required TrueType checks retain the parser's documented limits.
Direct mutation of canvas objects after placement is outside this contract.

This foundation does not enable CSS `@font-face`, JavaScript resource requests or
browser font admission. Those adapters must use the selected backend and keep
their resource and export contracts explicit.
