<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Narrative element workspaces — design record

The design for the Characters, Locations and Props workspaces in SCF
Studio, and what was actually built. Written as a proposal on
2026-10-02 (spec 0.59, schema 2.19) and kept here, as built, after the
six phases landed (spec 0.61, schema 2.21). Where the build departed
from the proposal, this says so and why.

It sits beside [`editor-mvp.md`](editor-mvp.md) for the same reason that
document exists: a design that lives outside the repository drifts into
describing a project that does not exist.

## 1. What and why

The editor was shaped like the format. A character is spread across
some twenty entities — the character row, appearance, vocal and
physical profiles, costumes and their progression, makeup, variants,
habits, arcs, relationships, color identity, asset bindings, anchors,
casting, performance states. Attaching one reference image meant four
records: an asset, a bundle with an intent, a membership with a role,
and a binding with baseline and precedence — four rows to say *this is
what she looks like*.

The workspaces are a second door into the same rows, shaped like the
writer's thinking instead:

- **Navigation** — a grouped activity bar: Story, Narrative elements,
  Tools.
- **A workspace per subject** — a list rail, a subject header, and dense
  subtabs grouped by the kind of thinking (who they are, how they look,
  how they sound), not by entity.
- **A wiring layer** — intent-level operations ("use this file as her
  look") that write the bundles, bindings, anchors and relationships as
  one undoable change.

Nothing existing was removed. Script, Structure, Shoot, Subjects,
Queries, Schema and Assets work as before.

## 2. Principles

These extend the project's standing rule — *use it like a word
processor, treat it like a database* — from the script page to the
narrative elements.

- **Author by intent, not by entity.** The writer says what something is
  for; the app decides which rows that means. No bundle, binding, anchor
  or precedence appears in the default view.
- **One subject, one place.** Every authored fact about a subject is
  reachable from its workspace. Facts owned elsewhere (scene cast,
  dialogue) are shown and linked.
- **The wiring is real SCF, not a shadow.** Workspace actions write
  ordinary rows a hand-written file could contain. No app-only tables,
  no hidden JSON. A file authored here reads identically in `scf-check`,
  `scf-mcp` and the queries — `mediaOps.test.ts` holds that equivalence.
- **Baseline first, then exceptions.** Every board starts with the
  baseline and offers exceptions for a scene range, a state, a variant
  or a time of day — the shape §12.8 already resolves.
- **Density over clicks.** One scrolling page of sections per subtab,
  two-column field grids on wide screens.
- **Empty is fine.** Every section renders usefully empty, with one
  obvious first action; singleton profile rows are created on the first
  edit (§9.2: half-placed data is normal).
- **Nothing removed.** Every section has an "open record" link to the
  row in Schema.
- **One description per rule.** Intent-to-rows mapping lives in one
  module, tested headlessly. "What is in force" is always the queries'
  own resolution, never a second copy in the UI.

## 3. Navigation

`ActivityBar` replaces the old seven-button strip with grouped,
always-visible sections:

| Group | Sections |
|---|---|
| Story | Script, Structure, Shoot |
| Narrative elements | Characters, Locations, Props |
| Tools | Subjects, Queries, Schema, Assets |

**Decided: an always-visible bar** over a grouped dropdown, because the
core loop is Script ↔ Characters and a dropdown makes every switch two
clicks. Shortcuts are **Alt+1 … Alt+0** in list order — the proposal
said Ctrl, but Ctrl+digit is the browser's own tab switching.

*Not built:* the dropdown fallback for narrow windows.

## 4. The workspace pattern

All three subject kinds share one frame. `SubjectShell` and
`SubjectRail` are generic over `state/subjectKinds.ts`, which names the
little that differs (entity, noun, variant table, presence query, tabs).

- **List rail.** "New …" at the top, a filter, then the list: face (the
  verified visual anchor, initials beneath while it loads), name, role
  and scene count. Ordered by first appearance, name or scene count; cut
  subjects behind a "show cut" toggle.
- **Subject header.** Name (editable in place), chips, variant chips,
  the "as of scene" control and "Open record". Tab and scroll position
  are remembered per subject.
- **As of scene.** Off by default, showing baselines. With a scene
  picked, boards dim what does not apply there and mark what is in
  force, and every story strip marks the column — using `resolveMedia`
  (Q13), `variantInForce` (§4.8) and the stage resolution of §4.5
  directly. `resolveMedia` gained `binding_verdicts` (which binding
  applies, and why) so the board never re-derives the answer.
- **Undo.** Every multi-row action records one `ChangeUndo`
  (`state/undoChange.ts`); the toast undoes it as one step. Session-only,
  one level, like delete-undo.

*Not built:* the readiness badge in the header (Q14/Q01 findings for the
subject) and the right-hand context rail. Both remain good ideas; neither
was needed for the workspaces to be usable.

## 5. Character workspace

Eight subtabs, from who the character is, through how they are realised,
to where they are in the film. **Decided:** eight, all shown — no
writer/production toggle.

| Subtab | Sections | Rows behind it |
|---|---|---|
| Profile | Identity · Summary · Drives · History · Casting · Variants · Notes | character, actor, actor_character_role, character_variant |
| Look | Reference board · Appearance · Color identity · Exceptions | character_appearance_profile, character_color_identity; media wiring |
| Wardrobe | Costumes (each with its own board) · Worn in · Wardrobe through the story · Makeup & hair | costume, costume_scene, costume_progression(_state), makeup_hair_design, costume_asset_binding |
| Voice | Voice reference · Voice · Speech · Accent · Delivery · Habits · Shifts · Voiceover | vocal_profile, performance_state (vocal), voiceover_design; media wiring |
| Physicality | Motion reference · Posture & energy · Movement · Face · Presence · Habits · Shifts · In the environment | physical_character_profile, physical_habit, performance_state (physical), character_environment_physicality |
| Relationships | Map · Selected relationship · Stages | character_relationship, relationship_state |
| Arc | Summary · arc lanes on the story strip | character.arc_description, character_arc, character_arc_state |
| Scenes & Lines | Presence · Scenes · Lines · Shots · Things they carry · Themes | scene_character, cue lines, shot_character, prop, prop_state, motif_appearance, thematic_connection |

Notes on what was built:

- **Casting** is one field: typing an actor's name matches or creates
  the actor and writes `actor_character_role`.
- **Relationships** are always shown from the selected character's side.
  Which row is A is never shown; "Eleanor → Marcus" or "mutual" is the
  writer's view, and reversing direction swaps A and B in the write
  (`setDirection`). One relationship per pair.
- **The story strip** (`StoryStrip`, `state/storyStrip.ts`) draws
  latest-wins stages (§4.5) across scenes in story order. Arc,
  Relationships, Wardrobe, prop states and location scenes all use it;
  clicking a scene column starts a stage there. Every cell is placed
  explicitly in the grid, so the as-of column cannot shift the others.
- **Scenes & Lines** reads presence from two sources — the authored
  links and the script's cues — using the §3.4 heading walk
  (`editor/characterPresence.ts`), and shows where they disagree inline:
  *silent* (linked, written, no cue) and *unlinked* (speaks, not
  linked). Mentioned and background presence are never asked about.
  "Open in script" opens the Script at the line by uuid.
- **Mentioned characters are not asked for a look.**

## 6. The wiring layer

`editor/mediaOps.ts` (boards, exceptions, anchors) and
`editor/elementOps.ts` (everything else) are headless: no view imports,
tested against the fixture with the Node SQLite driver.

### 6.1 Intent → rows

| The writer does | Rows written |
|---|---|
| Points at a file: *This is them* | asset (matched by identifier, else registered) + `entity_anchor`, **verified** — Q13 ignores candidates, so the writer's own choice is verified; candidate is left for anchors something else proposed |
| Confirms a proposed *This is them* | that anchor's `canonical_status` → verified |
| Marks the face in it | `entity_anchor.region_box` `{x, y, w, h}` in the image's pixels, + `region_label` (§6.4) |
| Marks the clip in a voice | `entity_anchor.audio_offset_start_sec` / `audio_offset_end_sec` (§6.4) |
| *Look* / *Voice reference* / motion / sound | `bundle_asset` (role as typed) in the owner's baseline set. First use only: a bundle of the board's intent and a baseline binding, precedence 0 |
| *Concept*, *Inspiration* | `asset_relationship` |
| Adds an exception | a bundle + a non-baseline binding, precedence above the highest, combine add or replace, the condition as its filter |
| Reorders exceptions | precedence renumbered 1…n |
| Removes an exception | the binding, and its bundle if nothing else uses it |
| Changes a tile's purpose | the old link deleted, the new one written; the asset is untouched (§8.4: purpose lives on the link) |
| Removes a tile | the link only; the asset stays, and §8.6 orphan reporting covers it |
| Adds a variant's references | the variant exception, made on the first file, and the files — one undo |
| Adds a stage on the strip | `character_arc_state`, `relationship_state`, `costume_progression_state` or `prop_state` with its scene |
| First edit in an empty profile section | the singleton row |

Boards and their intents: **look** → `visual_identity` (visual anchors),
**voice** → `voice_identity` (audio), **motion** → `motion`, **sound**
→ `acoustic` (audio, locations). Owners are characters, costumes,
locations and props; which filter columns an exception may set is read
from the owner's binding table in the registry, so a location's
exceptions offer variant and time of day and a character's offer scene
range, state and variant.

### 6.2 Rules

- **Managed rows are identified structurally, never by a marker.** "The
  baseline set" is a binding of this owner, baseline, carrying no filter
  its table declares, to a bundle of the board's intent. A flag saying
  "made by the workspace" would be a second description of that fact.
- **Exceptions are the non-baseline bindings with filters**, and their
  order is their precedence. Hand-built bindings appear as exceptions
  too, described in words ("while wounded", "as Marcus, age nine", "at
  dusk", "scenes 4–9").
- **Shared rows are shown, never silently edited.** A set bound to
  someone else is labelled; adding to it asks whether to add for both or
  split it off (`SharedSetError`).
- **Same file, same asset.** A file already in the project reuses its
  asset row by identifier.
- **Everything is one undo**, through `ChangeRecorder`.

### 6.3 Files on disk — no copying

The proposal's interim decision was to copy dropped files into the
project folder. **That was superseded during phase 3 by conventions §9**
— *SCF never ingests, copies or generates files* — which the editor was
already built on. Dropped or picked files must already be inside the
connected project folder; their identifier is their path relative to
it (§8.2). A file from outside the folder is reported by name with what
to do ("move it into the folder, then drop it again") and nothing is
written. `files/dropIntake.ts` takes the file handles synchronously
inside the drop event and resolves them against the root.

This still leaves open the case that prompted the interim choice — shot
data on one server, design data on another. That belongs to the broader
file-management design for a hosted editor, not to the workspaces.

### 6.4 Which part of the file

`AnchorScope.tsx` adds two small editors to identity tiles:

- **Region** (look boards): drag a box over the full image, or type it.
  Saved as `{x, y, w, h}` in whole pixels of that image — the shape
  `scf-core/src/anchors.ts` reads — with an optional label ("face").
  A box that runs past the image's edge is refused rather than stored,
  because every reader would discard it (`regionFits`) and the writer
  would see a mark that does nothing. A stored value the editor cannot
  read is shown, not dropped, and only replaced on save. The tile's
  thumbnail shows the crop.
- **Clip** (voice and sound boards): drag across a waveform (decoded in
  the browser) or set in and out from the player's position; "Play the
  clip" stops at the out point on the frame. Seconds from the start,
  to the millisecond; either end may be left open; the end must follow
  the start and fall within the file.

Both open the file through the shared object-URL cache — nothing is
copied or written beside it — and both are one undo step
(`setAnchorRegion`, `setAnchorClip`).

The spec still does not give `audio_offset_*` a declared meaning beyond
the field names. The editor treats them as seconds from the start of the
file, which is the only plausible reading; promoting that to normative
text, as was done for `region_box`'s help text, is a format decision.

## 7. Coexistence

| Section | After the workspaces |
|---|---|
| Schema | Unchanged; the complete record editor. Every workspace section links here |
| Assets | Unchanged; files, bundles and bindings directly. Every tile has "Show in Assets" |
| Subjects | Unchanged, under Tools. **Decided:** kept as is; it may be trimmed later |
| Script | Character, location and prop chips open the workspace; workspaces open the Script at a line |
| Queries | Unchanged. The workspaces call the same resolution the queries use |

## 8. Locations and props

Same shell, rail, boards, exceptions, strip and as-of control.

| Location tab | Sections | Rows |
|---|---|---|
| Profile | the place · details | location |
| Look | reference board · design · color | location_design, location_color_scheme; location_asset_binding |
| Sound | sound reference · the room, ambience | location_sound_profile; acoustic bundles |
| Variants | a card per variant with its own references | location_variant; a variant exception |
| Scenes | strip and table: when, the variant §12.17 picks, who is there | read: scene, `variantInForce` |

| Prop tab | Sections | Rows |
|---|---|---|
| Profile | the object, its story, its owner | prop |
| Look | reference board · surface | prop_surface_profile; prop_asset_binding |
| Variants | as for locations | prop_variant; a variant exception |
| Through the story | states and custody on the strip | prop_state |
| Scenes | links with significance and version, script tags | scene_prop, screenplay prop tags |

## 9. Format work it needed

The workspaces author existing entities, but building them surfaced
three gaps, each settled by a proposal before the UI relied on it:

- **[0033](../proposals/0033-variants-in-force.md) — variants in force**
  (spec 0.60, schema 2.20). `variant_id` on `scene_character` and
  `scene_prop` (a qualifier, outside the natural key), the variant
  filter restored on character and prop bindings, and
  `entity_anchor.subject_variant_id` honoured: a variant's anchor
  displaces the subject's own in the scenes where the variant is in
  force. It found a live defect — a variant's face was returned as the
  character's face everywhere. The fixture gained scene 25, a flashback
  with Marcus at nine. Two versions of one character in one scene is
  deferred to shot level.
- **[0034](../proposals/0034-anchor-state-columns.md)** removed
  `entity_anchor` physical, vocal and environmental state columns
  (schema 2.21): free text §12.8 never read. State-specific media is a
  binding with a state filter; a different design is a variant.
- **[0035](../proposals/0035-variants-in-the-cast.md)** put the variant
  on Q03/Q04 cast and prop entries and on Q12's transitions.

**Decided, as a workspace convention only:** one profile row per
subject. The editor edits the first. The format does not state it and
raises no finding.

## 10. Phasing, as delivered

| Phase | Delivered |
|---|---|
| 1 | Activity bar, rail, shell, Profile |
| 2 | Story strip; Arc and Relationships with the map |
| 3 | `mediaOps.ts`, file intake, Look and Voice boards (baselines), Q13 equivalence test |
| 4 | Exceptions, the as-of control, Wardrobe and Physicality |
| 5 | Scenes & Lines; Script ↔ workspace links |
| 6 | Locations and Props on a shared `SubjectShell` |
| close | Region and clip editors on identity tiles; this record |

## 11. Open

- **Readiness badge and context rail** (§4) — not built.
- **Shot-level variants** — two versions of one character in a scene.
- **`shotContext` does not name the variant** in force for a shot.
- **The fixture's night kitchen** resolves to the day baseline in scenes
  10 and 19: §12.17 ties toward the baseline when season disagrees
  (autumn variant, winter scenes). Correct by the rule; the fixture
  probably meant otherwise.
- **The fixture has no prop variants and no screenplay prop tags**, so
  those views are exercised only by tests.
- **`last_insert_rowid()` after a separate insert** is used in sixteen
  places across the editor. Through the worker it is a second message,
  so another write landing in between returns the wrong id. Harmless
  while writes are user-paced; worth replacing with `RETURNING id`
  before anything writes in the background.
- **The undo toast** stays until dismissed or replaced.
- **The scene rail** still jumps by `line_order` rather than uuid.
- **Fonts** load from Google Fonts; offline, the fallback stack applies.
- **`audio_offset_*` semantics** (§6.4) are unstated in the spec.
