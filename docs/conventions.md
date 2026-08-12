# SCF conventions

What the format means, and why. The registry says which fields exist;
this says how to read them. Where a rule is machine-checkable it is
pinned by a conformance test, and the test is named here so the two
cannot drift apart silently.

This is not the spec. A spec is a commitment to outside consumers and
the format is still moving. This is the document that stops the reasons
being lost — every rule below was a decision with a rejected
alternative, and several were learned by breaking something.

---

## 1. What SCF is

A description of a film's intent, dense enough that a human or a machine
can answer a specific question about a specific moment: what does this
character sound like in this scene, what is in force here, what is this
shot for.

**SCF describes; it does not enforce.** There are almost no constraints
in the schema beyond required fields and foreign key columns. Everything
else — duplicates, contradictions, gaps — is reported by the readiness
layer as a *finding*, never rejected on write. A half-entered project is
a normal state of work, not an error, and a format that refuses
incomplete data is a format nobody finishes filling in.

Consequence for consumers: never assume a row is well-formed because it
exists. Every resolver in `scf-core` stays total — it returns a sane
answer for missing, dangling, and contradictory data, and reports the
problem separately.

---

## 2. Derived versus stored

**The rule: if a value can be computed from another, compute it.**

A stored copy of a derivable fact is a second truth, and the moment the
original changes the copy is a lie that nothing detects. This has been
the source of more bugs in this project than anything else.

Applied:

- A **scene's label** is `sc {scene_number} — {name}`, built at render
  time. Not stored: renaming a scene would strand every copy.
- A **link row's label** is composed from the rows it points at. Where a
  link entity declares its `nameField` `hidden: true` — twelve of
  thirteen do — that column is not a name and must never be displayed.
  The importer parks cue text there; showing it made a character's whole
  scene list read as that character's own name.
- **Act and sequence membership** is derived from a boundary (§4).
- **Story order** is derived from the SCREENPLAY — the position of the
  heading carrying each scene — falling back to `scene_number`, then row
  id, only for a scene the script does not contain. `scene_number` is a
  label for that position, not the position itself (§3).

**The one deliberate exception is `shot.shot_number`**, which IS stored
and IS authored. A shot number is not a display label: it is an
identifier issued to a crew. Once a shot list goes out, 42A stays 42A
even if the scene renumbers, because paperwork exists on paper.
Consumers must not rewrite it. The app shows the derived code beside an
authored one when they disagree, so a list can be reissued deliberately.

The distinction that resolves the apparent contradiction: **a shot moved
to a different scene IS renumbered.** The rule protects the number
against the scene renumbering; it does not protect a number that names
the wrong scene.

### Derived-but-stored: a known fragility

`screenplay_lines.scene_id` is threaded onto body lines at commit — it
is derived state that happens to be stored. It is absent for lines typed
since the last commit and for projects written before the threading
existed. **Do not key anything important off it.** To read a scene's
text, find the heading line linked to that scene and take everything up
to the next heading; commit enforces one scene per heading, and
"slugline to slugline" is what a scene means anyway.

Pinned by: `scf-app/test/sceneScript.test.ts` (nulls every body line's
`scene_id` and asserts identical output).

---

## 3. Position and persistence

Everything positional is keyed to a **scene**, and scenes are ordered by
their position in the SCREENPLAY: the `line_order` of the heading that
carries each one. A scene the script does not contain has no position,
and falls back to `scene_number` — unnumbered last — then row id. That
ordering is the spine every other rule stands on.

`scenePositions` / `sceneOrderHint` in `scf-core/src/structure.ts` are
the derivation; `SCENE_ORDER_JOIN` / `SCENE_ORDER_BY` and the general
`storyOrder()` are its SQL twins, so no view invents its own.
**A consumer that sorts scenes by `scene_number` alone will be wrong**
about any blank-written project and about any scene moved since its last
commit. See §10 Resolved for the numbering flag that governs when the
label is recomputed.

Three patterns, distinguished by `positionPattern` on the entity:

**Pattern 1 — explicit rows.** A row per scene, no inference.
`costume_scene`, `scene_prop`. What is in force is what is written.

