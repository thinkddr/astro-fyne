<!-- SPDX-License-Identifier: Apache-2.0 -->

# Use the generated Go

The constructor returns a generated native widget, such as `*generated.CounterWidget`,
which embeds `*webui.View`, and checks required host actions. After
generating the Counter example, a Go host in the native module can construct it like this:

```go
import (
    webui "github.com/thinkddr/astro-fyne/native"
    "github.com/thinkddr/astro-fyne/native/generated"
)

view, err := generated.NewCounter(webui.Scope{}, webui.Actions{})
if err != nil {
    return err
}
window.SetContent(view)
if err := view.BindCanvas(window.Canvas()); err != nil {
    return err
}
if err := view.Error(); err != nil {
    return err
}
```

See the runnable [native demo](../native/cmd/astro-fyne-demo/main.go) for window creation,
theme setup and responsive rendering.

The repository includes generated Go and reports for its conformance examples in
`native/generated`. They are snapshots produced and tested by remote CI, so the native
module can be used and tested without first rebuilding Astro. CI regenerates them and fails
if committed snapshots or resolved Go dependencies change unexpectedly.

The example contains a stateful counter, a controlled input and conditional content. State
updates reuse objects by source position and supported list keys so the input can retain focus.
Public HTML IDs can change while the same source instance stays mounted. Hosts should surface
`view.Error()` when a runtime contract fails and perform UI mutations on Fyne's event
goroutine. Background service work returns to the UI through `fyne.Do`.

Application effects use named `webui.Actions`: the host implements service calls, navigation,
storage and other platform work in Go. A missing required action is an error. The constructor
also accepts an optional `webui.Backend`, which supplies boxes, text measurement and painting,
and editing. The default `webui.FyneBackend` uses public Fyne primitives. Measured text requires
explicit font resources matching the browser's loaded font family, weight and style; supplying
the same font file is necessary but does not by itself prove matching rasterization.

An entry can automate the matching font resources with `fonts`:

```json
"fonts": [{
  "family": "AstroNoto",
  "weight": 400,
  "style": "normal",
  "source": "example/public/fonts/NotoSans-Regular.ttf",
  "webSrc": "/fonts/NotoSans-Regular.ttf"
}]
```

Generation embeds the original bytes, emits `New<Name>Backend()` and includes the fonts
in `New<Name>Resources()`. The widget constructor selects this backend automatically when
the host supplies none. It also emits `<entry>.gen.fonts.css`, which the Astro host imports
to load the declared `@font-face`. The configuration binds a CSS family alias, face and web
URL to a content digest; changing any binding invalidates the source hash. Reports list
the font inventory without its binary content. With one declared family, the generated
theme uses its available regular/bold/italic faces; with several families, the theme keeps
its base fonts and the widget backend resolves each explicit family.

This contract accepts licensed, static TrueType files with weight 400 or 700 and normal or
italic style. It checks the SFNT table bounds, checksums, metrics and declared face before
writing any output. Native validation also parses the font and checks the supported text's
glyph coverage. Variable/color fonts, WOFF, CFF, font collections, synthesized faces and
implicit fallback require a separate rendering contract. Font sources must remain inside
the configuration's project directory, including through symlinks. Each file is limited
to 20 MiB, with 40 MiB across at most 16 faces. The example font retains its
[SIL Open Font License](../example/public/fonts/LICENSE-NotoSans.txt).

A custom backend can delegate its `Editor` method to `webui.NewEditor(backend, multiline,
style, onChange)`. This shares the native editing engine while using that backend's text
measurement and placement; the generated view owns keyboard focus and commit events.

Generation also emits an entry-specific theme type and constructor, such as
`GeometryTheme` and `NewGeometryTheme(base fyne.Theme)`. The theme receives the CSS custom
properties recorded by capture; the native theme adapter handles the supported token mapping
and uses the supplied base theme for the remaining Fyne theme values. Each generated widget
contains the source tree and layout/style data used by its native renderer. These outputs
automate the current widget and theme construction contract; general CSS theme switching,
arbitrary custom controls and every formatting model remain part of the compatibility roadmap.

An additional source-only mode generates a responsive native Flexbox layout from literal
inline styles. The same generated widget recalculates its rectangles when the Fyne canvas
resizes; it does not consume browser measurements. This mode currently accepts a single
full-width root with a fixed height, nested row/column flex containers, rectangular items,
one-line text, buttons, single-line inputs and bitmap images. Use explicit pixel bases, `minWidth: 0`, `minHeight: 0` and
`boxSizing: "border-box"` on every item. Growth, weighted shrinkage, gaps, main-axis
distribution and cross-axis alignment are handled by the native layout engine. The
[responsive layout contract](../COMPATIBILITY.md#responsive-source-layout) lists the exact
requirements and exclusions. Text and controls need explicit fonts, dimensions and reset styles. Wrapping, intrinsic
sizing and horizontal input scrolling remain unsupported; typography pixels are not yet
certified.

Local `<img src="/images/example.png" alt="…" />` nodes generate embedded native resources
and `canvas.Image` renderers. `NewNameResources()` exposes the resources by source path.
URL-root paths resolve from the entry's Astro `public` directory, even for imported shared
components; an entry can set `publicDir` explicitly. Relative image paths are source-relative.
The resource inventory and byte hashes appear in the report and source digest. Dynamic URLs,
remote assets, SVG, srcset, animation and color/orientation metadata require further adapters.
The initial PNG contract is RGB/RGBA with 8-bit channels; supported JPEG files also receive
native decoding, while actual pixel equality remains subject to the image gate.
