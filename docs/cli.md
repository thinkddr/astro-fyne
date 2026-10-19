<!-- SPDX-License-Identifier: Apache-2.0 -->

# Convert in either direction

Install the repository's pinned dependencies and register the CLI once:

```sh
git clone https://github.com/thinkddr/astro-fyne.git
cd astro-fyne
bun install --frozen-lockfile
bun link
```

Keep this checkout: the linked command runs its source and dependencies. Ensure
Bun's binary directory is on `PATH`. You can also run
`bun /path/to/astro-fyne/bin/astro-fyne.ts` without registering a command.

From your interface project, use the same CLI for both directions:

```sh
astro-fyne to-fyne src/App.tsx
astro-fyne to-web App.program.json
```

The first command bundles the component and supported local CSS imports into a
Go widget that runs Preact in Goja and renders native Fyne controls. It defaults
to `native/generated` and the component name `App`. This route embeds JavaScript
in generated Go. For declarative logic lowered into Go, use a configuration with
`astro-fyne to-fyne --config astro-fyne.json`.

The second command accepts an exported JavaScript archive, a portable declarative
program, or a Fyne scene. It detects the JSON document type and delegates to the
corresponding converter. For `App.program.json`, output defaults to
`src/pages/app`, with component name `App`.

Use `--out` and `--name` to choose other destinations and names:

```sh
astro-fyne to-fyne src/pages/dashboard.astro --name Dashboard --out native/generated
astro-fyne to-web Dashboard.program.json --name Dashboard --out src/pages/dashboard
astro-fyne to-fyne Dashboard.program.json --name Dashboard --out native/generated
```

Put the input immediately after the direction, before its options. Existing
explicit `--source`, `--program`, `--scene` and configuration commands remain
available. Named exports still need `--export Name`; a source entry otherwise
uses its default export. All paths are relative to your current directory unless
absolute. The source compiler's configuration paths remain relative to the
configuration file.

## Convert a component catalogue

Export a native `catalog.Registry` with `Marshal()`, then use either direction:

```sh
astro-fyne to-web Widgets.catalogue.json --out src/components/widgets --name Widgets --public-dir public
astro-fyne to-fyne Widgets.catalogue.json --out native/generated --name Widgets
astro-fyne to-fyne Widgets.catalogue.json --out native/generated --name Widgets --check
```

Use `--actions-module ./actions.ts` for web components that declare host actions.
For catalogues this path is relative to the generated `Widgets.catalogue.tsx`;
the converter adjusts imports in nested generated components. Native callbacks
remain explicit when constructing a widget or island.

Native output provides `NewWidgetsCatalogue()`, a registry with generated scene
and program factories plus the Goja JavaScript constructor. Web output provides
`Widgets.catalogue.tsx`, named component exports, a `WidgetsIsland` component,
matching font declarations and an Astro page mounting declared islands.

Both directions retain the exact input JSON, CSS and resource/license bytes in
content-addressed sidecars. Use the reported `archiveFile` as input for another
conversion. Themes/layouts remain explicit host dependencies. Motion definitions
retain their target/clock contracts. See [catalogues and embedded styles/fonts](catalogue.md).

## Include CSS

Local CSS imported by a source component is included automatically. Add a
separate stylesheet when needed:

```sh
astro-fyne to-fyne src/App.tsx --stylesheet src/app.css
```

Supported selectors, cascade rules, declarations and live changes run in the
native adapter. New program archives retain the original UTF-8 stylesheets and
their hashes. Both output directions include `App.css-sources.json` and
`App.css-sources/`; these retained files are source copies. Edit the original
stylesheet and regenerate to change compiled behavior. See
[CSS in both directions](css-roundtrip.md) for the supported subset and limits.

## Export from Fyne

A generated JavaScript widget exports its program with `ExportJavascript()`:

```go
program, err := view.ExportJavascript()
if err != nil {
    return err
}
data, err := json.MarshalIndent(program, "", "  ")
if err != nil {
    return err
}
return os.WriteFile("App.program.json", append(data, '\n'), 0644)
```

Use this in the host application with `encoding/json` and `os` imported. Commit
pending editor values and clear focus before export. The
[continuation guide](javascript-runtime.md#continue-in-astro-and-return-to-go)
explains host actions and replay boundaries. Declarative widgets with
`portableProgram: true` expose `ExportProgram()` instead.

For a handwritten Fyne view, export supported objects with
[`reverse.Export`](reverse-conversion.md), then convert the saved scene:

```sh
astro-fyne to-web scene.json --name NativePage --public-dir public
astro-fyne to-fyne scene.json --name NativePage
```

Arbitrary Go files and callback bodies need explicit conversion contracts. A
scene preserves supported native appearance and named actions; program archives
also preserve their documented state and logic.

## Check and regenerate

Repeat either conversion with `--check` to verify output without writing:

```sh
astro-fyne to-fyne src/App.tsx --check
astro-fyne to-web App.program.json --check
```

Regeneration refuses to overwrite handwritten files. Errors leave the existing
output intact. For configured declarative projects, use `astro-fyne watch` to
regenerate after supported source changes, then rebuild the native application.

Run `astro-fyne --help`, `astro-fyne to-fyne --help` or
`astro-fyne to-web --help` for all options. Unsupported features produce
diagnostics. A generated interface still needs its behavior and pixels checked
against the original; universal 1:1 conversion remains unfinished.
