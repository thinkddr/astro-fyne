<!-- SPDX-License-Identifier: Apache-2.0 -->

# Convert source with licensed fonts

Use a local font manifest when converting an Astro or Preact entry:

```sh
astro-fyne to-fyne src/App.astro --fonts fonts.json
astro-fyne to-fyne src/App.astro --fonts fonts.json --check
```

The shortcut defaults to `native/generated` and the entry's name. `--out`,
`--name`, `--package`, `--props`, `--export`, `--stylesheet` and `--actions`
keep their existing source meanings. This font option supports native source
generation and checks. To return to the browser, export the complete catalogue
described below. Existing scene `--fonts` JSON arrays keep their format.

## Font manifest

```json
{
  "schema": 1,
  "kind": "astro-fyne-font-manifest",
  "faces": [
    {
      "family": "Host",
      "weight": 400,
      "style": "normal",
      "source": "fonts/NotoSans-Regular.ttf",
      "license": "fonts/LICENSE-NotoSans.txt"
    }
  ]
}
```

Font and license paths are relative to the manifest directory. They must stay
inside that directory, including symlink targets. Faces use explicit aliases,
weight 400/700 and normal/italic style. Reference the alias from source styles:

```css
.card {
  font-family: Host;
  font-weight: 400;
  font-style: normal;
}
```

The manifest accepts 1–16 static TrueType bindings, at most 20 MiB per face and
40 MiB total, counting repeated bindings. It reuses the existing static font
validation. License files must contain nonblank UTF-8 text without NUL and fit
within 1 MiB. The manifest also has a 1 MiB limit. License BOM and line endings
are preserved exactly. Same-byte font aliases share a resource only when their
license bytes also match; conflicting license text is diagnosed.

Optional `hash` and `licenseHash` fields pin the respective raw file bytes with
lowercase SHA-256 values. They are checked when supplied. No manual hash is
required: the generation report records the computed font, license and manifest
hashes. Unknown fields, duplicate JSON keys and inconsistent bindings produce
diagnostics before writing output.

## Use and export the native widget

For `App.astro`, generated `App.gen.go` provides `NewApp`,
`NewAppWithOptions` and `ExportAppCatalogue`. The constructor returns the actual
`*javascript.Widget` with the catalogue's licensed resources bound to its Fyne
backend:

```go
view, err := generated.NewApp(nil, actions)
if err != nil {
    return err
}
window.SetContent(view)

data, err := generated.ExportAppCatalogue(view)
if err != nil {
    return err
}
if err := os.WriteFile("Updated.catalogue.json", data, 0644); err != nil {
    return err
}
```

The first argument overrides props for a fresh source instance; `nil` keeps
the props supplied at conversion. `NewAppWithOptions` also accepts
`javascript.Options`, including explicit manual animation clock ownership.
Use Fyne's event goroutine for widget operations and call `Close()` there when
disposing the widget. Commit editor values and clear focus before export.

Use `ExportAppCatalogue` for the portable file. It retains licensed font bytes,
aliases, exact CSS and the current supported JavaScript checkpoint.
`ExportJavascript` returns only the inner program and omits the outer resources.
The catalogue exporter uses the generated catalogue resources and is intended
for generated constructors. Its archive compatibility check cannot attest the
backend or font origin of an arbitrary foreign widget.

```sh
astro-fyne to-web Updated.catalogue.json --out src/components/app --name App
astro-fyne to-fyne Browser.catalogue.json --out native/returned --name Returned
```

The existing browser catalogue module exposes `exportCatalogue` for mounted
island handles; the island ID for this route is `app`. See the
[catalogue guide](catalogue.md) for that API and action bindings. Regenerated
native catalogues expose `NewReturnedCatalogue()` and its `NewIsland("app", actions)`.
The source generation report also identifies its exact input catalogue copy
through `archiveFile`, so either direction can start from that file.

## Output and rendering boundaries

Preparation validates the archive and resource metadata before output preflight;
native construction also validates its executed frame. Direct bundle inputs,
props, manifest, fonts and licenses are protected from
replacement, including output directory aliases. `--check` writes nothing.
Handwritten files and exact asset sidecars keep their existing ownership rules.
If license text changes for identical font bytes, use a fresh output directory;
the existing license sidecar is preserved rather than overwritten.

Fonts bind through the existing catalogue/Fyne backend and generated browser
font declarations. The route does not activate the optional nominal font backend
or strict browser glyph admission. Missing dynamic faces/glyphs, shaping,
fallback behavior and raster parity still need their documented adapters and
evidence. Authored CSS `@font-face` and unsupported URL resources keep their
existing diagnostics. Resource transport alone does not certify pixel equivalence.

Custom native hosts can use the optional [font resource binding API](font-resource-binding.md)
to check exact descriptor/hash requirements and retain an immutable backend.
That opt-in API does not change this CLI route's default font admission.
