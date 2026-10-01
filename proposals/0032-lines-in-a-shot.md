<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0032 — Which screenplay lines a shot covers, and line anchors

| | |
|---|---|
| **Status** | **implemented** — spec 0.59, schema 2.19 |
| **Author** | Found writing a video-generation prompt for shot 3B through the SCF MCP; drafted with Claude |
| **Opened** | 2026-10-01 |
| **Affects** | A new §3.5 (line anchors) and §4.7 (lines at a shot); `shot` gains a line range; `clip`'s line references are replaced; `performance_beat.line_ref` is declared an anchor; a registry field marker; four findings; `shotContext`; `spec/scf-mcp-design.md` §4; the fixture |

## The problem

**Nothing says which lines of the screenplay a shot covers.** Writing a
prompt for shot 3B, the dialogue could only be offered as optional: the
file has the scene's lines and the shot's framing, and nothing joins
them.

There is a route, and it runs through footage: `shot` ← `take.shot_id`
← `clip.take_id` → `clip.screenplay_line_start_id` / `_end_id`. A shot's
lines are known once a take of it has been recorded and clipped. This
project's `workflow_mode` is `generation_first`. There is no take until
the shot has been generated, and knowing its lines is what generating it
needs.

**The one link that exists is broken, and nothing noticed.** `clip`
points at its lines by row id. Writing the screenplay deletes and
re-inserts every line (`writeScreenplay`), so row ids do not survive an
edit. In the fixture, today:

- the clip "You came back" points at rows 51–52, which are now a blank
  line and the section marker `## The Thaw`;
- the clip "I came back" points at the heading `EXT. CREEK CROSSING - DAY`.

Both still resolve, to the wrong lines, so no reference is dangling and
nothing reports them. The take they belong to, "12-04 take 3", has an
empty `shot_id`, so even the footage route from 12-04 is broken.

**Line identity already has a working answer, and the spec does not
state it.** A line's uuid survives a revision that diffs before writing.
Prop tags (`screenplay_prop_tags.line_uuid`) and performance beats
(`performance_beat.line_ref`) anchor by it. The editor re-anchors them
through a line split or merge, and an integrity sweep reports the ones
whose line is gone. None of this is in the specification, and the
finding catalog has no code for an orphaned anchor. A second
implementation would have no way to know it should do any of it.

## The proposal

### A. A line anchor (new §3.5)

> **A line anchor names a screenplay line by its uuid.** It is stored as
> text, never as a row id, because a line's row id does not survive the
> screenplay being rewritten and its uuid does (§6.1).
>
> A field that is a line anchor is declared so in the registry
> (`lineAnchor: true`), so that every consumer finds the anchors from the
> registry rather than from a list it keeps. A writer that splits or
> merges a line SHOULD re-anchor every anchor that named it. An anchor
> whose uuid names no line is **orphaned**: kept, and reported.

The existing anchors are declared as such: `performance_beat.line_ref`
and `screenplay_prop_tags.line_uuid`. The second is a screenplay table,
not a registry entity, so it is named in §3.5's text.

### B. A shot's lines (new §4.7)

`shot` gains two line anchors:

| Field | Means |
|---|---|
| `line_start_ref` | The first line the shot covers. |
| `line_end_ref` | The last. Unset means the range is the one line at `line_start_ref`. |

> **A shot covers the lines of its scene from `line_start_ref` to
> `line_end_ref` inclusive, in script order** (§4.1), whole lines only.
>
> **Ranges may overlap, and usually will.** A scene is covered from
> several angles and resolved in editing: a master and two singles of
> the same exchange each cover the same lines, and none of them owns
> them. A range says what a shot is FOR, not where the cut falls. Nothing
> in the format partitions a scene's lines between its shots, and a
> consumer MUST NOT read overlapping ranges as a contradiction.
>
> A shot with no range is **unrecorded**, not empty, as with presence
> (§4.6). Neither a line no shot covers, nor a scene whose shots record
> no ranges at all, is a finding: coverage is planned in any order, and
> an unrecorded shot is not a fault.

### C. `clip` uses line anchors

