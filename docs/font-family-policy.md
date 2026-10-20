<!-- SPDX-License-Identifier: Apache-2.0 -->

# Unicode font-family policy

`src/font-family.ts` provides deterministic Unicode17 alias validation and two
different comparison keys. It uses pinned Unicode data in browser and compiler
code, without relying on the JavaScript engine's casing or Unicode property
tables.

```ts
import {
  FONT_FAMILY_UNICODE_VERSION,
  validFontResourceFamily,
  simpleFontFamilyKey,
  cssFontFamilyKey,
} from "./font-family.ts";

FONT_FAMILY_UNICODE_VERSION; // "17.0.0"
validFontResourceFamily("Σans_١"); // true
simpleFontFamilyKey("Σ") === simpleFontFamilyKey("ς"); // true
simpleFontFamilyKey("ß") === simpleFontFamilyKey("ss"); // false
cssFontFamilyKey("ß") === cssFontFamilyKey("ss"); // true
```

## Alias grammar

A family contains 1..80 Unicode scalars. Its first scalar must be a Unicode letter
(`L`). Later scalars may be letters, marks (`M`), decimal digits (`Nd`), ASCII
spaces, underscores or hyphens. An outer ASCII space and every lone UTF-16
surrogate are rejected. Other spaces, controls, commas, quotes and escapes are
outside this grammar. Marks and astral characters count as scalars, independently
of UTF-16 length or grapheme clusters.

These functions accept a decoded alias, rather than CSS syntax such as a quoted
family or fallback list. `validFontResourceFamily` returns false for invalid input;
both key functions throw an error. Keys are comparison values: full folding may
expand an 80-scalar input beyond 80 scalars.

The grammar matches the native font-resource requirement rule when Go uses
Unicode17.0.0. The Go standard library's Unicode version is a separate toolchain
property. A future version must be checked and qualified explicitly; a change of
version is not silently treated as compatible.

## Two comparison rules

