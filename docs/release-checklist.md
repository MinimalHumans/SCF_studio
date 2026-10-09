<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# The road to SCF 1.0 — release checklist

**Rev 14**, checked against `SCF_studio@main` at `37d47d5`
(2026-10-06) — spec **0.61**, schema **2.21**. Regenerated from the
tree, not edited forward from rev 13, which described spec 0.51 and
schema 2.13 and had drifted the way every untracked description here
eventually does.

**Decisions settled 2026-10-08** (§A): every ⚠️ in this list is now a
decision, and the work they add is §B8. `main` had moved to `3f3f7e9`
by then; no decision depends on the difference.

**Since then (2026-10-08):** 0036 landed as **spec 0.62, schema 2.22**,
tagged `schema-2.22` — so the release batch §A7 describes is **2.23**,
and every release-schema reference below says so.

✅ done · ◑ partial · ○ to do · ⚠️ decision needed · 🔒 one-way door

---

## Where this stands

**The machinery is green.** On a fresh clone, `tools/verify.py` passes
all 28 steps plus the published checksums: scf-core **762 passed / 6
skipped** (46 files), scf-app **373 / 1** (32), scf-mcp **27** (2),
45 artifacts, 275 public exports, 52 finding codes, 106 entities.
`scf-check` reads the fixture with 0 errors, 0 warnings, 5 info.
`schema-2.21` resolves at its tag and matches `SHA256SUMS`.

**What is not green is everything nothing checks.** Since rev 13 the
format absorbed proposals 0004–0035 — presence, line anchors, variants,
binding filters and combination, open vocabularies, `string_list`,
`required` — across spec 0.50–0.61 and schema 2.14–2.21. That work was
careful, and it left three kinds of debt behind:

1. **Prose that states old facts**, including in checksummed,
   normative documents (§B4).
2. **Twenty members that are empty in every normative result**, so a
   reader that ignores variants, voice states or version chains is
   byte-identical to one that implements them (§B2). The run-4 and
   run-5 pattern, again.
3. **A reference editor that re-derives queries scf-core already
   answers**, and has kept the bugs scf-core fixed (§B1).

None of it is large. All of it should be closed before the tag, because
**1.0 is where §11 starts binding** and where several of these become
expensive.

## What 1.0 commits you to 🔒

Stated first, because it decides what has to happen before the tag
rather than after it:

- **§11.0 inverts.** Files stop being disposable; removing a column,
  renaming a field or narrowing a type becomes a major change. Every
  removal still under discussion (§A) has to be settled now.
- **`registry.json`, the result envelopes and the report format become
  surfaces people build against.** Removing a member from any of them
  after 1.0 is a breaking change to a published artifact.
- **npm publish is irreversible after 72 hours.**

A **release candidate** keeps all three doors shut: tag `spec-1.0-rc.1`,
keep §11.0 in force, hold the npm publish, and run the sixth reader
against the candidate (§D1). **Decided: the release goes through an RC
whatever the timing** (§A13). The decisions below add normative text
after the last reader run — a new §12.17 order, the clip rename,
`audio_offset_*` semantics, a new finding — and that is the kind of
text runs 4 and 5 found criticals in.

---

## A. Decisions — settled 2026-10-08

Each was a conversation, not a build, and each is now decided. The
proposals carry their resolutions; the work the decisions create is
§B8.

