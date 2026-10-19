<!-- SPDX-License-Identifier: Apache-2.0 -->

# Portable component catalogues

`catalog.Registry` retains named components, themes, source layouts, resources,
CSS, font faces, islands and numeric motion definitions. It uses the existing
public native runtime and contains no private application assets or imports.

```go
registry, err := catalog.Parse(data)
if err != nil {
    return err
}
view, err := registry.NewIsland("left", webui.Actions{
    "changed": func(values ...any) any {
        return nil
    },
})
```

JavaScript components create real `javascript.Widget` instances with a separate
Goja VM for each construction. Two island IDs can share a key and still own
independent state, callbacks and native objects. Keep an instance mounted to
retain its live state; calling `NewIsland` again creates another instance.
Construction and widget operations belong on Fyne's event goroutine.

To retain an instance checkpoint, call its `ExportJavascript()`, encode the
archive as JSON, then pass that text to `WithIslandState(islandID, payload)`.
The returned registry owns that island's props and event history independently.
Its optional `statePayload` and `stateHash` travel through catalogue serialization.
Code, source digests, CSS bytes and action contracts must still match the
prototype. Other islands keep their own checkpoints or prototype state. Existing
native export guards reject pending editor state and focus before export.

Scene and declarative program components require an explicit `RegisterFactory`
binding. A factory receives copied component/island metadata, resources, named
actions, a font backend, and any theme/layout dependencies. The binding is a
native implementation supplied by the host. Go functions and layout algorithms
are not serialized. `Clone`, `Marshal` and `Parse` retain declarations; bind
factories again after restoration.

`Theme(id, base)` returns an independent `webui.CapturedTheme` with copied tokens
and explicit font overrides. `Layout(id)` returns copied source `webui.Style`
declarations, including presence pointers in `Flex`. These dependencies do not
install an application theme or override the compiled component CSS. Apply a
theme or layout explicitly in the host. A `LayoutSpec.Native` algorithm produces
a diagnostic instead of disappearing from the archive.

Resource hashes bind the actual embedded bytes and require explicit media types
and license notices. Font declarations require static TrueType faces, actual
matching weight/style, checked tables and a successful native font parse. Font
families are explicit aliases; styles are not synthesized. Resource getters and
font resources return copies.

Static font bytes are checked by the shared `native/fontresource` package. The
catalogue still validates face descriptors, licenses, hashes and resource limits.
The shared validator can serve a future portable JavaScript font envelope without
an import cycle; automatic CSS `@font-face` discovery remains unsupported. The
pinned parser may ignore malformed optional `loca`/`glyf` outline tables; a
successful parse does not certify every outline or glyph coverage.

CSS source paths are metadata. Relative imports such as `../styles/main.css`,
Unicode paths, a byte order mark and original line endings survive transport.
Paths never select an output destination. A JavaScript component's CSS references
must match every retained stylesheet's original path, digest and exact bytes.
The archived compiled program determines behavior; CSS source copies do not add
another cascade or implement unsupported CSS.

Component `payload` is exact JSON **text**, with its own SHA-256 digest. Keeping
it as a string avoids changing that digest when Go and JavaScript encoders format
the surrounding catalogue differently. Parsing rejects unknown/missing fields,
invalid references, duplicate IDs, changed hashes and unsupported declarations.

`Motion(id)` returns an independent numeric motion specification. The caller
owns geometry bindings, the controller and its clock. A declaration does not
automatically animate nested layout, custom painters or arbitrary Go callbacks.

The catalogue preserves these explicit contracts. Native creation alone does
not establish universal CSS support or pixel equivalence.
