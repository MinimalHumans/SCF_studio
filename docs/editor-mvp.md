<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# The editor MVP — what remains

Consolidated from the second-implementation design doc
(`20260715_SCF_Second_Implementation.md`, never in the repository) and
checked against `SCF_studio@main`, 2026-08-26 — spec 0.51, schema 2.13.

It lives here rather than as an upload for the same reason rev 11 of the
release checklist does: *rev 10 lived outside the repository and had
drifted into describing a project that did not exist.* Every `Part N`
reference in the source pointed at a document no contributor could open,
which is exactly how this document came to be written.

✅ done · ◑ partial · ○ not started · ⚠️ decision needed

---

## 1. The vocabulary, so it stops getting lost

The design doc split the second implementation into four Parts plus a
foundation. **They are work packages, not versions**, and they were
deliberately built out of numeric order.

| | Package | Built in | Status |
|---|---|---|---|
| — | `scf-core` + conformance parity | 1st | ✅ |
| **Part 1** | Entity browser / editor — form generator, both navigation modes, position-aware editing | 2nd | ✅ Schema + Subjects tabs |
| **Part 2** | Fountain/FDX parser + golden corpus — pure library, no UI | 4th | ✅ three stages, repair pass, re-import differ |
| **Part 3** | **Screenplay editor** — row-native CodeMirror 6, line identity in editor state, beats/prop-tags/versions | 5th (last, on purpose) | ✅ landed |
| **Part 4** | Query page — all sixteen canonical queries, three consumer modes each | 3rd | ✅ |

**Part 3 is the screenplay editor.** It was scheduled last because it
was the highest-risk UI and because it depended on all three others:
the row model as its document state, Part 2's proposals to stage,
Part 1's entities to link against.

It landed. `scf-app/src/editor/` is 4,907 lines across eleven modules
(`lineState`, `screenplayDoc`, `features`, `importPipeline`,
`structureCommit`, `sceneMove`, `sceneOps`, `shootOps`, `pasteLines`,
`extensions`, `integrity`), `ScriptView.tsx` is 1,448 lines, and the
Script tab is the first tab in the app.

**Nothing is waiting on "Part 3" any more.** Where the phrase still
appears in a comment it is a historical reference and should be read as
one; where it appears in *output*, it is a bug — see §2.

---

## 2. ✅ Q04 carries the scene's text — spec 0.49

Four sites told the user that screenplay text was coming:

> *Screenplay text joins this package when Part 3 lands.*

Part 3 had landed. The sentence was false in the shipped product and in
every copy-as-context block a user pasted into an LLM session.

**Resolved by adding the member rather than deleting the note.** The
alternative — stating in §12.17 that Q04 deliberately excludes the text
— was cheaper and defensible, since the Script tab is one click away.
It was rejected because it would have left the app free to render
something the normative result does not carry, which is the
two-descriptions-drift failure mode this project has paid for twice.

**§12.17.1** now defines the member. What it had to settle, and did:

- **Which lines.** The scene's heading and every line after it up to but
  not including the next heading by `line_order` — §3.4 restated as a
  result. The terminating bound is the next heading whichever scene owns
  it, **including a cut one**: those lines are absent because the bound
  stops before them, not because §6.6.1 filtered them, and a screenplay
  line carries no `lifecycle_status` to filter on.
- **The shape.** `screenplay_lines` is a `uuidExtraTable` carrying uuid
  identity on §6.1's terms, so its rows are ordinary projected rows
  under §12.1.2 — the only difference being that the column names come
  from `screenplay-tables.json` (§1.3.1) rather than the registry. That
  avoided inventing a sixth derived-record shape, which is what run 4's
  G-10 finding was about.
- **`scene_id` is omitted, not resolved.** §3.4 says implementations
  MUST NOT rely on it. A normative answer carrying it would invite
  exactly that.
- **The empty case is an answer.** Fixture scene 17 has no heading line
  — a scene authored in the database the screenplay has not reached —
  so `[]` is exercised and cannot be guessed as "never empty".

