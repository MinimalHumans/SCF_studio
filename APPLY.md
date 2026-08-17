# Schema 2.11 / spec 0.18 — `numbering_policy`

Apply after `scf-fixture-screenplay.zip`.

```sh
cd scf-core && npm test && npx tsc --noEmit
cd ../scf-app && npm test && npx tsc --noEmit && npm run build
cd .. && python3 schema/lint_registry.py
python3 schema/generate_registry_json.py --check
python3 schema/artifact_manifest.py --check
cd scf-core && npm run check-schema-sql && npm run check-finding-catalog \
  && npm run check-negative
```

Verified here:

- `scf-core`: 30 files, **512 passed**, 6 skipped (was 502)
- `scf-app`: 22 files, 249 passed, 1 skipped
- typecheck, build, lint, five `--check` modes, checksums — clean

---

## The name

**`project.numbering_policy`**, values unchanged (`derived` | `fixed`).

I considered `numbering_mode`, `numbering`, and `number_lock`. `policy`
won because it reads correctly in the sentence that matters —
*"numbering_policy: fixed"* is a statement about how the project is
governed, not about a state it happens to be in — and because it makes
room for a third value later (per-reel numbering, say) without the name
becoming wrong a second time.

I left the values alone. Your language was "lock the numbering", and
`locked` is more evocative than `fixed`, but renaming values means
migrating data in every existing file for a readability gain. `fixed`
is accurate and it's already in the wild.

## And a correction: this did not have to be a break

I told you a rename was non-additive and had to happen "before 1.0 or
never". **That was wrong.** §11.4 already defines a deprecation window,
and a rename fits it exactly:

| Schema | State |
|---|---|
| ≤ 2.10 | `scene_numbering` only |
| **2.11** | Both columns. `numbering_policy` is authoritative. |
| 2.12 | `scene_numbering` removed |

So the change is **additive and no file needs converting**. Every project
written before 2.11 keeps working: a reader prefers the new column and
falls back to the old.

New spec **§4.3.1** states that precedence, and one more rule that
matters: **while `scene_numbering` exists, a writer MUST mirror the
policy into it.**

That's a deliberate exception to §3.1's rule against storing a derivable
value twice, and the spec says why rather than leaving it to be
discovered. Without the mirror, a reader that knows only the old column
sees a stale `derived` on a project someone just locked — and renumbers
a shot list that is already on paper. It is the one failure this field
exists to prevent, so it gets the one exception.

The mirroring is on a timer and the timer is tested:
`numbering.test.ts` asserts both columns exist in 2.11, so when 2.12
removes one the test fails and points straight at the mirroring that
should go with it.

## Where the logic lives

`scf-core/src/numbering.ts` — `numberingPolicyOf(row)`,
`numberingPolicy(exec)`, `setNumberingPolicy(exec, policy)`.

`structureCommit`'s `numberingMode` / `setNumberingMode` now delegate to
it rather than reading the column. That matters more than it looks: the
precedence rule existing in two places is precisely how the two would
drift, and the app is where the renumbering actually happens.

Resolution is total, per §9.2 — no project table, no row, an
unrecognised value, all resolve to `derived`. That's also the safe
direction to fail in: it never silently freezes numbering that should be
tracking, and a project that wanted `fixed` will say so again.

## The fixture

Migrated in place: `numbering_policy` added, populated from
`scene_numbering`, both now `fixed`. Re-stamped 2.11 / `user_version`
2011, vacuumed, both copies byte-identical.

Tests that were reading the column directly now read through the
resolver — including the round-trip test, which is the one that would
have gone quietly wrong when 2.12 lands.

## What re-blessed

`shapes.json` only, and only to gain the new column. All eight blessed
markdown expectations still reproduce byte for byte.

---

## Where things stand

Everything from the audit's fix list is now done: the finding catalog is
published, the negative fixtures are reproducible, §7 describes the
cascade that exists, and the fixture's three orders differ.

`stability.md` still has seven Unstable rows, but they've changed
character — the top two are now **the query layer** and **removing
`scene_numbering` in 2.12**. The first is the last large piece of
specification work; the second is a scheduled deletion with a test
already waiting for it.

Next, unless you'd rather do something else: **checklist rev 7**, then
the query layer.
