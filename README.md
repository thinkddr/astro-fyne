<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Astro Fyne contributors. -->

# Astro Fyne

Build an interface in **Astro + Preact**, then generate **native Fyne widgets, Go code,
themes and embedded resources**. Export a supported Fyne interface back into an Astro page,
Preact component, CSS and bitmap assets.

**Early development:** the converter supports a strict declarative subset. It does not yet
convert arbitrary Astro, JavaScript, CSS or Go applications. Unsupported features produce
errors. Universal 1:1 conversion is the project goal, not a capability of this release.

[Compatibility](COMPATIBILITY.md) · [Native integration](docs/native-runtime.md) ·
[Reverse conversion](docs/reverse-conversion.md) · [Visual verification](docs/visual-verification.md)

The source compiler lowers supported logic into Go with native state and widgets.
Nullable property/index chains such as `profile?.details.name ?? "Guest"` retain
JavaScript's short-circuit behavior in that generated Go. See the compatibility
contract for the supported expressions, events and layouts.

## Get started

Install [Bun](https://bun.sh/docs/installation) and the Go version declared in
[native/go.mod](native/go.mod). CI currently uses Bun **1.4.2** and Go **1.27.1**.
Running a desktop window also requires the [Fyne platform dependencies](https://docs.fyne.io/started/).
The compiler is currently installed from this repository; there is no published npm package.

```sh
git clone https://github.com/thinkddr/astro-fyne.git
cd astro-fyne
bun install --frozen-lockfile
bun run to-fyne
bun run check
```

The default configuration converts `example/src/pages/index.astro` into
`native/generated/counter.gen.go`. Its report is written beside the Go file.

Open the web example:

```sh
bun run dev
```

Open the generated native example in another terminal:

```sh
bun run demo:native
```

Both examples use the Counter component. Change
[example/src/components/Counter.tsx](example/src/components/Counter.tsx), then regenerate
with `bun run to-fyne`. For automatic generation during development, run `bun run watch`.
Watch monitors supported files under the configuration directory. Restart the native demo
to load the new Go code. The counter demonstrates state and events;
it is not a certified visual profile.

The responsive native controls example is also available:

```sh
bun run to-fyne --config responsive-controls.json
bun run demo:native --example responsive
```

Its web page is `/responsive-controls`. It demonstrates typing, focus, commits, disabled
controls and resizing. Geometry and behavior are tested; text rasterization still differs.

## Convert your own page

Create `astro-fyne.json` at your project root:

```json
{
  "schema": 1,
  "package": "generated",
  "entries": [
    {
      "name": "Dashboard",
      "source": "src/pages/dashboard.astro",
      "output": "native/generated/dashboard.gen.go"
    }
  ]
}
```

Run the compiler from this checkout, pointing it at your configuration:

```sh
bun run to-fyne --config /path/to/your/project/astro-fyne.json
bun run check --config /path/to/your/project/astro-fyne.json
bun run watch --config /path/to/your/project/astro-fyne.json
```

Paths inside the configuration are relative to the configuration file. Add more entries
for more pages; use `--entry Dashboard` to select one. A TSX entry can set `export` to choose
a named component. See the [example configurations](responsive-controls.json) for font
bindings and the [native integration guide](docs/native-runtime.md) for measured profiles,
host actions and custom backends.

Generation produces:

| Output                    | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `<entry>.gen.go`          | Native widget, constructor, theme and resource factories        |
| `<entry>.gen.report.json` | Source digest, actions, resources and compatibility information |
| `astro_fyne_scope.gen.go` | Shared helper for the generated Go package                      |
| `<entry>.gen.fonts.css`   | Matching web font declarations when the entry declares fonts    |

Keep generated files in version control. Edit the Astro/TSX source or the host application;
`check` catches stale output. The compiler validates every selected entry before writing
and refuses to overwrite files it does not own.

## Use widgets, themes and fonts

Add `github.com/thinkddr/astro-fyne/native` to your Go application. The generated constructor
returns a native widget embedding `*webui.View`:

```go
view, err := generated.NewDashboard(webui.Scope{}, webui.Actions{})
if err != nil {
    return err
}
window.SetContent(view)
if err := view.BindCanvas(window.Canvas()); err != nil {
    return err
}
```

Supply required props through `webui.Scope` and platform effects through named
`webui.Actions`. Navigation, network calls and storage are implemented by the host. Surface
`view.Error()` and perform UI changes on Fyne's event goroutine.

`NewDashboardTheme(baseTheme)` constructs the generated theme; apply it with
`app.Settings().SetTheme(theme)`. `NewDashboardResources()` exposes embedded assets.
Entries with `fonts` also get `NewDashboardBackend()`, selected automatically by the widget
constructor. Import the generated `.fonts.css` in Astro and serve the original font files
at their configured `webSrc` URLs. Generation embeds fonts into Go; it does not copy them
into the web project's public directory.

See the runnable [native demo](native/cmd/astro-fyne-demo/main.go) and
[font configuration](responsive-controls.json). Static TrueType regular/bold and normal/italic
faces are supported. Font licenses remain your responsibility; the included Noto Sans files
retain their [SIL Open Font License](example/public/fonts/LICENSE-NotoSans.txt).

## Convert Fyne to Astro + Preact

Export a supported, already laid out Fyne tree with the Go `reverse.Export` API and save the
result as `scene.json`. Then run:

```sh
bun run to-web --scene scene.json \
  --out /path/to/your/project/src/pages/native-page --name NativePage \
  --public-dir /path/to/your/project/public
```

This creates `NativePage.astro`, `NativePage.tsx`, `NativePage.css`, a report and any bitmap
assets. The page route is `/native-page/NativePage`. Repeat the command with `--check` to
verify that the output is current.

To try the reverse pipeline with the included native scene:

```sh
bun run demo:scene
bun run to-web --scene artifacts/reverse/scene.json \
  --out example/src/pages/native-page --name NativePage --public-dir example/public
bun run dev
```

Open `/native-page/NativePage`. The fixture exports real native objects using the software
driver, so this example does not require a desktop window.

The exporter captures the current frame. It preserves supported values, styles, resources
and named event bindings. Set `PreserveLayout: true` to retain validated source Flexbox
declarations from a generated responsive View. Arbitrary Go layouts and function bodies
need explicit host contracts. Interactive scenes need explicit action bindings and an
`--actions-module` exporting `actions`. See the [complete reverse guide](docs/reverse-conversion.md).

Rebuild the exported scene as native widgets, including interactive scenes whose generated
web island contains hydration code:

```sh
bun run to-fyne --scene artifacts/reverse/scene.json \
  --out native/generated --name NativeScene
bun run check --scene artifacts/reverse/scene.json \
  --out native/generated --name NativeScene
```

Schema 1 scenes retain fixed boxes and local input editing. Schema 2 scenes retain the
supported Flexbox declarations and resize without additional captures. Both generate native
resources, themes and named actions. Supply matching fonts through `--fonts faces.json` or
a host backend; the [reverse guide](docs/reverse-conversion.md) describes these boundaries.

Source-generated widgets can also preserve their declarative logic and current state. Enable
`portableProgram: true`, export with `ExportProgram()`, and import using `to-web --program`
or `to-fyne --program`. Native execution remains generated Go. See the
[program roundtrip guide](docs/program-roundtrip.md) for actions, data and CSS boundaries.

## Commands

All conversion commands support `--help`. `bun run astro-fyne --help` lists the complete interface.

| Command                                     | Use                                                     |
| ------------------------------------------- | ------------------------------------------------------- |
| `bun run to-fyne`                           | Generate native Go; alias of `generate`                 |
| `bun run to-web --scene … --out … --name …` | Generate Astro + Preact; alias of `reverse`             |
| `bun run check`                             | Verify generated native files without writing           |
| `bun run watch`                             | Regenerate native files after source edits              |
| `bun run analyze`                           | Print the source manifest as JSON                       |
| `bun run dev`                               | Start the example Astro development server              |
| `bun run demo:scene`                        | Export the included native scene for reverse conversion |
| `bun run demo:native`                       | Run the generated desktop example                       |

Forward source commands default to `astro-fyne.json`. Use `--config PATH`, `--entry NAME` and,
for a single measured entry, `--measurements PATH`. Reverse output is checked with
`bun run to-web … --check`. Native scene input supports `to-fyne --scene …` and
`check --scene …`, with `--out`, `--name`, optional `--package` and `--fonts`.

## Compatibility and visual accuracy

| Area                 | Current support                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| Source               | Declarative Astro/TSX components, props, supported expressions, `useState`, events and keyed lists   |
| Native output        | Fyne widgets, generated themes, explicit host actions, local PNG/JPEG resources and static TTF faces |
| Responsive layout    | Explicit row/column Flexbox, boxes, one-line text, buttons, single-line inputs and bitmap leaves     |
| Browser measurements | Fixed source/state/viewport/device-scale profiles with validated styles                              |
| Reverse output       | Fixed native scenes or preserved source Flexbox, with values, resources and named actions            |
| Program roundtrip    | Opt-in compiler IR, declared props/state and list identities restored in Preact and generated Go     |
| Still unsupported    | Arbitrary JS/Go, full CSS cascade, grid, wrapping/intrinsic layout, animations and browser APIs      |

CI compares browser and native captures and retains the generated code, traces, scene files
and pixel diffs. The current corpus includes **38 exact visual comparisons** with zero RGBA
differences, plus **12 exact native scene reconstruction frames**, control behavior and
geometry checks. **All 22 responsive typography frames
still differ at zero tolerance.** Passing a profile certifies that profile only.

Generation reports `pixelPerfectVerified: false`; generating code or matching rectangles
is not proof of matching pixels. Follow the [visual verification guide](docs/visual-verification.md)
to capture a profile and compare it. Evidence is available in the
[GitHub Actions runs](https://github.com/thinkddr/astro-fyne/actions).

## Development

For development validation, run builds and tests on a remote machine or in CI, following
[CONTRIBUTING.md](CONTRIBUTING.md). In a remote checkout, run the compiler checks:

```sh
bun run test
bun run typecheck
bun run check
```

Run `go test ./...` from `native` in that remote checkout for the runtime tests. The desktop
demo has a separate Go module so the runtime tests do not need a desktop graphics driver.
CI additionally runs race checks, vet, vulnerability checks, Chromium captures, inverse
conversion and strict pixel comparisons. To run the full `bash ci/run.sh` workflow on a
remote machine, first install the capture browser with
`bunx --no-install playwright install chromium`.

When contributing, include a small reproduction, preserve explicit unsupported-feature
errors, and add behavior or visual evidence for new conversion features. See
[COMPATIBILITY.md](COMPATIBILITY.md) for the rendering contract and remaining work.

## Troubleshooting

| Problem                       | Next step                                                                |
| ----------------------------- | ------------------------------------------------------------------------ |
| `gofmt` cannot run            | Install Go and ensure `gofmt` is on `PATH`                               |
| Unsupported source or CSS     | Use the reported source location and check the compatibility contract    |
| Missing host action           | Add the named function to the constructor's `webui.Actions` map          |
| Missing font or glyph         | Declare the exact face in `fonts` and serve the same bytes in Astro      |
| Stale generated output        | Run `to-fyne` or `to-web` again, then `check`                            |
| Desktop build fails           | Install the Fyne dependencies for your OS                                |
| Measured view becomes invalid | Restore its recorded state, viewport and scale, or capture a new profile |

## License

The compiler, capture tools and native runtime use [Apache-2.0](LICENSE).
See [NOTICE](NOTICE) for attribution. Dependencies and bundled assets retain their own
licenses. This public repository uses public Fyne dependencies and does not require private
product code or forks.