The derivation moved from `scf-app/src/editor/shootOps.ts` into
`scf-core/src/screenplay/sceneScript.ts`, and the app re-exports it. It
described a MUST NOT and existed in one place; now it describes a MUST
NOT and a normative member, and still exists in one place.

`Q04.result.json` is re-blessed and carries scene 12's twenty lines.

**One thing this did not fix.** The app's `runnersComposed.ts` builds
its own Q04 payload rather than calling `q04Result` from `scf-core` —
it did before this change and it does after. Two descriptions of one
answer, one of them normative. It has not caused a divergence yet
because both now share the line derivation, but it is on the same list
as everything else here.

## 3. ⚠️ Part 3 features the fixture never shows — the live item

Four reader runs have each found at least one defect that no published
artifact could catch, because the fixture had no rows of the relevant
kind. The pattern is now well understood: **a feature the fixture does
not exercise is a feature no independent implementation ever sees, and
a conforming and a broken reader are byte-identical on it.**

Proposal 0001 was the last instance — `clip`'s screenplay line columns
were undetectably wrong while the `clip` table was empty. Adding two
rows closed it.

The three headline Part 3 features are in that state right now:

| Feature | Code | Fixture | Cost to close |
|---|---|---|---|
| **Beat anchoring (G5)** — `performance_beat.line_ref` → a line's uuid | ✅ `features.ts`, wired in `ScriptView` | ○ 14 beats, **0 with `line_ref`** | a few rows |
| **Prop tags** — line uuid + offsets, revalidated on edit | ✅ `features.ts`, `validateTags` | ○ `screenplay_prop_tags` **empty** | a few rows |
| **Versions** — publish a snapshot, diff against current | ✅ `publishVersion`, `diffVersionAgainstCurrent` | ○ `screenplay_versions` and both version tables **empty** | one published version |

All three are authored *from the editor*, which is why the fixture
builder never produced them: `hollow_creek.data.json` predates them.
The R85 dump/rebuild loop exists for exactly this — author in the app,
dump, review the JSON diff, rebuild, commit both.

Optional, and cheap once you are in there: thread `scene_id`
**deliberately wrong** on one body line. §3.4 says implementations MUST
NOT rely on it; nothing currently proves that a reader doesn't. It is
the same two-sided trick as §6.6.1's mirror — the rule that a *correct*
reader's answer must not change.

---

## 4. Deferred UI — in or out of MVP?

Both were named as deferred when Part 4 closed and neither has been
built. Neither is referenced in the spec.

- ○ **Editing from the spine.** Click a cell in Q10's thematic
  accounting to key a state at that position.
- ○ **Q15's "why?" affordance.** Provenance reachable from a resolved
  value inside another query's answer, rather than only as its own
  query. `ProvenanceView` exists; the entry point from elsewhere does
  not — `composedViews.tsx` and `QueryRunner.tsx` carry three
  `onClick` handlers between them, so the query surface is read-only
  by construction today.

**Decided: both out of MVP.** They make the editor nicer to use;
neither demonstrates a capability of the *format* that is otherwise
undemonstrated, which is the bar everything else on this list clears.
Worth saying so explicitly in the doc rather than leaving them on an
implicit list, because an unstated deferral is indistinguishable from
an oversight — which is the whole reason this document exists.

---

## 5. Documentation debt inside the editor

- ✅ **`scf-app/README.md` said "Six tabs".** There are seven — Assets
  was added and the table was not. Fixed.
- ✅ **`docs/release-checklist.md` was stamped rev 12, spec 0.42, schema
  2.12** against a main at 0.48 / 2.13. **Rev 13** re-checked against
  the tree: section 7 turned out to be complete, and one item had
  regressed — **`schema-2.13` shipped in 0.47 and is not tagged.**
- ✅ **No editor design document in the repository.** The `Part N`
  references in the source pointed at an upload. This file closes that,
  and `scf-app/README.md` now points at it.

---

## 6. Format proposals that touch the editor

Neither blocks the editor MVP; both change what the editor does if
accepted.

- **0002 — ownership by declaration** (draft, open). Affects how the
  entity forms decide what belongs to what.