| | # | Item | Decision |
|---|---|---|---|
| ✅ | 1 | **0002 — ownership by declaration.** §2.3 deletes by column name; `clip.scene_id` made "cut the scene" delete its footage. | **Accepted, narrow form.** A clip is *not* deleted with its scene: footage outlives the script. `clip.scene_id` is renamed so it points at the scene and is cleared on delete, and `lint_registry.py` requires every new `<entity>_id` without a declared parent to be recorded as deliberate. Populating `parentEntity` on the thirty-three and rewriting §2.3 is deferred past 1.0 (§F) — done that way it can reproduce today's behaviour, so it is non-breaking later. `stability.md` still marks §2.3 **Stable**; the rename is the last change before that is true. |
| ✅ | 2 | **0003 — absolute paths resolve.** | **Deferred** until the editor has named-root support. Behavioural and additive. |
| ✅ | 3 | **0014, 0019.** | **Declined**, reasons written into each file. |
| ✅ | 4 | **0015 — one location per scene.** | **Deferred.** `scene.location_id` stays and stays the primary; that is what keeps a later `scene_location` link additive. |
| ✅ | 5 | **`sequence.act_id`** — stored, derivable, unspecified, undefined for a sequence that crosses an act. | **Removed** in 2.23 under §11.0. Acts derive from boundaries. The app's writes and reads go (`structureCommit.ts`, `StructureView.tsx`, `EntityList.tsx`; Q04's goes with §B1), and so does the finding that only checked it, `structure.sequence_act_mismatch`. |
| ✅ | 6 | **The registry's `queries` field** — wrong in both directions since rev 6, checked by nothing. | **Unpublished.** Dropped from `registry.json` and `registry.schema.json` in 2.23. The Python ontology keeps it, because `entity_registry.py`'s lint uses it to enforce that every entity serves a canonical query. Generating a true list from what each `qNNResult()` reads is additive and can come after 1.0. |
| ✅ | 7 | **One schema bump, not four.** | **2.23 is the release schema**, carrying every registry change in this table — the clip rename, `act_id`, `queries` and the `audio_offset_*` help text. `project.synopsis` already shipped on its own as **2.22** (§A14), tagged before this pass settled the numbering; that tag stays as published rather than being reused, so the release batch is 2.23. Numbering stays `2.x`; no 3.0. |
| ✅ | 8 | **The schema floor.** §0.6's "2.12 and later" is false. | §0.6 says the spec describes **exactly schema 2.23** — no "and later". Later compatible 2.x revisions are governed by §11, not by the floor sentence. |
| ✅ | 9 | **`entity_anchor.audio_offset_*` has no stated meaning.** | **Specified, matching what the editor already enforces** (`mediaOps.ts`): non-negative seconds from the start of the asset's playable audio (t = 0 at the first sample); the span is start-inclusive, end-exclusive, and end MUST exceed start; a null bound is open (null start = from the beginning, null end = to the end, both null = the whole recording); meaningless on an asset without audio, where a reader MUST ignore them. In the help text and in §12.8. |
| ✅ | 10 | **Does 1.0 include the editor?** | **No.** 1.0 is the format, its artifacts and `scf-core`; the editor ships as the reference editor on its own version line. **`scf-mcp` is published to npm at 0.x** after `scf-core`, with a version range on it and no 1.0 stability promise. `editor-mvp.md` §9 should say so. |
| ✅ | 11 | **The night kitchen (D2).** Scenes 10 and 19 (night, winter) tie the night variant (time) against the morning baseline (season), and the tie gives a night scene morning dressing. | **The rule changes, not the fixture.** §12.17 compares the axes in order — `time_of_day`, then weather, then season — instead of counting them equally; the baseline still breaks a full tie and still wins when nothing agrees, and `varies` still agrees on time. Scenes 10 and 19 then resolve the night variant; scene 12 is unchanged. Normative: `resolution.ts`, §12.17's text, re-bless Q04. |
| ✅ | 12 | **An unknown `line_type` raises no finding (D4).** | **A finding: `line.type_unknown`, severity error** — a writer broke a MUST NOT. The line is kept as unknown content; the finding names its uuid and the value. §1.3.1's "no finding is raised" sentence is replaced — its own reasoning, a wrong answer given in silence, is the case for the finding. |
| ✅ | 13 | **RC or straight to 1.0.** | **RC first, always.** Tag `spec-1.0-rc.1`, keep §11.0, hold npm, run D1 against the candidate, then cut 1.0. |
| ✅ | 14 | **0036 — `project.synopsis`** (opened after rev 14 was written). | **Accepted into 2.22, and implemented** (`0d65695`, spec 0.62): the field, a three-paragraph synopsis authored on Hollow Creek's project row, Q00's normative result carrying it, and the editor's Project tab showing it under the logline. The "uncommitted work on another machine" was this. |
| ✅ | 15 | **`docs/conventions.md`** (§C). | **Deferred** past 1.0 (§F). |

