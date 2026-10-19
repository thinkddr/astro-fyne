<!-- SPDX-License-Identifier: Apache-2.0 -->

# Native nominal font admission

`fontbackend.New` constructs an optional backend for static, single-line native
text. It uses `fontresource.StaticFace` and `webui.LegacyTextValidator` to reject
missing faces or nominal glyphs before a legacy or Goja View commits its tree.
The default Fyne backend remains unchanged.

```go
backend, err := fontbackend.New(map[string]map[webui.Font]fyne.Resource{
    "Host": {{Weight: 400}: regularResource, {Weight: 700}: boldResource},
})
if err != nil {
    return err
}
view := webui.NewView(build, backend)
```

Supply licensed static TrueType resources. The constructor accepts 1–16 face
bindings, at most 20 MiB each and 128 MiB in total. Repeated bindings count
separately toward that budget. Each binding reads its input resource's
`Content()` exactly once; caller resource names are not read. Families start
with a Unicode letter, contain at most 80 letters, digits, combining marks,
ASCII spaces, underscores or hyphens, and have no outer whitespace. Aliases
that compare equal with Go's `strings.EqualFold` are rejected, including Unicode
case-fold collisions. Catalogue aliases retain their existing narrower rules.

Bytes, maps and descriptors are privately frozen. Coverage and native paint use
the same bytes. Equal digests share one stable, comparable private painter
resource; its `Content()` returns independent copies. `Profiles()` returns
copied family/coverage metadata in family, weight and style order. Imported
profiles cannot construct or change a backend.

Reuse one constructed backend across Views on Fyne's event goroutine. The
pinned Fyne renderer caches custom fonts by resource identity, so constructing
another backend creates another set of cache identities. Deduplication and
budgets apply to each construction; this package provides no global cache pool
or cache-release guarantee. Metadata and nominal checks only read owned state.

The text profile requires:

- A static `text`, `label`, `button` or `link` text field with explicit `nowrap`.
- One registered family, optionally enclosed in one matching quote pair, with
  no escapes or fallback stack. Matching uses `strings.EqualFold`.
- Exact weight 400/700 and normal/italic face bytes. Weight zero selects 400
  and an empty style selects normal, matching the existing Fyne lookup. The
  default standalone button weight 600 is diagnosed, never remapped.
- A font size in `(0, 256]` pixels and line height in `(0, 1024]` pixels.
- Valid UTF-8 with nominal coverage, no controls or line separators, and no
  leading, trailing or repeated ASCII spaces. NBSP remains literal.

Empty text still requires a matching face. The constructor also requires `H`
and SPACE because native baseline and metric probes use them independently of
the displayed text. Input, textarea and other field roles are diagnosed even
when empty, hidden or disabled; editor admission needs a separate prospective
edit adapter. Responsive typography requires its own qualified adapter.

`Validate` and `ValidateLegacyText` return diagnostics. Direct `Text`, `Measure`
and `PlaceText` calls panic with a diagnostic when their text contract is
invalid, since their backend interfaces cannot return errors. Mutating returned
canvas objects outside the View transaction is outside this admission contract.

A measurement request rejected by the existing `Backend.Validate` style
preflight leaves the previous valid profile and snapshot available. A text
rejection from `LegacyTextValidator` records the View's admission error and
blocks snapshots and export until a successful refresh. These are separate
existing transaction boundaries; the adapter does not change them.

Existing catalogue factories can pass `input.Backend.Fonts` to the constructor
and reuse the resulting backend across their instances. The catalogue retains
resource licenses, aliases, exact CSS and checkpoints. This is an explicit host
binding that must be reapplied after restoring a catalogue; no schema, automatic
CLI opt-in or browser font admission is added here.

The parser build must satisfy `StaticFace`'s declared dependency policy. Replaced,
unidentified or unsupported parser builds are rejected. CI exercises original
API positives and an explicit constructor-rejection contract under its local
parser replacement, with separate retained results and no conditional skips.

These checks establish nominal coverage and owned resource identity. They do
not validate every outline, GSUB/GPOS result, cluster, shaping operation or
raster output. The Fyne renderer may still substitute replacement glyphs or
use fallback during shaping. CSS layout and pixel equivalence need separate
evidence; no fallback-free rendering or universal conversion is claimed.

Tests use the repository's public Noto Sans regular/bold fixtures and their
existing SIL Open Font License. Repaired cmap fixtures are derived in memory
from those public bytes; no private font assets are bundled.
