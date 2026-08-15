# Checklist section 0 — the four documents

Unzip over the repo root. Nothing is deleted; `docs/conventions.md` and
`README.md` are replaced.

```
spec/scf-spec.md      NEW   the normative specification, 0.9 draft
spec/stability.md     NEW   tier per area, current as of schema 2.8
spec/conformance.md   NEW   roles and what claiming support means
docs/conventions.md   REPLACED  now the design record; states no rules
README.md             REPLACED  directory table + §8 pointer
```

**Diff `docs/conventions.md` before committing.** §1–§9 are rewritten;
§10 (Open questions and Resolved) is spliced in byte-for-byte from your
current file except for two edits, both marked below.

---

## 1. Scope statement

It is §0 of the spec, not a separate file. What it commits you to:

- **§0.3** — the unit of interchange is the `.scf`, per your answer. A
  lone `.scf` is a complete SCF document; the folder is the editor's
  workflow and is described as such. This has one consequence worth
  seeing: it forced a fifth resolution state into the normative text.
  `unaddressed` already exists in `assets.ts` but was missing from
  `conventions.md`'s four-state table, and once the file is the unit of
  interchange, "opened with no root supplied" stops being an edge case
  and becomes the *default* posture of any consumer that isn't your
  editor. §8.3 now requires it be distinguished from `missing`.
- **§0.4** — version/snapshot outside 1.0, worded as "may never enter
  it", with conforming readers required to ignore the tables. Layers,
  merge, packaging, editor behaviour and metadata query listed with it.
- **§0.6** — three independent version numbers: spec `0.9`, schema
  `2.8`, implementation. The spec declares which schema version it
  describes.
- **§0.7** — a glossary. Small, and the highest-leverage thing in the
  document for anyone reading it cold.

## 2. The split

`spec/scf-spec.md` states rules. `docs/conventions.md` explains them and
states none — every rule reference in it is now `spec §N`.

The discipline is written into both documents (spec preamble;
conventions §8, "The rule that keeps this document honest") because a
split that isn't enforced closes again within a few rounds.

What moved where, in practice:

- **Rules → spec.** Ordering, position patterns, span derivation,
  identity, the cascade, identifier grammar, resolution states, the
  derive-don't-store list.
- **Reasons stayed.** The 356-candidate prop failure, the hidden
  `nameField` incident, the crossing-sequence renderer bug, the
  locked-down Windows enumeration finding, why `shot_number` is the
  exception, why duplicates are findings rather than constraints.
- **Newly written, not moved.** Spec §1 (physical format), §2
  (registry as normative), §9 (findings as a model), §10
  (extensibility), §11 (versioning). None of these existed as prose
  anywhere — they were facts about the code with no document.

Two edits to §10, both flagged in the diff:

- **"A real spec"** rewritten to "in progress", pointing at the three
  new documents, with the residual — canonical query expectations as
  data — kept as the live part.
- **"Filtering on `lifecycle_status`"** upgraded from open question to
  1.0 blocker, with the reason: a spec that says "do what you like"
  means every consumer answers the canonical queries differently and all
  of them conform.

## 3. Stability tiers

Five tiers: Stable / Provisional / Unstable / Reserved / Out of scope.
Every normative area has a row, with its spec section, tier, whether
it's implemented, and a note.

The distinction that does the work is **Stable vs Provisional**. Stable
means "will not change incompatibly before 2.0". Provisional means "I
believe this is right, and no second implementation has ever tested it."
Most of the asset layer is Provisional for that reason alone — it's
correct as far as anyone knows, and "as far as anyone knows" is one
implementation.

The document ends with the seven Unstable rows in dependency order.
Two are worth pulling out here:

**Resolution state names are the cheapest fix and I'd do it first.**
`conventions.md` documented four states spelled `unmaterialized`;
`assets.ts` defines five spelled `unmaterialised`. The spec now states
five with the code's spelling, but that's me picking — a state name is a
wire value that appears in query output and exports, so pick
deliberately rather than inheriting my choice.

**Enumerated finding types block the validator.** Findings today come
out of `identity.ts`, `relationships.ts`, `junctions.ts`, `structure.ts`,
`assetIndex.ts` and `resolution.ts` with no shared codes, no severities
and no serialised form. `scf-check` can't be specified until they have
a vocabulary, so this gates most of `conformance.md`.

## 4. Conformance targets

Three roles, each a superset: **Reader** (opens and answers), **Writer**
(round-trips without loss), **Editor** (maintains derived state across
edits). Assets are optional for Reader, which is what lets a production
tracker claim something real without implementing your resolver.

The document is deliberately full of "not yet specifiable" markers
rather than plausible-sounding text. Four things it says plainly:

- **There is no round-trip test.** This is the largest hole. §10.1 of
  the spec requires that unknown tables and columns survive a
  read-modify-write, and nothing verifies it. It's also the single most
  likely place a Writer claim fails in practice.
- **There is no validator.** Most of the logic exists as library code;
  what's missing is a CLI and a stable output format.
- **There are no negative fixtures.** Hollow Creek contains authored
  absences and no authored errors, so nothing pins what an
  implementation should say when a file is wrong.
- **Nobody can currently claim conformance meaningfully**, and §6 says
  so rather than inventing a process.

§7 states what the two existing implementations claim and on what basis,
including that there is no second implementation and therefore every
rule is only guaranteed implementable the way it was already
implemented.

---

## Follow-up not in this zip

**Inbound references.** About a dozen places say "see conventions.md"
meaning "see the rules" — `schema/README.md`, `scf-app/README.md`,
`fixtures/build/README.md`, `readiness.ts`, `resolution.ts`, and roughly
eight `help_text` strings in `entity_registry.py`. They now point at a
document that no longer states rules. Most should become `spec §N`. I
left them alone because retargeting registry help text means
regenerating and bumping, which shouldn't ride along with a docs commit.

**Spec changelog.** §11.5 requires one and there isn't a file for it.
`spec/CHANGELOG.md` starting at 0.9 would close that.

**Doc licensing.** Checklist §8 — code under Apache-2.0 is done, but the
spec and design record are still under it too. CC BY 4.0 for `spec/` and
`docs/` is the usual pairing, and it's what lets someone quote the spec
in their own documentation. Worth deciding before anyone reads it.

**Appendix A is partial.** The spec's conformance test map lists 13
pinned sections. Everything in §1, §2, §10 and §11 is unpinned, which is
consistent with those being the newly written parts.
