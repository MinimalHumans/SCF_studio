# SCF schema changelog

The registry is generated from `schema/entity_registry.py` by
`schema/generate_registry_json.py`; the version is `SCHEMA_VERSION` in
`schema/schema_meta.py`. Bump the version and record the change here in
the same commit.

## 2.7

**`asset.identifier`** (TEXT, nullable), plus **`size_bytes`**,
**`source_mtime`** and **`content_hash`** on a new Resolution tab.
**`asset.asset_type`** and **`asset.file_path`** are deprecated.

An asset is a reference, not a container, and `file_path` was doing four
jobs at once: relative path, absolute path, URL, and — once a `.scf` can
point at another — a composition arc. `identifier` does one: a rooted,
portable address (`@project/characters/eleanor/face_ref.png`) that gets
committed and diffed. Where the bytes actually are is derived at load
time and never stored, so relocating a project is a change to one root
rather than an update across thousands of rows. See conventions §9.

`asset_type` is deprecated rather than repaired. It mixed container
format (`image`, `audio`) with editorial intent (`concept art`,
`lookbook`), and the Hollow Creek fixture had already outgrown the enum
by storing `archive`. Format is derived from the identifier; what an
asset is FOR is a property of the link that reaches it —
`bundle_asset.role_in_bundle` and `asset_relationship.relationship_type`
already carry it. There is deliberately no replacement column.

Additive and self-migrating. `migrateFilePaths()` runs on open and roots
any bare `file_path` into `@project/...`; anything already absolute or
already rooted is copied unchanged, because rewriting it would assert a
portability it does not have. It is idempotent, and it does NOT clear
`file_path`: both deprecated columns stay, so a file opened by 2.7 and
taken back to 2.6 loses nothing.

**Consumer note.** Resolution is a state, not a boolean. `missing` and
`unmaterialised` are different facts — a cloud placeholder will appear
when touched — and collapsing them reports every synced project as
broken on open.


## 2.6

**`screenplay_version_lines.source_uuid`** (TEXT, nullable).

Records which LIVE line each snapshot row was taken from.

A snapshot row already has a `uuid`, but it is the snapshot row's own —
`publishVersion` deliberately does not copy the live line's, because the
unique index on version-line uuids depends on them being distinct. That
left no way to say "this saved line is that line", so reverting to a
version would have handed every restored line a brand-new identity and
orphaned every performance beat and prop tag anchored to one. Reverting
the script would silently have broken everything attached to it.

Additive and self-migrating (ALTER on open). Versions published before
2.6 have NULL here and are not lost: `resolveRevertRows` falls back to
`diffScreenplay`'s text-and-type anchoring against the current script,
and the pre-flight report says how many lines it could not place.

**Consumer note.** `uuid` and `source_uuid` on a version line mean
different things and are never interchangeable. `uuid` identifies the
snapshot row; `source_uuid` points into `screenplay_lines`, and may
point at a line that no longer exists.


## 2.5

**`project.scene_numbering`** (select `derived` | `fixed`, default
`derived`).

States whether the editor may recompute `scene.scene_number` from the
script's order. `derived` keeps the numbers true while the script is
live; `fixed` means never touch them.

Why it had to exist before scene renumbering could: a screenplay
imported from a production carries that production's own numbering,
which may be gapped, out of sequence, or (in the wider world)
alphanumeric. Renumbering it on the first commit would destroy real data
silently. Imports set `fixed`; a blank screenplay gets `derived`.

This is the smallest piece of production LOCKING (conventions §9), and
the gate is the renumber block in `structureCommit`, exactly where §9
said it would be.

**Consumer note.** `scene_number` is a LABEL for a position, not the
position itself. Story order comes from the screenplay when one exists —
the `line_order` of the heading carrying each scene — and falls back to
`scene_number` then `id` only for scenes with no heading. See
`scenePositions`/`sceneOrderHint` in `scf-core/src/structure.ts`. A
consumer that sorts scenes by `scene_number` alone will be wrong about
any project written blank, and about any scene moved since its last
commit.


## 2.4

Three additive optional fields. No table changes, no data migration: a
2.3 file opened by the app gains the columns through `initDatabase`,
which ALTER-adds anything the registry declares and the file lacks. A
2.4 file read by a strict 2.3 consumer carries columns it does not know
about and is otherwise unchanged.

| Entity | Field | Why |
|---|---|---|
| `act` | `start_scene_id` → scene | An act begins at a scene and runs until the next act begins. Membership is derived from this one anchor, so acts cannot overlap or leave gaps and a scene inserted mid-act joins it with no write. |
| `sequence` | `start_scene_id` → scene | Same model, independently — which is what lets a scene belong to an act without first inventing a sequence. |
| `shot` | `story_beat_id` → story_beat | Optional. `scene_id` stays required, so a shot is valid with or without a beat and existing shots are untouched. |
| `character_relationship` | `directionality` (`mutual` \| `a_to_b`, default `mutual`) | The pair is what identifies a relationship, and nothing said whether the order of its two characters carries meaning. Without that, no tool can tell one relationship entered twice from two legitimate directed facts — and the duplicate splits its `relationship_state` history across two rows. |

Four fields, three entities plus one; the table above lists them by the
change that motivated each.

### Consumer notes

- Nothing enforces the new relationships between rows. `act` and
  `sequence` boundaries may be absent (the span appears nowhere),
  dangling (the anchor scene was deleted), or shared (two acts on one
  scene, leaving one empty). All three are reported as findings rather
  than rejected — see `scf-core/src/structure.ts`.
- Duplicate and reversed relationship pairs are likewise findings, not
  constraints. A unique index could not decide whether a reversed
  directed pair is a duplicate, and several relationships between the
  same two people are legitimate.

## 2.3

Cross-file row identity: `uuid` on all 99 entities plus the four
`screenplay_*` tables, with a unique index and backfill on open.
Junction tables still carry no identity columns of their own — a stated
gap.