`simpleFontFamilyKey` applies the Unicode `C` and `S` mappings. Its equality
relation matches Go `strings.EqualFold` with Unicode17 data. `cssFontFamilyKey`
applies `C` and `F`, as required for CSS default caseless family matching. Neither
function normalizes text or applies Turkic mappings or locale-specific tailoring.
See the primary [Go documentation](https://go.dev/pkg/strings/#EqualFold),
[Unicode case-fold data](https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt)
and [CSS Fonts matching rule](https://www.w3.org/TR/css-fonts-4/#localized-name-matching).

| Names                         | Simple key equal | CSS key equal |
| ----------------------------- | ---------------- | ------------- |
| `Σ`, `σ`, `ς`                 | yes              | yes           |
| `S`, `ſ`                      | yes              | yes           |
| `K`, `K`                      | yes              | yes           |
| `I`, `ı`                      | no               | no            |
| `İ`, `i`                      | no               | no            |
| `İ`, `i` followed by `U+0307` | no               | yes           |
| `ß`, `ẞ`                      | yes              | yes           |
| `ß`, `ss`                     | no               | yes           |
| `é`, `e` followed by `U+0301` | no               | no            |

Simple folding also equates `U+0390` with `U+1FD3`, `U+03B0` with `U+1FE3`, and
`U+FB05` with `U+FB06`. Single-scalar upper/lower casing misses all three pairs:
each member has a multi-scalar uppercase expansion and lowercases to itself.
Using Unicode normalization to repair this would incorrectly merge other names.

Consequently, a family collection can pass Go duplicate checks and still contain
CSS collisions. `Straße` and `STRASSE` are one example. CSS generation rejects
these distinct native aliases in the same CSS namespace, even when their bytes
or weight/style slots differ. Identical declarations shared by independent
components remain valid; conflicting hashes for one CSS slot are rejected.

## Manifests, catalogues and source islands

Font manifests and catalogue validation use the grammar above and native simple
equality. Use one exact spelling across every weight and style of a native alias
class. Resource names preserve the previous ASCII hash inputs. A wholly ASCII
manifest keeps its existing ordering; a manifest containing Unicode uses one
deterministic scalar comparator for the entire collection.

The CLI resolves source-font islands automatically:

```sh
astro-fyne to-fyne src/App.astro --fonts fonts.json --out native/generated --name App
astro-fyne to-web checkpoint.catalogue.json --out src/components/app --name App
```

Generated CSS is UTF-8. The host Astro document must declare UTF-8, for example
with `<meta charset="utf-8">` in the layout's `<head>`. Component emitters leave
that document head to the host layout.

With a declared `Straße` family, authored `font-family: STRASSE` resolves to the
canonical CSS string `"Straße"` in native and generated web frames. Dynamic inline
styles, inherited styles and CSS variables pass through the same final snapshot
resolver. The source DOM style, original stylesheet text/hash and checkpoint
journal stay intact. Canonical names are embedded in the compiled factory and
therefore affect its code hash. Factories that include Unicode comparison data
also retain its complete Unicode-3.0 license notice, hash and protected source
path. A warm checkpoint carries that resolver back to
Fyne without adding host calls or replaying effects.

`src/font-family-css.ts` also exposes `parseCSSFontFamily`,
`createCSSFontFamilyResolver` and `validateCSSFontNamespace`. The parser accepts
one quoted family or unescaped CSS identifier sequence. Unquoted ASCII CSS
whitespace collapses between identifiers; quoted spaces are significant. An
unquoted generic or CSS-wide keyword never resolves to a declared quoted alias.
Keyword recognition is ASCII-insensitive, independently of Unicode family
matching. See [CSS family syntax](https://www.w3.org/TR/css-fonts-4/#family-name-syntax)
and [custom identifiers](https://www.w3.org/TR/css-values-4/#custom-idents).

Lists, CSS escapes, generic functions and names outside the bounded resource
grammar require additional adapters and produce diagnostics. Cleared inline
families keep the existing empty-style behavior. Unknown valid names are left
to the existing native style/resource checks. The older responsive emitter and
capture adapter still have narrower family parsing rules; this integration does
not expand those profiles.

The resolver does not change native `EqualFold` semantics or implement a private
alias scheme for colliding families. It does not enable the stricter native
resource-factory ABI or a verified browser `FontFace` resource pool. These
functions do not load fonts, inspect glyph coverage or establish shaping,
fallback absence or pixel equivalence.

## Data and regeneration

The implementation shares 1,481 common mappings, with 31 simple overrides and 104
full overrides. Common mappings are stored as 88 arithmetic runs and 111 single
entries. Category tables contain 684 letter ranges, 327 mark ranges and 72 decimal
digit ranges. They come from the original Unicode17 `CaseFolding.txt` and
`UnicodeData.txt` retained in `third_party/unicode17`.

The data keeps its Unicode-3.0 license; the utility and generator are Apache-2.0.
[Provenance](../third_party/unicode17/provenance.json) records primary source URLs,
exact SHA-256 hashes, generator hash, generated-file hash and policy options.
The generator uses only the Python standard library and local pinned inputs.
The hosted gate checks that regeneration preserves both generated outputs.

```sh
python3 third_party/unicode17/generate.py
python3 third_party/unicode17/generate.py --check
```

Regeneration checks the raw input hashes before writing either generated output.
It does not download files. A Unicode update requires reviewing new inputs,
updating pins and expected counts, regenerating and running hosted conformance.

## Hosted verification

The source-font roundtrip gate runs separate ASCII and Unicode profiles. The
Unicode profile declares `SourceStraße`, retains authored CSS `SOURCESTRASSE`,
and alternates inline `SOURCESTRASSE`/`sourceſtraße` after real clicks. A program
attribute exposes the chosen authored alias; native snapshots and exported
frames retain the exact quoted canonical CSS string. Managed browser computed
styles are observed separately. The same warm checkpoint moves from native
count 1 to browser count 2 and returned native count 3, preserving source CSS,
font bytes, licenses and host history. A separate original Astro JSON-props case
is native-only. These checks establish the observed loaded-font behavior rather
than font-origin, fallback-free or pixel equivalence.

The seven Bun tests include explicit failure cases and independent parsing of
the original data files. They compare leading and continuation grammar for
every code point, and exact simple/full keys for every admitted continuation
scalar. They also check license/source pins and generated provenance.

`ci/unicode-font-family.ts` runs the hosted cross-reference gate. It copies
`ci/unicode-font-family.go.txt` into a generated native package, replaces
`PROBE_PACKAGE`, formats it remotely, and compiles and executes its race-enabled
test binary. The fixture:

1. Requires the actual Go `unicode.Version` to be 17.0.0.
2. Checks the actual exported native requirement validator twice for every
   Unicode scalar, comparing leading and continuation admission with standard
   library categories. This includes 2,224,128 native grammar checks.
3. Separates 1,482 raw `unicode.SimpleFold` orbits into 1,440 admitted alias orbits
   and 42 rejected orbits. Circled letters and Roman numerals participate in Go
   folding but are outside the alias grammar. Every orbit member is individually
   checked before a native error can be interpreted as duplicate rejection.
4. Checks 6,084 raw Go EqualFold pairs and 5,916 admitted native duplicate pairs.
   Explicit unequal examples check dotless-I, expansion and normalization
   boundaries. It retains Go/Unicode versions, counts, ranges and all three orbit
   inventories.

The producer runs the same pure checker in a bounded Bun subprocess and in
actual Playwright Chromium. The browser bundle imports the utility being
qualified. Both engines compare every code point's leading/continuation grammar,
exact normative simple/full keys for 148,988 admitted continuation scalars, and
simple-key equivalence classes in both directions. This detects false merges as
well as missed aliases. The original normative `C`/`F` data provides the separate
CSS oracle; the Go reference does not claim full CSS folding.

Results under `artifacts/unicode-font-family` include literal source inputs,
normative data and license, standard-library Unicode sources/version/license,
native module locks before and after, exact phase commands/logs, the real ARM64
race executable, BuildInfo and test2json trace. Browser evidence includes its
actual bundle, observed response hashes, result counts and version, and unchanged
before/after process/binary provenance sidecars. Effective font policy is not
observed. The harness uses a loopback HTTP server and closes its browser and
server on failure.

The Go test has a 180-second limit, the Bun comparison subprocess a 180-second
limit, and the Chromium comparison a 180-second limit. The two exhaustive Bun
unit tests have separate 120-second limits. Enumeration counters and bounded
mismatch diagnostics are retained; individual native scalar assertion states are
not separate snapshots. Source or passing counts alone do not attest a compiler
binary's source or establish rendering equivalence.