---

## B. Defects found in this pass — fix before the tag

### B1. ○ The app's query pages re-derive what scf-core answers

`scf-core` exports a normative `qNNResult()` for **all sixteen**
queries. The app's query pages call scf-core for Q03 and Q12 and
re-derive the rest in `scf-app/src/ui/queries/runnersComposed.ts`, and
the copies have kept bugs the core fixed:

- **Q04 lineage reads `scene_sequence` and `sequence.act_id`**
  (lines 365–372). §5.4 says a conforming reader MUST derive membership
  from boundaries — the R88 fix, never carried to the app.
- **Q04 cast and props, and Q02 costumes, join without the cut filter**
  (lines 223, 384, 387). The five junction-join sites R89 fixed in core
  with `excludeCut`; a cut character still appears on the app's Q04
  page. *Found by reading; not run.*
- **No presence and no variant on the Q04 cast** (0030, 0035).
- `SCENE_DETAIL` is a second copy of `Q04_DETAIL`.
- The header comment says Q15's `affected_entities` is unpopulated in
  the fixture; it has been populated since 0.54.

**Fix the class, not the instances:** every query page renders scf-core's
`qNNResult()` and owns only its markdown. That deletes most of
`runnersComposed.ts`, and a check — no `ctx.exec` under `ui/queries/` —
keeps it deleted.

### B2. ○ Twenty members empty in every normative result

Measured by walking the sixteen `fixtures/expectations/Q??.result.json`.
For each, a reader that never produces the member at all is
byte-identical to a correct one:

| Member(s) | What it hides |
|---|---|
| `Q03.characters[].variant`, `Q03.props[].variant`, `Q04.cast[].variant`, `Q04.props[].variant`, `Q12.{characters,props}[].variantFrom/variantTo`, `Q02.characterVariant`, `Q02.locationVariant`, `Q02.propVariant` | **All of 0033 and 0035.** The only result carrying a variant, `Q13-scene25`, is not normative. `stability.md` says so; nothing fails. |
| `Q05.states`, `Q05.modulations` | The voice query's own content. The blessed position has no vocal state. |
| `Q15.versionChain` | §12.14's version chains. All three screenplay version tables are empty. |
| `Q02.propState` | Prop state in a subject's context. |
| `Q01.motifCarriage`, `Q02.dossier.motifCarriage` | Motif carriage in the dossier. |
| `Q09.candidates` | Q09's second half. |
| `Q02/Q13 …sizeBytes` | **Expected** — environment-dependent (§8.3). Not a gap. |

**Cheapest close: bless normative Q03, Q04 and Q12 at scene 25**, where
a variant is in force — data, not code, the same move 0.22 made by
blessing Q03 away from scene 12. Then author the remaining rows through
the dump/rebuild loop, together with `editor-mvp.md` §3's three:

- `performance_beat.line_ref` — **0 of 14** beats anchored
- `screenplay_prop_tags` — empty
- `screenplay_versions` and both version tables — empty (also closes
  `Q15.versionChain`)

Also empty and read by normative code: **`prop_variant`** (variant in
force for props) and **`set_dressing`**, which `Q04_DETAIL` lists.

Twenty-five of 113 fixture tables are empty in all. Most are unread
design entities and can stay that way; the ones above are the ones a
normative query reads.

### B3. ✅ Eight proposals implemented but still `draft`

**0010, 0011, 0017, 0018, 0020, 0021, 0023** landed in schema 2.14 —
the registry carries every field they add and lacks the one 0021
removes — and **0006** was superseded by 0023. All eight still say
`draft`, so the directory understates what was built by a third.

**`check_proposal_status.py` missed them** because its pattern needs the
word "proposal" before the number, and the schema changelog cites them
parenthetically — `scene.characters_present` **(0021)**. Widen the
pattern to a parenthesised four-digit number, fix the eight, and the
check covers what it was written for.