**Pattern 2 — persistence.** A state row is keyed at a scene and carries
`persistence`:
- `scene_only` — in force at its own scene and nowhere else.
- `until_resolved` — in force from its scene forward, until
  `resolved_at_scene_id` (exclusive), or to the end.

An injury taken at sc 9 is still in force at sc 12; hoarseness from the
same scene is not. Modulations from multiple states merge oldest-first,
so a later state overrides an earlier one field by field.

Pinned by: `conformance.canonical.test.ts` → "persistence rule".

**Pattern 3 — latest wins.** A state row per scene where the value
changed; the answer at any position is the most recent row at or before
it. `relationship_state`, `prop_state`, `motif_state`. There is no
"until" — the next row supersedes.

Pinned by: `conformance.canonical.test.ts` → "pattern 3 (latest-wins)".

---

## 4. Structure: spans anchored at their start

An act **begins** at a scene and runs until the next act begins. A
sequence likewise. `act.start_scene_id` and `sequence.start_scene_id`
are the only stored facts; membership is derived.

Why the start alone, rather than a start/end pair or a row per scene:

- Overlaps and gaps become impossible to express. Nothing to validate.
- A scene inserted mid-act joins it with no write at all.
- No end anchor to drift out of sync when scenes move.
- "Scenes 32–54 are Act II" is two placements, not 23 rows.

The cost, accepted deliberately: **spans must be contiguous.** A
cross-cut sequence interleaved with another cannot be expressed. If that
requirement arrives, enumerated membership is the only model that
supports it, and this one must be replaced rather than patched.

Acts and sequences are **independent spans, not a hierarchy**. A scene
can be in an act with no sequence — the whole point of the change, since
membership used to be reachable only through `scene_sequence` — and a
sequence may begin in one act and end in another. That is legal and
deliberately unrestricted: a montage or a cross-cut can bridge an act
break, and forbidding it would buy tidiness at the cost of a real
structure.

The consequence is for renderers, not for the data. Anything drawing
acts and sequences as nested must group an act's scenes into **runs** of
sequence (`actOutline()`), so a crossing sequence appears in each act as
the part of it that belongs there. Grouping instead by "sequences whose
start falls in this act" draws the crossing sequence's later scenes
under the wrong act and again under the right one — which is exactly
what both outlines did until it was caught.

`scene_sequence` rows are still materialized at commit so existing
queries keep working. The boundary is the truth; those rows are its
shadow, and may be stale between commits. Rows that no boundary explains
are counted and reported, never deleted.

Half-placed structure is normal: an act with no boundary, a boundary on
a deleted scene, two acts on one scene, scenes before the first act.
Each produces a sane structure and a finding.

Pinned by: `scf-core/test/structure.test.ts`.

---

## 5. Identity

**Rows** carry a `uuid` (schema 2.3), unique per table, backfilled on
open. This is what survives export, re-import, and being read by another
tool. Row ids are local to a file and mean nothing outside it.

**Junctions carry row identity too.** `uuid` is a framework column on
all 99 entities, junctions included — an earlier note in this document
claiming otherwise was wrong. What a uuid answers is the *lineage*
question: is this the same row as before, across export, re-import and
versioning.

It does not answer the other one. A uuid is minted per file, so two
people describing the same production mint different ones for the same
link. Across files a junction is identified by its **natural key** — the
rows it joins, plus the polymorphic target where it has one, plus
`domain` where present, since a motif may legitimately appear in one
scene both visually and sonically. `junctionKeyFields()` in
`scf-core/src/junctions.ts` states that key for all thirteen link
entities so that merging, de-duplicating and validating agree on it.

Nothing in the schema stops two rows sharing a natural key. The commit
path de-duplicates in code; anything added by hand is unchecked. Two
rows for one link split its authored content — a role, a usage note — and
a reader taking the first finds half of it. Reported by
`duplicateJunctions()`, and reported more loudly when the duplicates
disagree, since identical duplicates are only clutter.

**Relationship pairs** are the case where that bites. `character_
relationship` has no constraint on its two character columns and no
convention about which character goes first, so the same pair can be
entered twice, or once from each end, splitting its `relationship_state`
history across two rows that a latest-wins lookup cannot reconcile.

Schema 2.4 adds `directionality` (`mutual` | `a_to_b`) because the
missing fact is **symmetry**: without it nothing can distinguish one
relationship entered twice from two legitimate directed facts. A mutual
pair is unordered; a directed pair reads A → B.

