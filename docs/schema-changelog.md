<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# SCF schema changelog

The registry is generated from `schema/entity_registry.py` by
`schema/generate_registry_json.py`; the version is `SCHEMA_VERSION` in
`schema/schema_meta.py`. Bump the version and record the change here in
the same commit.

## Held for the next bump

Changes that are ready and cannot ship on their own, because
`registry.json` is pinned by the `schema-<version>` tag
(`spec/ARTIFACTS.md`): once a tag exists, ANY byte change to the
registry makes that tag serve different bytes than `SHA256SUMS`
claims, and `schema/check_pin.py` fails. Conventions §8 exempts
"purely cosmetic" changes from a version bump, and that exemption is
only safe BEFORE the tag. Afterwards a cosmetic change waits here, or
takes a version of its own.

*(Empty. The `bundle.intent` help text queued here in 0.55 shipped
with 2.16.)*

## 2.22

The project synopsis: proposal 0036.

**Added:**

- `project.synopsis`: the story told short, in prose — a paragraph to
  a page, between the one-sentence `logline` and the screenplay. Not
  the screenplay's `=` synopsis lines (`line_type = synopsis`), which
  outline a section or a scene. Optional, no default.

**Fixture:** Hollow Creek's project row carries a synopsis, so Q00's
published result shows the field surviving projection.

Query results (not schema): Q00's `project` layer gains `synopsis`.

## 2.21

The anchor state columns, and variants in the cast: proposals 0034 and
0035.

**Removed** (§11.0: pre-1.0 files are disposable):

- `entity_anchor.physical_state`, `entity_anchor.vocal_state`,
  `entity_anchor.environmental_state` — free text that §12.8 never read,
  so an anchor scoped by one applied at every position. No fixture row
  set them. Scope by state with a binding's state filter, or by design
  with a variant.

**Changed:**

- `entity_anchor.condition_description` gains help text saying it
  describes and never scopes.

Query results (not schema): Q03, Q04 and Q12 gain variant members
(proposal 0035).

## 2.20

Which character or prop variant is in force: proposal 0033.

**Added:**

- `scene_character.variant_id` and `scene_prop.variant_id`: the variant
  the subject appears as at that scene (spec §4.8). Null means the
  subject as defined.
- `character_asset_binding.variant_id` and `prop_asset_binding.variant_id`:
  the filter 0027 removed for lack of an in-force rule, back now that
  §4.8 is one. Satisfied where that variant is in force (§12.8.1).
- `qualifier` on a field in `registry.json`: on a link entity, a
  reference that qualifies the link and is not part of its natural key
  (§6.3). Declared on the two presence `variant_id` columns.
  `registry.schema.json` describes it.

**Changed meaning:**

- `entity_anchor.subject_variant_id` is now read by §12.8: an anchor
  naming a variant contributes only where it is in force, and there
  displaces the subject's own anchors of its type. Before 2.20 it was
  read by nothing.

**Fixture:** scene 25, a flashback coda at the creek; the variant
"Marcus, age nine", named by Marcus's scene link there; a binding scoped
to the variant that replaces his baseline; a verified anchor for the
variant's face; a summer baseline variant for the creek. Creative
decision 2 now allows the one flashback.

## 2.19

Which screenplay lines a shot covers, and line anchors: proposal 0032.

**Added:**

- `shot.line_start_ref` and `shot.line_end_ref`: the range of the
  screenplay a shot covers, as line anchors. Whole lines; ranges may
  overlap, and a shot with none is unrecorded (§4.7).
- `lineAnchor` on a field in `registry.json`: the field is a text uuid
  naming a screenplay line (§3.5). Declared on the four range fields and
  on `performance_beat.line_ref`. `registry.schema.json` describes it.

**Removed** (§11.0: pre-1.0 files are disposable):

- `clip.screenplay_line_start_id` and `clip.screenplay_line_end_id`,
  replaced by `clip.line_start_ref` and `clip.line_end_ref`. They pointed
  at a line by row id, which the screenplay being rewritten re-numbers:
  in the fixture both clips had come to point at a blank line, a section
  marker and a heading, and nothing reported it.

**Changed:**

- `performance_beat.line_ref`'s help text cites §3.5 instead of an
  internal ticket.

## 2.18

How bindings combine, proposal 0031. Additive: `combine` defaults to
`add`, which is what every binding did before.

**Added:**

