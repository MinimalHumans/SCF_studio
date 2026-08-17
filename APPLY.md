# Spec 0.19 / schema 2.12 — collapse the window, settle the states

Apply after `scf-numbering-policy.zip`.

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

- `scf-core`: 30 files, **512 passed**, 6 skipped
- `scf-app`: 22 files, 249 passed, 1 skipped
- typecheck, build, lint, five `--check` modes, checksums — clean

---

## 1. The deprecation window is gone

Schema **2.12** removes `project.scene_numbering`, one version after
2.11 renamed it. The mirroring in `setNumberingPolicy` and the fallback
in `numberingPolicyOf` go with it, so the format no longer stores this
fact twice anywhere.

New **§11.0: these rules take effect at 1.0.** Your policy, written into
the spec — before 1.0, files from earlier schema versions are
disposable; `fixtures/hollow_creek.scf` is the one exception because it
is a normative artifact.

I wrote the *reason* into the clause rather than leaving it as
permission, because "we may break things" reads worse than it is: before
1.0 nobody has built on the format, so a deprecation window protects
nothing and leaves two descriptions of one fact. After 1.0 someone has.
§11.4's note now lists all three changes taken under it — 2.8's
removals, 2.9's type widening, and 2.12's.

One test worth knowing about: a stale `scene_numbering` column **cannot
override** the real one. Otherwise removing it would have achieved
nothing the moment someone opened an old file.

## 2. §8.3's resolution states — the audit's item, settled

This is the one I'd have missed. The code reported an **unmapped root**
as `out-of-root`. It is `unaddressed`, and §8.3 *and* §0.3 both said so —
§0.3 states outright that a `.scf` opened with no root mapping is valid
and resolves everything to `unaddressed`.

`out-of-root` now means only what its name says: the identifier points
outside the project **by construction** — absolute, or containing `..`.

The distinction is worth the words:

| | depends on | a user does |
|---|---|---|
| `unaddressed` | the **session** | attach a folder, or give the row an identifier |
| `out-of-root` | the **identifier** | fix it, or accept it will not travel |

Conflating them told a user their paths were broken when the truth was
that they hadn't attached a folder yet — which is the first thing that
happens to everyone. §8.3 gains a table, and the design record gains the
story, because that one took an outside reader to catch.

**And it exposed a lie in a normative artifact.** Q13's blessed summary
read `3 with no identifier` for three assets of which **two had
identifiers** — the renderer's label was tied to the old meaning of
`unaddressed`. It now reads `3 unresolvable`, which is true.

## 3. §0.2 now names the query layer

It lists §12, and says plainly that §12 **is not yet written**: the
queries are part of the format, the normative answer is the result
structure rather than any rendering, and until the section exists a
query's only definition is one blessed example of its output. Named in
the document as the largest known gap in it.

---

## Where this leaves things

`stability.md` is down to **five** Unstable rows, from seven:

1. **The query layer** — the last large piece of specification work.
2. The asset resolution tally flag.
3. `lifecycle_status` filtering — needs a fixture with cut rows, which is
   cheap now.
4. `scene_sequence` shadow rows — survive 1.0, or go.
5. Artifact addressing — one `git tag`.

**Delete by hand:** nothing this round. The stray root `APPLY.md` from
the section-0 session is still there if you haven't removed it.

## What I'd do next

**The query layer**, and I'd start with the smallest possible piece
rather than all sixteen: pick Q05 and Q07, write §12's shape — purpose,
parameters, contributing entities, result structure — and see whether
the shape survives two queries that stress different machinery before
committing to fourteen more.

The alternative worth considering first is **CI**, on its seventh
revision, now twelve commands. It is the only item on the checklist that
gets more expensive every session rather than less: every artifact I add
is another thing that can go stale silently between now and the next
time someone runs the checks by hand.