**Done 2026-10-08.** The check matches `(0ddd…)` citations too — a
leading 0, so a year in parentheses cannot match — and on its first run
flagged exactly the seven above. All eight now say `implemented`, with a
Resolution confirmed against the registry rather than the changelog;
0006 as implemented through 0023. 27 proposals are recorded as landed,
all agreeing.

### B4. ✅ Checksummed documents that say false things

The R86 class: a hand-written count or version beside a fact that
moved.

**`spec/scf-spec.md`**
- §0.6: "Currently `0.54`" and "Currently `2.19`" under a header saying
  0.61 and 2.21. "Describes schema 2.12 and later" — see §A.
- §4.5's table: "95 of 103 entities" — **98 of 106**.
- §7: "Twelve of the 103" — twelve is right, **106**.
- §2 (line 339): "Version 2.19 defines 106 entities" — 2.21.
- §11.0 names 2.9 and 2.12 as the changes taken under it. 2.14, 2.15
  and 2.21 removed fields too.

**`spec/conformance.md`**
- Its status line promises sections "marked *not yet specifiable*"; no
  section is marked.
- §4, "The validator", opens with "*Not yet built.*" `scf-check` has
  existed since 0.15.

**`spec/stability.md`**
- Header: "0.59 / schema 2.19".
- **"Polymorphic `_id` columns dropped"** still says `projectRow()`
  drops any `_id` with no `referenceEntity` — **the 0.29 rule 0.40
  removed**, contradicting the row 56 lines above it.
- Artifact addressing: "41 files … 42 as of 0.33" — **45**. API:
  "224 names" — **275**. Finding catalog: "36 codes" — **52**.
- Patterns 1–3 cite **§4.3** (numbering policy); they are **§4.5**.
- "Expectation coverage" still waits on queries being specified.
- **`varies` is marked Implemented: No.** `resolution.ts:430`
  implements it — the gap is that no fixture variant uses it. By this
  document's own definition of 1.0 ("every 'not yet implemented' note
  to done"), a wrong *No* blocks the release on paper. Same review for
  the `status` row: "nothing reads it" describes a writing stage, which
  nothing needs to read; the gap is again exercise, not implementation.
- "Rubric steps resolve to entities" sits under *Identity*.
- The summary still describes 0.38.

**The check worth adding**, since this keeps recurring: no bare count
of entities, codes, exports or artifacts in checksummed prose unless
the stamping step writes it. The generators already know every number
above.

**Done 2026-10-08 (spec 0.63, editorial), except that check.** Every
item above is fixed, plus seven the list missed: §0.7 still said 99
entities and **thirteen** link entities while §6.3 and §6.6 said
**fourteen** (the registry has sixteen); §2.4 "sixteen" open fields
(seventeen); and `stability.md`'s forward-compatibility row called §10.1
untested while its own history says it is tested. Where a count was not
load-bearing it was removed in favour of the generated file that holds
it, which is the class fix in prose form. `varies` and `status` now say
*Yes — not exercised*. §11.0 lists 2.14, 2.15 and 2.21, and
`check_spec_references.py` records their removed columns as history.

**✅ The check, too (2026-10-08): `schema/check_prose_counts.py`**, in
`verify.py` and CI. It does not ban numbers; it compares them. For each
quantity a generated file knows — entities, link entities, per-tier
counts, open fields, finding codes, exported names, manifest files, line
types, canonical queries — a number beside that noun in the reading
documents must be the true one. It skips sentences anchored in time
("in 0.53", "as of 2.14"), subsets ("eleven of the sixteen", or a count
under half the total), code blocks and changelogs. Run against the
documents as they stood before this pass, it finds twelve of the stale
counts above unaided. On its first run against the corrected tree it
found six more nobody had listed — `faq.md`'s "ninety-nine" twice, and
the tier counts in `what-is-scf.md` and `authoring-guide.md` (tier 0 is
26, tier 2 is 34, tier 6 is 18) — and all six are fixed.

### B5. ✅ `verify.py` fails on Windows

