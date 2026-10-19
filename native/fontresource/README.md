<!-- SPDX-License-Identifier: Apache-2.0 -->

# Static font validation

`fontresource.Validate(data, weight, style)` checks embedded single-face TrueType
bytes against the declared weight and style. It preserves the catalogue's table
bounds, ordering, overlap, checksum and native font parse, including
its diagnostics. Variable fonts, color glyphs, CFF and collections require a
different adapter. Validation does not modify the supplied bytes.

The pinned parser rejects malformed required tables but may ignore errors in
optional `loca`/`glyf` outline tables. Validation does not certify every outline
or glyph coverage. The extraction preserves this existing limitation.

Callers must first validate their descriptor domain. The catalogue admits weight
400 or 700 and style `normal` or `italic`; it also owns family aliases, resource
paths, SHA-256 digests, explicit license notices and resource/archive limits.
These metadata requirements remain in `native/catalog`.

The package depends on the existing pinned Go text parser and does not import
the catalogue or JavaScript runtime. A future JavaScript font envelope can reuse
the same byte validation without an import cycle. This extraction does not add
an envelope, automatic CSS `@font-face` imports, glyph fallback or pixel parity.

Tests use the existing public Noto Sans regular/bold fixtures and their
[SIL Open Font License](../../example/public/fonts/LICENSE-NotoSans.txt).
