<!-- SPDX-License-Identifier: Apache-2.0 -->

# Reusable native component catalogues

The `native/catalog` package groups portable components with the resources,
stylesheets, fonts, themes, layout declarations, islands and motion definitions
they depend on. A catalogue can be authored in Go and transported as JSON with
`Registry.Marshal()` and `catalog.Parse()`. It reuses the public Astro Fyne
runtime; no private application package or asset is required.

```go
import (
    webui "github.com/thinkddr/astro-fyne/native"
    "github.com/thinkddr/astro-fyne/native/catalog"
)

registry, err := catalog.Parse(data)
if err != nil {
    return err
}
view, err := registry.NewIsland("counter-left", webui.Actions{
    "changed": func(arguments ...any) any {
        return nil
    },
})
```

The host places `view` in its native interface and handles errors. Construction
and widget operations belong on Fyne's event goroutine.

## Convert a catalogue with the CLI

Save `registry.Marshal()` as `Widgets.catalogue.json` and run:

```sh
astro-fyne to-fyne Widgets.catalogue.json --out native/generated --name Widgets
astro-fyne to-web Widgets.catalogue.json --out src/components/widgets --name Widgets --public-dir public
```

The file shortcut detects `kind: "astro-fyne-catalogue"`. Explicit input uses
`--catalogue Widgets.catalogue.json`. `--check` verifies either destination
without writing, and every component is prepared before output preflight.

Native generation embeds the exact catalogue in `NewWidgetsCatalogue()` and
registers generated constructors for scene/program components. JavaScript
components use the default Goja constructor. Pass host actions to the returned
registry's `NewWidget` or `NewIsland` methods.

Web generation exports `components`, `themes`, `layouts`, `motions` and
`WidgetsIsland` from `Widgets.catalogue.tsx`. Each island receives its own
component and checkpoint. Pass `actions` to bind callbacks, and `handleRef` to
obtain a JavaScript/program export handle after mounting. Scene components
represent snapshots and do not expose a live program handle. With declared
actions, pass `--actions-module ./actions.ts`; its path is relative to the
catalogue module, with nested imports adjusted automatically.

A generated browser module also exports `exportCatalogue`. Give it mounted
JavaScript handles to capture their current checkpoints into a new catalogue:

```ts
import { exportCatalogue } from "./Widgets.catalogue.tsx";

const updated = await exportCatalogue(new Map([["counter-left", leftHandle]]));
const json = JSON.stringify(updated, null, 2);
```

`leftHandle` comes from a mounted `WidgetsIsland`'s `handleRef`. Commit editor
values and clear focus before capturing. The helper snapshots supplied handles
before hashing, checks component code/source/CSS/action identity, preserves
other islands and returns independent metadata. It does not mutate the original
catalogue or perform a download. Save `json` through your host application, then
run `astro-fyne to-fyne Updated.catalogue.json` to restore supported state in Go.
Scene/program checkpoint contracts remain their existing explicit export APIs;
this helper currently accepts JavaScript island handles.

A scene containing labels with `labelFor` currently requires exactly one
declared island for web generation. Combining it with another island is
diagnosed before writing, because document-wide control IDs could associate a
label with another instance. This includes distinct scene components, not just
repeated references to the same component. Hosts that manually mount exported
scene components must provide unique document-wide IDs; reusable scene ID
scoping still needs a separate runtime contract.

The generated Astro page mounts all declared islands. Its module imports
component CSS and font declarations. Named theme/layout objects are available
for explicit host application; they do not alter the archived components.
Web font faces share the browser's font namespace, so conflicting bytes for one
family/weight/style within a catalogue produce a diagnostic before writing.

Resources, font licenses and original stylesheet bytes use content-addressed
sidecars. The generation report's `archiveFile` points to an exact source JSON
copy that either CLI direction can consume. Source paths remain metadata and
cannot redirect generated files. Resource licenses remain attached to each
resource; generated wrapper code uses Apache-2.0.

## Components and independent islands

A `Component` contains a stable ID, a supported kind, exact JSON payload text,
its SHA-256 digest, named action contracts and dependency references. The kinds
are `javascript`, `program` and `scene`.