Consumers must read relationships from **both** columns —
`relationshipsFor()` in `scf-core/src/relationships.ts` — and must not
assume a character sits in `character_a_id`. It returns each row from
the requested character's side: `other`, and a `direction` of `mutual`,
`outgoing`, `incoming`, or `unspecified` where `directionality` is
empty.

Note that `character_relationship` is not one of the thirteen link
entities — its `subject` is `character` — so `junctionEntities()` skips
it and `duplicateJunctions()` never sees it. `relationshipFindings()`
covers it separately: one pair entered twice as `mutual` is a duplicate,
two `a_to_b` rows in opposite directions are two legitimate facts, the
same direction twice is a duplicate again, and a pair described as
mutual on one row and directed on another contradicts itself. Rows with
no `directionality`, rows naming one character twice, and rows pointing
at a character that is not in the file are each reported on their own.

Duplicates are findings, not constraints. A unique index could not
decide whether a reversed directed pair is a duplicate, and several
relationships between the same two people are legitimate.

Pinned by: `scf-core/test/relationships.test.ts`,
`scf-core/test/junctions.test.ts`.

### Soft-retiring: links inherit their endpoints' lifecycle

Two of the thirteen link entities carry `lifecycle_status` —
`actor_character_role` and `thematic_connection` — and that asymmetry is
deliberate rather than an omission.

A link is a statement that a connection exists. If the connection stops
existing, the row is wrong, not retired: delete it. And when an endpoint
goes, the link goes with it — mark a scene or a prop `cut` and every
link to it is cut by implication, without eleven more columns saying so
again. Adding the field everywhere would put a value on every junction
that nothing sets and nothing reads.

The two exceptions are the links where the row is itself a **claim**
rather than a connection. An actor was really attached to a part before
being recast, and dailies exist. A reading of a theme was really held
before being revised. Those are worth keeping and marking, not deleting.

Test for whether a future link should carry it: *would you want to know
this used to be true?* If yes it is a claim; if the answer is only "it
is not true now", it is a connection, and deleting it loses nothing.

Note that `lifecycle_status` is **authored but unread**: no resolver in
`scf-core` filters on it. A consumer that wants to exclude cut rows must
do so itself. See §10.

---

## 6. The direction cascade

Look and sound resolve **root-first, most specific last**: project →
sequence → scene → shot. The last layer wins, and every layer is
returned so a consumer can see where a value came from rather than only
what it resolved to.

Pinned by: `conformance.canonical.test.ts` → Q07, Q08, Q11.

---

## 7. Proposals from a screenplay

Anything extracted from a script is a **proposal**, not a fact. The
import flow stages proposals for review; only `high` confidence is
accepted by best-guess, and **props never reach `high`** — a prop is
only ever created by a human ticking a box.

The lesson worth keeping from the prop extractor: **capitalization is
not a signal.** Mid-line caps in a screenplay mean "production, take
note" — writers cap character introductions, sound cues, and
camera-worthy actions as readily as objects. Extraction keys on syntax
instead (a noun phrase after a determiner; the object of a handling
verb), filters by the head word against category lexicons, and scores.
Precision over recall, and the UI says so.

Fountain **sections** (`# ACT II`) become acts and sequences at commit
on the same terms as headings becoming scenes: the author typed it, so
creating what they named is the feature. The section's line metadata
carries `structureRef {kind, id}` so renaming a section renames its
entity instead of creating a second one.

Section **text is read before depth**: a line saying ACT is an act at
any depth. `#` = act / `##` = sequence is only the fallback, because
plenty of writers use a single `#` for sequences and never write an act
line.

---

## 8. Changing the format

1. Edit `schema/entity_registry.py`. It is the source of truth.
2. Regenerate: `python schema/generate_registry_json.py`.
3. Lint: `python schema/lint_registry.py`.
4. If the change is not purely cosmetic, bump `SCHEMA_VERSION` in
   `schema/schema_meta.py` and record it in `docs/schema-changelog.md`
   **in the same commit**.
5. Migrate `fixtures/hollow_creek.scf` if a conformance test compares
   its column set. User files need no migration: `initDatabase`
   ALTER-adds any registry column a file lacks, on open.