- **0003 — absolute paths resolve** (draft). Affects `assetLocator.ts`
  and the Assets tab; roots beyond `@project` are reserved in the
  grammar and unimplemented.

---

## 7. Explicitly not the editor's MVP

Listed so they stop being weighed against it: publishing
`@minimalhumans/scf-core` at 1.0 (held deliberately — npm blocks
unpublish after 72 hours), the MCP server, the docs site beyond what
ships, and section 7 prose, which is now largely written
(`what-is-scf.md`, `authoring-guide.md`, `walkthrough.md`, `faq.md`,
`glossary.md` are all in `docs/`).

---

## 7a. ✅ Attaching the folder to an open file

The folder-first open (`openProject()`) is one gesture when directory
listing works and a diagnostic panel when it does not. The awkwardness
was never the UI; it was that the app had to *work out* which `.scf` in
the folder was the project, and could not when the scan came back blind.

The `.scf` can now be opened first and its folder attached afterwards,
from the `no folder` indicator in the topbar. The reason this is better
rather than merely different is that the pairing can be **checked**:
`FileSystemDirectoryHandle.resolve()` reports whether a named folder
holds a given file handle, and where. Discovery guesses; this does not.
The full reasoning, including the three-row `resolve()` table, is in
`docs/conventions.md` §9 under "The other order: the file first".

What landed:

- `classifyRootPairing()` in `scf-core/src/project.ts` — the rule, kept
  browser-free like `chooseProjectFile()` so it is testable without a
  directory handle. `at-root` accepts; `below-root` and `outside-root`
  are refused with a message naming both the file and the folder.
- `attachRoot()` on the adapter. Uses `startIn` so the picker opens
  inside the file's own folder, and retries once without it rather than
  costing the user the gesture if the option is rejected.
- The attach path asks for a **`read`** grant, not `readwrite` — the
  write handle came from the file picker. Grant mode is now carried with
  the handle, because querying a `read` grant for `readwrite` reports
  `prompt` and would show a working folder as needing reconnection.
- `applyRoot()` and `probeTraversal()` extracted from
  `finishFolderOpen()`, so both acquisition orders run the identical
  tail. Conventions §9 already claimed the resulting sessions are
  identical; now the code says it once instead of twice.
- `environmentRevision`, bumped when the *environment* changes rather
  than the data. Asset resolution and Q13 depend on the root and must
  re-run; `revision` could not carry it, because
  `revision !== lastSavedRevision` is what marks a project unsaved and
  attaching a folder writes nothing.

**Two defects found while doing it**, both live before this change and
both invisible in use:

1. `openFromPicker()` never cleared `projectRoot`. Opening a plain
   `.scf` while a folder session was live left the new project holding
   the old project's folder, addressing every asset against another
   film's disk. A stale root resolves perfectly well, so nothing
   reported it.
2. `resumeLast()` recalled the file handle and the root independently,
   reproducing (1) across a reload. Roots are now stored as
   `{file, root, mode}` pairs and looked up by `isSameEntry()`, which
   also means reopening a known project costs one re-grant click instead
   of another trip through the folder picker.

**Consequence for the demo, unplanned but useful.** A session with no
`.scf` on disk cannot have its pairing checked — there is no file for
the folder to contain. Rather than refuse, the root attaches and the
session is marked `folder unverified` in the topbar. So the Hollow Creek
demo can be pointed at a downloaded asset folder by hand, and the nine
identifiers the fixture already carries resolve without a single change
to the fixture, the manifest or any published result.

**Not done, deliberately.** The start screen still lists
"Open project folder…" above "Open an .scf file…", and `openProject()`,
`chooseProjectFile()` and the "Why it could not find it itself" panel are
all still there. If file-first becomes the front door, that ordering is
wrong and roughly 150 lines of scan-fallback machinery become dead —
but retiring the folder-first entry point is a product decision, not a
cleanup.

## 7b. ✅ Thumbnails, and the first reader of `region_box`

Asset previews existed in exactly one place: the asset row's own form.
Everywhere a file is *chosen* — a bundle's members, a binding, the asset
browser, a character — it was a filename.

