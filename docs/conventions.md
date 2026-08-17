# SCF design record

**Why the format is the way it is.**

The rules live in [`spec/scf-spec.md`](../spec/scf-spec.md). This
document explains them: what each decision cost, what was rejected, and
which ones were learned by breaking something. Every rule below was a
decision with a live alternative.

**This document states no rules.** Where a rule is needed, it is cited
as `spec §N` and not restated. That constraint is deliberate: two
documents stating the same rule in different words is worse than one
document mixing rule and reason, because only one of them gets updated.
If you find a rule stated here and nowhere else, that is a defect —
move it to the specification and cite it from here.

Section numbers match the specification's where they can. Sections 10
and 11 have no counterpart there and are the working record.

---

## 1. What SCF is — the describing/enforcing choice

`spec §9.1` says SCF describes and does not enforce. The alternative was
a schema with real constraints: unique indexes on natural keys, check
constraints on enums, foreign keys that refuse.

It was rejected because **a half-entered project is the normal state of
work.** A format that refuses incomplete data is a format nobody
finishes filling in — the first hour of use is exactly when the data is
at its least complete, and a tool that argues during that hour does not
get a second one.

The cost is real and lands on consumers: nothing may be assumed
well-formed because it exists. That cost is paid once, in the resolver
layer, rather than every time a user tries to save. `spec §9.2` is the
discipline that makes it survivable — a resolver that throws on
half-placed data pushes the cost straight back out to the user.

A secondary reason: several of the constraints one would want cannot be
expressed correctly anyway. `spec §6.4` explains why a unique index
could not decide whether a reversed directed relationship pair is a
duplicate.

---

## 2. Derived versus stored

`spec §3` is the oldest rule in the format and has been the source of
more bugs in this project than anything else — every one of them the
same bug, which is a stored copy of a derivable fact quietly becoming a
lie.

The scene label case is the clearest: store `sc 12 — The Kitchen` and a
rename strands every copy, with nothing to detect it.

The link-label case cost real user-visible damage before it was
understood. Twelve of thirteen link entities declare their `nameField`
`hidden`, because the importer parks cue text in that column. Displaying
it made a character's entire scene list read as that character's own
name. The fix was not to stop parking text there — the column is useful
— but to derive the label from the rows the link points at, which is
what it always meant.

### Why `shot_number` is the exception

`spec §3.3`. A shot number is not a display label; it is an identifier
issued to a crew. Once a shot list goes out, 42A stays 42A even when the
scene renumbers, because paperwork exists on paper and people are
holding it.

The apparent contradiction — an authored value that duplicates a
derivable one — resolves on a distinction: a shot moved to a different
scene *is* renumbered. The rule protects a number against its scene
renumbering. It does not protect a number that names the wrong scene.

The app shows the derived code beside a disagreeing authored one, so a
list can be reissued deliberately rather than drifting.

### `screenplay_lines.scene_id` — a known fragility

`spec §3.4` prohibits relying on it, which is an unusual thing for a
specification to say about a column that exists.

It is derived state that happens to be stored: threaded onto body lines
at commit, absent for lines typed since, and absent entirely for files
written before the threading existed. It was kept because it makes some
queries much cheaper, and prohibited because the cheapness is a trap.

The alternative reading — heading line to next heading — is not a
workaround. Commit enforces one scene per heading, and "slugline to
slugline" is what a scene means anyway. `scf-app/test/sceneScript.test.ts`
nulls every body line's `scene_id` and asserts identical output, which is
the test that keeps the prohibition honest.

---

## 3. Position and persistence

`spec §4`. Story order comes from the screenplay because the screenplay
is the only place the order actually lives. This was learned the hard
way: ordering by `scene_number` alone was wrong in both directions at
once. A blank-written project has no numbers at all, so order collapsed
to insertion order and a scene added mid-act sorted to the end of the
film. And a scene moved since the last commit carries a number that no
longer matches the page.

The three position patterns exist because three genuinely different
things are being modelled, and collapsing them would make two of them
wrong:

- **Explicit rows** for things that are simply true at a scene — a
  costume, a prop present. No inference is wanted; what is in force is
  what someone wrote.
- **Persistence** for states with a duration. An injury taken at sc 9 is
  still in force at sc 12. Hoarseness from the same scene is not. The
  difference is not derivable from the state itself, so it is authored:
  `scene_only` or `until_resolved`.