Prefer **additive optional fields**. Every schema change so far has been
one, which is why no file has ever needed converting.

### The fixture is part of the contract

`fixtures/hollow_creek.scf` is not sample data. Its content is asserted
by the conformance suites, and several of its properties are load-bearing:

- **Scene numbers have gaps** (1, 3, 7, 9, …). Suites address scenes by
  number; renumbering breaks every lookup.
- **Scene 12 is the pinned scene** — its motif manifest, its single
  sound cue, its costume set and its direction chains are asserted
  exactly. Add nothing to it.
- **Marcus's vocal profile is deliberately thin** and his voice bundle
  deliberately absent: the readiness suite asserts Q05 warns about
  exactly those gaps. An authored absence is part of what the fixture
  demonstrates.
- **Shot 12-04 keeps a production numbering scheme** that the app's
  derived code disagrees with, demonstrating that an authored number
  survives.
- A theme carried by both leads lights every scene, so **a second,
  narrowly carried theme** exists to demonstrate Q10's gap reporting.

Rebuild scripts live in `fixtures/build/`.

---

## 9. Assets and addressing

**Status: implemented as of schema 2.8**, except for layers. Addressing, resolution states,
the folder-is-a-project rule and per-prefix relink are live in
`scf-core/src/project.ts` and `scf-core/src/assets.ts`. Pinned by
`scf-core/test/project.test.ts` and `scf-core/test/assets.test.ts`.

An asset is a **reference**, not a container. It is how SCF stops holding
things and starts pointing at them: an image, an audio file, a 3D model, a
model weight, a document. The `asset` entity is the lowest level at which
that happens, and at working scale a project holds thousands of them.

### Identity is not location

An asset row stores an **identifier** — portable, root-relative, and the
thing that gets committed and diffed:

```
@project/characters/eleanor/face_ref.png
```

A **resolver** maps that identifier to bytes at load time. What comes back
is derived and never stored, for the same reason §2 gives everywhere else:
a stored location is a second copy of a truth that changes without asking.
Relocating a project is then a change to one root, not an update across
thousands of rows.

A **root** is a name standing in for a folder. `@project` is the folder the
user opened, and in the common case it is the only root that appears. The
grammar reserves other names — `@plates`, `@nas` — for a project that
points into storage it does not control, where the identifier stays stable
while each machine maps the root somewhere different. That mapping is
machine-local and therefore cannot live in the `.scf` without destroying
the portability it exists to serve, and each additional root costs its own
filesystem permission grant. The prefix is reserved now; the configuration
is deferred until someone needs it.

Absolute paths remain representable and are flagged non-portable. Some
projects need them, and pretending otherwise only puts lies inside the
`@project` namespace.

### A project is a folder

The File System Access API cannot return a parent directory from a file
handle — there is no `getParent()`, by design. A `.scf` opened on its own
therefore cannot see what sits beside it, which is why an asset next to the
file is unreachable through the file. One directory-picker gesture yields
the project root, the `.scf` within it, and the whole asset tree under a
single grant.

Discovery scans the root only, non-recursive, for `*.scf`. Exactly one is a
valid project; zero or several is malformed, and is reported as a finding
for the user to resolve rather than guessed at. A `.scf` in a subfolder is
never a project candidate — those are layers (below). SQLite's `-wal`,
`-shm` and `-journal` sidecars are not projects either, and their
presence is reported on its own, since it usually means the project is
open somewhere else.

**Discovery is an optimisation, not the mechanism.** Directory listing
is not reliably available: a locked-down Windows machine returned zero
entries for an ordinary Desktop folder, through three separate
iterators, with permission granted and nothing thrown — and did the same
in a bare DevTools console, so no application code was involved.
Enterprise policy is the likely cause and there is nothing to work
around. What a project needs is the root handle plus the `.scf`; when
listing cannot supply the second, the user names it in a second gesture,
and the resulting session is identical — same root, same grant, same
asset reachability. A folder that lists is one gesture; a folder that
does not is two.

`chooseProjectFile()` in `scf-core/src/project.ts` states the rule, and
takes a list of names rather than a directory handle so that it holds
without a browser. It carries `seen` — every root file the scan found —
so that "no .scf here" can show its evidence rather than being an
unarguable assertion. Pinned by `scf-core/test/project.test.ts`.