**A thumbnail is not a small preview**, and the difference is the whole
reason `AssetThumb` is a separate component from `AssetPreview`. A
previewer is one of a kind on screen and can afford to read a file the
moment it mounts. `AssetPreview`'s own header names the hazard —
*"an asset browser walked through a few hundred plates would hold all of
them"* — and thumbnails make that the normal case. Three consequences:

- Nothing loads until the row is **on screen** (`IntersectionObserver`,
  200px margin). A bundle of two hundred plates nobody scrolls costs two
  hundred resolutions and zero reads.
- Object URLs come from a **refcounted cache** keyed by root handle plus
  path, with a grace period before revoking. The same plate can be in a
  bundle list, on a binding, behind a subject's anchor and in the asset
  browser at once; four URLs for one file is four things to revoke and
  three chances to leak. The cache is flushed when the root changes or
  the project closes — a URL into the *previous* folder returns bytes
  from a project the user has left, which is worse than a blank
  thumbnail because it looks like it worked.
- **Images only**, and the fallback chip is the *same box* as an image.
  A slot that collapses for a `.zip` makes every list reflow as it
  loads, and three of the nine assets in Hollow Creek are not natively
  viewable. `previewCapability`'s third tier is a real tier, not a
  failure.

Placed on: bundle members and the add-assets picker, the asset browser
list, `*_asset_binding` rows (as a strip of what the bundle puts on
screen — the binding names a bundle, and the bundle is a name), and
character / prop / location, in both the entity form header and the
subject view.

### `region_box`

The subject thumbnail is the **anchor**, not the cascade: a bundle is
everything gathered for an intent, while an anchor is somebody pointing
at one image and saying "that is her". Anchors are position-independent,
so it needs no scene picker.

Eleanor's anchor points at a reference *sheet*. Showing the sheet as her
thumbnail is nearly useless; showing `region_box` is the actual answer —
so the crop is the default, with a toggle back to the whole frame,
because a crop with no way back hides the evidence that the box is
wrong. `parseRegionBox` is the field's first reader anywhere in the
repository, and the coordinate space it defines is written down in
`docs/conventions.md` §9 rather than left living in TypeScript.

**The fixture now exercises it.** `entity_anchor` 1 gained
`region_box` and `region_label` — a two-line diff through the R85
dump/rebuild loop, and it moved no published result. Third entry in the
same class as §4.1's unscripted scene and §12.17's mismatches: a rule
the format states that no artifact demonstrated. The locket anchor is
deliberately left alone — it points at a `.glb`, which is preview tier 2,
so it exercises "the anchor is correct and there is still nothing to
show".

### Why the second visit was slow

Leaving the assets tab and coming back rebuilt every thumbnail, badly
enough to be the highest-priority complaint about the feature. The
object URL cache was only hiding a fifth of the cost. **Three things ran
on every mount and only the third was cached at all:**

1. **Resolution.** `resolveIdentifier` walks `getDirectoryHandle` /
   `getFileHandle` from the root and calls `getFile()`, *once per
   asset*. Forty rows is forty round trips through the browser's file
   system layer every time the tab is opened, and on Windows with an
   antivirus filter in the path none of them is cheap. This was the bulk
   of the lag and it was cached nowhere.
2. **Decode.** A full-size plate decoded to a bitmap so it could be
   drawn into a 28-pixel box, then thrown away on unmount.
3. The object URL, with a five-second grace period — right for a React
   remount, far too short for "switch tabs and come back".

`thumbnailCache` resolves once per session and decodes **once ever**. A
generated thumbnail is a few KB of WebP at 176px (twice the largest
display size, so one raster serves all three and stays sharp on HiDPI),
which is small enough to hold hundreds of in memory and small enough to
persist. It goes to IndexedDB keyed on **root name + path + mtime +
size**, so a reload no longer pays for the decode either and a file
edited outside the app regenerates rather than showing a stale picture.
After the first visit the list touches no files at all.

Two consequences worth recording:

