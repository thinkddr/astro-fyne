<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Astro Fyne contributors. -->

# Roundtrip a generated program and its state

A generated widget can retain the compiler's declarative program and export its current
props, hook state and list identities. `--program` uses that archive to generate a Preact
island or recompile native Go. Both outputs continue from the exported state.

This is an opt-in contract for source-generated widgets. Fyne keeps compiled Go and native
widgets; it does not embed a JavaScript engine. The browser uses real Preact hooks and
reconciliation with a typed interpreter for the validated IR. Neither runtime uses `eval`
or recovers arbitrary function bodies.

For bundled JavaScript execution, use the separate [Goja route](javascript-runtime.md)
with `--javascript` and `ExportJavascript()`. That mode transports recorded programs and
events; the declarative archive described here retains its original Go-lowering contract.

## Enable and export

Add `portableProgram: true` to the source entry in your configuration:

```json
{
  "schema": 1,
  "package": "generated",
  "entries": [
    {
      "name": "Counter",
      "source": "example/src/components/Counter.tsx",
      "export": "Counter",
      "output": "native/generated/counter.gen.go",
      "portableProgram": true
    }
  ]
}
```

Generate with `bun run to-fyne --config <your-config.json>`. The widget gains an
`ExportProgram() (webui.ProgramArchive, error)` method. On Fyne's UI goroutine, after
committing editor values and clearing focus, save its archive:

```go
archive, err := view.ExportProgram()
if err != nil {
    return err
}
data, err := json.MarshalIndent(archive, "", "  ")
if err != nil {
    return err
}
if err := os.WriteFile("counter.program.json", data, 0644); err != nil {
    return err
}
```

Import `encoding/json` and `os`. Export reads the valid current frame without invoking
the builder or callbacks. Focus, caret, selection and editor text that has not entered
declared state cause a diagnostic. Existing widgets without the flag keep their generated
output and API.

## Generate Astro or Go

```sh
bun run to-web --program counter.program.json \
  --out example/src/pages/portable-counter --name PortableCounter \
  --public-dir example/public
bun run to-web --program counter.program.json \
  --out example/src/pages/portable-counter --name PortableCounter \
  --public-dir example/public --check

bun run to-fyne --program counter.program.json \
  --out native/generated --name RestoredCounter --package generated
bun run check --program counter.program.json \
  --out native/generated --name RestoredCounter --package generated
```

The web output contains an Astro page, a Preact component, browser runtime/types/data
helpers, a font stylesheet, assets and a report. The component and helpers live in
`_<Name>-program/`, which Astro excludes from routing. Its Astro page uses `client:only="preact"`.
Each island decodes its own props/state graph; islands do not share mutable hook seeds.
Import the component into Preact to supply mount-time `props` overrides and stable `actions`.
Changing those bindings while mounted produces a diagnostic; remount to replace them. An exported
`<Name>Handle`, attached through `ref`, provides `exportProgram()` after a committed render.
Its archive can enter the same `to-fyne --program` route after further browser interactions.

Native output includes `<Name>.gen.go`, the shared scope helper, font CSS when needed and
a report. Construct `NewRestoredCounter(nil, actions)` to use exported props. Supplied Go
props override individual archived props at construction. Hook seeds are consumed at mount; removing and
reinserting a component initializes fresh state. Keyed reorders and compatible conditional
branches retain their mounted state according to the source contract.

Named callbacks remain explicit local bindings. Native constructors require matching
`webui.Actions`. Web generation requires `--actions-module <import>` when the program has
actions; that browser module exports `actions`, and its import path is relative to the generated
component in `_<Name>-program/`. The Preact component also accepts an explicit
actions map. Top-level function props bound to those names are transported as action tags,
preserving their presence without serializing implementations. A missing binding is an error.

## Data and validation boundary

Archive schema 1 stores exact canonical IR JSON, its SHA-256 digest and the compiler source
digest. The tagged graph preserves null, undefined, booleans, Unicode strings, JavaScript
numbers including `NaN`, infinities and negative zero, dense arrays, ordinary data records,
aliases and cycles across props and state. It validates reference identities, declared state
addresses, component dependencies, expressions, handlers and embedded resource hashes before
writing artifacts. Limits include 100 levels, 100,000 data values, 16 MiB of data strings/keys
and 64 MiB of program JSON. Hashes establish content identity, not trust or authorization.

Go structs, pointers, non-string maps, channels, unbound functions and browser host objects
need data adapters. Sparse arrays, custom array properties, symbols, accessors, nonenumerable
properties, nonstandard descriptors and isolated UTF-16 surrogates produce diagnostics. Extra inactive hook seeds are
pruned at mount; unknown state namespaces are rejected.
Repeated zero-capacity Go slices or nil maps cannot establish JavaScript reference identity
and require an identity adapter. Decoded empty arrays receive distinct backing storage; repeated
references to those arrays remain shared.

The current IR does not retain original external/inline CSS source. Programs with
`hasStyles: true` therefore cannot enable this export; captured measurements cannot replace
the missing CSS. Literal inline style objects and class strings remain in the program, with
host stylesheets still supplied by the web project. Package/native component adapters also
require a web contract before program export. Arbitrary JavaScript, Go callbacks, custom
hooks, module effects, themes and manual native geometry overrides are outside the archive.
Use the [scene exporter](reverse-conversion.md) for supported handwritten Fyne objects.

This transport preserves declared behavior; its reports retain `pixelPerfectVerified: false`.
Native typography and visual fidelity still require the separate rendering-profile gates.

## Evidence

`bun ci/program-roundtrip.ts`, included in remote CI after Chromium installation, compiles
the Counter, Conformance, KeyedConformance, PrimitiveConformance and PortableConformance sources to Go. It exports
them after intermediate interactions, compares original and restored browser behavior against
native traces, then recompiles browser-exported state and compares further Go interactions.
The comparisons cover text/input values, updater batching, closure observations, optional
chains, event evaluation order, row order, object retention, focus, remounts and list identities.
The portable data fixture also compares cyclic references, prop/state aliases, special numbers
and setter batches with no net change. Archives, generated code and ordered traces remain under `artifacts/program-roundtrip`.