- **Latest wins** for things that change rather than persist. A
  relationship's temperature at sc 20 is whatever the last row at or
  before sc 20 says. There is no "until" — the next row supersedes, and
  an author who had to close each state before opening the next would
  spend their time on bookkeeping.

Oldest-first merging for overlapping persistent states is the reading
that lets a later state override an earlier one field by field, which is
how a stacked injury and exhaustion actually compose.

---

## 4. Structure: why spans, and what it costs

`spec §5`. An act begins at a scene; membership is derived. The
alternatives were a start/end pair, or a row per scene.

Start-only wins on four counts:

- overlaps and gaps become inexpressible, so there is nothing to
  validate;
- a scene inserted mid-act joins it with no write at all;
- there is no end anchor to drift out of sync when scenes move;
- "scenes 32–54 are Act II" is two placements, not 23 rows.

**The cost, accepted deliberately: spans must be contiguous.** A
cross-cut sequence interleaved with another cannot be expressed. If that
requirement ever arrives, enumerated membership is the only model that
supports it, and this one must be *replaced* rather than patched —
adding an exception to a model whose whole value is inexpressibility
would give up the four benefits above and keep the complexity.

### Independence, not hierarchy

Acts and sequences do not nest (`spec §5.3`). Membership used to be
reachable only through `scene_sequence`, which meant a scene could not
be in an act without also being in a sequence — the change was made
precisely to break that.

Allowing a sequence to cross an act boundary is deliberate. A montage or
a cross-cut can bridge an act break, and forbidding it would buy
tidiness at the cost of a real structure.

The consequence lands on renderers, not on data, and it caught both
outlines before it was understood: grouping by "sequences whose start
falls in this act" draws a crossing sequence's later scenes under the
wrong act, and again under the right one. Run-grouping (`actOutline()`)
is the correct shape — a crossing sequence appears in each act as the
part of it that belongs there.

### Shadow rows

`scene_sequence` rows are materialised at commit so queries written
before spans keep working. The boundary is the truth; those rows are its
shadow.

This is an acknowledged violation of §2 — derived state that is stored —
kept for compatibility rather than because it is right. `spec/stability.md`
marks it Unstable for that reason, and 1.0 is the moment to decide
whether it survives. Rows no boundary explains are counted and reported
rather than deleted, since deleting data to satisfy a derivation is how
you lose someone's work.

---

## 5. Identity

`spec §6`. Two different questions get confused constantly, and the
format answers them with two different mechanisms.

**Lineage** — is this the same row as before, across export, re-import
and versioning? Answered by `uuid`. An earlier version of this document
claimed junctions did not carry one; that was wrong, and the note is
kept here so the error is not rediscovered.

**Cross-file sameness** — is this row the same *thing* as that row in
another file? Uuids cannot answer it, because a uuid is minted per file:
two people describing the same production mint different ones for the
same link. That question needs a **natural key** — the rows joined, plus
the polymorphic target, plus `domain` where present, since a motif may
legitimately appear in one scene both visually and sonically.

`junctionKeyFields()` states the key for all thirteen link entities in
one place, so that merging, de-duplicating and validating cannot
disagree about it. Merge does not exist yet; when it does, this is the
thing it will stand on.

### Why duplicates are findings

Two rows sharing a natural key split the link's authored content — a
role, a usage note — and a reader taking the first finds half of it.
That is worth reporting loudly, and reporting *more* loudly when the
duplicates disagree, since identical duplicates are only clutter.

It is not worth a constraint, for the reason `spec §6.4` implies and
this document can state plainly: a unique index could not decide the
hard cases. Several relationships between the same two people are
legitimate. A reversed directed pair may be one fact or two.

### Relationships, and why `directionality` exists

`character_relationship` has no constraint on its two character columns
and no convention about which character goes first. The same pair can be
entered twice, or once from each end, splitting its `relationship_state`
history across two rows that a latest-wins lookup cannot reconcile.

The missing fact was **symmetry**. Without it, nothing can distinguish
one relationship entered twice from two legitimate directed facts.
Schema 2.4 added `directionality` for exactly that, and the seven
reported cases in `spec §6.5` are the complete enumeration of what the
two columns plus that flag can mean.

