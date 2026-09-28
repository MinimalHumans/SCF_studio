<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0009 — Story-structure beats that span scenes

| | |
|---|---|
| **Status** | **declined** — handled as a Scriptyard export rule; see Resolution |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | Spec §5 (a third span kind); `schema/entity_registry.py`; `scf-core/src/structure.ts`; scf-app `structureCommit.ts` section classification; possibly Q04, Q10 |

## The problem

**SCF has four beat entities and none of them can span scenes.**

| Entity | Scope |
|---|---|
| `story_beat` | Within one scene (`scene_id`, `beat_order`). Shots attach to it (`shot.story_beat_id`). The structure design record's shoot outline: *BEAT A · The family realizes they're trapped*, under sc 42. |
| `performance_beat` | A dialogue moment within a scene. |
| `emotional_beat` | The audience's journey, keyed to a scene or a sequence. |
| `staging_beat` | Blocking. |

The beat most writers mean first is none of these. It is the
**story-structure beat**: "Catalyst", "Midpoint", "All is lost" — a
named stretch of the story, usually several scenes long, between the
scale of a sequence and the scale of a scene.

**This has actually bitten, twice.**

1. Scriptyard's Beat backdrop can contain Scene backdrops. Mapped to
   `story_beat` it would need one `scene_id`, and picking the first
   scene misstates it. Worse, it collides with in-scene beats: shots
   would be offered a "beat" that is really a third of an act.
2. Scriptyard's Fountain export writes a structural beat as a `###`
   section. scf-app's `classifySection` reads any section that says
   neither ACT nor SEQUENCE and is deeper than `#` **as a sequence**. So
   a Scriptyard file opened in scf-app turns every structural beat into a
   sequence at the first commit, silently.

## The proposal

**A third span kind**, alongside acts and sequences, defined by §5 on the
same terms: it begins at a scene and runs until the next one of its kind
begins.

`structure_beat` — tier 0:

| Field | Type | |
|---|---|---|
| `start_scene_id` | reference → scene | The only stored fact (§5.1). |
| `beat_number` | integer | Authored, governed by `numbering_policy` like act and sequence numbers (§4.3). |
| `beat_type` | text | e.g. "catalyst", "midpoint". Text rather than a closed set, because every structure method names its beats differently. |
| `description` | textarea | |
| `notes` | textarea | |

**Spec changes:**

- §5 generalises "acts and sequences" to "span kinds", listing three.
- §5.3's independence rule covers the new kind: structural beats are
  independent of acts and sequences, not nested in them.
- §5.5's half-placed findings apply unchanged.

**Editor convention:** `classifySection` reads BEAT in a section's text
as a structural beat, as it already reads ACT and SEQUENCE.

## What it breaks

- **This is the largest change in this set.** `structure.ts` derives two
  span kinds today, and every consumer of `deriveStructure` — the rail,
  numbering, Q04's lineage, Q10's spine if it reports structure — has to
  decide whether it shows the third.
- **§5.2's contiguity applies.** A structural beat runs until the next
  one begins, so a writer cannot leave a gap between beats. Methods like
  Save the Cat do tile the whole story, so this usually matches. But a
  Scriptyard board with beats covering scenes 3–5 and 9–11, and nothing
  between, cannot be expressed: scenes 6–8 would join the first beat.
- Q04's published lineage gains a member if structural beats are part of
  it.

## Alternatives

**Map structural beats to sequences.** Zero schema change, and it is what
scf-app would do by accident today. But it erases a distinction writers
make deliberately: a sequence is a unit of story, a structural beat is a
landmark in a structure method. The two overlap without nesting.

**Make `story_beat` a span.** Breaks its in-scene meaning, and
`shot.story_beat_id` with it.

**Nested spans** (beats inside acts, sub-beats inside beats). §5.3
deliberately rejected nesting for acts and sequences. A third kind should
not reopen that alone.

**Do nothing.** Structural beats survive only as section lines, which
scf-app then misclassifies.

## Unresolved

- **Sub-beats.** Scriptyard nests Beat backdrops. Spans are flat. Is a
  sub-beat a fourth kind, a section line with no entity, or not
  expressible?
- **Gaps.** Is contiguity right for beats, or do they need an explicit
  end — breaking the "only the start is stored" rule for this kind alone?
- **Name.** `structure_beat`, `plot_point`, or something else that cannot
  be confused with `story_beat`?
- **Which queries report it?** Q04's lineage and Q10's spine are the
  obvious candidates.

---

## Resolution

**Declined.** SCF gains no third span kind, and `story_beat` keeps its
in-scene meaning.

The reasoning is a boundary this proposal had wrong. Scriptyard is an
**outline for writing a screenplay**, not an authoring surface for SCF.
Its value is a head start: structure and entities that map cleanly are
carried across, and everything else is handed to the writer as prose
they can work with. "Beat" is used and misused in enough ways that
forcing it into a queryable entity would encode one reading of a word
the format is better off not adjudicating.

**The export rule instead:** an outline item with no SCF equivalent is
written into the screenplay as an action line —

    BEAT: Meeting the Mentor

— and listed in the export report. Nothing is omitted, nothing is
invented, and the author sees it where they are already working. This
is a Scriptyard rule, not a format rule, and it applies to any awkward
mapping rather than to beats alone (see 0016).

**What remains open, and is not this proposal's business:**
`classifySection` still reads any `###` section that names neither ACT
nor SEQUENCE as a sequence. No Scriptyard file will contain one under
the export rule above, but a hand-written Fountain file might. If that
ever matters, it is an editor issue.