The folder is granted **readwrite**, not read. SCF writes exactly one
file, the `.scf` itself, and that file handle comes out of the root, so
a read-only grant produces a project that cannot be saved. The platform
offers no unit narrower than the folder, so the read-only rule below
stays a discipline in the code rather than a sandbox around it.

Opening a lone `.scf` still works. Every asset resolves to `missing`, the
tally is reported, and the file behaves normally in every other respect.
The single-file path degrades; it does not disappear.

### Resolution states

Every asset resolves to exactly one of:

| state | meaning |
|---|---|
| `resolved` | bytes reachable now |
| `missing` | does not resolve under its root |
| `unmaterialized` | cloud placeholder; appears on access |
| `out-of-root` | absolute or foreign root; resolvable but non-portable |

`unmaterialized` is not a kind of `missing`. A synced project full of
placeholders is healthy, and reporting it as broken on open would be a
false statement about the user's data.

Resolution stays total on half-placed data, per §2: a project where nothing
resolves opens, lists everything, and reports findings. It does not throw.

### Read-only toward the filesystem

SCF never ingests, copies, or generates files. It reads what it is pointed
at, and it exports artifacts — a shooting script, a query result as
markdown — through an explicit save gesture, for tools that do not read SCF
directly.

This says nothing about the database. Relinking, correcting an identifier,
and caching size or mtime are writes to SCF's own rows and are entirely
normal. The read-only rule is about other people's files.

Content hashing is opportunistic for the same reason. Hashing thousands of
assets at load would stall on unmaterialized files or fail outright, so
`size_bytes` and `source_mtime` serve as cheap staleness hints and a hash
is a deliberate per-asset act.

### Where meaning lives

**Format** is derived from the identifier's extension. It dispatches
preview and supports coarse filtering. It is a hint, and it is never a
claim about purpose — the same text file serves twenty purposes across a
production.

**Use** is a property of the link, not the asset.
`bundle_asset.role_in_bundle` and `asset_relationship.relationship_type`
already carry it. A file used twenty ways is twenty edges and one row.

There is deliberately no intrinsic-purpose column. `asset_type` was one,
mixing container format with editorial intent, and the fixture had already
outgrown its enum. It was deprecated in 2.7 and removed in 2.8, not
replaced: a purpose stored on the row is a second place for meaning to
live and a second place for it to go stale. `tags` remains as the user-controlled escape hatch, freeform
by intent rather than pretending to be a taxonomy.

### Organisation is derived

The **bundle graph** is the authored structure. `intent` lives on `bundle`,
and the cascade in `resolution.ts` already walks it. It does not get copied
onto the asset so that a list can group by it.

The **path tree** is a navigational view computed from the identifier's
root and segments. It costs nothing, since the identifier is stored anyway,
and it matches the folder layout a production already maintains.

Everything else is a **facet**, not a folder: format, resolution state,
lifecycle, tags, unreferenced. Facets compose; a single imposed hierarchy
is wrong for half of its users and has to be maintained by hand.

`scf-core/src/assetIndex.ts` derives all of this — `pathTree()`,
`facetsOf()`, `orphanIds()`. Orphans are computed from the registry
rather than a hand-kept list: every field anywhere in the schema whose
`referenceEntity` is `asset` counts as usage, so a junction added later
is covered without an edit. The asset table's own version columns are
excluded, because a row whose only inbound reference is its own
successor is still an orphan and counting supersession as usage would
hide exactly the rows worth finding. Pinned by
`scf-core/test/assetIndex.test.ts`, which also measures 2,000 assets
through the whole index.

The failure mode to design against is not search but **orphans** — assets
nobody linked. At scale those are what rot, so "referenced by nothing" is a
first-class query rather than something a user has to notice.

### Preview has three tiers, and the third is a real one

**native** — the browser decodes it: png, jpg, webp, gif, svg, mp4,
webm, wav, mp3, pdf, and plain text. An object URL and an element.

**decoded** — real content behind a decoder SCF does not ship: exr, dpx,
tiff, psd, glb, usd, mov, mxf. Named separately so the editor can say
"not yet" rather than "no", and so the work is scoped if anyone wants
it.