- **The crop moved out of CSS and into generation.** The first version
  scaled and offset the full image inside a clipping box, which meant
  holding a whole plate decoded to show 176 pixels of it. It also could
  not distinguish "no region" from "a region that did not fit" — both
  rendered as the whole frame. Generation returns `regionApplied`, so
  `AnchorThumb` now says *region does not fit* for a box measured
  against a different file, which is an authoring error that was
  previously invisible.
- **`AssetPreview` moved onto the shared URL cache.** Without that the
  cache had no consumer left and would have been dead code with thirteen
  tests attached to it. It is also the right home: stepping back and
  forth between two assets used to re-read both every time, and the
  component's own header had warned about holding hundreds of files at
  once — a bound it could not enforce while each instance owned its URL.

**A keying bug the tests found.** The first version keyed on path,
mtime and size alone. `path` is *relative to the project root*, so
`assets/hero.png` in two different projects is the same string. That
triple is the standard file-identity heuristic and a collision would
almost always be two copies of one file — but "almost always" is the
wrong standard when being wrong means showing one film's frame under
another film's asset. The root's name is in the key now; its *handle*
is not, because persisted entries have to survive a reload where every
handle is new.

Mutation-tested like the URL cache: ignoring the environment epoch,
dropping mtime and size from the key, and removing the in-flight dedup
each fail a test. Three of the thirteen also passed for the wrong reason
until a cache reset was added between them — module-level state outlives
a test file.

### A leak the tests did not catch until they were attacked

`objectUrlCache` has 13 headless tests (no view imported, fake timers).
All thirteen passed first run, which is not evidence of anything, so
three deliberate defects were introduced to see whether they bite:
trusting an in-flight read after its holder released (caught), revoking
with no grace period (caught two tests), and **deleting the refcount
guard in `release` (caught nothing)**.

Tracing why exposed a real leak in the original code. The scheduled
revoke returned early when something still held the URL, without
clearing its own timer handle. Nothing could reach that state, because
`acquire` always clears a pending timer — but the two guards were
covering for each other, and with one removed the sequence is: release
one of two holders, the timer fires and declines to revoke while leaving
`timer` set, then the last release sees a non-null timer, takes the
early exit, and schedules nothing. The URL lives for the rest of the
session with nobody holding it.

Fixed by having the callback clear its own handle before deciding, and
pinned by a new test — verified against the *original* code plus the
mutation, where it fails. The `release` guard is now honestly a fast
path rather than a second line of defence, which is what it should have
been all along.

**One open decision, deferred on purpose.** The definition belongs in
the registry's help text, not in `conventions.md` — §2.1 makes the
registry the authority on fields, and help text is generated into
`entity-reference.md` and checksummed. Writing it there changes
`registry.json`, which is the one artifact pinned to the `schema-2.13`
tag, so `check_pin` fails: the live tag would serve different bytes than
`SHA256SUMS` claims. That needs a re-cut tag or a schema bump, which is
a release decision. `check_pin` caught this immediately, which is the
best argument for its existence so far.

## 8. Suggested order

1. ✅ **§2 — Q04.** Done in spec 0.49.
2. ✅ **§5 — the stale documents.** Checklist at rev 13, app README at
   seven tabs, this file checked in.
3. ✅ **§4 — the deferrals recorded** as decisions rather than left
   implicit.
4. **§3 — the three unexercised features.** The live item. Highest value
   per hour on the list: it converts three built-but-invisible features
   into features an independent reader can see, and it is data, not
   code.
5. ✅ **§7a — the folder attach.** Done; two latent root-pairing
   defects fixed with it.
6. ✅ **§7b — thumbnails.** Done; `region_box` read for the first
   time, and the fixture exercises it.
7. **§6** — whenever the proposals resolve.

## 9. What "MVP" is being taken to mean here

Stated because the list above depends on it, and because it is the one
thing in this document that is a proposal rather than a finding:

> **The editor is MVP-complete when every capability the format claims
> can be authored in it, and every capability the editor can author is
> visible in the published fixture.**

That definition is what puts §3 near the top and §4 out of scope. If
the intended bar is instead "a writer can take a screenplay from import
to a shootable package without touching SQL," then §3 becomes optional
polish and the list gets shorter — worth settling before any of it
starts.
