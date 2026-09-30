<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0004 — `status` is a writing stage; only `lifecycle_status` cuts

| | |
|---|---|
| **Status** | **implemented** — spec 0.53 |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | Spec §6.6; `schema/entity_registry.py` (`scene`, `act`, `sequence`); `registry.json`, `entity-reference.md`; `docs/conventions.md` ("A scene cut from the screenplay") |

## The problem

**Three entities can be cut in two different columns, and the
specification only honours one of them.**

`scene`, `act` and `sequence` each carry two select fields:

```
status            outline | draft | revised | locked | cut        (default outline)
lifecycle_status  active | draft | superseded | deprecated | cut | archived
```

§6.6.1 is precise about the second: **a resolver MUST exclude rows whose
`lifecycle_status` is `cut`.** §6.6 never mentions `status` at all. So a
scene whose `status` is `cut` and whose `lifecycle_status` is `active` is
in the film to every conforming resolver — it keeps its story position,
its act, its cast in Q04, its place in Q10's spine.

An author who opens the scene form, finds a field whose value can be
`cut`, and sets it, has done the obvious thing and been silently
ignored. Nothing reports it, because §6.6.1 gives nothing a reason to
look.

The intent was always that the two are different axes. `act.status`
carries the help text *"Writing-process status. Distinct from
lifecycle_status."* — but `scene.status` and `sequence.status` carry no
help text, and a writing-process axis that includes `cut` is not
distinct from the one that decides what is in the film. `cut` is not a
stage of writing a scene; it is a claim about the film, which is the
distinction §6.6 draws when it explains why `cut` alone of the six
lifecycle values is excluded from resolution.

**No published artifact can distinguish the readings.** Every one of
the fixture's 22 rows across the three tables has `status = outline`.
The fixture's one cut scene is cut through `lifecycle_status`. An
implementation that treats `status = cut` as cut and one that ignores
it produce identical output on all sixteen results.

**Nothing in `scf-core` reads `status`** (checked). It is authored and
displayed, and never interpreted.

**This has actually bitten.** Scriptyard carries one Status per card and
backdrop — Active, Draft, Cut — and mapping it to SCF meant choosing a
column. The schema offers two plausible ones, and the spec only makes
one of them work.

## The proposal

1. **Remove `cut` from `status`** on `scene`, `act` and `sequence`. The
   vocabulary becomes `outline | draft | revised | locked`.
2. **Give `scene.status` and `sequence.status` the help text `act.status`
   already has**, so the three read identically in the entity reference.
3. **Add to §6.6**, after "Only `cut` is excluded from resolution":

   > `scene`, `act` and `sequence` also carry `status`, a **writing
   > stage** — how far the author has taken the row, from `outline` to
   > `locked`. It makes no claim about whether the row is in the film and
   > MUST NOT affect resolution. A row leaves the film through
   > `lifecycle_status = cut` and in no other way.

4. **`docs/conventions.md`**: the note on a scene cut from the
   screenplay lists `status` as "(outline / draft / revised / locked /
   cut)" and says marking a scene cut "stays the author's own act".
   Update it to say the author's act is `lifecycle_status = cut`.

## What it breaks

- **Any file with `status = 'cut'`.** None exists in the repository. Under
  §11.0 such files are disposable; after 1.0 this would be the removal of
  a vocabulary member, which §11.1 does not permit, so it is cheaper now
  than it will ever be again.
- **Editors that offer `cut` in the status picker**, including scf-app's
  generated entity form. The option disappears from the registry, so a
  form generated from it follows automatically.
- **Generated artifacts**: `registry.json`, `entity-reference.md`, and
  whatever the manifest covers of them. `scf-schema.sql` should be
  unchanged — the column is `TEXT` with no `CHECK` — but that is to be
  confirmed by regeneration, not assumed.
- **Schema version** moves (a vocabulary change is non-cosmetic), and
  the spec takes a minor bump for the §6.6 paragraph.
- **No published result moves.** Q15 projects `status: "outline"` for
  scene 12; that value survives.

## Alternatives

**Do nothing.** Leaves two cuts, one of which does nothing. Every
writer that maps an external "cut" has to know which column the spec
meant, and nothing tells it.

**Make `status = cut` also exclude.** A resolver checks both columns.
This is two stored facts for one truth (§3.1), and they can disagree —
a row `status = cut`, `lifecycle_status = active` would need a rule for
which wins, and whichever rule is chosen, the other column becomes
decorative in the disagreeing case.

**Keep both, and raise a finding when `status = cut` and
`lifecycle_status` is not.** Honest about the ambiguity but doesn't
remove it: every such file becomes noisy, and the finding's advice would
be "set the other column", i.e. this proposal applied by hand, per row.

**Drop `status` entirely.** Loses a real authored axis. Where a scene
stands in the writing process is information a production uses, and
it is not derivable.

**Rename it `writing_stage`.** Clearer, and would make the reading in
this proposal self-evident from the column name. More churn for the
same effect; listed under Unresolved rather than proposed.

## Unresolved

- **`draft` appears on both axes.** `status = draft` (a writing stage)
  and `lifecycle_status = draft` ("in the film, and not settled") are
  close enough that an author will reasonably conflate them. Neither
  changes resolution, so the harm is confusion rather than a wrong
  answer. Is it worth renaming one of them while the vocabulary is
  already moving?
- **Should `status` be renamed `writing_stage`** at the same time? Pre-1.0
  a rename costs the same as the vocabulary change.
- **The specification has no rule for a select value outside its
  vocabulary.** After this change a file may still carry `status = 'cut'`.
  §1.3.1 answers this for `line_type` specifically (treat as unknown
  content, MUST NOT guess a synonym); nothing answers it for registry
  selects in general. That is a wider question than this proposal and
  probably deserves its own — but it is the question a reader of this
  change will ask first.
