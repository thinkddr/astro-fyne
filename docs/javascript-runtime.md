<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Astro Fyne contributors. -->

# Run JavaScript in native Fyne

The explicit `--javascript` route bundles an Astro/TSX/JSX/TS/JS component and runs it in
[Goja](https://github.com/dop251/goja), a JavaScript engine implemented in Go.
Generated native files remain `.go`. They embed the JavaScript program and call the
Go runtime; the application does not require Node, Bun or a browser at runtime.
JavaScript logic is interpreted, rather than translated into Go statements.
Fyne still owns the window, drawing, buttons, links and native text editors.

The default declarative compiler remains available. Its `portableProgram` archives
and this mode's JavaScript archives are separate, explicit contracts.

## Generate and run

From this checkout, with Bun and Go on PATH:

```sh
bun run to-fyne --javascript \
  --source example/src/components/JavascriptConformance.tsx \
  --export JavascriptConformance --actions observe \
  --out native/generated-js --name JavascriptExample
bun run check --javascript \
  --source example/src/components/JavascriptConformance.tsx \
  --export JavascriptConformance --actions observe \
  --out native/generated-js --name JavascriptExample
```

Use `--export` for a named export; the default is `default`. `--props <json-file>`
provides initial data. `--package <identifier>` defaults to `generated`.
`--actions` is a comma-separated list of callback props, bound by the native host:

```go
view, err := generated.NewJavascriptExample(nil, webui.Actions{
    "observe": func(args ...any) any {
        // Record an observation or perform an explicit application action.
        return nil
    },
})
if err != nil {
    return err
}
window.SetContent(view)
if err := view.BindCanvas(window.Canvas()); err != nil {
    return err
}
```

The constructor returns the engine widget, extending `webui.View`. Use its normal
`Object`, `Error` and canvas APIs. All VM/UI operations belong on Fyne's event
goroutine. Call `Close()` there when disposing the widget to run Preact effect cleanups.
The VM has a 500ms execution budget per operation and a 512-frame call-stack limit;
the budget interrupts JavaScript loops, not a blocking Go host callback.

The bundler includes local imports and compatible browser packages, using this
checkout's pinned Preact. It does not execute source during generation. Bun validates
and bundles it; Goja parses the completed program before any artifacts are written.
The executed tree receives further native adapter validation. Reports preserve source
digests and `pixelPerfectVerified: false`; generation is not visual certification.

## Continue in Astro and return to Go

After committing editor values and clearing focus, save
`view.ExportJavascript() (javascript.Archive, error)` with `encoding/json` and `os`.
Then generate a working Astro island:

```sh
bun run to-web --javascript --program native.javascript.json \
  --out src/pages/native --name NativeJavascript \
  --actions-module ../../../native-actions.ts
bun run to-web --javascript --program native.javascript.json \
  --out src/pages/native --name NativeJavascript \
  --actions-module ../../../native-actions.ts --check
```

The actions module exports `actions`; its import is relative to the component in
`_<Name>-javascript/`. Browser bindings use finite JSON arguments and results;
return explicit `null` for a void action. Native `nil` corresponds to that `null`.
The component accepts an explicit stable `actions` map when used directly in Preact.
Its exported `<Name>Handle`, attached through `ref`, offers `exportJavascript()`.

After further browser interactions, save that archive and regenerate native Go:

```sh
bun run to-fyne --javascript --program browser.javascript.json \
  --out native/generated-js --name RestoredJavascript
```

Native props replace initial props only for a fresh source program. An archive that
already has a frame/history must retain its original inputs for replay. Remount a fresh
source program to change data or action bindings.

## What is transported

Archive schema 1, kind `astro-fyne-javascript`, contains the self-contained program,
its SHA-256 digest, source digests, initial JSON props, named actions, input events,
host results and the current virtual frame. Restoration reruns the source and replays
the events. This rebuilds closures, refs, hook state, keyed component lifetimes and
module mutations without serializing a Goja heap or recovering function bodies.

`Math.random`, current-time `Date` calls and named action results are recorded.
Replayed actions consume their recorded results and errors without calling the host.
Restoration checks each boundary's name and arguments, exhausts the recorded results,
and compares the resulting virtual frame. A mismatch is an error. Further live actions
use local bindings and append to the history. Imports execute again during restoration;
external effects must enter through the recorded host boundary.
Locale/time-zone behavior, dynamic code that bypasses the recorded globals and other
nondeterministic services require replay adapters; a changed frame is rejected on restore.

Guest JavaScript may keep arrays, objects, cycles, special numbers, Maps, classes and
functions internally. Props and host bindings deliberately cross by JSON value: finite
numbers, booleans, strings, null, dense arrays and plain records. Functions, host objects,
accessors, sparse arrays, undefined, negative zero and cyclic host data need adapters.
JSON transfer does not retain aliases between separate host calls.

Histories are limited to 10,000 input events and 100,000 host results (16MiB of journal
data); each host data value is limited to 1MiB and 100 levels. Program code is limited
to 64MiB and the complete archive to 128MiB. Hashes
establish content identity, not the trustworthiness of a program. Keep archives in the
same trust boundary as application source.

## Current platform boundary

Real Preact provides state, reducers, refs, memo/callback hooks, context, layout/passive
effects, custom hooks, class components and keyed reconciliation. The tested execution
profile settles synchronous component/event work and effects between input events.
Promises/async host work, delayed timers, networking, storage, SSR and browser services
still need event-loop/platform adapters. This is not a complete browser environment.

The DOM adapter currently covers supported containers, plain text, buttons, links,
text inputs and textareas. Click capture/bubbling, controlled/uncontrolled input/change
events, direct event properties and programmatic clicks travel through the virtual DOM.
Physical clicks currently enter through native buttons and links; direct clicks on text,
container backgrounds or editor surfaces need a pointer adapter.
Links require `preventDefault()` and a named platform action for navigation.
Native keyboard/pointer event payloads beyond this
profile need adapters. Focus/caret/selection and pending editor values are excluded
from archives. Refs point to the shared virtual elements; layout measurement,
programmatic focus, raw HTML, SVG, additional controls and general DOM APIs need adapters.

Supported inline styles use the native prototype sizing/direction contract: finite
pixel dimensions, spacing, solid colors/borders, typography and row/column direction.
CSS imports, class-based styling, general cascade/layout and rich text require native
contracts. Mixed padding/background shorthands and longhands are diagnosed until ordered
CSS is retained.
[Astro source entries](astro-javascript.md) support synchronous frontmatter, nested Astro
components, default slots, compatible hydrated Preact islands and processed scripts.
General SSR/routing and browser services require further adapters. Astro output uses a hydrated
Preact island, with private helper files excluded from page routing.

Universal conversion remains pending these platform contracts and the independent
pixel-equivalence gates. Goja expands executable JavaScript; it does not implement CSS
or turn arbitrary browser/Go application effects into portable native behavior.

## Evidence

`bun ci/javascript-roundtrip.ts` compiles actual generated Go, exports an intermediate
native frame, continues the same program in Chromium, exports again and recompiles Go.
Its conformance source uses private class fields, reducers, spreading, array methods,
closures, module mutations, refs, context, hooks/effect cleanup, capture/bubbling,
controlled/uncontrolled editors, direct event properties, programmatic clicks and keyed
remounts. It compares 29 browser frames (12 from the unmodified original component) and
17 generated-Go frames, and proves that restoration repeats zero host effects.
Remote CI also checks two actual
Astro hydration/event frames, bounded VM execution and preservation of valid native
objects after source errors. Six bundled-source scenarios verify native diagnostics for
unsupported CSS, measurements, DOM properties, async handlers, host data and navigation.
Archives, callbacks and frames remain under
`artifacts/javascript-roundtrip`.

Goja is pinned to commit `e2ea74d3d2104994e1a7c76dd15b9f4e04df20e0` (Go module pseudo-version,
because upstream does not publish stable release tags) and uses MIT. Preact's existing
MIT dependency is bundled into each program; the adapter/runtime sources use Apache-2.0.