**named** — nothing to depict. Archives, caches, model weights, DCC
scene files. A LoRA is not media: it is invoked rather than looked at,
and there is no image of it failing to render. Roughly a third of the
Hollow Creek fixture sits in tiers 2 and 3, which is an honest ratio to
design against — an editor that treated "cannot preview" as an error
would be wrong about half a real project.

Sidecar thumbnails are ruled out by the read-only rule: something would
have to write them, and it will not be SCF. Tier 2 therefore means an
in-memory decoder or nothing, and today it means nothing.

`previewCapability()` in `scf-core/src/preview.ts` classifies a format.
An unknown extension lands in tier 3, never tier 1: handing an
unrecognised format to an image element yields a broken-image icon,
which reads as "this asset is broken" when the truth is "this editor
does not know that format". Pinned by `scf-core/test/preview.test.ts`.

### Metadata is read, never stored

`size_bytes` and `source_mtime` are stored because they are hints about
the REFERENCE going stale. Dimensions, channels, compression, duration
and generator are facts about the CONTENT, and they are read from the
file each time they are shown. There is no width column and there should
never be one — a stored dimension is a second copy of a truth that
changes without asking, which is the fragility §2 already names.

The accepted consequence is that **metadata cannot be queried**. A
filter over thousands of assets would mean reading thousands of files,
so if something needs storing to be queried, it does not get queried.

`readHeaderMetadata()` in `scf-core/src/fileMetadata.ts` parses headers
only — the first 96KB — so nothing is decoded and nothing large is read.
For PNG that includes the text chunks, which is where generated images
keep their provenance: Midjourney writes `Description` (prompt, flags
and job id), ComfyUI writes `prompt` and `workflow` as JSON, A1111
writes `parameters`. A workflow can exceed the slice, and a chunk
running past what was read says so rather than reporting no metadata.
Compressed text is named but not expanded — inflating needs an async
API and this parser is synchronous and pure.
That makes the metadata tier deliberately unlike the preview tier: an
EXR cannot be displayed but its attribute table parses cleanly, and a
`.glb` carries a JSON chunk describing the scene. The formats that
preview worst are often the ones where this helps most, because it is
the only way to learn anything about them without opening a DCC. Pinned
by `scf-core/test/fileMetadata.test.ts`.

### Getting an asset into a bundle

Three entities stand between a character and an asset:

```
character → character_asset_binding → bundle → bundle_asset → asset
```

The indirection earns its place — one bundle can serve several
characters, carry `precedence` and `is_baseline`, and be scoped to a
scene range or a variant — but the workflow should not mirror the
schema. `scf-core/src/bundling.ts` makes each step one action, and
`bundle_asset` membership is editable from the bundle row, which the
generic entity form could not show because it is a link entity.

Batching is the normal case, not an optimisation: after importing a
folder the real act is "these twenty into her visual identity". An asset
already in the target bundle is skipped rather than duplicated —
`bundle_asset`'s natural key is the pair (§5) — so an overlapping
selection is safe to re-apply. `order` continues from the highest
already present rather than restarting, so an appended batch lands after
what was there. Pinned by `scf-core/test/bundling.test.ts`.

A bundle with no `intent` resolves for nothing, and a bundle bound to
nobody reaches nobody. Both are easy to create by accident and neither
is visible in the bundle row itself, so binding is a distinct step
rather than an implied one.

### Import reads, and writes only rows

Authoring assets one form at a time does not survive a real project, so
files can be imported in bulk. This does not weaken the read-only rule:
import READS a set of files the user picked and writes rows into the
`.scf`. Nothing is copied, moved, or created on disk, and what lands in
the database is an address rather than a payload.

Import never uses `entries()`, because enumeration is not available
everywhere (above). Two routes avoid it:

**A folder**, via `<input type="file" webkitdirectory>`. It pre-dates
the File System Access API and walks the directory inside the browser's
own picker process, returning a flat FileList with `webkitRelativePath`
on each entry — a different code path that works on machines where
`entries()` returns nothing. Its catch is the anchor: paths start at the
folder the user picked, and a `File` carries no handle, so `resolve()`
cannot be asked where that folder sits. `candidatePaths()` produces the
readings worth trying and each is settled by TRAVERSAL, walking the root
to see which is actually there. A file matching no reading is reported
rather than imported under a guessed address.

