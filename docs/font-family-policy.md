<!-- SPDX-License-Identifier: Apache-2.0 -->

# Unicode font-family policy

`src/font-family.ts` provides deterministic Unicode17 alias validation and simple
and full comparison keys. It uses pinned Unicode data in browser and compiler
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

`cssFontFamilyTextKey` compares decoded CSS text separately from resource aliases.
It accepts nonempty, well-formed Unicode text up to 240 scalars. This bound comes
from the 80-scalar native limit and the largest three-scalar C/F expansion in the
pinned data. Case folding never deletes an input scalar, so a longer spelling
cannot equal a supported native alias's full key. The function is comparison
arithmetic; it does not parse CSS syntax or validate a resource declaration.

`simpleFontFamilyTextKey` applies the same decoded-text bounds with the pinned
`C`/`S` mappings. The converter uses it as an additional admission check; it does
not replace the CSS full-fold comparison rule.

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

With a declared `Straße` family, authored `font-family: STRAẞE` resolves to the
canonical CSS string `"Straße"` in native and generated web frames. Conversion
first selects a declared alias by its full-fold key, then requires equal simple
keys and unchanged astral scalars at every position. A changed scalar above
`U+FFFF`, including a Deseret case pair, requires an adapter. Exact astral
spellings remain valid resource aliases. These restrictions are a conservative
conversion profile, not a replacement for CSS's specified comparison rule or
proof of a browser's complete algorithm.

Dynamic inline styles, inherited styles and CSS variables pass through the same
final snapshot resolver. Dynamic code may produce an unsupported value only at
mount or a later update; the CLI cannot statically reject every future branch.
The source DOM style, original stylesheet text/hash and checkpoint journal stay
intact. Canonical names are embedded in the compiled factory and therefore
affect its code hash. Factories that include Unicode comparison data also retain
its complete Unicode-3.0 license notice, hash and protected source path. A warm
checkpoint carries that resolver back to Fyne without replaying effects.
Each exported frame owns its attribute maps. Later DOM updates or edits to another
snapshot preserve the saved checkpoint, including when a font diagnostic rejects
the current state.

