# Repair — the missing half of `scf-audit2-fixes.zip`

Unzip over the repo root. **Eight files. Nothing else changes.**

```sh
cd scf-core && npm test && npx tsc --noEmit
cd ../scf-app && npm test && npm run build
cd .. && python3 schema/artifact_manifest.py --check
sha256sum -c spec/SHA256SUMS
```

---

## What happened

`scf-audit2-fixes.zip` was never applied. Every zip after it was.

So `canonicalQueries.ts` is at its newest — importing `referencesOf`
from `queryResult.ts` — while `queryResult.ts` is still the version from
before that fix, 150 lines, without it. Vite resolves the import at load
time, finds nothing, and the app never mounts.

I checked which zips landed rather than guessing, by looking for one
marker from each:

| Marker | Expected in | Present on main |
|---|---|---|
| `referencesOf` in `queryResult.ts` | audit2-fixes | **no** |
| `anchorName` in `mediaReferences.ts` | audit2-fixes | **no** |
| `anchor_assets` in `resolution.ts` | audit2-fixes | **no** |
| `sqlite_%` in `emit_schema_sql.mjs` | audit2-fixes | **no** |
| `emit_normative_data.mjs` | normative-data | yes |
| `junction-keys.json` | normative-data | yes |
| `referencesOf` in `canonicalQueries.ts` | q00/q11/q15 | yes |

One zip, cleanly skipped.

## Two more consequences you had not seen yet

The white screen is the loud one. There were two quiet ones:

**`sha256sum -c spec/SHA256SUMS` currently fails on main.**
`spec/scf-schema.sql` is the old copy while the published manifest
carries the hash of the corrected one. Anyone verifying your published
artifacts today would get a checksum mismatch — and that is the artifact
whose whole purpose is to be verifiable.

**The published DDL still cannot be loaded.** It still carries
`CREATE TABLE sqlite_sequence(name,seq)`, which SQLite rejects. That is
the defect the second reader hit at negative-fixture case one of eleven.

**And the anchor bug is still live in the editor.** Without
`mediaReferences.ts` and `resolution.ts`, Q13 still reports the anchor
row instead of the asset it anchors, so the app's media list still shows
`Eleanor face anchor — (no identifier)` and still omits
`eleanor_turnaround_v3.png`.

## Why this zip is not just the old one re-sent

`scf-audit2-fixes.zip` also contained `canonicalQueries.ts`, the spec
documents, the expectations and `SHA256SUMS` — all of which **later
zips replaced with newer versions**. Unzipping it now would roll those
back and break the tree in a different way.

So this carries only the files no later zip touched, at their current
content:

```
scf-core/src/queryResult.ts          the missing exports
scf-core/src/resolution.ts           anchor_assets
scf-core/src/mediaReferences.ts      the anchor fix
scf-core/scripts/emit_schema_sql.mjs excludes sqlite_%
scf-core/test/mediaReferences.test.ts
spec/scf-schema.sql                  regenerated, loads cleanly
fixtures/expectations/Q13.expected.md stale rendering
fixtures/expectations/shapes.json     stale shape
```

The last two were not obvious: the app's blessed Q13 markdown still
showed the wrong anchor, so `scf-app`'s suite failed two tests until
they came along too.

## I verified this against your actual tree

Rather than assuming, I fetched `main`, applied only this zip on top,
and ran everything:

- `scf-core` **592 passed**, 6 skipped
- `scf-app` **249 passed**, 1 skipped
- both typecheck clean, production build clean
- registry, schema SQL, finding catalog, negative fixtures and normative
  data all `--check` clean
- `sha256sum -c spec/SHA256SUMS` — **all 25 match**

That is the full CI sequence, green, from your current commit plus these
eight files.

## Worth noting

CI would have caught this the moment it was pushed — the `core` job
typechecks, and the `artifacts` job verifies the checksums that are
currently failing. The workflow shipped in `scf-ci.zip`; if it is on
main and not running, the repository's Actions may need enabling.