**Selected files**, via a multi-select picker plus
`FileSystemDirectoryHandle.resolve()`, which traverses rather than
enumerating and gives the path segments from the root down to a handle
directly.

Identity for this purpose is the **identifier**, not the filename: two
files called `plate.exr` in different folders are two assets, the same
file offered twice is one, and re-importing a folder after adding three
files creates three rows and touches nothing else. A file picked from
outside the project folder is reported and skipped rather than imported
as an absolute path, since silently producing non-portable addresses
would undo the point of this section. `planAssetImport()` and
`applyAssetImport()` in `scf-core/src/assetImport.ts`, pinned by
`scf-core/test/assetImport.test.ts`.

### Queries carry references, never bytes

Asset-bearing query output carries identifier, format, role, intent,
provenance, and resolution state. The consumer fetches what it needs. The
resolver stays the only thing that touches disk, and a context pack stays
proportionate at scale.

Every export carries a **resolution report** — referenced, resolved, and
missing, with the missing ones named. Silently omitting three unresolvable
references would be the reporting failure §2 already forbids elsewhere.

`mediaReferences()` in `scf-core/src/mediaReferences.ts` turns a Q13
cascade into references and their states. An asset reached through more
than one layer is reported once, at the layer that won — the cascade
returns most-specific-first, so an override beats the base bundle it
shadows. The report also distinguishes "no folder attached" from "the
files are gone": a session opened without a project folder resolves
nothing, and saying so is different from claiming a hundred assets are
missing.

The locator is injected into the query layer rather than imported, so
`runners.ts` stays runnable without the app store or its SQL worker.
Pinned by `scf-core/test/mediaReferences.test.ts`, including an
assertion that no export ever contains `base64`, `blob:` or `data:`.

### Another `.scf` is not an asset

A `.scf` that points at another `.scf` is doing **composition**, not
reference: it raises whether the entities arrive, whether they can be
overridden, and which opinion wins. That is the same territory as the
cross-file merge deferred in §10, and it is not settled by anything above.

The word for it is **layer**, and layers live in a subfolder, never at the
root. Nothing else about them is specified. Admitting one as "just another
file type" under `asset` would make `asset` the composition mechanism by
accident, which is how a format acquires a permanent wart.

---

## 10. Open questions

Each is marked **schema** (the format has to change), **editor** (only
this application), or **both**.

- **Filtering on `lifecycle_status`.** *(both)* Every non-link entity
  carries it, nothing in `scf-core` reads it, and the fixture has no
  non-active row — so "cut" is currently decorative. Deciding it means
  answering whether resolvers should exclude cut rows by default, which
  would change the answer to every canonical query, and whether a
  consumer can still ask for history. Until then, treat a `cut` row as
  present unless you filter it yourself.
- **Locking, beyond numbering.** *(editor)* The numbering half is built
  — see Resolved. What is not: revision colours, A-pages, locked page
  breaks, and a stored record of codes that once existed so a reissued
  shot list cannot reuse a retired one. `nextShotNumber` continues from
  the highest code rather than backfilling, but the database keeps no
  memory of deleted codes, so deleting the last shot in a scene frees its
  code again. A production that needs the stronger promise wants a stored
  counter.
- **Import never writes to the imported file** *(editor)* — a
  .fountain/.fdx import reads through a plain `<input type="file">`,
  which hands the page a read-only snapshot and no handle back to the
  disk. Only two paths can write: `adapter.save`, whose token comes
  solely from an .scf the user opened or a Save-As destination they
  picked, and `.fountain` EXPORT, which always creates a new download
  named after the project. There is no path by which editing a project
  can modify the file it was imported from.
- **The clipboard carries text, nothing else** *(editor)* — copy, cut and
  paste move plain text with no links, no types and no identity. Editing
  text is never how a record is created or destroyed. A scene is moved,
  duplicated or removed from the Scene Rail, where the operation is a
  database operation and says so. Paste still assigns identity
  explicitly, because CodeMirror's split rule would otherwise hand pasted
  text the id — and therefore the scene — of the line it pushed down.
