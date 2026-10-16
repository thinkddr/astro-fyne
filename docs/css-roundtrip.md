<!-- SPDX-License-Identifier: Apache-2.0 -->

# CSS in both directions

CSS is part of the Astro/Preact ↔ Fyne conversion contract. A successful
conversion must preserve supported styling behavior, including changes after
interaction. Unsupported rules must produce a diagnostic. Full CSS support and
universal pixel parity remain unfinished.

The current routes preserve different information:

| Route                                           | CSS handling                                                                                                                                                           | Current boundary                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Declarative Astro/Preact → Fyne                 | Lowers supported literal styles and responsive flex properties into native layout and painting.                                                                        | General imported or Astro styles require a captured browser profile. A fixed profile does not implement a live cascade.            |
| JavaScript source → Fyne                        | Compiles supported local stylesheets into the native JavaScript DOM/cascade adapter. DOM and component state changes reevaluate selectors, variables and declarations. | Media queries, general layout, pointer/focus selectors, nesting, fonts and CSS URL resources need further adapters.                |
| Generated JavaScript Fyne → Astro/Preact → Fyne | Retains the compiled stylesheet behavior in the saved program archive and continues it with the component state and event history.                                     | This preserves the supported program; it does not reconstruct the original stylesheet text, comments or source formatting.         |
| Exported Fyne scene → Astro/Preact              | Emits CSS, native theme tokens and supported node styles. Responsive scenes retain their source layout values.                                                         | A resolved native scene cannot infer the original selectors, breakpoints or variable bindings without retained source information. |

The JavaScript cascade currently supports type, class, ID and attribute selectors;
descendant, child and sibling combinators; `:is()`, `:where()` and `:not()`;
the documented structural and checked/disabled states; flat cascade layers;
specificity, declaration order and `!important`; custom properties and declared
inheritance. See [the runtime contract](javascript-runtime.md) for the exact
value and control limits. These features do not establish native layout or
pixel equivalence for every declaration accepted by a browser.

Supported resolved custom properties on the single responsive root remain
inline declarations in the exported page and values in the regenerated Fyne
theme's `CSS(name)` map. Theme installation and passing `Tokens` to a subsequent
scene export remain explicit host operations. This does not add `var()` painting,
dynamic token scopes or automatic application-wide theme changes.

Use a local stylesheet with the existing CLI:

```sh
bun run to-fyne --javascript --source src/App.tsx \
  --stylesheet src/app.css --out native/generated --name App
```

For the inverse direction, export the native program with `ExportJavascript()`
and pass its JSON archive to `to-web --javascript --program`. To export a
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
