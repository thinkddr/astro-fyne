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

The default schema 1 scene freezes the current geometry, styles, values, theme tokens and
resources. Schema 2 additionally preserves validated source Flexbox declarations when the
host requests `PreserveLayout: true`. Neither format translates arbitrary Go callback bodies
or reconstructs an arbitrary Fyne layout algorithm.
Font-family mappings are supplied explicitly by the native host and need corresponding
licensed web font resources. Reports contain a scene digest and leave visual verification
false until the images pass the comparison gate.

## Rebuild a native scene

Use the same scene document as an input to the native generator:

```sh
bun run to-fyne --scene scene.json --out native/generated --name NativeScene
bun run check --scene scene.json --out native/generated --name NativeScene
```

This produces `NativeScene.gen.go` and `NativeScene.gen.report.json`. `--package` selects
the Go package, defaulting to `generated`. Ownership checks, whole-input validation and
read-only checking also apply to this direction. It does not require the generated TSX
island to fit the declarative source parser.

Construct `NewNativeScene(props, actions, backends...)` using the same native integration
API as a source-generated widget. Props do not change an exported snapshot. Actions must
include every callback referenced by the scene; their implementations remain the
host's responsibility. Input values are local to the reconstructed field and survive host
refreshes. Input actions run immediately, changes commit once on blur or Return, and
single-line submit actions run after the commit on every Return. A commit that removes or
disables the field prevents its subsequent native submit.

Schema 1 boxes are authored fixed geometry, not browser measurement certification. The
native runtime permits editing values within them, while requiring the same node structure,
styles, resources, viewport and scale. Browser `ApplyMeasurements` retains its strict source
state and pending-input checks. Geometry does not certify pixels after edits or overflow.
Native scene import currently rejects textarea rendering and placeholder paint that differs
from the public editor's half-alpha text color.

Text scenes require an explicit matching font backend. To embed the supported TrueType
faces automatically, create `faces.json`:

```json
[
  {
    "family": "HostFont",
    "weight": 400,
    "style": "normal",
    "source": "public/fonts/HostFont-Regular.ttf",
    "webSrc": "/fonts/HostFont-Regular.ttf"
  }
]
```

Run `to-fyne` and `check` with `--fonts faces.json`. Font paths are relative to that JSON
file. Font bytes and bindings are part of the generation digest. This adds the resource and
backend factories and matching `.gen.fonts.css`; browser font serving remains explicit.
Other font contracts need the host backend rather than synthesized font faces.

## Preserve responsive source layout

For a generated responsive widget, export on the UI goroutine after layout:

```go
document, err := reverse.Export(view, reverse.Options{
    Viewport: reverse.Viewport{Width: 224, Height: 96, Scale: 1},
    Canvas: window.Canvas(),
    PreserveLayout: true,
})
```

Schema 2 records `layout: "flex"` and each node's `sourceStyle` separately from the initial
resolved `style`. Optional dimension declarations, explicit zero bases and zero shrink
factors remain distinct. Web output uses those declarations instead of fixed coordinates;
native scene output restores the same native layout engine. One document can therefore
resize through 224 → 368 → 512 → 368 → 224 pixels. Static generated TSX also fits the existing
forward source compiler without measured geometry; use its TSX entry for that route.

This mode requires a visible single responsive View at the viewport origin and size, with
an opaque square borderless root covering the viewport. Bind IDs and callbacks to its source
nodes; the implementation wrapper has no web node. Raw Fyne containers, measured browser
profiles, arbitrary layout algorithms, canvas composition, multiline controls and unsupported
Flexbox declarations and manual geometry/visibility overrides produce errors. Exported values and actions describe the current state;
source hooks, props, keyed-list lifecycles and arbitrary callback bodies are not recovered.

CI reconstructs geometry, bitmap and control scenes in Fyne and compares their pixels or
action traces. It also resizes one schema 2 web page per source through the existing Flexbox
and bitmap corpus and applies the unchanged zero-difference RGBA gate to every frame.

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