`character_relationship` is not one of the thirteen link entities — its
`subject` is `character` — so junction tooling skips it entirely and
`relationshipFindings()` covers it separately. That asymmetry surprises
people, including its author, twice.

### Soft-retiring: why only two links carry `lifecycle_status`

A link is a statement that a connection exists. If the connection stops
existing, the row is *wrong*, not retired — delete it. And when an
endpoint goes, the link goes with it: mark a scene or a prop `cut` and
every link to it is cut by implication, without eleven more columns
saying so again.

The two exceptions are the links where the row is a **claim** rather
than a connection. An actor really was attached to a part before being
recast, and dailies exist. A reading of a theme really was held before
being revised. Those are worth keeping and marking.

The test for a future link: *would you want to know this used to be
true?* If yes it is a claim. If the answer is only "it is not true now",
it is a connection, and deleting it loses nothing.

Note that `lifecycle_status` is currently **authored but unread** — no
resolver filters on it, and the fixture has no non-active row, so "cut"
is decorative today. `spec §6.6` marks this as the open normative gap it
is; §10 below is where the decision gets made.

---

## 6. The direction cascade

`spec §7`. The chain is the `refines` closure of a named leaf, and every
contributing entity is returned.

The `refines` field carried this meaning from the beginning and went
undocumented until 0.17, when an independent implementation reverse-
engineered it from the data — correctly, and only because Q07's ordering
ruled out every other reading. §7 had until then described a scope
ordering that the code never implemented. The lesson is narrow and worth
keeping: the cascade was built as a graph walk and described as a
hierarchy, and nobody noticed for as long as the only reader was the one
that wrote it.

Returning the whole chain matters more than it looks. Returning only the resolved
value makes the answer unarguable and unexplainable at the same time — a
supervisor asking "why is she lit this way here" gets a value and no
provenance. Returning the chain costs nothing and turns the cascade into
something a person can reason about.

---

## 7. Proposals from a screenplay

`spec §9.3`. Extraction produces proposals, never facts, and props never
reach automatic acceptance.

The lesson worth keeping from the prop extractor: **capitalization is
not a signal.** Mid-line caps in a screenplay mean "production, take
note" — writers cap character introductions, sound cues and
camera-worthy actions as readily as objects. The first version keyed off
caps alone and produced 356 candidates from one feature, led by TWO OLD
HUNTERS, SUN, HOWLING and TOSSES THE MEN. Worse, scripts that do not use
the convention produced almost nothing, since nothing about being a prop
makes a word capitalized.

Extraction keys on syntax instead — a noun phrase after a determiner,
the object of a handling verb — filters by head word against category
lexicons, and scores. Precision over recall, and the UI says so.

That scorer remains tuned to the corpus it was built against. On a
script that does not cap objects mid-line, the "introduced" signal never
fires at all and the whole ranking collapses onto one signal; set
dressing then scores like a plot-bearing prop, because recurrence and
handling are all that is left to read. `scf-core/test/props.test.ts`
carries a named regression test recording that gap rather than hiding
it.

Fountain **sections** (`# ACT II`) become acts and sequences at commit
on the same terms as headings becoming scenes: the author typed it, so
creating what they named is the feature. The section's line metadata
carries `structureRef {kind, id}` so renaming a section renames its
entity instead of creating a second one.

Section **text is read before depth** — a line saying ACT is an act at
any depth. `#` = act / `##` = sequence is only the fallback, because
plenty of writers use a single `#` for sequences and never write an act
line.

---

## 8. Changing the format

The procedure:

1. Edit `schema/entity_registry.py`. It is the source of truth.
2. Regenerate: `python schema/generate_registry_json.py`.
3. Lint: `python schema/lint_registry.py`.
4. If the change is not purely cosmetic, bump `SCHEMA_VERSION` in
   `schema/schema_meta.py` and record it in `docs/schema-changelog.md`
   **in the same commit**.
5. Migrate `fixtures/hollow_creek.scf` if a conformance test compares
   its column set. User files need no migration — `initDatabase`
   ALTER-adds any registry column a file lacks, on open.
6. Re-emit the published artifacts, the negative fixtures' blessed
   reports, and the checksums:

   ```sh
   cd scf-core && npm run emit-schema-sql && npm run emit-finding-catalog \
     && npm run bless-negative && cd ..
   cd scf-app && npm run bless-queries && cd ..
   python3 schema/artifact_manifest.py
   ```

   The query expectations are blessed here because a schema change can
   alter what a runner returns without any test failing on its own
   terms.

