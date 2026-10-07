<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# The road to SCF 1.0 — release checklist

**Rev 14**, checked against `SCF_studio@main` at `37d47d5`
(2026-10-06) — spec **0.61**, schema **2.21**. Regenerated from the
tree, not edited forward from rev 13, which described spec 0.51 and
schema 2.13 and had drifted the way every untracked description here
eventually does.

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
against the candidate (§D1). That is the recommended path if the reader
run cannot finish inside the two days.

---

## A. Decisions — settle before the tag

Each is a conversation, not a build. Most have a recommended answer
already written into the proposal.

| | Item | Recommendation |
|---|---|---|
| ⚠️ | **0002 — ownership by declaration.** §2.3 deletes by column name; `clip.scene_id` makes "cut the scene" delete its footage. `stability.md` marks §2.3 **Stable** while an open proposal targets it. | Decide. The narrow option — fix `clip` only and lint that a new `<entity>_id` is a deliberate choice — is enough for 1.0. A later move to declarations can reproduce today's behaviour exactly, so it need not block. |
| ⚠️ | **0003 — absolute paths resolve.** | **Defer.** Behavioural, additive, and the proposal itself says named roots are the better answer. Mark `deferred`. |
| ⚠️ | **0014, 0019** — both recommend decline. | **Decline.** Write the resolution into each file. |
| ⚠️ | **0015 — one location per scene** — recommends defer. | **Defer**, with the note that keeping `scene.location_id` is what keeps the later change non-breaking. |
| ⚠️ | **`sequence.act_id`** — a stored, derivable fact the spec never mentions, undefined for a sequence that crosses an act (§5.3 permits that, and the fixture has one). The app's Q04 reads it (§B1). | **Remove** under §11.0 while removal is free; acts derive from boundaries. Otherwise specify it. Not after 1.0. |
| ⚠️ | **The registry's `queries` field** — wrong in both directions since rev 6, and nothing checks it. | **Remove** from `registry.json` and `registry.schema.json`, or generate it. Leaving it ships a known-wrong member in a published artifact. |
| ⚠️ | **The schema floor.** §0.6 says the spec "describes schema **2.12 and later**". Under §11.0, 2.14, 2.15 and 2.21 removed fields, so that sentence is false. | Set the floor to the release schema. Keep `2.x` numbering — a 3.0 bump buys a signal at the cost of churn across every artifact. |
| ⚠️ | **`entity_anchor.audio_offset_*` has no stated meaning** (`narrative-workspaces.md` §11). `region_box` got a declared shape; these did not, and §12.8 reads anchors. | One sentence in the help text and one in §12.8 — units, origin, which media it applies to — or remove before 1.0. |
| ⚠️ | **One schema bump, not four.** `act_id`, the `queries` field and the `audio_offset_*` help text each change `registry.json` bytes, and `schema-2.21` is tagged, so none can ship as cosmetic (`schema-changelog.md`, "Held for the next bump"). | Batch every registry change above into **2.22**, and make 2.22 the release schema. |
| ⚠️ | **Does 1.0 include the editor?** `editor-mvp.md` §9 still asks this. | **No.** 1.0 is the format, its artifacts and `scf-core`. The editor ships as the reference editor at its own version. This takes the editor list off the critical path. |

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

### B3. ○ Eight proposals implemented but still `draft`

**0010, 0011, 0017, 0018, 0020, 0021, 0023** landed in schema 2.14 —
the registry carries every field they add and lacks the one 0021
removes — and **0006** was superseded by 0023. All eight still say
`draft`, so the directory understates what was built by a third.

**`check_proposal_status.py` missed them** because its pattern needs the
word "proposal" before the number, and the schema changelog cites them
parenthetically — `scene.characters_present` **(0021)**. Widen the
pattern to a parenthesised four-digit number, fix the eight, and the
check covers what it was written for.

### B4. ○ Checksummed documents that say false things

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

### B5. ○ `verify.py` fails on Windows

Step 28 runs `["python3", "schema/check_pin.py", "--strict"]`. Every
other step uses `PY = sys.executable`. On Windows `python3` is absent
or the Store stub, so the one-command check fails on the machine it is
most often run on. One word.

### B6. ○ Packaging blocks the publish

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

### B7. ○ Small hygiene

- **`scf-core/scripts/scf_check.mjs` is committed `100644`** but is the
  package's bin; installing chmods it, so `verify.py` leaves a dirty
  tree on Linux and macOS. `git update-index --chmod=+x`.
- **`schema-2.13` and `schema-2.21` are lightweight tags**; 2.14–2.20
  are annotated, as `ARTIFACTS.md` and §10 say they should be.
  Recreating 2.21 annotated *at the same commit* changes no bytes, so
  `check_pin` keeps passing.
- `verify.py` omits two checks CI runs — the corpus bless check and
  "the demo fixture is the conformance fixture". Both pass today.

---