`src/font-family-css.ts` also exposes `parseCSSFontFamily`,
`createCSSFontFamilyResolver` and `validateCSSFontNamespace`. The parser accepts
one quoted family or CSS identifier sequence, including CSS escapes. Unquoted ASCII CSS
whitespace collapses between identifier tokens; quoted and escaped spaces are significant. An
unquoted generic or CSS-wide keyword never resolves to a declared quoted alias.
Keyword recognition is ASCII-insensitive, independently of Unicode family
matching. See [CSS family syntax](https://www.w3.org/TR/css-fonts-4/#family-name-syntax)
and [custom identifiers](https://www.w3.org/TR/css-values-4/#custom-idents).

Simple escapes and one-to-six-digit hexadecimal escapes decode before family
matching. A hexadecimal escape consumes one optional whitespace terminator;
CRLF counts as one terminator. Quoted strings also accept escaped line
continuations. These spellings select the declared `EscapedStraße` family:

```css
.first {
  font-family: ESCAPEDSTRA\1e9e E;
}
.second {
  font-family: "EscapedStra\df e";
}
```

The original CSS bytes and authored inline strings remain in the archive. Native
frames use a quoted decoded family, so CSS escapes never become literal native
resource names. Escaped generic keywords retain their keyword meaning. Escaped
CSS-wide keywords require a cascade adapter and produce a diagnostic.

Closed CSS comments are accepted before or after a family and between identifier
tokens. `Host/**/Name` decodes to `Host Name`; `ser/**/if` is the named family
`ser if`, rather than the generic `serif`. Comments also separate escape-bearing
tokens: `\48/**/ost` decodes to `H ost`, while `\48 ost` decodes to `Host`.
Comment contents are consumed through the first `*/`, without nesting. Quotes,
backslashes and newlines inside a comment do not change that boundary. See
[CSS comment consumption](https://www.w3.org/TR/css-syntax-3/#consume-comments).

Comments are recognized outside strings and escaped characters. A quoted name
such as `"Host/*comment*/Name"` retains its literal punctuation and fails the
native alias grammar. Commented named families are serialized as quoted decoded
or canonical names, including a comment beside an exact quoted alias. Commented
generic values become clean keywords. Commented CSS-wide values need a cascade
adapter; unclosed comments need a CSS recovery adapter. Original authored CSS
text remains in the archive.

The resolver accepts a broader authored spelling when it also passes that
admission filter. For example, `U+0345` is a combining mark that simple-folds to
Greek iota. Eighty such marks, or eighty `ι` scalars, can select a declared alias
of eighty `Ι` scalars, although a resource declaration cannot start with a mark.
An 80-scalar alias consisting of `ΐ` and its 240-scalar full-fold spellings still
have equal mathematical C/F keys. Their simple keys differ, so conversion
diagnoses them until a matching adapter is qualified. The same distinction
rejects `STRASSE` for `Straße` and `i` followed by `U+0307` for `İ`. No Unicode
normalization is applied. The exported `parseCSSFontFamily` keeps its existing
bounded resource-parser contract; the resolver uses a separate parser path for
matching. Unknown names still pass the existing resource-profile checks.

Lists, malformed escapes, generic functions and unmatched names outside the bounded
resource grammar require additional adapters and produce diagnostics. Cleared inline
families keep the existing empty-style behavior. Unknown valid names are left
to the existing native style/resource checks. The older responsive emitter and
capture adapter still have narrower family parsing rules; this integration does
not expand those profiles.

The resolver does not change native `EqualFold` semantics or implement a private
alias scheme for colliding families. It does not enable the stricter native
resource-factory ABI or a verified browser `FontFace` resource pool. These
functions do not load fonts, inspect glyph coverage or establish shaping,
fallback absence or pixel equivalence.

## Observed browser boundary

A retained failed hosted probe used Chromium 153.0.8010.12 with declared
`SourceStraße` faces at weights 400 and 700. Canonical queries loaded one face
each with the expected font bytes. Raw `SOURCESTRASSE` queries loaded no faces;
raw `sourceſtraße` queries loaded the same face objects as the canonical queries.
Both names have the same normative C/F key. These observations concern those
queries and that browser build, not all Unicode names or browsers.

The browser reported revision `971a7443b0c9b0a9b2860529b33331b76077ec62`.
At that source revision, [FontFaceSet loading](https://chromium.googlesource.com/chromium/src/+/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/core/css/font_face_set.cc)
uses the [family cache](https://chromium.googlesource.com/chromium/src/+/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/core/css/font_face_cache.h),
whose [comparison trait](https://chromium.googlesource.com/chromium/src/+/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/platform/wtf/text/case_folding_hash.h)
reaches a [string comparison](https://chromium.googlesource.com/chromium/src/+/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/platform/wtf/text/string_view.cc)
that first rejects unequal UTF-16 lengths. This is consistent with the observed
sharp-s expansion difference. It does not attest that the executable was built
from those source bytes, or prove that every comparison equals Go simple
folding. The conversion filter also excludes changed astral scalars rather than
assuming UTF-16 cache behavior is scalar-aware.

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
Unicode profile declares `SourceStraße`, retains authored CSS `SOURCESTRAẞE`,
and alternates inline `SOURCESTRAẞE`/`sourceſtraße` after real clicks. A program
attribute exposes the chosen authored alias; native snapshots and exported
frames retain the exact quoted canonical CSS string. Managed browser computed
styles are observed separately. The same warm checkpoint moves from native
count 1 to browser count 2 and returned native count 3, preserving source CSS,
font bytes, licenses and host history. A separate original Astro JSON-props case
is native-only. These checks establish the observed loaded-font behavior rather
than font-origin, fallback-free or pixel equivalence.

A separate `--unicode-matching` profile declares eighty `Ι` scalars and alternates
eighty `U+0345` marks and eighty `ι` scalars. It keeps the same
native/browser/returned-native checkpoint tests and licensed font bytes. Unicode
browser probes query `document.fonts.load` with each admitted raw authored name
and compare the returned `FontFace` object with the canonical query's object.
Separate negative probes retain the observed outcomes for full-fold-only and
changed-astral names; native constructor cases must diagnose those conversions.
These assertions check selected actual name matches and admission failures, not
font origin, every painted glyph or raster equivalence. The independent C/F
math tests still require the 80-to-240-scalar expansion equality.

The `--css-comments` source-font profile declares `Comment Host` and alternates
`COMMENT/**/HOST` with `/* lead */"Comment Host"/* tail */`. It retains the
original BOM and CRLF stylesheet bytes, licensed font resources and action
history across native count 1, browser count 2 and returned native count 3.
Browser probes pass both authored CSS values directly to `document.fonts.load`
at weights 400 and 700 and compare the actual returned `FontFace` objects with
the canonical queries. Separate source-bundle tests cover comments in inherited
CSS variables and cleared inline styles. These checks retain the same limits
on claims about font origin, glyph coverage and pixel equivalence.

The eleven Bun tests include explicit failure cases and independent parsing of
the original data files. They compare leading and continuation grammar for
every code point, and exact simple/full keys for every admitted continuation
scalar. Separate text-key sweeps check C/S and C/F mappings for all 1,112,064
Unicode scalars, including names outside the resource grammar. The tests also
check license/source pins and generated provenance.

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
limit, and the Chromium comparison a 180-second limit. The four exhaustive Bun
unit tests have separate 120-second limits. Enumeration counters and bounded
mismatch diagnostics are retained; individual native scalar assertion states are
not separate snapshots. Source or passing counts alone do not attest a compiler
binary's source or establish rendering equivalence.