**Fixed 2026-10-08.** `py tools/verify.py --fast` now runs end to end on
a Windows checkout — all 23 steps and the published checksums green,
the site step skipped and said so. Before, it could not start.

- ✅ **Step 28 ran `python3`**, absent or the Store stub on Windows.
  It uses `PY = sys.executable`, like every other step.
- ✅ **The Python generators wrote CRLF on Windows.** Text mode
  translates `\n`, and four writers — `generate_registry_json.py`,
  `artifact_manifest.py`, `dump_fixture.py`, `screenplay_body.py` —
  did not pass `newline="\n"`. `0d65695` therefore published a
  `registry.json` digest over CRLF bytes that exist nowhere; git
  normalised the file on commit, so nothing looked wrong locally.
  Fixed at the root in `7f2fbb7`, and the digest corrected.
  `.gitattributes` already said why this matters; the writers were the
  exceptions to it.
- ✅ **`check_pin.py` crashed on Windows** decoding `git` output with the
  locale codec. It decodes as UTF-8, and it now hashes the tagged blob's
  **raw bytes** — it used to decode and re-encode them, so a digest that
  is defined over bytes went through a text round trip first.
- ✅ **`verify.py` would not start without `site/` installed.** The site
  step is skipped with a warning instead, and the summary says
  "everything run passes … 1 step skipped", never "everything passes".
  Its step output and its own console output are decoded and written as
  UTF-8, so neither a test runner's `✓` nor its own `…` breaks on
  Windows.
- ✅ **A CRLF working tree failed the golden-corpus test.** With
  `core.autocrlf=true` a Windows checkout can hold CRLF copies of LF
  files despite `eol=lf`. The corpus test (both tiers) and
  `bless_corpus.mjs --check` compare the blessed types after normalising
  line ends, so the check is about classification, not the checkout.

### B6. ◑ Packaging blocks the publish

- **`scf-core`'s `files` lists `LICENSE` and `NOTICE`, and neither
  exists in `scf-core/`.** `npm pack --dry-run` ships 224 files and no
  licence. Apache-2.0 §4 requires both to travel with the
  distribution. Copy them in at `prepack`, and make `pack-test` assert
  they are in the tarball — it checks everything else.
- No `repository` field (npm provenance and the package page need it);
  no `publishConfig.access: "public"`, which a scoped package needs.
- **The `@minimalhumans` npm scope does not exist** — the registry
  answers "Scope not found". Creating the org is free and reversible;
  publishing is not. Create it now, before the name is taken.
- `scf-mcp` depends on `"file:../scf-core"`; it needs a version range
  before it can be published. `scf-app` has no `license` field.

**Done 2026-10-08:** `tools/legal_files.mjs` copies the root `LICENSE`
and `NOTICE` in at `prepack` and out at `postpack` (the copies are
gitignored), for both packages; `pack-test` asserts both arrive
byte-equal, and without the hook the tarball has neither. `repository`
and `publishConfig.access: "public"` on both; scf-mcp gained a `files`
list (it had none, so it would have shipped its tests) and a README;
`scf-app` has `license`.

**○ Still open, and none can be done from the repository:**
- **Create the `@minimalhumans` npm org** — a step on npmjs.com.
- ✅ **scf-mcp's dependency** — decided 2026-10-08: the repository keeps
  `file:../scf-core`, and `tools/pack_with_ranges.mjs` replaces it with
  `^<scf-core's version>` for the length of a pack or publish, restoring
  `package.json` byte-for-byte after, failure or not. Publish with
  **`npm run publish:release`** in `scf-mcp/`; a bare `npm publish` is
  refused by a `prepublishOnly` guard while a `file:` dependency
  remains. A wrapper rather than a prepack hook because `npm publish`
  re-reads `package.json` after packing, so a hook restoring it at
  postpack would publish correct bytes under wrong metadata. `verify.py`
  and CI run its `plan` mode, so a rewrite that cannot be made fails
  now. Workspaces replace it after 1.0 (§F).
- **Both packages are `"private": true`**, which npm refuses to publish.
  Presumably the guard until publish day; flip it as part of §E.

