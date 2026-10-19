<!-- SPDX-License-Identifier: Apache-2.0 -->

# CSS in both directions

Automatic source `@keyframes` for a bounded height-only block-flow profile are
described in [CSS height animations](css-height-animations.md), including clocks,
checkpoint restoration and the remaining fractional geometry limit. General
animation effects and automatic arbitrary `@font-face` imports remain outside
that profile; fonts use explicit validated resource metadata.

CSS is part of the Astro/Preact ↔ Fyne conversion contract. A successful
conversion must preserve supported styling behavior, including changes after
interaction. Unsupported rules must produce a diagnostic. Full CSS support and
universal pixel parity remain unfinished.

The current routes preserve different information:

| Route                                           | CSS handling                                                                                                                                                           | Current boundary                                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Declarative Astro/Preact → Fyne                 | Lowers supported literal styles and responsive flex properties into native layout and painting.                                                                        | General imported or Astro styles require a captured browser profile. A fixed profile does not implement a live cascade.                        |
| JavaScript source → Fyne                        | Compiles supported local stylesheets into the native JavaScript DOM/cascade adapter. DOM and component state changes reevaluate selectors, variables and declarations. | Media queries, general layout, pointer/focus selectors, nesting, fonts and CSS URL resources need further adapters.                            |
| Generated JavaScript Fyne → Astro/Preact → Fyne | Retains compiled stylesheet behavior, original local CSS sources, component state and event history in the saved program archive.                                      | Older archives contain only compiled behavior. Retained source files do not add unsupported CSS or automatically replace the compiled program. |
| Exported Fyne scene → Astro/Preact              | Emits CSS, native theme tokens and supported node styles. Responsive scenes retain their source layout values.                                                         | A resolved native scene cannot infer the original selectors, breakpoints or variable bindings without retained source information.             |

The JavaScript cascade currently supports type, class, ID and attribute selectors;
descendant, child and sibling combinators; `:is()`, `:where()`, `:not()` and `:has()`;
the documented structural and checked/disabled states; flat cascade layers;
specificity, declaration order and `!important`; custom properties and declared
inheritance. See [the runtime contract](javascript-runtime.md) for the exact
value and control limits. These features do not establish native layout or
pixel equivalence for every declaration accepted by a browser.

`:has()` evaluates its relative selectors from the element being styled. It
supports descendant, child (`>`), adjacent sibling (`+`) and following sibling
(`~`) relationships, including lists and chains of those relationships. Rules
are reevaluated after DOM, class, attribute and supported control state changes.
For example, `.card:has(> input:checked)` can change a card's supported styles
when its checkbox changes, and `.card:has(+ .selected)` can style the card before
a selected sibling. This does not add checkbox painting or a general layout
engine.

The specificity of `:has()` uses its most specific argument, including arguments
that do not match. `:where()` still contributes zero specificity. Nested
`:has()`, pseudo-elements and unsupported selectors produce diagnostics,
including inside `:is()`, `:not()` or `:where()`. CSS nesting remains a separate
unsupported feature. The matching rules follow
[Selectors Level 4](https://www.w3.org/TR/selectors-4/#relational).

Supported resolved custom properties on the single responsive root remain
inline declarations in the exported page and values in the regenerated Fyne
theme's `CSS(name)` map. Theme installation and passing `Tokens` to a subsequent
scene export remain explicit host operations. This does not add `var()` painting,
dynamic token scopes or automatic application-wide theme changes.

Use a local stylesheet with the [CLI](cli.md):

```sh
astro-fyne to-fyne src/App.tsx --stylesheet src/app.css
```

New JavaScript programs retain the exact UTF-8 contents of local stylesheets,
including recursive imports, comments, letter case, line endings and a UTF-8
byte order mark. Both CLI directions write `App.css-sources.json`, which maps
the original paths to files in `App.css-sources/`. Source paths are metadata;
they never select an output location. The file names contain the content hash,
and regeneration preserves handwritten edits by refusing to overwrite them.

The retained CSS is a source copy. The generated widget and web wrapper continue
to execute the compiled stylesheet adapter; they do not import the copy a second
time. To change stylesheet behavior, edit the stylesheet in the original project
and regenerate the JavaScript program. Legacy archives without CSS source data
still restore their compiled behavior, but cannot recover missing original text.
Invalid UTF-8 input produces a diagnostic instead of changing source bytes.

For the inverse direction, export the native program with `ExportJavascript()`
and pass its JSON archive to `astro-fyne to-web App.program.json`. The CLI
detects the archive type. The explicit `to-web --javascript --program` form
also remains available. To export a
handwritten Fyne view, use the scene route. The
[JavaScript continuation guide](javascript-runtime.md#continue-in-astro-and-return-to-go)
and [scene export guide](../README.md#convert-fyne-to-astro--preact) describe the complete
commands and host bindings.

Validation must distinguish stylesheet syntax, cascade values, native layout,
interactive behavior and rendered pixels. The hosted JavaScript CSS scenario
compares native values with computed styles from the original browser source,
then continues the program through the reverse route. These value checks are
separate from the image gates, which retain zero RGBA tolerance. Passing one
check does not imply the others pass.

Future CSS coverage must carry enough source information to preserve selectors,
cascade origins, variables, conditions, resources and state-dependent rules on
export. Flattening those rules into one captured frame is insufficient for
bidirectional migration.