7. Tag it, which is what makes the published URLs resolve:

   ```sh
   git tag -s schema-X.Y -m 'schema X.Y'
   git push origin schema-X.Y
   ```

Since the specification exists, two more steps apply when the change
touches anything normative:

8. Update `spec/scf-spec.md`, and its version, per `spec §11.5`.
9. Update the affected row in `spec/stability.md`.

**Prefer additive optional fields.** Every schema change so far has been
one, which is why no file has ever needed converting. `spec §11.1` now
makes that a requirement rather than a habit.

### The rule that keeps this document honest

This document may not state a rule. When a change adds one, it goes in
the specification and is cited here with its reason. When a change
removes one, the reason stays here as history — a rejected alternative
is worth keeping even after the thing it was rejected in favour of has
also gone.

### The fixture is part of the contract

`fixtures/hollow_creek.scf` is not sample data; `spec/conformance.md` §5.1
enumerates the properties that are load-bearing.

Why a fixture rather than generated data: several of the properties
being asserted are *absences*. Marcus's vocal profile is deliberately
thin and his voice bundle deliberately missing, so that the readiness
suite has something real to warn about. A generator producing complete
data would have nothing to say about incompleteness, which is half of
what this format has to handle well.

The gapped scene numbers exist for the same reason — real productions
have them, and a fixture numbered 1..n would let a whole class of
ordering bug through. That one nearly escaped: a migration set
`project.scene_numbering` to `derived`, which would have renumbered
Hollow Creek on first commit and silently changed the subject of every
"sc 12" assertion in the suite.

---

## 9. Assets and addressing

`spec §8`. Implemented as of schema 2.8, except layers.

An asset is where SCF stops holding things and starts pointing at them.
At working scale a project holds thousands, and the failure mode to
design against is not search but **orphans** — assets nobody linked.
Those are what rot, so "referenced by nothing" is a first-class query
rather than something a user has to notice.

### Identity is not location

A stored location is a second copy of a truth that changes without
asking, which is §2's fragility in a new place. Storing a portable
identifier and deriving bytes through a resolver makes relocating a
project a change to one root rather than an update across thousands of
rows.

Roots beyond `@project` are reserved but unconfigured. A project
pointing into storage it does not control needs the identifier to stay
stable while each machine maps the root somewhere different — which
means the mapping is machine-local and therefore cannot live in the
`.scf` without destroying the portability it exists to serve. Each
additional root also costs its own filesystem permission grant. The
prefix is reserved now; the configuration is deferred until someone
needs it.

Absolute paths stay representable because some projects need them.
Pretending otherwise would only put lies inside the `@project`
namespace.

### The project folder is a workflow, not the format

`spec §0.3` is explicit that the unit of interchange is the `.scf`.
This subsection is about why the *editor* asks for a folder anyway.

The File System Access API cannot return a parent directory from a file
handle — there is no `getParent()`, by design. A `.scf` opened on its
own therefore cannot see what sits beside it, which is why an asset next
to the file is unreachable through the file. One directory-picker
gesture yields the root, the `.scf` within it, and the whole asset tree
under a single grant.

Discovery scans the root only, non-recursive, for `*.scf`. Exactly one
is a valid project; zero or several is reported for the user to resolve
rather than guessed at. A `.scf` in a subfolder is never a candidate —
those are layers. SQLite's `-wal`, `-shm` and `-journal` sidecars are
not projects either, and their presence is reported on its own, since it
usually means the project is open somewhere else.

**Discovery is an optimisation, not the mechanism.** Directory listing
is not reliably available: a locked-down Windows machine returned zero
entries for an ordinary Desktop folder, through three separate
iterators, with permission granted and nothing thrown — and did the same
in a bare DevTools console, so no application code was involved.
Enterprise policy is the likely cause and there is nothing to work
around. What a project needs is the root handle plus the `.scf`; when
listing cannot supply the second, the user names it in a second gesture,
and the resulting session is identical. A folder that lists is one
gesture; a folder that does not is two.

`chooseProjectFile()` takes a list of names rather than a directory
handle, so the rule holds without a browser. It carries `seen` — every
root file the scan found — so "no .scf here" can show its evidence
rather than being an unarguable assertion.