### B7. ✅ Small hygiene

- **`scf-core/scripts/scf_check.mjs` is committed `100644`** but is the
  package's bin; installing chmods it, so `verify.py` leaves a dirty
  tree on Linux and macOS. `git update-index --chmod=+x`.
- **`schema-2.13` and `schema-2.21` are lightweight tags**; 2.14–2.20
  are annotated, as `ARTIFACTS.md` and §10 say they should be.
  Recreating 2.21 annotated *at the same commit* changes no bytes, so
  `check_pin` keeps passing.
- `verify.py` omits two checks CI runs — the corpus bless check and
  "the demo fixture is the conformance fixture". Both pass today.

**Done 2026-10-08:** `scf_check.mjs` is `100755` in the index; both
checks are `verify.py` steps. `schema-2.13` and `schema-2.21` were
recreated annotated at their own commits (`b1bdc18`, `fd371dd`), so every
schema tag from 2.12 to 2.22 is annotated, and `check_pin` still
passes.

### B8. ○ Work the §A decisions add

Everything here except the finding lands in the **one 2.23
regeneration** — registry, `scf-schema.sql`, `entity-reference.md`,
every artifact, the fixture rebuild — so do it in one change, and each
item that declares something authors a fixture row that exercises it.

- **Schema 2.23** (§A1, A5, A6, A7, A9; §A14 already in 2.22):
  - rename `clip.scene_id` to a pointer; the delete-a-scene test now
    expects the clip kept with the reference cleared, and
    `canonicalDump` after a scene delete changes accordingly;
  - the `<entity>_id`-must-be-deliberate lint in `lint_registry.py`;
  - drop `sequence.act_id`, its app reads and writes, and
    `structure.sequence_act_mismatch` (finding catalog 52 → 51 before
    the addition below) — and re-take `docs/walkthrough.md`'s
    `scf-check` output, which quotes that finding;
  - drop `queries` from `registry.json` and `registry.schema.json`; keep
    it in `entity_registry.py`;
  - `audio_offset_*` help text as decided;
  - ✅ `project.synopsis` (0036) — done in `0d65695`, with a synopsis
    authored in the fixture.
  - ◑ shot and scene media (0037) — in the working tree 2026-10-09,
    awaiting review: `relationship_type` gains `storyboard`,
    `start_frame`, `end_frame`, `previs`; `asset_relationship.order`;
    spec 0.64 §8.6; shot 12-04's panels in the fixture. It moved
    `SCHEMA_VERSION` to 2.23 ahead of the rest of this batch, which
    lands under the same number.
  - ◑ the project poster (0038) — in the working tree 2026-10-09,
    awaiting review: `relationship_type` gains `poster`; spec 0.65
    §8.6 and §12.12; Q00 gains `posters`; the fixture project relates
    `poster01.png`.
- **Spec text:** §0.6's floor (exactly 2.23, §A8); §12.8's
  `audio_offset_*` sentence (§A9); §12.17's ordered comparison (§A11);
  §1.3.1's finding sentence (§A12); §2.3's clip note (§A1); the
  CHANGELOG naming each break taken under §11.0.
- **§12.17 order (§A11):** `resolution.ts` compares `time_of_day`, then
  weather, then season; re-bless Q04 and anything else that resolves a
  location variant; the night kitchen (scenes 10, 19) is the fixture
  row that exercises it.
- **`line.type_unknown` (§A12):** error severity, in the catalog and
  `scf-check`, with a test row carrying an unlisted `line_type`.
- **Proposal statuses:** 0002 moves from `accepted` to `implemented`
  when this lands. 0036 is already `implemented`.
- `editor-mvp.md` §9 answered: the editor is not in 1.0 (§A10).

---

## C. Non-normative docs that drifted

