<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Astro Fyne contributors. -->

# Compatibility contract and roadmap

The target is an automated native implementation of interfaces authored in Astro + Preact,
preserving behavior and producing identical pixels for declared rendering profiles. Stage 01
establishes a compiler, a native runtime and measurable failure gates. Universal compatibility
remains a development objective.

Compatibility has three separate requirements: source syntax must compile, native interaction
must preserve the relevant behavior, and the resulting native image must match the browser.
A parser test alone establishes the first requirement. A generated button responding to a
tap establishes one interaction. A zero-difference geometry capture establishes one visual
profile. These results do not imply coverage of an entire application.

## Stage 01 source contract

The source compiler uses Astro's parser and TypeScript's AST. It lowers a declarative subset
to a portable intermediate representation and then generates Go. It does not evaluate the
original JavaScript or execute a general ECMAScript runtime.

| Area                | Initial contract                                                                                                                           | Outside the initial contract                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Entry files         | `.astro`, `.tsx` and `.jsx`; local component imports; default or selected named exports                                                    | General package resolution, server execution and arbitrary module side effects                                                         |
| Components          | Function components with supported props, constants and a declarative JSX return                                                           | Class components, arbitrary imperative component bodies and slots/children without a native contract                                   |
| State               | Supported `useState` declarations; direct and declarative updater setters in event handlers                                                | Other hooks, arbitrary custom hooks and general effect lifecycles                                                                      |
| Expressions         | Literals, supported ordinary/optional property and index access, arrays, objects, templates, conditionals and listed operators             | Arbitrary function calls, optional calls, spread and unsupported JavaScript constructs                                                 |
| Branches and lists  | Supported JSX conditionals and declarative `map` callbacks; unique finite homogeneous string or number keys on a single root               | General iteration, arbitrary callback bodies, mixed or changing key types and fragment keys                                            |
| Events              | Button/link `onClick`; input/textarea `onInput` and `onChange`; Go host callbacks declared explicitly in props and the host translator `t` | Full DOM event propagation, arbitrary event payloads, browser effects and implicit platform adapters                                   |
| HTML nodes          | Supported container, plain text, button, link, input, textarea and local bitmap image tags                                                 | Rich text nesting, forms, specialized form controls and unsupported tags                                                               |
| Application effects | Explicit named native actions supplied by the Go host                                                                                      | Host calls during module initialization; automatic translation of browser APIs, networking, SSR, storage or navigation implementations |

The accepted operators and calls are defined in `src/parser.ts`; their native implementations
live in `native/expressions.go`. This is a portable expression contract rather than proof of
complete ECMAScript equivalence. Expanding it requires browser/native differential tests for
value coercion, Unicode strings, missing values, short-circuit evaluation and event ordering.
Compilation must reject a construction when its semantics cannot be preserved.

The portable conversion rules include `String`, `Number`, addition and relational
operators over supported scalars, dense arrays and ordinary data records. Arrays use
their comma-separated primitive projection; ordinary records use the standard
`valueOf`/`toString` order for each conversion hint. Non-callable own properties shadow
those methods and can make conversion fail with a TypeError. Native callable overrides,
custom prototypes, boxed values and `Symbol.toPrimitive` require explicit adapters.
Array coercion is bounded and rejects cycles rather than recursing without limit.
Optional property/index access preserves one continuous chain, evaluating its base
once and skipping computed keys and subsequent accesses only at a nullish optional
step. For example, `null?.child.value` produces `undefined`, while
`(null?.child).value` fails. False, zero and empty strings remain ordinary values;
reads of missing own properties on Boolean and number primitives produce `undefined`.
Parentheses end the chain, while erased TypeScript non-null assertions do not.
Optional calls and inherited callable properties still require an explicit native
callable/prototype contract.
Known inherited prototype properties cannot be read as a fabricated `undefined` value;
reading them requires a prototype adapter. Ordinary absent data properties still yield
`undefined`. Prototype-mutating `__proto__` literals receive a source diagnostic.
Object initializer values retain their source evaluation order, including integer-like
keys. Duplicate literal keys require a diagnostic until ordered overwrite semantics are
represented in the intermediate form; their earlier expressions must never disappear.