JavaScript components create real `javascript.Widget` instances backed by Goja
and native Fyne controls. Each `NewWidget` or `NewIsland` call creates an
independent instance. Two islands may reference the same component and key while
keeping separate state, native objects and action bindings. Island IDs must be
unique. Keep the constructed instance mounted to preserve its live state;
constructing it again starts another instance from its archived checkpoint.

Call the resulting JavaScript widget's `ExportJavascript()` to retain its
supported current state and event history. The original catalogue remains an
immutable construction description; live instances do not mutate its payload.

Store a checkpoint explicitly with `WithIslandState`:

```go
state, err := javascriptWidget.ExportJavascript()
if err != nil {
    return err
}
payload, err := json.Marshal(state)
if err != nil {
    return err
}
updated, err := registry.WithIslandState("counter-left", string(payload))
```

`updated` is another immutable registry. Its serialized island contains paired
`statePayload` and `stateHash` fields. Native export retains the existing guards
for focus and pending editor values. The checkpoint can carry different instance
props and recorded history, while code, source digests, exact CSS and action
contracts must match the prototype. Saving one island cannot replace another
island's state or change the component definition. `NewIsland` restores that
island's checkpoint through the existing JavaScript replay contract. Factory
bindings remain explicit on the returned registry. Checkpoints for opaque scene
or arbitrary Go state require additional runtime contracts and are diagnosed.

Scene and declarative program components require a native factory:

```go
err := registry.RegisterFactory("NativePanel", func(input catalog.Instance) (fyne.Widget, error) {
    // Delegate to the host's generated or declared native constructor.
    return newNativePanel(input)
})
```

`newNativePanel` is a host constructor, not an API supplied by this package. The
factory receives copied component and island metadata, resource bytes, a font
backend, named actions and any referenced theme/layout dependencies. Generated
program constructors must restore and validate their declared state through the
existing program contract. The catalogue does not translate arbitrary Go
functions into JavaScript or infer missing native implementations.

`Factory(id)` looks up a registered binding. Duplicate registrations, unknown
components, missing named actions and nil factory results produce diagnostics.
Factories remain host bindings: `Clone`, `Marshal` and `Parse` copy portable
metadata and require factories to be registered again.

## Resources, CSS and fonts

`Resource` declares a safe relative name, media type, actual bytes, lowercase
SHA-256 digest and an explicit license notice. Supported media types are
`font/ttf`, `image/png`, `image/jpeg`, `text/css` and
`application/octet-stream`. Resources are embedded JSON base64, with at most
20 MiB per resource. Getters and native font resources return independent copies.

`Stylesheet` declares a source ID, original path, digest and exact UTF-8 bytes.
Its source path is metadata: relative imports such as `../styles/app.css` and
Unicode paths are retained and never select output destinations. Comments,
letter case, a byte order mark and original line endings survive transport.
A JavaScript component must reference exactly its archived stylesheet sources,
including matching paths, digests and bytes. The compiled program determines
CSS behavior. Retaining original text does not add another cascade or implement
unsupported CSS.

`FontFace` binds an ID and family alias to a resource and digest, with explicit
weight `400` or `700` and style `normal` or `italic`. Families use consistent
capitalization and each family/weight/style combination is unique. Resources
require static single-face TrueType data, valid tables/checksums, matching actual
weight/style, consistent horizontal metrics and bounded glyph indexes before
the native font parse. The index check accepts empty glyphs and rejects missing,
descending or out-of-range locations in either TrueType location format. It
does not validate every contour, composite or instruction, or certify glyph
coverage. Variable fonts, color fonts and
synthesized styles need separate adapters. The default JavaScript constructor
passes referenced faces to `webui.FyneBackend`.

## Embed CSS and typography in Go

Use Go embedding for resource data that belongs to your application:

