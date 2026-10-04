<!-- SPDX-License-Identifier: Apache-2.0 -->

# Export Fyne to Astro + Preact

Export the actual Fyne object tree after layout on its UI goroutine. The exporter supports
the declared native scene contract and rejects widgets or rendering features outside it:

```go
import (
    "encoding/json"
    "os"

    "fyne.io/fyne/v2/theme"
    "github.com/thinkddr/astro-fyne/native/reverse"
)

document, err := reverse.Export(root, reverse.Options{
    Viewport: reverse.Viewport{Width: 320, Height: 240, Scale: 1},
    Canvas: window.Canvas(),
    CanvasBackground: theme.Color(theme.ColorNameBackground), // Standard opaque Fyne window.
})
if err != nil {
    return err
}
encoded, err := json.MarshalIndent(document, "", "  ")
if err != nil {
    return err
}
if err := os.WriteFile("scene.json", append(encoded, '\n'), 0644); err != nil {
    return err
}
```

The snippet assumes `root` is already mounted in `window`, laid out at 320 × 240,
and unfocused. Use the actual canvas size and scale for your application. A text or control
tree also needs the font and action bindings described below.

Supply the actual background of the canvas; a transparent canvas uses `color.Transparent`.
`CanvasBackground` may be omitted only when the exported tree itself guarantees opaque,
unrounded and borderless coverage of the full viewport. Fyne's public canvas interface does
not expose transparency, so the exporter requires this host assertion instead of guessing.

Convert the scene into web source files, placing bitmap assets in the Astro public directory:

```sh
bun src/cli.ts reverse --scene scene.json \
  --out example/src/pages/native-page --name NativePage \
  --public-dir example/public
bun src/cli.ts reverse --scene scene.json \
  --out example/src/pages/native-page --name NativePage \
  --public-dir example/public --check
```

This creates `NativePage.astro`, `NativePage.tsx`, `NativePage.css` and
`NativePage.reverse.report.json`. Without `--public-dir`, assets go into `OUT/public`;
configure Astro to serve that directory. Existing files must carry the generator marker;
existing bitmap bytes must match exactly. The complete scene and destinations are validated
before writing, so unsupported input preserves previous outputs. `--check` compares source
files, reports and bitmap bytes.

Callbacks require named actions in `reverse.Options.Bindings` or `IDBindings`. Export reports
a callback without its binding as an error. Use `--actions-module ./actions` for an explicit
client module exporting `actions`. Astro loads that module in the browser; SSR props do not
serialize Go or JavaScript functions. The generated Preact component also accepts an `actions`
prop for direct embedding. Text fields preserve local editing, immediate input and deduplicated
blur/Return commits. A single-line native `Entry.OnSubmitted` binds a separate `submit` action.

The scene freezes the current geometry, styles, values, theme tokens and resources. It does
not translate arbitrary Go callback bodies or reconstruct the original responsive layout.
Font-family mappings are supplied explicitly by the native host and need corresponding
licensed web font resources. Reports contain a scene digest and leave visual verification
false until the images pass the comparison gate.

## Bind controls and browser actions

For a generated view with an input `name` and a button `save`, bind its callbacks by ID:

```go
IDBindings: map[string]reverse.Events{
    "name": {Input: "updateName", Change: "commitName"},
    "save": {Tap: "save"},
},
```

Only include events that exist on those native nodes. For ordinary Fyne widgets, use
`Bindings` keyed by their actual `fyne.CanvasObject`, and `IDs` to assign stable IDs.
The [native fixture](../native/reverse/cmd/scene-fixture/main.go) provides an executable example.

Create `actions.ts` beside the generated page:

```ts
export const actions = {
  updateName(value?: string) {
    console.log("Name changed", value);
  },
  commitName(value?: string) {
    console.log("Name committed", value);
  },
  save() {
    console.log("Save requested");
  },
};
```

Pass `--actions-module ./actions` when generating that page. Replace these example actions
with the web host's service or navigation code.

For text, assert an equivalent licensed web family through `NodeFontFamilies` by ID or
`FontFamilies` by `fyne.Resource`. Serve the corresponding font and load it through CSS.
An explicit source family already stored in a generated node is preserved, but a family
name alone does not certify the browser and native pixels.