Callback names bound to state, constants or shadowing list/event/updater parameters do not
authorize host actions. Calls to shadowed `String`, `Number` or `Boolean` require an explicit
native adapter. A component-local constant may call the host translator `t`; a module-level
constant may not, because its initialization lifecycle is not implemented. HTML `form` nodes
are rejected during Go generation until native submit and implicit submit behavior are defined.
Named handlers used under a `map` that shadows a component or module binding are conservatively
rejected until lexical captures are qualified. Inline handlers retain their list-local bindings;
named handlers outside those shadows remain supported.
Lexical bindings named `undefined` and asynchronous `map` callbacks are rejected explicitly.
Ordinary components cannot receive nested child nodes without a native children/slot contract;
scalar props named `children` retain their ordinary prop value, and explicit adapters keep
their declared native child behavior.

Keyed list identities preserve native objects and component state when supported rows reorder.
Removing a row prunes its state; reinserting it mounts a fresh instance. Keys are scoped to
their source list, validated for duplicates before children render, and encoded without
collisions from Unicode or path characters. A key change replaces the native object even
when its explicit HTML ID stays the same. Mixed string/number keys or a key type change across
renders are rejected until Preact's coercing identity rules have a complete native contract.
The native reconciliation follows the pinned Preact sibling insertion order for the supported
single-root rows. Focus follows the actual DOM movement in the Chromium profile: moving a
focused subtree clears focus, while inserting or moving another sibling can preserve it.
Programmatic activation and pointer taps have separate focus behavior and must be compared
using the same gesture in both runtimes. General fragment and multi-root movement need
additional virtual-node metadata before receiving this contract.

Conditional branches with one compatible root preserve the same source position when both
roots have the same component type or a matching fixed element structure. Component props can
change while its hooks, native objects and focus remain mounted. Ambiguous fragment roots,
changing child structure and dynamic nested sibling matching require a broader virtual-node
reconciliation contract and produce diagnostics.
Type-changing conditional roots that could reuse another unkeyed sibling also produce a
diagnostic; Preact can transfer that sibling's instance into the changed position. Keyed
component rows must resolve to one physical element root through component aliases in every
branch. Returning a fragment, list or empty root requires virtual group metadata.
Each direct array keeps its own source group, including when multiple arrays share a DOM
parent. Nested arrays require a physical containing element until hierarchical virtual groups
are implemented. Unkeyed callbacks that change their virtual row type produce diagnostics.
JSX `&&` evaluates its left operand once. Boolean conditions leave an empty false slot; a
Boolean hook requires a Boolean initializer and Boolean results from every reachable setter.
Unknown values keep JavaScript's falsy child value, such as the rendered number `0`.

The programmatic compiler API supports explicit package adapters. CLI entries expose source,
output, named exports, public directories, fonts, measurements and visual profiles. Adapters
must preserve a component's
behavior and styling contract; recognizing a component name alone does not establish parity.

## Stage 01 visual contract

Source-only layouts are useful for functional prototypes. The built-in utility mapping uses
its own fixed spacing and typography profile, including a 14px `rem`; it is not a general
Tailwind implementation. CSS inside Astro files or imported stylesheets requires browser
measurements. A measured profile uses the browser's actual rectangles and computed styles.

### Responsive source layout