```go
import (
    "crypto/sha256"
    _ "embed"
    "fmt"

    "github.com/thinkddr/astro-fyne/native/catalog"
)

//go:embed styles/panel.css
var panelCSS []byte

//go:embed fonts/NotoSans-Regular.ttf
var regularFont []byte

//go:embed fonts/LICENSE-NotoSans.txt
var regularLicense string

func embeddedResources() ([]catalog.Resource, []catalog.Stylesheet, []catalog.FontFace) {
    fontHash := fmt.Sprintf("%x", sha256.Sum256(regularFont))
    cssHash := fmt.Sprintf("%x", sha256.Sum256(panelCSS))
    return []catalog.Resource{{
        Name: "fonts/NotoSans-Regular.ttf", MediaType: "font/ttf",
        Hash: fontHash, Content: regularFont, License: regularLicense,
    }}, []catalog.Stylesheet{{
        ID: "panel", Path: "styles/panel.css", Hash: cssHash, Content: panelCSS,
    }}, []catalog.FontFace{{
        ID: "regular", Family: "AstroNoto", Weight: 400, Style: "normal",
        Resource: "fonts/NotoSans-Regular.ttf", Hash: fontHash,
    }}
}
```

Place these collections in the catalogue specification. Reference `regular`
from component/theme `fontFaces`; the native backend receives the exact font
resource. Web output emits the same bytes and a matching `@font-face` rule.
Keep the actual font's redistribution license with the resource.

For explicit nominal glyph checks, use
[`fontresource.NewStaticFace`](../native/fontresource/README.md) with the exact
TTF bytes, weight and style. Its immutable `StaticFace` provides `Contains(rune)`,
`ValidateText(string)` and a copied `Profile()` containing the font digest,
parser identity and inclusive Unicode scalar ranges. Rebuild a profile from its
font bytes before trusting imported metadata.

These methods check the selected character map. They do not certify shaping,
outlines or raster parity, and do not enable strict font admission in existing
widgets or browser components.

A stylesheet reference must match the component archive's imported CSS path,
digest and bytes. Compile the Astro/Preact source with its CSS imports first;
adding unrelated source text to metadata does not apply CSS to arbitrary Go
widgets. In the example, the component must archive `styles/panel.css` under
that exact source path before it can reference the `panel` stylesheet.

## Themes and source layouts

`Theme(id, base)` creates an independent `webui.CapturedTheme` from copied tokens
and explicit font overrides. It preserves custom-property spelling and retains
the existing captured color/size token validation. Two themes cannot change one
another by editing returned maps or resource bytes. Theme creation never
installs a global application theme.

`Layout(id)` returns copied `webui.Style` source declarations, including optional
numeric presence pointers in `Flex`. Named root and item layouts retain their
declarations; an actual source factory validates their behavior in its complete
tree. Fixed captured coordinates do not describe a reusable source layout.
Setting `LayoutSpec.Native` to a Go layout algorithm produces a diagnostic
instead of silently dropping executable behavior.

Generated layout CSS retains opacity, alignment, whitespace and declared text
metrics even when the family is inherited. Retaining a declaration does not add
a native compositor: actual responsive Fyne binding still diagnoses unsupported
group opacity and other missing adapters in the complete source tree.

Theme and layout references describe dependencies, not automatic overrides.
The host explicitly applies returned themes and layouts. A default JavaScript
widget continues to use its archived compiled styling.

## Motion and transport boundaries

Optional `motions` contain validated `motion.Spec` values. `Motion(id)` returns
an independent copy. The host binds target geometry and owns the motion
controller and clock. Web catalogues with motion definitions include and export
`WebMotionController`, using the same explicit target and clock contract. A catalogue does not automatically animate nested layouts,
custom painters or Go callbacks. See [numeric motion](motion.md).

The JSON envelope has schema `1` and kind `astro-fyne-catalogue`. The file limit
is 128 MiB; individual component payload text is limited to 64 MiB. Collection,
font-face and motion limits are checked before construction. Parsing diagnoses
unknown or missing fields, invalid references, duplicate IDs, changed hashes,
invalid UTF-8 and unsupported declarations.

Payloads remain strings containing their exact full JSON archive. Their hashes
therefore survive differences between Go and JavaScript encoders when the outer
catalogue is serialized. `Spec`, `Resources`, `Component`, `Layout` and `Motion`
return copied metadata, and `Clone` preserves the same portable content.

These APIs preserve explicit construction and source contracts. They do not
establish universal CSS support or pixel equivalence for arbitrary applications.
