<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Astro Fyne contributors. -->

# Run JavaScript in native Fyne

The explicit `--javascript` route bundles an Astro/TSX/JSX/TS/JS component and runs it in
[Goja](https://github.com/dop251/goja), a JavaScript engine implemented in Go.
Generated native files remain `.go`. They embed the JavaScript program and call the
Go runtime; the application does not require Node, Bun or a browser at runtime.
JavaScript logic is interpreted, rather than translated into Go statements.
Fyne still owns the window, drawing, buttons, links, checkboxes and native text editors.

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
`--stylesheet <local.css>` adds a prebuilt stylesheet (for example, Tailwind output)
before source-module CSS imports. It is part of the source digests and program hash;
restoring a saved archive cannot replace it with a different stylesheet.
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
unstyled checkboxes, text inputs and textareas. Click capture/bubbling, controlled/uncontrolled input/change
events, direct event properties and programmatic clicks travel through the virtual DOM.
Listener identity includes event type, callback and capture flag. Boolean/options capture,
`once`, `passive`, callable `handleEvent` objects and listener removal during dispatch retain
their DOM behavior. Assigning a direct handler to `null` removes its listener slot; assigning
it again appends a new slot. A direct handler returning `false` cancels a cancelable event;
ordinary listener returns are ignored. Abort signals still need a native adapter.
HTML element and attribute names use ASCII case folding. Supported controls retain
boolean `disabled` presence, dirty input values, reflected checkbox/button values and
text/checkbox value-mode transitions. Textareas retain child-text defaults and normalized
line endings independently of edited values. Unsupported input types still require adapters.
`insertBefore` [validates a non-null reference](https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity)
before detaching the inserted node.
A foreign reference, including a foreign self reference, throws an error named
`NotFoundError` without changing the tree or edited input. Valid same-parent moves
retain the virtual node and native control. This bounded contract does not provide
a global `DOMException` constructor or complete DOM hierarchy validation.
Checkboxes preserve `checked`/`defaultChecked`, dirty local state, the default `on`
value, click preactivation and cancellation, input/change ordering, disabled behavior,
Space activation and associated plain-text labels. Native refreshes retain the control
and suppress programmatic callbacks; archives reject visual/source checked-state divergence.
Checkbox styling and image/geometry certification require a native checkbox style adapter.
Physical clicks currently enter through native buttons, links, checkboxes and associated labels; direct clicks on other text,
container backgrounds or editor surfaces need a pointer adapter.
Links require `preventDefault()` and a named platform action for navigation.
Native keyboard/pointer event payloads beyond this
profile need adapters. Focus/caret/selection and pending editor values are excluded
from archives. Refs point to the shared virtual elements; layout measurement,
programmatic focus, raw HTML, SVG, additional controls and general DOM APIs need adapters.

Supported inline styles use the native prototype sizing/direction contract: finite
pixel dimensions, spacing, solid colors/borders, typography and row/column direction.
Local side-effect CSS imports and recursive local `@import` retain their source hashes
and install ordered source rules in the shared Goja/browser runtime. Supported selectors
include element/class/ID/attributes, descendant/child/sibling combinators, `:is`, `:where`,
`:not`, `:root`, checked/disabled/enabled and simple child/empty states. Flat named layers,
specificity, source order, `!important`, inline priorities, inheritance, variables/fallbacks
and ordered padding/background declarations are retained through dynamic class changes
and continuation. Variable resolution follows the selected fallback path and invalidates
active cycle participants. Unused fallbacks are not evaluated. Inherited custom properties
retain their already computed values; explicit `inherit`, `unset` and `initial` are supported.
Complete-value variables, whitespace-separated padding lists and comma-separated RGB/RGBA
channels are supported. Token adjacency such as `var(--number)px` or `var(--hex)def`,
and unquoted comments in selected replacements, require a token-stream adapter and receive
diagnostics. Substitution must not fabricate a dimension or color by joining authored tokens.
Escaped variable functions/names, dynamic first arguments, custom-property `revert` and
`revert-layer`, and CSS-wide keywords produced by custom-property substitution require
further token/property adapters and receive diagnostics. CSS syntax is parsed at build time
with pinned MIT-licensed CSS Tree;
the runtime does not require it, Bun or a browser. Native properties still use the supported
prototype sizing/paint contract. Control typography needs explicit declarations or `inherit`
when matching browser control defaults matters.

CSS modules, media/feature queries, nesting, dynamic pointer/focus states, fonts and URL
resources, general layout and rich text still require native adapters. Invalid/unresolved
variables and unsupported initial/revert semantics are diagnosed. Explicit zero sizing
and zero default control padding require presence-aware native sizing; they are not
silently replaced by widget defaults. Full CSS and pixel equivalence remain pending.
[Astro source entries](astro-javascript.md) support synchronous frontmatter, nested Astro
components, default/named/forwarded slots, compatible hydrated Preact islands and processed scripts.
General SSR/routing and browser services require further adapters. Astro output uses a hydrated
Preact island, with private helper files excluded from page routing.

Universal conversion remains pending these platform contracts and the independent
pixel-equivalence gates. Goja expands executable JavaScript; it does not implement full CSS
or turn arbitrary browser/Go application effects into portable native behavior.

## Evidence

`bun ci/javascript-roundtrip.ts` compiles actual generated Go, exports an intermediate
native frame, continues the same program in Chromium, exports again and recompiles Go.
Its conformance source uses private class fields, reducers, spreading, array methods,
closures, module mutations, refs, context, hooks/effect cleanup, capture/bubbling,
controlled/uncontrolled editors, direct event properties, programmatic clicks and keyed
remounts. Its checkbox scenario also exercises preactivation, cancellation, disabled and
controlled/local state, labels, programmatic activation and Space. Its listener scenario also
checks options, duplicate registration, one-shot callbacks,
passive cancellation, object receivers, removal during dispatch, direct handler ordering and
programmatic click reentry.
It compares the unmodified original component, archived browser continuation and generated-Go
frames at every recorded step, and proves that restoration repeats zero host effects. Frame
counts are recorded in `comparison.json`. The attribute scenario independently checks default
and edited values, case folding, disabled presence, type changes and textarea child mutations.
The insertion scenario checks rejected references and valid moves against fixed tree/value
expectations, stable virtual IDs, native object pointers and actual browser element identity.
The CSS scenario additionally compares native
cascade values against Chromium's original computed styles in an isolated shadow tree,
including self/mutual cycles, selected/unused fallbacks, comments and function-name boundaries,
live cycle removal and explicit custom-property inheritance.
Remote CI also checks two actual
Astro hydration/event frames, bounded VM execution and preservation of valid native
objects after source errors. Bundled-source rejection scenarios verify native diagnostics for
unsupported CSS, token adjacency, measurements, DOM properties, async handlers, host data and navigation.
Archives, callbacks and frames remain under
`artifacts/javascript-roundtrip`.

Goja is pinned to commit `e2ea74d3d2104994e1a7c76dd15b9f4e04df20e0` (Go module pseudo-version,
because upstream does not publish stable release tags) and uses MIT. Preact's existing
MIT dependency is bundled into each program; the adapter/runtime sources use Apache-2.0.