## C. Non-normative docs that drifted

| | File | What |
|---|---|---|
| ○ | `docs/glossary.md` | "Currently 2.12" and "currently 0.42"; "103 entities" |
| ○ | `docs/walkthrough.md` | `scf-check` output shows schema 2.12 and two findings; today it is 2.21 and five. "107 tables" — 113 |
| ○ | `README.md` | Manifest "44 files" — 45. **No mention of `scf-mcp`** |
| ○ | `scf-core/README.md` | "All 99 entities" — 106. This is the page npm will show |
| ○ | `spec/scf-mcp-design.md` | Sits in `spec/` beside the normative documents and is not in the manifest; says "Nothing here is built" and "Status: proposal"; stamped 0.51/2.13; its link to `editor-mvp.md` is broken from `spec/`. **Move to `docs/`**, mark as built. `scf-mcp/` has no README |
| ○ | `docs/editor-mvp.md` | §5 and §8 describe rev 13; §7b's "open decision" (`region_box` help text) is done — the registry carries it |
| ⚠️ | `docs/conventions.md` | ~38 inbound references meaning "the rules". Carried since rev 11; fine to defer |

---

## D. Verification before the tag

| | Item | Notes |
|---|---|---|
| ○ | **D1. A sixth reader run** | **The biggest risk on this list.** No run since 0.49. Twelve spec revisions and about thirty proposals of normative text since — §2.4.1 presence, §3.5 line anchors, §4.6–4.8, §12.8.1–12.8.2 — read by nobody outside the project. Runs 4 and 5 each found a critical that no published artifact could see. Run it **after** B2 and B4, so it reads a true document against artifacts that exercise it, and start it from `what-is-scf.md`: section 7 has never been read cold. It runs unattended — launch it as soon as B2/B4 land. |
| ○ | D2. Fixture: the night kitchen | Scenes 10 and 19 resolve the **day** baseline because the night variant is autumn and they are winter (`narrative-workspaces.md` §11). Correct by §12.17; the fixture probably meant otherwise. Decide the intent, and if the rule is right, say in §12.17 why a season mismatch outweighs time of day. |
| ○ | D3. Rules stated and exercised by nothing | `junction.endpoint_absent`, `structure.section_mismatch`, §12.17's zero-score baseline, `varies`, a `status` that disagrees with `lifecycle_status`, act and sequence renumbering under `derived` (§4.3). A row each where cheap; otherwise list them in `stability.md` as known-unexercised — which is a Provisional statement, not a blocker. |
| ○ | D4. An unknown `line_type` raises no finding | §1.3.1 closes the vocabulary at fifteen; the column is free text and nothing reports a sixteenth. A finding code, or a sentence saying none is owed. |
| ? | D5. The docs site is live | Could not confirm from here. Settings → Pages → Source = GitHub Actions. |

---

## E. Release day

In this order — the manifest goes last because `SHA256SUMS` covers the
prose:

1. ○ Spec **1.0** (or `1.0-rc.1`): CHANGELOG entry; §0.6 rewritten;
   §11.0 changed from "becomes binding at 1.0" to binding; stability and
   conformance headers.
2. ○ Schema version per §A. If it moves, regenerate every artifact and
   rebuild the fixture.
3. ○ `python schema/artifact_manifest.py`, then `tools/verify.py`, green.
4. ○ 🔒 Annotated tags, pushed: `schema-<n>` and `spec-1.0`. Then
   `check_pin.py --strict` against the remote.
5. ○ 🔒 `npm publish --access public` for `scf-core`, after `pack-test`
   confirms the licence is in the tarball. Then `scf-mcp`, if it ships
   at 1.0.
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
- **Proposal 0003**, and anything additive that arrives later.
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

**Day 1, morning — decide.** Section A together; about an hour. Then
the mechanical half: B3, B4, B5, B6 except the publish, B7 and C. It is
one change across many files.

**Day 1, afternoon — the app.** B1: query pages onto scf-core.

**Day 2, morning — the fixture.** B2: bless Q03/Q04/Q12 at scene 25,
author the anchored beats, prop tags, a published version, a prop
variant and a vocal state at a blessed position; rebuild; re-bless.
**Launch D1 the moment this lands.**

**Day 2, afternoon — tag.** If the reader run is back and quiet: E as
written. If not: tag `spec-1.0-rc.1`, hold the npm publish and §11.0,
and cut 1.0 when it returns. The RC loses nothing; publishing a format
the sixth reader then finds a critical in would.

---

## Where six revisions of this list leave the lesson

Rev 13 closed on the rule that **declaring a thing and authoring a row
that exercises it are one change, not two.** Thirty proposals later,
§B2 is that rule broken twenty times, every one of them quietly, and
§B4 is the older lesson — anything derivable written by hand eventually
disagrees with itself — broken a dozen more. Both checks this list
proposes, the always-empty-member scan and the no-bare-counts rule, are
checks for the class.
