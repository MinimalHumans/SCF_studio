<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0016 — Section lines and the structure they name

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | Spec §1.3.1, §3, §5; `screenplay_lines.metadata`; possibly the finding catalog; scf-app `structureCommit.ts` |

## The problem

**scf-app binds section lines to acts and sequences through a
convention the specification never mentions, keyed by row id.**

`docs/conventions.md` records how this works today:

- a Fountain section (`# Act 2 — The Thaw`) becomes an act or sequence
  at commit;
- the section line's metadata carries `structureRef {kind, id}`, so that
  renaming the section renames the entity rather than creating a second
  one.

The fixture carries eight such lines. The first is:

```
# Act 1 — Arrival   {"section": {...}, "structureRef": {"kind": "act", "id": 1}}
```

Four problems follow:

1. **The binding is by row id**, which §6.2 and §12.1.2 say is file-local
   and renumberable. This is the same fragility 0007 describes for
   `affected_entities`.
2. **The specification does not know `structureRef` exists.** A second
   writer cannot produce it, and a second reader cannot honour it.
3. **Two stored facts can disagree:**
   - a section line's position implies where a span starts;
   - `act.start_scene_id` states it.

   §5.1 says the boundary is "the only stored fact". The section line is a
   second one. So is its text against `act.name`: the fixture's
   `# Act 1 — Arrival` duplicates the act's name.
4. **Classification is editor code.** `classifySection` decides what a
   section is: ACT in the text means an act, SEQ means a sequence, and
   otherwise depth decides. A writer that emits `### Midpoint` gets a
   sequence (see 0009).

The same shape exists for scenes: `scene.name` is the heading text in
every fixture scene, and the heading line carries `scene_id`.

**This has actually bitten.** Scriptyard's export writes section lines,
exactly as its Fountain export does, and creates the acts and sequences
they name. To stop scf-app creating duplicates at the first commit, it
has to write `structureRef` — a convention it can only learn by reading
scf-app's source.

## The proposal

1. **Specify the binding** in §1.3.1: a `section` line MAY carry
   `metadata.structureRef = {"kind": "<entity>", "uuid": "<uuid>"}`,
   naming the span entity it declares. **By uuid, not row id.** A reader
   MUST accept the legacy `id` form until 1.0.
2. **State which is the truth.** `start_scene_id` and `name` on the
   entity are the record. A bound section line is the **authoring handle**
   for them. An editor MAY update the record from the handle at commit.
   A reader MUST answer from the record.
3. **A finding for disagreement**, `structure.section_mismatch` (info):
   the record's boundary or name differs from its bound line's. It is not
   an error: between commits the two legitimately differ.
4. **Classification stays an editor convention**, and the spec says so. A
   writer that binds its lines never depends on it.

## What it breaks

- scf-app writes and reads `structureRef` by id. It moves to uuid.
- The fixture's eight bound lines are rewritten, through the fixture's
  dump/rebuild loop.
- The catalog gains a code, and the fixture reports nothing new if the
  lines agree.

## Alternatives

**Section lines as pure outline** — never bound, never read. scf-app would
lose rename-follows-section, and would create duplicates on every
re-import.

**Derive the record from the lines** (no `start_scene_id`). Reverses
§5.1, and breaks every file with structure but no script.

**Do nothing.** The binding stays an scf-app private.

## Unresolved

- **The scene case.** Should `scene.name` duplicating its heading be
  treated the same way (record vs handle), or is the name a separate
  authored label that merely starts as the heading?
- **Synopsis lines** (`= …`) under a heading: are they a handle for
  `scene.summary`, or independent? Scriptyard's Fountain export writes the
  scene note as a synopsis.
- **Info or warning** for the mismatch?
