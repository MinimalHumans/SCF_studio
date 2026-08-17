# SCF schema changelog

The registry is generated from `schema/entity_registry.py` by
`schema/generate_registry_json.py`; the version is `SCHEMA_VERSION` in
`schema/schema_meta.py`. Bump the version and record the change here in
the same commit.

## 2.12

**`project.scene_numbering` removed.** It was deprecated in 2.11 when the
field was renamed `numbering_policy`, with writers mirroring into it for
one version so that a reader knowing only the old name could not see a
stale policy.

Spec §11.0 now states that before 1.0 files written by earlier schema
versions are disposable. The window protected only files written before
2.11, so it protected nothing, and carrying it left the format storing
one fact in two columns. The column, the mirroring in
`setNumberingPolicy`, and the fallback in `numberingPolicyOf` all go
together.

A file that still carries a `scene_numbering` column is unknown content
under §10.1: preserved on write, ignored on read, and unable to override
the real column. There is a test asserting exactly that, so removing the
column cannot be quietly undone by a stale file.

## 2.11

**`project.scene_numbering` renamed to `project.numbering_policy`.** The
old name described one of the four things the field governs: spec §4.3
now states that act, sequence and scene numbers and shot codes are all
authored and all governed by it.

**The rename is additive**, through §11.4's deprecation window rather
than as a break. 2.11 adds `numbering_policy` and keeps `scene_numbering`
readable; **2.12 removes it**. No file needs converting: a reader prefers
the new column and falls back to the old one, so every file written
before 2.11 keeps working untouched.

Writers MUST mirror the policy into `scene_numbering` while it exists.
That is a deliberate exception to the derive-don't-store rule, made
because a reader that knew only the old column would otherwise see a
stale `derived` on a locked project and renumber a shot list that is
already on paper. The mirroring goes away with the column.

`scf-core/src/numbering.ts` owns the precedence so no caller has to know
about any of this; `structureCommit`'s `numberingMode` / `setNumberingMode`
delegate to it.

## 2.10

**`ownedTables` added to the registry.** Spec §1.3 defined the file's
known table set as the registry entities plus `UUID_EXTRA_TABLES`, which
conflated two different questions: is this table SCF's, and does it
carry row identity.

They are not the same question, and the gap was invisible until
`collectFindings` enumerated a real file for the first time — SCF
reported two of its own tables, `screenplay_title_page` and
`screenplay_version_title_page`, as third-party content.

A title page is a **property of the screenplay** rather than a row in
its own right, so these do not gain uuids. They are simply ours. The
registry now declares them separately, and `Registry.knownTables` is the
union a reader should test unknown content against.

No file changes. Nothing is created, altered or dropped — this adds a
declaration about tables that already existed.

## 2.9

**`scene.scene_number` widened from integer to text.** A scene number is
a LABEL for a position, not the position itself, and production practice
labels inserted scenes `12A` and `A12`. As an integer column it could
not hold one: the importer's `parseInt` truncated `12A` to `12`, which
destroyed exactly the numbering an imported locked script most needs
preserved.

Grammar and ordering are specified in `spec/scf-spec.md` §4.2 — the
grammar is a parse, not a constraint, so a label that does not match it
is opaque rather than invalid.

**This is the first non-additive change since the removals in 2.8**, and
it is deliberately taken now: SQLite cannot alter a column's affinity in
place, and spec §11.1 forbids non-additive changes after 1.0. No
conversion is required for existing files — affinity is a hint, so an
integer-affinity column stores a label unchanged, and `initDatabase`
does not rewrite columns it finds.

Callers that assumed a number were updated with it: `structureCommit`
now writes the label as text (the driver binds JS numbers as doubles, so
`1` was landing as `"1.0"`), `importPipeline` keeps the script's own
label instead of `parseInt`-ing it, and `ScriptView`'s
`typeof === "number"` guard would otherwise have made every scene read
as unnumbered.

## 2.8

**`asset.asset_type` and `asset.file_path` removed.** Both were
deprecated in 2.7 and retained so that a file could move between
versions without losing data. That caution is withdrawn: the format has
no installed base to protect, and carrying two dead columns plus a
Deprecated tab in the editor cost more in confusion than the
compatibility was worth.

`migrateFilePaths()` goes with them — there is nothing left to migrate
from. A pre-2.7 file opened by this version keeps its `file_path` values
in the table (SQLite does not drop unknown columns) but nothing reads
them, and the assets will read as unaddressed until their identifiers
are authored or re-imported.


## 2.8

**`asset.asset_type` and `asset.file_path` removed.** Both were
deprecated in 2.7 and retained so a 2.7 file could be taken back to 2.6
without loss. That protection is no longer wanted: there are no files in
the wild to protect, and a Deprecated tab in the editor costs every
future reader a moment working out why two dead fields are on screen.

Not additive, and deliberately so. A 2.6 or 2.7 file opened by 2.8 keeps
whatever was in those columns — `initDatabase` never drops columns — but
the editor stops showing them and `resolveAllAssets` stops reading them.
The `file_path` → `identifier` migration is gone with them; anything
still holding only a `file_path` should be reimported.


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

Additive and self-migrating at the time; both deprecated columns were
removed in 2.8, along with the migration.

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
