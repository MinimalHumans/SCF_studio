# scf-spec-0.29 — apply notes

Drop-in over `SCF_studio@main`, verified against `b06ddaa` ("CI fixes",
2026-08-21). Seven files, all modified — nothing added, nothing deleted.

Spec **0.28 → 0.29**. Minor per §11.5: MUSTs added, none removed or
changed in meaning. Schema stays **2.12** — no registry change, so no
regeneration and no artifact churn.

---

## What is in it

| File | |
|---|---|
| `spec/scf-spec.md` | §12.1.2 rewritten; §12.1.3 moved; §12.1.4–12.1.6 new; §12.5, §12.8, §12.10, §12.11 per-query rules; §9.5's `clean`/`rowIds`/`count`/`title` defined; §4.4.4's two stale MUSTs corrected; version bumped in two places |
| `spec/conformance.md` | §2.2's stale MUST and its wrong section reference; §5.4's self-contradiction and `shapes.json`'s scope |
| `spec/stability.md` | Two stale rows corrected, one duplicate row merged, seven rows added for the new subsections |
| `spec/CHANGELOG.md` | The 0.29 entry |
| `docs/conventions.md` | §8's step ordering corrected; the lockfile rule added |
| `scf-core/package.json` | `"license"`: MIT → Apache-2.0 |
| `scf-core/src/canonicalQueries.ts` | One comment: `Q13Result.trail` said "most specific first"; the spec and the artifact are both broadest-first |

## By hand

1. **`APPLY.md` at the repo root** — still stray, still needs deleting.
   A zip cannot remove a file.
2. **The tag.** Once this is committed:

   ```sh
   git tag -s schema-2.12 -m 'schema 2.12'
   git push origin schema-2.12
   ```

   Do this *after* committing, not before — the tag pins a tree, and you
   want the one whose spec is correct.

## Verified

Applied to a clean clone of `main` and run there:

- `scf-core`: `npm ci` from nothing, `npm test` → 592 passed / 6 skipped
  (32 files), `npm run typecheck` clean.
- `python3 schema/artifact_manifest.py --check` → up to date.
- `python3 schema/lint_registry.py` → clean, 99 entities.

Nothing regenerated, because nothing generated was touched.

## Not done, and why

`fixtures/expectations/shapes.json` is stale — it records the app
runners' flat row with a `<row-ref>` where §12.1 defines
`{ uuid, fields }` with the reference resolved. §5.4 now scopes it as an
internal check a third party should ignore, which is honest but does not
make it current. Re-blessing it is a decision about the runners, not
about the spec, so it is left alone.