- `combine` on `character_asset_binding`, `prop_asset_binding`,
  `location_asset_binding` and `costume_asset_binding`: `add` (default)
  or `replace`. A binding in force that replaces excludes every binding
  for the same subject and intent with lower precedence (§12.8.2).

**Changed:**

- `precedence` and `is_baseline` gain help text on all four binding
  entities. Neither had any, and the fixture used `precedence` both ways
  round. It is now the author's ranking, higher being the more specific
  opinion, and a baseline SHOULD sit at 0.

## 2.17

Presence, proposal 0030: whether a subject is seen, heard or only
named, at a scene and at a shot. Additive: a file with no shot rows
reads exactly as before.

**Added:**

- `shot_character` and `shot_prop`: which characters and props are in
  a shot, and how they read. `framing` (`full`, `cropped`,
  `off_screen`), `focus` (`sharp`, `soft`), and on `shot_character`
  only, `facing` (`toward`, `profile`, `away`). Three closed fields, not
  one vocabulary of cases, because the cases are not exclusive: a
  character can be back to camera and out of focus at once.
- `shot.presence_complete`: the shot's rows are its whole frame. Unset,
  the scene's seen subjects may also be in the shot (§4.6).
- `optionPresence` on a field in `registry.json`, declared on
  `scene_character.role_in_scene`, `scene_prop.significance` and the new
  `framing` fields. It gives each value a presence: `seen`, `heard` or
  `named` (§2.4.1). `registry.schema.json` describes it.

**Changed:**

- `scene_character.role_in_scene` and `scene_prop.significance` gain
  help text stating what their values say about being on screen. The
  values themselves are unchanged.

## 2.16

Six binding filters resolved — four specified, two removed — one new
entity, and the held help text. Proposals 0012 (its last item), 0025
(its documentation half), 0027 and 0029.

**Removed** (§11.0: pre-1.0 files are disposable):

- `character_asset_binding.act_id`, `prop_asset_binding.act_id`,
  `location_asset_binding.act_id` — act membership is derived from
  boundaries (§5.1), so an act-scoped binding is a scene range written
  in a way that goes stale when a boundary moves.
- `character_asset_binding.variant_id`,
  `prop_asset_binding.variant_id` — nothing anywhere says which
  character or prop variant is in force at a position. There is no
  positional rule and no junction that names one, so the filter could
  not be evaluated, which is the defect 0027 is about. If a rule
  arrives, the column comes back with it.

**Changed:**

- `location_asset_binding.time_of_day_filter` is now a `select` over
  `scene.time_of_day`'s vocabulary (0012, item 4). Free text matched
  against a closed vocabulary could only agree by luck.
- `location_asset_binding.variant_id`,
  `character_asset_binding.physical_state_filter` and
  `vocal_state_filter` gain help text stating what §12.8.1 now makes
  them mean. The state filters match a state's NAME, not its sentence.
- `entity_anchor.region_box` declares its `{x, y, w, h}` shape and
  §10.1's preserve rule (0025's remaining half).
- `bundle.intent`'s help text: `acoustic` is any subject's sonic
  identity, not only a location's ambience.

**Added:**

- `costume_asset_binding` (0029). Costume was the one media subject
  with references and nowhere to bind them: a bundle of costume
  images could be assembled and reach nobody. It has no variant filter
  (costume has no variant entity) and no act filter.
- `costume` joins the ontology's `SUBJECTS`. A costume is about its
  character; a costume asset binding is about the costume, and Q13
  finds a binding by the subject column the ontology names.

Every new rule is exercised by the fixture rather than only stated:
one binding scoped by time of day, one by variant, one by a physical
state, and the costume binding. The `asset.bundle_unbound` finding,
which the fixture previously raised on the unbindable costume bundle,
moved to a twelfth negative fixture so it stays exercised.

## 2.15

Four entities added, two JSON columns retired, and one new field type.
Proposals 0008, 0024 and 0026.

**Character arcs (0008).** `character_arc` and `character_arc_state`,
the latter `latest_wins` (spec §4.5). SCF could say how a relationship
changed across the story and how a motif did, and not how a character
did: `character.arc_description` is prose and `emotional_arc` is the
audience's. The prose field stays as the narrative summary — the same
division `motif.evolution_description` and `motif_state` already make.

