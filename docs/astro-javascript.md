<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Astro Fyne contributors. -->

# Astro source in the JavaScript engine

The explicit JavaScript route accepts `.astro` entries and their local Astro component
imports. Synchronous frontmatter runs as real JavaScript in Goja; it is not limited to
the declarative expression compiler. The native output still consists of Go files with
an embedded program and interactive Fyne widgets. Read [the engine guide](javascript-runtime.md)
for host bindings, replay archives and the general native platform boundary.

```sh
bun run to-fyne --javascript \
  --source example/src/pages/astro-javascript-original.astro \
  --out native/generated-astro --name AstroExample
bun run check --javascript \
  --source example/src/pages/astro-javascript-original.astro \
  --out native/generated-astro --name AstroExample
```

Astro entries expose their default component. `--props` supplies finite JSON input to
`Astro.props`; generated native constructors may replace it only for fresh programs.
An exported archive's frame, events or host journal requires its original inputs.
`ExportJavascript()`, `to-web --javascript --program` and regeneration from browser
archives work in the same way as component-module entries.

## Rendering and component lifetime

Frontmatter executes once per mounted Astro instance and caches its returned tree.
Imported hydrated Preact components use real hooks and update their own native widgets;
their events do not reexecute the containing frontmatter. Default `<slot>` content
evaluates lazily when used, with its fallback when no slot was supplied. `Astro.slots.has`
is supported. Props named `children`, `key` or `ref` remain Astro data, separate from
slot/reconciliation metadata. Internal `_afyAstro*` names are reserved.

Expressions preserve Astro's scalar, function and synchronous iterable rendering,
including visible `true` and `NaN`, omitted false/null/undefined, array/Set children,
ordinary object stringification and nested template elements. Strings enter native text
nodes, retaining Astro's escaping. Raw HTML/bytes and asynchronous rendering need adapters.

JS components require `client:load` or `client:only="preact"`. This profile represents
their settled hydrated state. Props crossing that hydration boundary transfer by finite
JSON value, including loss of shared-object aliases; functions, cycles and other Astro
serialization types need an explicit renderer adapter. Compatible static/nested `.astro`
components retain their own server-style props and default slots.

## Processed scripts

An ordinary `<script>` without attributes bundles its entire module graph independently.
The graph executes after the shared virtual DOM exists, so even imported dependencies
can access page elements at the same stage as the browser's processed script. A script
executes once per document/source occurrence, including when its Astro component appears
multiple times. Module variables and event closures rebuild through archived inputs.
Every imported source contributes to the archive digests.

Scripts can use supported virtual DOM APIs such as `document.getElementById`, textContent,
and click/input/change listeners. This does not supply a complete browser DOM. Script
attributes, inline/external script execution, dynamic assets and scripts that mount an
independent Preact renderer require additional module/renderer adapters.

## Current boundary

Native containers, text and controls retain the engine's documented sizing/style contract.
Astro inline styles require supported CSS objects with explicit pixel strings for nonzero
dimensions; Astro itself does not add JSX's implicit pixel units. Stylesheets, CSS cascade,
document shells/metadata, named slots, hydrated HTML slots, event attributes and deferred
hydration have explicit diagnostics. They are not silently discarded or made interactive.

Async frontmatter, response returns, route exports, request/URL/site APIs and other SSR
services remain outside this profile. Dynamic directives, nonserializable hydrated props
and unsupported Astro globals fail at execution when source values cannot be decided
without running the program. Generation validates syntax and structural contracts before
writing; it does not execute application source to infer platform behavior.

Native arbitrary Go callback bodies still need browser implementations through named
bindings. These source/archive routes preserve programs created for this engine; they
do not recover JavaScript from an arbitrary existing Go application. Universal conversion
and universal pixel equivalence remain pending explicit platform and rendering contracts.

## Evidence

`bun ci/javascript-roundtrip.ts --astro` starts from the original `.astro` source, builds
actual Go widgets, exports an intermediate state, continues in Chromium, exports again
and regenerates Go. It compares 11 browser and 11 generated-Go frames. The fixture uses
imported private-field arithmetic, default slots and props, hydrated hooks/editors, shared
props that lose aliases across hydration, and an imported script dependency with a retained
counter. Repeating the script's component must not multiply its event handlers.

`capture/astro-javascript.ts` compares seven further states from the unmodified, built
Astro page and seven from the regenerated Astro island with the same native trace. This
checks the actual SSR/hydration/script pipeline, rather than only two copies of the adapter.
Evidence remains under `artifacts/astro-javascript-roundtrip`.

The existing component-module corpus, declarative compiler, native behavior and strict
RGBA gates remain part of CI. Reports keep `pixelPerfectVerified: false`; passing the
source/behavior corpus does not certify general CSS or typography pixels.