| | File | What |
|---|---|---|
| ✅ | `docs/glossary.md` | "Currently 2.12" and "currently 0.42"; "103 entities" |
| ✅ | `docs/walkthrough.md` | `scf-check` output shows schema 2.12 and two findings; today it is 2.22 and five. "107 tables" — the walkthrough's own command prints **114**, counting SQLite's bookkeeping table. **Changes again in 2.23**, when `structure.sequence_act_mismatch` goes (§B8) |
| ✅ | `README.md` | Manifest "44 files" — 45. **No mention of `scf-mcp`** |
| ✅ | `scf-core/README.md` | "All 99 entities" — 106. This is the page npm will show |
| ✅ | `docs/scf-mcp-design.md` (was `spec/`) | Sat in `spec/` beside the normative documents and is not in the manifest; says "Nothing here is built" and "Status: proposal"; stamped 0.51/2.13; its link to `editor-mvp.md` is broken from `spec/`. **Move to `docs/`**, mark as built. `scf-mcp/` has no README |
| ✅ | `docs/editor-mvp.md` | §5 and §8 describe rev 13; §7b's "open decision" (`region_box` help text) is done — the registry carries it |
| ✅ | `docs/conventions.md` | ~38 inbound references meaning "the rules". Carried since rev 11. **Deferred past 1.0** (§A15, §F) |

---

## D. Verification before the tag

| | Item | Notes |
|---|---|---|
| ○ | **D1. A sixth reader run** | **The biggest risk on this list.** No run since 0.49. Twelve spec revisions and about thirty proposals of normative text since — §2.4.1 presence, §3.5 line anchors, §4.6–4.8, §12.8.1–12.8.2 — read by nobody outside the project. Runs 4 and 5 each found a critical that no published artifact could see. Run it **after** B2 and B4, so it reads a true document against artifacts that exercise it, and start it from `what-is-scf.md`: section 7 has never been read cold. It runs unattended — launch it as soon as B2/B4 land. |
| ○ | D2. Fixture: the night kitchen | Scenes 10 and 19 resolve the **day** baseline because the night variant is autumn and they are winter (`narrative-workspaces.md` §11). **Decided (§A11): the rule was wrong** — §12.17 now ranks time of day first. What remains is the work in §B8, after which these scenes resolve the night variant and exercise the new order. |
| ○ | D3. Rules stated and exercised by nothing | `junction.endpoint_absent`, `structure.section_mismatch`, §12.17's zero-score baseline, `varies`, a `status` that disagrees with `lifecycle_status`, act and sequence renumbering under `derived` (§4.3). A row each where cheap; otherwise list them in `stability.md` as known-unexercised — which is a Provisional statement, not a blocker. |
| ○ | D4. An unknown `line_type` raises no finding | §1.3.1 closes the vocabulary at fifteen; the column is free text and nothing reports a sixteenth. **Decided (§A12): `line.type_unknown`, severity error.** Work in §B8. |
| ? | D5. The docs site is live | Could not confirm from here. Settings → Pages → Source = GitHub Actions. |

---

## E. Release day

Two days, per §A13: the candidate, then the release once D1 is back
and quiet. In each, the manifest goes last because `SHA256SUMS` covers
the prose.

**RC day — every door stays shut:**

1. ○ Spec **`1.0-rc.1`**: CHANGELOG entry; §0.6 rewritten (exactly
   schema 2.23); stability and conformance headers. §11.0 stays in
   force.
2. ○ Schema **2.23** (§A7): every artifact regenerated, the fixture
   rebuilt.
3. ○ `python schema/artifact_manifest.py`, then `tools/verify.py`, green.
4. ○ Annotated tags, pushed: `schema-2.23` and `spec-1.0-rc.1`. Then
   `check_pin.py --strict` against the remote. No npm publish.
5. ○ Launch D1 against the candidate.

**1.0 day — after D1, and after anything it finds is fixed:**

1. ○ Spec **1.0**: CHANGELOG entry; §11.0 changed from "becomes binding
   at 1.0" to binding; headers.
2. ○ If D1 forced a registry change, a new schema version and a
   regeneration; otherwise 2.23 stands.
