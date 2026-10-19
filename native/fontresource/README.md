<!-- SPDX-License-Identifier: Apache-2.0 -->

# Static font validation

`fontresource.Validate(data, weight, style)` checks embedded single-face TrueType
bytes against the declared weight and style. It retains the catalogue's table
bounds, ordering, overlap, checksum and native font parse, and adds explicit
metric and index guards. Variable fonts, color glyphs, CFF and collections require
a different adapter. Validation does not modify the supplied bytes.

Explicit guards check the header magic and units, glyph/metric counts, horizontal
metric storage and both `loca` formats. Decoded locations must be nondecreasing
and stay within `glyf`; equal locations represent valid empty glyphs. Checksums
are verified before these guards, and the native font parse remains required.

The pinned parser may ignore some optional `loca`/`glyf` parse errors. Index bounds
do not validate contours, composite references/cycles, instructions or glyph
coverage. This is not a complete outline validator.

## Nominal coverage

`NewStaticFace(data, weight, style)` accepts 1..20 MiB, weight 400/700 and style
`normal`/`italic`, then applies the static font validation above. It looks up
every Unicode scalar through the pinned parser's selected `NominalGlyph` mapping.
Glyph zero is missing; any nonzero mapping outside the declared glyph count is
diagnosed. Surrogates are excluded. A mapped glyph may have an empty outline.

The immutable `StaticFace` provides `Contains(rune)` and `ValidateText(string)`.
Text must be valid UTF-8 and every scalar must have a covered nominal glyph.
`Profile()` returns independent ranges with inclusive `start`/`end` endpoints,
schema 1, the exact font SHA-256, weight/style and the binary's declared parser
dependency identity. This profile requires the original
`github.com/go-text/typesetting@v0.3.4` dependency. Missing metadata, replacements
and other versions require an explicit adapter. Build metadata is not source
attestation for modified or vendored dependencies.

The build-contract test checks admission in the original dependency build and
rejection in deliberately replaced builds. Positive coverage fixtures require
the original qualified dependency.

A profile is output metadata; there is no profile import API, and changing a
copy cannot change a face's private coverage.
Nil and zero faces have no coverage, reject text validation and return a zero
profile. A constructed face with no covered scalars still accepts empty text.

The API retains no parsed font or caller-owned bytes. It does not perform
substitution, variation-selector matching, shaping, browser font loading or
runtime admission. Nominal coverage does not certify outline or raster parity.

Callers of `Validate` must first validate their descriptor domain. The catalogue admits weight
400 or 700 and style `normal` or `italic`; it also owns family aliases, resource
paths, SHA-256 digests, explicit license notices and resource/archive limits.
These metadata requirements remain in `native/catalog`.

The package depends on the existing pinned Go text parser and does not import
the catalogue or JavaScript runtime. A future JavaScript font envelope can reuse
the same byte validation without an import cycle. The package does not add
an envelope, automatic CSS `@font-face` imports, glyph fallback or pixel parity.

Tests use the existing public Noto Sans regular/bold fixtures and their
[SIL Open Font License](../../example/public/fonts/LICENSE-NotoSans.txt).