`clip.screenplay_line_start_id` and `_end_id` are **removed** and
replaced by `line_start_ref` and `line_end_ref`, with §4.7's meaning
(the lines the clip covers, which need not equal its shot's). Pre-1.0
files are disposable (§11.0), and these two references could not be
trusted in any file whose screenplay had ever been rewritten.

### D. Findings

Kept and reported (§9.2), on any entity whose fields the registry marks
as line anchors:

| Finding | Severity | Raised when |
|---|---|---|
| `line.anchor_orphaned` | `warning` | A line anchor names a uuid that is not a line of the screenplay. |
| `line.range_outside_scene` | `warning` | A shot's or a clip's range names a line that is not in its own scene. |
| `line.range_reversed` | `warning` | `line_end_ref` comes before `line_start_ref` in script order. |
| `line.end_without_start` | `warning` | `line_end_ref` is set and `line_start_ref` is not. |

### E. The consumers

- **`shotContext`** gains `lines`: the shot's lines, projected as Q04
  projects the scene's screenplay, or **null when the shot is
  unrecorded**. Unlike presence, an unrecorded shot does not inherit its
  scene's lines: that would hand a three-second insert every line of the
  scene. The scene's whole screenplay is already in `scene`, for a
  consumer that wants it. A prompt for 3B then carries its dialogue from
  the file.
- **The editor's integrity sweep** reads its anchors from the registry
  marker, not from its hand-written list of two.

### F. The fixture

- **Scene 3's shots get ranges, overlapping on purpose:**
  - 3A, the wide master: the whole scene, from "ELEANOR CADE is at the
    sink…" to "She washes the same cup…";
  - 3B, the doorway: "ELEANOR / Shut it behind you." to "It isn't.";
  - 3C, her hands: "Is Ada's room still—" to "Eleanor turns the tap on.";
  - 3D, the door: "She washes the same cup…" alone.

  3A covers every line the others do, and that is the point.
- **The two clips are re-anchored** to the lines their names say: "You
  came back" and "I came back" in scene 12.
- **"12-04 take 3" gets its `shot_id`.** Scene 12 is pinned, but the take
  is not part of what its published results say, and the footage route
  from 12-04 should work in the file that demonstrates it.

## What it breaks

- **Two columns removed from `clip`.** Breaking, and only before 1.0
  (§11.0). A file that used them loses references that were probably
  already wrong.
- **The schema.** New fields on `shot` and `clip`, and the `lineAnchor`
  marker in `registry.json` and `registry.schema.json`: a minor bump.
- **§12.1.2's example of a reference into a screenplay table** is
  `clip.screenplay_line_start_id`. After this change no registry
  reference targets a screenplay table, and the example goes. The rule it
  illustrates stays.
- **Published results.** `shotContext` is not a published query. The
  clips and the take are in no published result, so none is expected to
  change; re-blessing will confirm it.
- **The finding catalog** gains four codes.
- **Writers.** Nothing is required. A writer that knows which lines a
  shot covers gains somewhere to put it. A writer that rewrites the
  screenplay without diffing keeps orphaning anchors, now reported.

## Alternatives

**A junction of shot to line.** One row per line, so a shot could skip
lines, such as a cutaway. Declined: shots cover runs of the script, a
row per line multiplies the anchors to re-anchor on every edit, and a
skip is two shots.

**Character offsets within a line.** A long action paragraph can span
two shots, and prop tags already carry offsets. Declined for now: it
asks a writer to split the action exactly where the cut will fall, which
is the decision editing exists to defer. Whole lines, with overlap,
leave it there.

**Assign each line to one shot.** A partition is what a shooting script
written for the edit looks like, and it is not how a scene is shot.
Declined, and §4.7 says so, so a consumer does not assume it either.

**Keep row-id references and re-point them on every rewrite.** That
moves the burden onto every writer, and the fixture shows what happens
when one forgets.

**Derive a shot's lines from its story beat.** `shot.story_beat_id`
exists, and beats are coarser than lines and carry no line range.
It would answer "which beat", not "which lines".

**Do nothing.** Prompts keep omitting dialogue, or guessing it, and
`clip` keeps pointing at headings.

## Unresolved

None open. The questions this draft opened with were settled in
discussion before it was put up:

| Question | Settled as |
|---|---|
| A range, or a list of lines? | A range (§B). |
| Whole lines, or offsets within a line? | Whole lines, with ranges free to overlap, so the cut is left to editing (§B). |
| May several shots cover the same lines? | Yes, and usually will: coverage from several angles, resolved in editing (§B). |
| Fix `clip` in the same proposal? | Yes, onto line anchors (§C). |
| Fix the fixture's take? | Yes: "12-04 take 3" gets its `shot_id` (§F). |
| Does a scene with shots and no ranges raise anything? | No (§B). |
| `lines` for an unrecorded shot? | Null, not inherited from the scene (§E). |
| Is re-anchoring through a split or merge a MUST? | No, a SHOULD: it is a writer's behaviour, and an orphaned anchor is reported either way (§A). |

---

## Resolution

**Accepted and implemented, 2026-10-01.** Spec 0.59, schema 2.19.

The questions this draft opened with were settled before it was put up,
and are recorded above. Implementing it confirmed that **no published
query result changed**: every expectation moved only its schema version.

Details worth recording:

- **`lines.ts` is the one implementation.** It reads the anchors from the
  registry's `lineAnchor` marker, and derives which entities carry a
  range (`shot`, `clip`) from the anchors they declare rather than from a
  list.
- **The editor's integrity sweep gained a generic list** of every other
  orphaned anchor, built from that marker. Prop tags and beats keep their
  own richer views and are not reported twice.
- **A range with an orphaned end is reported once**, as
  `line.anchor_orphaned`, not again as a range problem, so one broken
  anchor is one finding.
- **The fixture's clips** are anchored to cue and dialogue: ELEANOR / "You
  came back." and MARCUS / "I came back."