- **What belongs to a scene** *(editor, derived from the registry)* — a
  field named `scene_id` means the row BELONGS to the scene and is
  deleted with it; any other reference to `scene` means the row POINTS AT
  the scene and only loses the pointer. So shots, beats and cues die with
  the scene while a motif's `first_appearance_scene_id` survives with a
  cleared reference. Act and sequence `start_scene_id` are excluded from
  both and re-anchored first. The rule is derived, so adding an entity
  needs no edit.
- **Version identity** *(schema 2.6)* — `screenplay_version_lines`
  carries both `uuid` (the snapshot row's own) and `source_uuid` (the
  live line it was taken from). They are never interchangeable, and
  `source_uuid` may point at a line that no longer exists. Revert
  restores identity from it. **Revert is retired** and the version system
  is scheduled for replacement: a version snapshots the SCRIPT, not the
  records it points at, so it could never restore a scene, character or
  location deleted since. An SCF describes what is in the film, not
  everything that has been tried — external file versioning is the right
  tool for that, and reintegrating pieces from another .scf is the
  eventual answer. Publish and diff remain; they are read-only.
- **Merging two files.** *(editor, later)* The live use for junction
  natural keys (§5), and the point at which uuids stop being enough.
  Matching links requires resolving their endpoints first, which is a
  merge algorithm. It belongs with multi-user work, not before.
- **A real spec.** *(both)* When the format stabilizes: registry, this
  document, the fixture, and the canonical query expectations as data
  rather than as test code, so a third consumer costs an afternoon
  instead of a port.

### Resolved

- **Junction identity** *(schema)* — junctions already carry `uuid`;
  what they lacked was a stated natural key, now in
  `scf-core/src/junctions.ts`. §5.
- **Soft-retiring a link** *(schema)* — deliberate: links inherit their
  endpoints' lifecycle, except the two that are claims rather than
  connections. §5.
- **Sequences crossing act boundaries** *(editor)* — legal and
  unrestricted. The renderers were the thing that had to change. §4.
- **Scene order, and the numbering half of locking** *(both, schema 2.5)*
  — two answers that turned out to be one.

  Story order comes from the SCREENPLAY when one exists: the `line_order`
  of the heading carrying each scene. `scene_number` is a LABEL for that
  position, not the position itself. Ordering by it alone was wrong in
  both directions — a blank-written project has no numbers at all, so
  order collapsed to insertion order and a scene added mid-act sorted to
  the end of the film; and a scene moved since the last commit carries a
  number that no longer matches the page. `scenePositions` and
  `sceneOrderHint` in `scf-core/src/structure.ts` are the derivation;
  `SCENE_ORDER_JOIN` / `SCENE_ORDER_BY` are its SQL twin, for callers
  that list scenes straight from a query. **A consumer that sorts scenes
  by `scene_number` alone will be wrong about both cases.**

  `project.scene_numbering` (`derived` | `fixed`, default `derived`) is
  the gate, and it sits exactly where this section predicted: the
  renumber block in `commitStructure`. `derived` recomputes scene numbers
  from the script's order at every commit and clears them for scenes with
  no heading. `fixed` never touches them — which an import needs, because
  a production's own numbering may be gapped or out of sequence and is
  data, not a derivation. Imports of numbered scripts set it.

  Shot codes are under the same flag. `shots.ts` says a shot number is
  never rewritten because `42A` is issued to a crew — but that was
  written as though the script were always locked, and nobody holds paper
  on an unlocked one. `42A` in a scene now numbered 43 is stale, not
  stable. So `derived` restamps the prefix and keeps the letter, and
  `fixed` freezes scene numbers and shot codes together, which is the
  state a distributed shot list needs.

  Act and sequence numbers are NOT gated: they are structural labels the
  app has always owned, and no crew holds paper on one. `renumberSpans`
  is shared by the script commit and the Structure tab, which both move
  boundaries.
- **A scene cut from the screenplay** *(editor)* — derived and badged,
  never written. The entity survives by design; what it loses is a
  position, so it has no number and belongs to no act. `orphanedScenes`
  reports it and the rail badges it. Nothing stamps `status = 'cut'`,
  because `status` is authored (outline / draft / revised / locked / cut)
  and overwriting it on a commit would destroy what the author put there
  with nowhere to remember it for the trip back. Marking a scene cut
  stays the author's own act. This is deliberately NOT an answer to the
  `lifecycle_status` question above, which is still open.
