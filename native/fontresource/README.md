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

Callers must first validate their descriptor domain. The catalogue admits weight
400 or 700 and style `normal` or `italic`; it also owns family aliases, resource
paths, SHA-256 digests, explicit license notices and resource/archive limits.
These metadata requirements remain in `native/catalog`.

The package depends on the existing pinned Go text parser and does not import
the catalogue or JavaScript runtime. A future JavaScript font envelope can reuse
the same byte validation without an import cycle. The package does not add
an envelope, automatic CSS `@font-face` imports, glyph fallback or pixel parity.

Tests use the existing public Noto Sans regular/bold fixtures and their
[SIL Open Font License](../../example/public/fonts/LICENSE-NotoSans.txt).