Q02 carries `arcStates`, the stage in force at the scene. It does NOT
carry the arcs themselves: `character_arc` has `subject: character` and
`scope: global` and declares `character_id`, so the dossier picks it up
from the registry without a line of code, and §3.1 wants it in one
place.

**Rows instead of blobs (0026).** `costume_progression_state` replaces
`costume_progression.progression_stages`, a JSON blob holding what the
rest of the schema holds as positioned rows.
`staging_beat_character` replaces `staging_beat.character_positions`, a
map keyed by character NAME in a schema where a character is a row with
a uuid. Link entities go from thirteen to fourteen, and §6.6's count
moves with them.

**`string_list` (0024).** A new `fieldType` on 29 fields that had been
`json`. No column moves and no value changes — the type is a
declaration, and it is what lets an editor render a chip input and
§12.1.2 project an array instead of the text holding it.

**`structureRef` binds by uuid (0016).** Not a registry change: the
fixture's screenplay builder now writes
`{"kind": …, "uuid": …}` on its eight section lines, and scf-app reads
and writes that form. The legacy `{"kind": …, "id": …}` is still read.

## 2.14

Fifteen proposals' worth of registry change, from mapping Scriptyard's
`.scf` export against the schema. Every file in the repository is
rebuilt from source, and no `.scf` outside it needs converting — spec
§11.0 still applies and nothing external has written one.

**Fields added.** `scene.goal`, `scene.conflict`, `scene.outcome`
(0010), named to match `sequence`'s: the standard scene unit was
recordable for a sequence and not for a scene. `theme.statement` and
`theme.opposition` (0011): a theme was a topic with no way to say what
the story argues about it. `thematic_connection.notes` (0020): the link
§6.6 calls a claim had typed fields for the kind of connection and none
for the reasoning. `notes` on 22 entities (0023) under one rule — an
entity a person authors as a unit gets one, tiers 0 to 2; `character`
was the only tier-0 story entity without one and all nine tier-1 vision
documents lacked it.

**Fields removed.** `scene.characters_present` (0021) stored the cast as
a JSON list of NAMES beside the `scene_character` links, went stale
unnoticed on three of fourteen scenes, and was read by nothing.
`project.themes`, `theme.motifs`, `staging_beat.characters_involved` and
`scene_music_design.themes_used` (0025) are the same defect, all empty.
The three `conditions_json` columns go too: labelled "Additional
Conditions", with no help text, no specification text, no reader and no
writer.

**Vocabularies.** `cut` removed from `status` on scene, act and sequence
(0004) — see spec §6.6. `day` added to `scene.time_of_day` and
`location_variant.time_of_day` and `continuous` removed from the former
(0012). `act` and `sequence` added to
`thematic_connection.entity_type` (0013). `functional` added to
`prop.story_function` (0018) — deliberately not "practical", which on
set means a working prop. Sixteen vocabularies lost `other` and gained
`open: true` (0022), a new per-field flag: the options are the known
values and any other string is the value rather than an error.

**`external_id`** on `act`, `sequence`, `story_beat`, `theme` and
`motif` (0017). It was on ten entities chosen for production systems,
which identify scenes, shots and assets; a story tool re-syncing acts,
beats and themes had to match them by name.

**Two fields are now stated once rather than three times.** The three
`status` fields inlined the same option list; `WRITING_STATUS_OPTIONS`
existed, unused, and they now share it.

## 2.13

**`clip.screenplay_line_start_id` and `clip.screenplay_line_end_id`
declared as references** to `screenplay_lines`. They were plain
integers, so spec §12.1.2's resolution rule could not reach them and
both survived projection as bare row ids — file-local values in a result
that is supposed to describe the story.

**No DDL change, and no file needs converting.** The generator emits no
foreign key for a registry reference, so the physical schema is
identical to 2.12's apart from its version comment. A 2.12 file opened
by a 2.13 reader projects the two columns as
`screenplay_line_start_uuid` and `_end_uuid` with no migration.

This is the first reference anywhere in the schema whose target is a
`uuidExtraTable` rather than one of the 99 entities. `screenplay_lines`
carries uuid row identity on spec §6.1's terms, so there is a uuid to
resolve to; `uuidLookupFor` indexes any table with `id` and `uuid` and
needed no change.

The old drop-every-column-ending-`_id` rule had been hiding this by
catching both columns for the wrong reason. Spec 0.40 replaced that rule
with one that reads declarations, and this is the declaration it needed.

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