The folder is granted **readwrite**, not read. SCF writes exactly one
file, the `.scf` itself, and that handle comes out of the root, so a
read-only grant produces a project that cannot be saved. The platform
offers no unit narrower than the folder, which is why the read-only rule
below is a discipline in the code rather than a sandbox around it.

Opening a lone `.scf` still works, and `spec §0.3` makes that the
normative case rather than a degraded one.

### Resolution states

`spec §8.3`. `unmaterialised` is not a kind of `missing`: a synced
project full of placeholders is healthy, and reporting it as broken on
open would be a false statement about the user's data. `unaddressed` is
likewise not `missing` — a session opened with no root supplied resolves
nothing, and saying so is different from claiming a hundred assets are
gone.

### Read-only toward the filesystem

SCF never ingests, copies or generates files. It reads what it is
pointed at, and exports artifacts — a shooting script, a query result as
markdown — through an explicit save gesture, for tools that do not read
SCF directly.

This says nothing about the database. Relinking, correcting an
identifier and caching size or mtime are writes to SCF's own rows and
are entirely normal. The read-only rule is about other people's files.

Content hashing is opportunistic for the same reason: hashing thousands
of assets at load would stall on unmaterialised files or fail outright,
so `size_bytes` and `source_mtime` serve as cheap staleness hints and a
hash is a deliberate per-asset act.

Sidecar thumbnails are ruled out by this rule too — something would have
to write them, and it will not be SCF.

### Where meaning lives

**Format** is a hint and never a claim about purpose; the same text file
serves twenty purposes across a production.

**Use** is a property of the link. A file used twenty ways is twenty
edges and one row.

There was an intrinsic-purpose column. `asset_type` mixed container
format with editorial intent, and the fixture had already outgrown its
enum. It was deprecated in 2.7 and removed in 2.8, and deliberately not
replaced: a purpose stored on the row is a second place for meaning to
live and a second place for it to go stale. `tags` remains as the
user-controlled escape hatch, freeform by intent rather than pretending
to be a taxonomy.

### Organisation is derived

The **bundle graph** is the authored structure, and the cascade already
walks it. It does not get copied onto the asset so that a list can group
by it.

The **path tree** is a navigational view computed from the identifier's
segments. It costs nothing, since the identifier is stored anyway, and
it matches the folder layout a production already maintains.

Everything else is a **facet**, not a folder: format, resolution state,
lifecycle, tags, unreferenced. Facets compose. A single imposed
hierarchy is wrong for half of its users and has to be maintained by
hand.

Orphan counting excludes the asset table's own version columns, because
a row whose only inbound reference is its own successor is still an
orphan — counting supersession as usage would hide exactly the rows
worth finding.

### Preview has three tiers, and the third is a real one

**native** — the browser decodes it: png, jpg, webp, gif, svg, mp4,
webm, wav, mp3, pdf, plain text. An object URL and an element.

**decoded** — real content behind a decoder SCF does not ship: exr, dpx,
tiff, psd, glb, usd, mov, mxf. Named separately so the editor can say
"not yet" rather than "no", and so the work is scoped if anyone wants
it. Today it means nothing, since sidecar thumbnails are ruled out and
an in-memory decoder is the only remaining option.

**named** — nothing to depict. Archives, caches, model weights, DCC
scene files. A LoRA is not media: it is invoked rather than looked at,
and there is no image of it failing to render.

Roughly a third of the Hollow Creek fixture sits in tiers 2 and 3, which
is an honest ratio to design against — an editor treating "cannot
preview" as an error would be wrong about half a real project.

An unknown extension lands in tier 3, never tier 1: handing an
unrecognised format to an image element yields a broken-image icon,
which reads as "this asset is broken" when the truth is "this editor
does not know that format".

### Metadata is read, never stored

`size_bytes` and `source_mtime` are stored because they are hints about
the *reference* going stale. Dimensions, channels, compression, duration
and generator are facts about the *content*, and a stored dimension is
the §2 fragility again.

The accepted consequence is that **metadata cannot be queried**. A
filter over thousands of assets would mean reading thousands of files,
so if something needs storing to be queried, it does not get queried.