3. ○ `python schema/artifact_manifest.py`, then `tools/verify.py`, green.
4. ○ 🔒 Annotated tag `spec-1.0`, pushed; `check_pin.py --strict`.
5. ○ 🔒 `npm publish --access public` for `scf-core`, after `pack-test`
   confirms the licence is in the tarball. Then `scf-mcp` **at 0.x**,
   with **`npm run publish:release`**, which publishes it depending on
   `scf-core` by version range (§A10, §B6).
6. ○ A GitHub Release: notes from the CHANGELOG, the manifest's files
   and `SHA256SUMS` attached.
7. ○ Pages rebuilt from the tag.

---

## F. After 1.0 — decided, not forgotten

Listed so an unstated deferral cannot be mistaken for an oversight.

- **Second maintained implementation.** Five independent readers, all
  Python, all discarded. Every Provisional row already encodes its
  absence; 1.0 does not need it.
- **Magic stanza upstream** — a PR to `github.com/file/file`. Possible
  any day; blocks nothing.
- **Asset resolution tally** in `scf-check` — conformance §4's ninth
  check, waiting on a root-mapping flag.
- **Proposal 0003** (waits on named roots in the editor), and anything
  additive that arrives later.
- **Proposal 0002's declaration move** — `parentEntity`/`parentField` on
  the thirty-three and §2.3 reading declarations only. Non-breaking if
  it reproduces 2.23's behaviour, which it must.
- **Proposal 0015** — intercut, as an additive `scene_location` link;
  `scene.location_id` stays the primary.
- **A generated `queries` member** in `registry.json`, from what each
  `qNNResult()` reads. Additive.
- **An npm workspace** for `scf-core`, `scf-mcp` and `scf-app`, so a
  sibling dependency is a real range resolved locally. It retires
  `tools/pack_with_ranges.mjs` (§B6). Deferred because it replaces three
  lockfiles with one and changes dependency hoisting — plumbing to move
  when nothing else is.
- **`docs/conventions.md`** and its ~38 inbound references.
- **The editor at its own version** (§A10), and `scf-mcp` toward 1.0.
- **Hosted editor build**, signed tags, roadmap and decision log.
- **Editor:** spine editing and Q15's "why?" affordance (`editor-mvp.md`
  §4); `narrative-workspaces.md` §11 — readiness badge, shot-level
  variants, `shotContext` naming the variant, the undo toast, the scene
  rail jumping by `line_order`, offline fonts, and **sixteen
  `last_insert_rowid()` calls** to replace with `RETURNING id` before
  anything writes in the background.
- **Announcement, landing page, positioning, citable reference.**

---

## A two-day plan

**Decide — done 2026-10-08.** Section A is settled, and the
`project.synopsis` work it was waiting on has landed (§A14).

**Day 1, morning — the mechanical half.** B3, B4, B6 except the
publish, B7 and C (B5 is done). It is one change across many files.

**Day 1, afternoon — the app.** B1: query pages onto scf-core. Removing
`act_id` (§B8) falls out of it: Q04's read goes with the runner, and the
structure views derive acts from boundaries.

**Day 2, morning — 2.23 and the fixture.** §B8's schema and spec
changes, then B2: bless Q03/Q04/Q12 at scene 25, author the anchored
beats, prop tags, a published version, a prop variant, a vocal state
and the synopsis at blessed positions; rebuild; re-bless, including Q04
under the new §12.17 order. One regeneration.

**Day 2, afternoon — the candidate.** RC day as written in §E: tag
`spec-1.0-rc.1` and `schema-2.23`, hold the npm publish and §11.0, and
**launch D1 against the candidate**. Cut 1.0 when it returns quiet. The
RC loses nothing; publishing a format the sixth reader then finds a
critical in would.

---

## Where six revisions of this list leave the lesson

Rev 13 closed on the rule that **declaring a thing and authoring a row
that exercises it are one change, not two.** Thirty proposals later,
§B2 is that rule broken twenty times, every one of them quietly, and
§B4 is the older lesson — anything derivable written by hand eventually
disagrees with itself — broken a dozen more. Both checks this list
proposes, the always-empty-member scan and the no-bare-counts rule, are
checks for the class.
