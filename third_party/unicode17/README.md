<!-- SPDX-License-Identifier: Apache-2.0 -->

# Unicode17 data

This directory retains the Unicode17 character and case-fold data used by the
standalone font-family policy. Original data and the derived
`src/font-family-data.ts` use Unicode-3.0. Preserve [LICENSE.txt](LICENSE.txt) with
redistributions. The generator and explanatory documentation use Apache-2.0.

`provenance.json` binds exact original source bytes, primary URLs, generator and
generated output. `generate.py` verifies those source hashes and derives shared
common mappings, separate simple/full overrides and `L`/`M`/`Nd` category ranges.
It uses no network access, external packages, engine case conversion or Unicode
normalization.

Run from the repository root:

```sh
python3 third_party/unicode17/generate.py --check
```

The complete policy and hosted validation design are documented in
[font-family-policy.md](../../docs/font-family-policy.md).