`readHeaderMetadata()` parses headers only — the first 96KB — so nothing
is decoded and nothing large is read. For PNG that includes the text
chunks, which is where generated images keep their provenance:
Midjourney writes `Description` (prompt, flags and job id), ComfyUI
writes `prompt` and `workflow` as JSON, A1111 writes `parameters`. A
workflow can exceed the slice, and a chunk running past what was read
says so rather than reporting no metadata. Compressed text is named but
not expanded — inflating needs an async API and this parser is
synchronous and pure.

That makes the metadata tier deliberately unlike the preview tier: an
EXR cannot be displayed but its attribute table parses cleanly, and a
`.glb` carries a JSON chunk describing the scene. The formats that
preview worst are often the ones where this helps most, because it is
the only way to learn anything about them without opening a DCC.

### Getting an asset into a bundle

Three entities stand between a character and an asset:

```
character → character_asset_binding → bundle → bundle_asset → asset
```

The indirection earns its place — one bundle can serve several
characters, carry `precedence` and `is_baseline`, and be scoped to a
scene range or a variant — but the workflow should not mirror the
schema. `bundling.ts` makes each step one action, and `bundle_asset`
membership is editable from the bundle row, which the generic entity
form could not show because it is a link entity.

Batching is the normal case, not an optimisation: after importing a
folder the real act is "these twenty into her visual identity". An asset
already in the target bundle is skipped rather than duplicated —
`bundle_asset`'s natural key is the pair — so an overlapping selection
is safe to re-apply. `order` continues from the highest already present,
so an appended batch lands after what was there.

A bundle with no `intent` resolves for nothing, and a bundle bound to
nobody reaches nobody. Both are easy to create by accident and neither
is visible in the bundle row itself, so binding is a distinct step
rather than an implied one.

### Import reads, and writes only rows

Authoring assets one form at a time does not survive a real project, so
files can be imported in bulk. This does not weaken the read-only rule:
import READS a set of files the user picked and writes rows into the
`.scf`. Nothing is copied, moved or created on disk, and what lands in
the database is an address rather than a payload.

Import never uses `entries()`, because enumeration is not available
everywhere. Two routes avoid it:

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
would undo the point of this section.

### Queries carry references, never bytes

The consumer fetches what it needs. The resolver stays the only thing
that touches disk, and a context pack stays proportionate at scale.

Every export carries a resolution report because silently omitting three
unresolvable references would be the reporting failure §1 already
forbids elsewhere.

`mediaReferences()` turns a Q13 cascade into references and their
states. An asset reached through more than one layer is reported once,
at the layer that won — the cascade returns most-specific-first, so an
override beats the base bundle it shadows.

The locator is injected into the query layer rather than imported, so
`runners.ts` stays runnable without the app store or its SQL worker.
`scf-core/test/mediaReferences.test.ts` includes an assertion that no
export ever contains `base64`, `blob:` or `data:`.

### Another `.scf` is not an asset

A `.scf` pointing at another `.scf` is doing **composition**, not
reference: it raises whether the entities arrive, whether they can be
overridden, and which opinion wins. That is the same territory as the
cross-file merge deferred below, and nothing above settles it.

The word for it is **layer**. Admitting one as "just another file type"
under `asset` would make `asset` the composition mechanism by accident,
which is how a format acquires a permanent wart. `spec §8.8` reserves
the term and specifies nothing else, deliberately.

---
## 10. Open questions

Each is marked **schema** (the format has to change), **editor** (only
this application), or **both**.

- **Filtering on `lifecycle_status`.** *(both)* Every non-link entity
  carries it, nothing in `scf-core` reads it, and the fixture has no
  non-active row — so "cut" is currently decorative. Deciding it means
  answering whether resolvers should exclude cut rows by default, which
  would change the answer to every canonical query, and whether a
  consumer can still ask for history. **This is now a 1.0 blocker**, not
  merely an open question: `spec §6.6` carries a normative gap that
  cannot ship unfilled, since a specification saying "do what you like"
  means every consumer answers the canonical queries differently and all
  of them conform. Deciding it also needs a fixture containing cut rows.
  Until then, treat a `cut` row as present unless you filter it
  yourself.
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
- **A real spec.** *(both)* **In progress.** `spec/scf-spec.md` 0.9 is
  the normative document, `spec/stability.md` tracks what is safe to
  build against, and `spec/conformance.md` states the roles. What
  remains from the original form of this question: the canonical query
  expectations as DATA rather than as test code, so a third consumer
  costs an afternoon instead of a port. See `spec/conformance.md` §5.4.

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