The opt-in responsive mode is a native implementation of a restricted, single-line
[CSS Flexbox layout](https://www.w3.org/TR/css-flexbox-1/). It is activated by literal
inline `display: "flex"` on a single root; the existing utility classes retain their
prototype layout contract. Browser capture is used to verify the implementation, rather
than to supply its positions.

The root must have `width: "100%"`, an explicit pixel height and
`boxSizing: "border-box"`. Containers with children must themselves use
`display: "flex"`; supported leaves are empty containers, plain text, buttons,
single-line text inputs and bitmap images. Every flex item must
declare a nonnegative pixel `flexBasis`, `minWidth: 0`, `minHeight: 0` and
`boxSizing: "border-box"`. `flexGrow` defaults to 0 and `flexShrink` to 1; explicit zero
factors remain zero. Sizes and spacing use numbers or `px`, not the prototype mapper's
14px `rem` assumption. A dimension of zero remains distinct from an omitted dimension.

Supported main axes are `row` and `column`, with one equal `gap` between items.
`justifyContent` accepts `flex-start`, `flex-end`, `center`, `space-between`,
`space-around` and `space-evenly`. `alignItems` and `alignSelf` accept `flex-start`,
`flex-end`, `center` and `stretch`; `alignSelf: "auto"` inherits the container's setting.
Stretch applies only to an unspecified cross dimension. A `100%` child dimension is
supported only on the cross axis, against a definite parent size.

Growth with a total factor below one consumes only that proportion of the available
space. Shrinkage weights each factor by the inner flex base size; items freeze at
their padding/border floor and remaining space is recalculated. Layout keeps source
order and updates existing native objects on resize. Runtime validation checks the
expanded tree, including component and list results, before it lays out the frame.

Text and control leaves require a definite cross size or stretch, `margin: 0`, an explicit
font family, weight 400/700, normal/italic style, positive pixel font size and line height,
color, text alignment and `whiteSpace: "nowrap"`. Numeric Preact `lineHeight` is a multiplier
of the explicit pixel `fontSize`; a `px` string is an absolute line height. Unquoted family
identifiers follow the [CSS Fonts family-name rules](https://www.w3.org/TR/css-fonts-4/#font-family-prop).
Controls additionally require `type="button"` or `type="text"`, `appearance: "none"`,
explicit padding, border width/style/color, radius and background. These declarations replace
browser control defaults with a supported source style. The native text backend must parse
the matching font and diagnose unavailable glyphs through `TextValidator`.

This text contract currently covers a single line that fits its content box. Horizontal input
scrolling, overflowing labels and wrapping require additional native layout/paint behavior.
Input control characters, multiline editors and links are outside this responsive profile.
Glyph coverage, matching font bytes and matching box geometry do not establish text raster
equivalence. Focus outlines, caret/selection paint, shaping and antialiasing still require
their own exact pixel profiles.

Bitmap leaves require `display: "block"`, explicit positive pixel dimensions, `margin: 0`
and zero padding, border and radius. The responsive bitmap corpus uses the source PNG at its
natural 16×16 size and scale 1; it does not certify image interpolation at another size or scale.

This mode does not implement text or control intrinsic sizes, automatic/content/percentage
bases, automatic minima, nonzero margins, wrapping, reverse directions, `order`, baseline alignment,
min/max constraints, the CSS cascade, external stylesheets or arbitrary percentage sizing.
Unsupported declarations or tree shapes fail explicitly. Measured profiles keep their
existing exact-viewport restriction.

Active borders require an explicit `borderStyle: "solid"`, `borderWidth` and
`borderColor`. Source border widths currently use whole CSS pixels; binding a canvas
must also make each width a whole number of device pixels. Fractional used border
widths require the CSS device-pixel snapping implementation before they can be accepted.

The responsive corpus compares a rectangular layout through 224 → 368 → 512 → 368 → 224
logical pixels at scale 1, then 224 pixels at scale 2, with a fixed height of 640 pixels.
It includes distribution, growth, shrinkage, nested axes and cross alignment. Native
geometry is checked against Chromium with a declared 1/64 CSS-pixel bound; every image
comparison retains the zero-difference RGBA policy. Each native frame is also exported and
rendered through the inverse pipeline for another zero-difference comparison. These
selected integer-edge cases do not establish general subpixel rasterization or platform
renderer equivalence.

The responsive controls corpus adds 22 retained frames at widths 224, 368 and 512 pixels,
with real pointer gestures, typing on the existing focus, blur/Enter commits, disabled
controls and object identity checks. Geometry and behavior comparisons are required. Chromium's
actual font response and the native embedded resource must have the same SHA-256 digest.
Its text PNGs are compared at zero tolerance as explicitly uncertified diagnostics: differences
remain `accepted: false` and `pixelPerfectVerified: false`; CI success for the supported box/event
contract is not certification of those pixels. The software-canvas harness invokes the focused
control for typing and explicitly dispatches blur after the final background hit test.

Five additional bitmap viewports (224 → 368 → 512 → 368 → 224, height 96, scale 1) require
zero-difference forward and inverse RGBA comparisons. Inverse pages are generated from each
already laid out native scene, rebuilt in Astro and checked in Chromium. These image scenes
remain frozen exports rather than an inferred responsive web program.

| Feature              | Current boundary                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geometry             | CSS pixel dimensions; viewport coordinates for roots; parent border-box coordinates for children                                                                                      |
| Layout               | Recorded positions for one viewport and state; source-only row/column layouts within the supported style subset                                                                       |
| Paint                | Supported solid colors, uniform borders and uniform radii; the backend and zero-difference gate decide actual equivalence                                                             |
| Opacity              | Measured group opacity must be 1; translucent colors require correct composition from the backend                                                                                     |
| Typography           | Explicit loaded browser fonts and corresponding native resources; supported text alignment, line height and whitespace                                                                |
| Stacking and effects | Capture rejects non-default stacking, transforms, shadows, gradients, filters, masks and pseudo content                                                                               |
| Overflow             | Capture rejects content extending outside its measured box; scrolling and clipping need explicit future support                                                                       |
| Resources            | Embedded local PNG RGB/RGBA8 and supported JPEG, without color/orientation metadata; SVG, media, iframe, canvas, remote images, srcset and Shadow DOM require further native adapters |
| Themes               | The capture currently requests light color scheme; dark and system-theme switching need separate scenarios and implementation                                                         |
| Scale                | Capture records device scale 1 or 2; each native profile must enforce and verify its corresponding scale                                                                              |
| Platforms            | A pass in the pinned test renderer does not certify desktop GPU rendering, other operating systems or mobile devices                                                                  |

Each capture carries a `sourceHash`, a state label, viewport dimensions, scale, DOM hash,
screenshot hash and root custom-property tokens. The generator checks the source digest and
the supported measurement schema; when the entry declares a `profile`, it also requires the
state label, viewport and scale to match that configured profile. The runtime rejects
incomplete or extra node measurements,
viewport stretching and changes to a measured visual tree. The state label is scenario
metadata; it does not establish that the correct application state was reached. Scenario
assertions and the final image comparison establish that correspondence.

PNG source and scene assets validate chunk order and CRCs, the complete bounded zlib stream,
scanline lengths and filters, including Adam7 passes. RGB8 `tRNS` samples require canonical
0..255 values until decoder masking behavior is certified across both renderers. JPEG input
receives structural and metadata inspection in the compiler and complete decoding in Go.

Measured nodes also retain a typed signature of their evaluated source attributes, including
classes and inline styles. A change to those values invalidates the frozen profile even when
it does not change a native text or geometry field. Attributes are evaluated once during each
render; computing the signature must not cause an extra host callback. This guard reports a
missing profile, rather than supplying runtime CSS layout for arbitrary new states.

`sourceHash` covers the compiler's recorded source dependency list, including embedded asset
digests. It is not a signature of a running server or proof that an arbitrary URL serves
those sources and asset bytes.
CI must build the selected revision, serve that build, prepare deterministic state and keep
the resulting capture evidence. If a page declares `data-fyne-source-hash` or
`data-fyne-state`, capture also checks those values against its arguments.

## Conformance evidence

A passing profile retains its source digest, environment versions, application data, interaction
scenario, viewport, scale, color scheme and font files. It also retains `measurements.json`,
`web.png`, `native.png`, `diff.png` and the comparison JSON. The default comparison requires
zero differences in all four color channels; no implicit antialiasing tolerance is applied.
The comparison contract uses up to 8-bit channels and rejects 16-bit PNG input, including
changes that would disappear if their channels were reduced to 8 bits.
The PNG CLI also rejects animation, color profiles and unrecognized interpretation chunks;
it validates the entire chunk stream, including CRCs and trailing bytes.

The initial examples exercise state/input behavior and solid geometry at 320 × 240 pixels,
scale 1. A behavioral corpus drives the same click sequence in Preact/Chromium and generated Go.
The differential gate compares texts, mount/unmount results and callback observations;
passing it covers that declared scenario only. Its browser and native JSON traces are CI artifacts.
The tests include a negative visual check that changes one channel of one pixel
and requires the comparator to fail. A release should report which scenarios actually passed
in CI and which remain untested, rather than applying a general fidelity badge to generated
code. Failed or missing comparisons leave a profile uncertified.

A separate primitive scenario compares 46 text fields across four real component states
and eight observation frames in Chromium and generated Go. Its event callbacks also
compare object initializer evaluation order. Its optional access cases require skipped
keys to remain uncalled and preserve the order of evaluated keys and single base calls.
An optional-access updater advances nullable object state through all four states;
compiled Go/JavaScript negative cases also check that parentheses and nonoptional
nullish intermediates fail. These checks establish behavior rather than font
pixel parity. The scale 2 geometry scenario captures the actual 320 × 240 logical canvas
as 640 × 480 pixels in both renderers and checks the same zero-difference policy. It
also verifies that a scale 1 canvas cannot validate or export a scale 2 profile. This
scenario contains solid rectangles; bitmap resampling and text at scale 2 remain untested.

## Reverse native scene contract

`native/reverse.Export` reads supported real Fyne objects after layout and emits schema 1.
`webui.View.Snapshot` exports its reconciled tree without reevaluating its builder or executing
callbacks. Unsupported objects, invalid geometry, duplicate identities, stale measured
profiles and missing action bindings produce errors. The scene contains viewport and scale,
parent-relative border-box coordinates, resolved styles, native control values, theme tokens,
explicit action IDs and embedded PNG/JPEG bytes with SHA-256 digests.

The export also preserves the canvas paint behind the object tree. If no visible, opaque,
unrounded and borderless solid rectangle in the tree covers the entire viewport, the host
must supply `Options.CanvasBackground` with its actual background color, or
`color.Transparent` for a transparent canvas. This requirement applies even without
`Options.Canvas`: Fyne's public canvas interface does not reveal transparency. The asserted
paint becomes a viewport-sized background node behind the exported root; it is never inferred
from the current theme.

The web emitter validates the complete scene before generating literal JSX and scoped CSS.
It escapes scene strings, rejects unsupported style values and verifies bitmap bytes, MIME
types and dimensions. Text controls use browser input/textarea elements and local state;
button callbacks and field events require an explicit client action implementation.
Native Go functions, server behavior, custom renderers, dynamic Fyne layouts and an application's
full state machine require additional source or host contracts. A frozen export describes one
rendered state. Export success alone does not prove behavior or pixel equality.

The opt-in schema 2 export preserves validated responsive source Flexbox metadata from
`webui.View` snapshots. Resolved reference boxes stay separate from source declarations,
including dimension presence and explicit zero growth/shrink factors. It requires a single
visible responsive View at the viewport origin and size, with opaque square borderless root
coverage. Arbitrary native layout algorithms and canvas composition remain unsupported in
this mode. Default exports keep the schema 1 frozen contract.

Both scene versions can generate native Go directly through `to-fyne --scene`, including
interactive scenes that generate a web island outside the forward parser's source subset.
Named callbacks, bitmap bytes and declared fonts remain explicit. Schema 1 reconstruction
uses authored fixed geometry with local editing, fixed node structure, viewport and scale;
it does not weaken browser measurement freshness. Schema 2 reconstruction uses the responsive
native layout engine. Native scene import rejects unsupported multiline and placeholder paint.
Static schema 2 TSX can also pass through the existing source compiler without measurements.
Scene round trips preserve the exported state and declared events; they do not recover
arbitrary Go/JavaScript function bodies or the original application's state machine.

Raw native entries currently require a borderless host theme; Fyne's centered asymmetric
input chrome needs a layered paint contract. Native textarea export is rejected until shared
hard-line and soft-wrap behavior is defined. Focus, caret and selection are outside the scene
contract, so exporting an actively focused canvas fails. Single-line control strings that
the browser would normalize, unsupported text formatting and unsupported paint effects also
fail explicitly.

The reverse geometry scenario starts from real native rectangles and a bitmap, builds the
generated Astro page and compares the browser capture against the original native image.
It then lowers that generated Preact source back into a measured native widget and compares
the round-trip image. Both comparisons use the same zero-difference policy as forward conversion.

## Roadmap toward broad compatibility

The following are engineering stages, not implemented features or delivery dates.

1. **Behavioral semantics.** Extend the differential corpus to nested components, keyed lists,
   batched updates, closures, controlled inputs, refs, context, effects, cleanup and unmounts.
   Separate JSX child rendering from JavaScript conversion rules and preserve ECMAScript
   strings, missing values, coercion and short-circuit evaluation. A Go lowering must implement
   these rules explicitly. For arbitrary JavaScript and third-party Preact libraries, evaluate
   an embedded ECMAScript engine with a Preact host renderer as a separate architecture decision;
   it would add a scripting runtime and platform bridges. A syntax parser alone cannot supply
   general JavaScript execution semantics.
2. **Styles and responsive layout.** Build a versioned CSS cascade and formatting-box model:
   selectors, inherited values, custom properties, units, flexbox, grid, inline formatting,
   intrinsic sizing, wrapping, clipping, scroll containers, positioning and stacking. Continue
   using browser captures as an oracle while adding runtime layout for changing data and window
   sizes. Captured coordinates for a finite collection of states cannot represent arbitrary
   future content or a continuously resized window.
3. **Text and painting.** Define a reproducible font and rendering profile: shaping, fallback,
   ligatures, bidi, grapheme clusters, line breaking, baselines, subpixel origins, alpha
   composition, gradients, shadows and antialiasing. Extend the native backend or maintain
   clearly scoped Fyne forks where its painter or driver prevents the required behavior.
   Matching a font filename, an advance width or a bounding box is insufficient evidence of
   pixel equality.
4. **Interaction and accessibility.** Preserve event phases, focus order, keyboard handling,
   hover/pressed/disabled states, selection, composition, shortcuts, gestures, drag/drop and
   accessibility roles, names and state. Native controls need desktop and mobile IME tests,
   including composition and selection across Unicode text. Compare observable event traces
   as well as images.
5. **Resources and platform APIs.** Add versioned native contracts for routing, history,
   asynchronous effects, timers, fetch, sockets, persistence, clipboard, file access, image
   decoding, SVG, canvas and media. Document permission, cancellation and lifecycle behavior.
   Astro SSR and server-only code remain separate execution concerns: supply their results
   through props or define an explicit server integration.
6. **Release conformance.** Expand reproducible scenarios across light/dark/system themes,
   window sizes, scales, locales, resource loads, desktop backends and real mobile devices.
   Keep failure artifacts, enforce the requested zero-difference policy, and reject unsupported
   features until their behavior and rendering have a passing scenario. Publish a versioned
   capability matrix and extraction/build checks for the independent distribution.

These stages imply a substantial platform compatibility layer. The generated output remains
a native Go interface, with interactive Fyne objects and explicit host boundaries. Each design
decision about a scripting engine, CSS implementation or Fyne fork must state how that native
contract is maintained and how its new capabilities are tested.

## Primary references

The architecture follows the distinction between source parsing, runtime behavior, formatting
boxes and native painting described by their upstream implementations:

- [Astro compiler](https://github.com/withastro/compiler): source AST and server-runtime concerns.
- [Preact hooks](https://preactjs.com/guide/v10/hooks/): state, context, effects and lifecycle behavior.
- [CSS Display specification](https://www.w3.org/TR/css-display-3/): formatting box generation.
- [Fyne custom widgets](https://docs.fyne.io/extend/custom-widget/): stateful widgets and native renderers.
- [QuickJS](https://bellard.org/quickjs/): an example ECMAScript engine to evaluate, not a current dependency.
- [Web Platform Tests](https://web-platform-tests.org/): a model for versioned platform conformance.
