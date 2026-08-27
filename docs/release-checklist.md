<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# What an "official" SCF release contains

A checklist, with OpenUSD as the reference example. Status against
`SCF_studio@main` as of 2026-08-26, **rev 13** — spec 0.49, schema 2.13.
The published tag is still `schema-2.12`; **2.13 shipped in 0.47 and has
not been tagged.**

✅ have · ◑ partial · ○ missing · ⚠️ needs attention

Checked against the tree, as rev 11 was. Rev 10 lived outside the
repository and had drifted into describing a project that did not exist;
this file has been in `docs/` since 0.36, where the change procedure can
reach it.

---

## Where this stands

**Eleven of eleven sections are complete or complete-but-for-a-decision.**
Section 7 — the block rev 10, 11 and 12 each named as the only
substantial thing left — closed between rev 12 and this one.

Since rev 12 the specification has been through **a fifth independent
reader run** and seven revisions:

- **0.44** fixed run 4's and run 5's shared critical finding: §12.13
  named a cascade leaf, `scene_emotional_design`, that the registry does
  not define. The member was `[]` for every file that could exist and
  the blessed artifact recorded the empty array as correct.
- **0.47** landed **proposal 0001** — `clip.screenplay_line_start_id`
  and `_end_id` declared as references — with a schema bump to 2.13 and
  two fixture clips, because the defect was invisible while the table
  was empty.
- **0.48** removed a prose rule the format does not hold: the authoring
  guide forbade absolute paths that §8.2 explicitly permits.
- **0.49** gave Q04 the scene's own text (§12.17.1), closing the last
  place where the reference editor printed a promise about a work
  package that had already shipped.

The **proposals directory now has live entries** rather than only a
template: 0001 implemented, 0002 and 0003 open.

## Start here in the next session

1. **Tag `schema-2.13`.** It shipped in 0.47 and the published tag is
   still 2.12. Annotated, per §10's reasoning about steps nobody can
   run.
2. **The editor MVP** — [`editor-mvp.md`](editor-mvp.md), new in this
   revision. Its live item is the three Part 3 features the fixture does
   not exercise: `performance_beat.line_ref` is null on all fourteen
   beats, `screenplay_prop_tags` is empty, and all three version tables
   are empty. That is the invisible-defect class this list has been
   fighting since rev 10, applied to the editor rather than the format.
3. **Publish `@minimalhumans/scf-core`** at 1.0, not before. Unchanged
   from rev 12: packaging is proven end to end by CI, and only
   `"private": true` and the npm org stand in the way. Held because npm
   blocks unpublish after 72 hours.
4. **A sixth reader run**, now that section 7 exists — so a run finally
   tests the documents a stranger would actually start from, rather than
   §0.1.

## Where five reader runs left the format

| Run | Result | What was wrong |
|---|---|---|
| 1 | no claim possible | The spec was **silent** about what a reader does |
| 2 | 5/10 queries, claim with 8 divergences | The **artifacts** contradicted the spec, from code bugs |
| 3 | 15/16 queries, claim with 11 divergences | The **spec** was wrong; the artifacts faithfully recorded it |
| 4 | **14/16 queries, 11/11 negatives**, claim declined | The spec was **silent in shape** where it was complete in content — and two artifacts were wrong |
| 5 | **15/16 queries, 11/11 negatives**, 24 guesses | The spec was largely **right**; what was left was **unexercised** — two defects only an empty table was hiding |

Run 3's central finding — that the `.result.json` files had become the
specification for §12 — was answered in 0.29. Run 4 tested that fix and
returned a precise verdict: *"the fix moved the problem rather than
closing it."* §12.1's conventions implemented cleanly from prose, and
then **stopped at the boundary of the carrier record**: every query
section named the computed members and never the member the row itself
sat under. Five of sixteen queries could not be shaped from the
document. 0.40 closed that.

**Run 4 declined an unqualified claim**, not because a conformance step
failed but because it disbelieved two normative artifacts. It was right
about both.

**Run 5 found the pattern rather than an instance.** Its two most
serious findings were both cases where the fixture's empty tables made a
conforming and a non-conforming reader byte-identical — the same shape
as run 4's `external_id` finding, arriving through a different door.
Proposal 0001 closed one by declaring the columns *and* authoring two
clip rows; the declaration alone would have left the defect exactly as
invisible as it was.

**The two findings it rated critical were invisible to every published
artifact.** That is the argument for running these until one comes back
quiet, rather than for deciding the format has been read.

## 0. Scope — ✅ complete

| | Item | Notes |
|---|---|---|
| ✅ | Scope statement, normative/informative split, stability tiers, conformance targets | |

## 1. The specification document — ✅ complete

| | Item | Notes |
|---|---|---|
| ✅ | Data model, identity, ordering, spans, addressing, findings, extensibility, versioning, document equality, the query layer | spec at **0.35** |
| ✅ | Normative language, glossary, changelog, version tracks, formal grammars | |
| ✅ | **§12's shape conventions stated** | 0.29. §12.1.2's projected row, the polymorphic `_id` rule, §12.1.4's derived records, §12.1.5's closed vocabularies, §12.1.6's ordering |
| ✅ | **§9.5's undefined terms defined** | `clean`, `rowIds`, `count`, `title`. The semantics had lived only in `findings.ts` |
| ✅ | **§1.3.1 — the screenplay tables** | `line_type` closed at fifteen values; a reader hitting an unknown one MUST treat the line as unknown content and MUST NOT map it to a value it resembles |
| ✅ | Stale MUSTs corrected | §4.4.4 and `conformance.md` §2.2 both cited `project.scene_numbering`, removed in schema 2.12 |
| ✅ | **`unmaterialised` scoped to the environment** | 0.39. No role is required to produce it, and `conformance.md` says so |
| ✅ | **§6.6's link rule explained, and the cut bug fixed** | 0.39. A link inherits its endpoints' lifecycle; five queries were joining past the filter |
| ✅ | **§12.1.2 no longer deletes `external_id`** | 0.40. The registry declares which references are polymorphic; the rule reads the declaration instead of the name |
| ✅ | **§6.6's full six-value vocabulary stated** | 0.40. The section had named two of the six the registry declares |
| ✅ | **Spec prose checked against the registry** | 0.40. Two invented entity names had survived four revisions |

## 1A. The query layer — ✅ complete

| | Item | Notes |
|---|---|---|
| ✅ | **All sixteen queries specified** | §12.2–12.17, each with a published normative result |
| ✅ | The envelope holds across every shape | A position, a diff, a cascade, a media resolution, a rubric, a whole-story spine, and one query with no parameters |
| ✅ | **Q14 correctly declared not byte-comparable** | Conformance is coverage, severity range, justified departures |
| ⚠️ | The registry's `queries` field is still wrong in both directions | Unchanged since rev 6 |
| ✅ | **Rubric steps resolve to entities** | 0.38. `entities` are registry names, checked at generation time; `filter` and `intent` carry what the prose used to. A test pins that Q14 reports only what the rubric declares |

## 2. Versioning — ✅ complete

| | Item | Notes |
|---|---|---|
| ✅ | Version constant, scheme, forward/backward rules, deprecation window, §11.0's pre-1.0 clause, both changelogs | schema **2.12** |

## 3. File identification — ✅ complete

| | Item | Notes |
|---|---|---|
| ✅ | Extension, both pragmas, magic pattern, media type, unit of interchange | |
| ✅ | **`screenplay-tables.json` published** | 0.30. Six tables with columns, types, nullability and defaults, plus the closed `line_type` vocabulary. Generated from `initDatabase()`; `screenplayTables.test.ts` checks it back |
| ○ | Upstream the magic stanza | `github.com/file/file` remains the better bet |

## 4. Schema artifact and extensibility — ✅ complete

| | Item | Notes |
|---|---|---|
| ✅ | Registry, generator, linter, DDL, JSON Schema, `x_` prefix, reserved names, unknown-content survival | |
| ✅ | **45 artifacts, all published and all checksummed** | One exhaustive list, grouped. Everything in `ARTIFACTS.md` is in `SHA256SUMS` and nothing is checksummed that is not described |
| ✅ | **The manifest covers the specification itself** | 0.31. Three implementations were written from this prose and nothing let them confirm they had the published bytes |
| ✅ | **`schema-2.12` tagged, and the addressing scheme proven** | Annotated. `spec/scf-spec.md` was fetched at the tag and its digest matched `SHA256SUMS` exactly |

## 5. Conformance — ✅ complete

| | Item | Notes |
|---|---|---|
| ✅ | Fixture, suites, roles, `scf-check`, report format, negative fixtures, round trip, expectations as data, test map, claim process | **618 core / 248 app** |
| ✅ | **The fixture exercises the fallbacks** | 0.42. Scene 17 has a number and no heading, so §4.1's ordering fallback fires; scene 12's variant disagrees on season, so §12.17's `mismatches` is non-empty. Both rules were stated and checked by nothing |
| ✅ | **The fixture reports one `info` finding, deliberately** | §9.2 asks a reader to answer on half-placed data *and say what is missing*; a fixture with nothing missing can only demonstrate the first half |
| ✅ | **Query selectors published** | 0.40. `conformance.md` §5.4 had promised them since it was written; a third party had been reading parameters out of the artifact it was graded against |
| ✅ | **Four independent reader runs** | The fourth: 14/16 queries, 11/11 negative fixtures, and two correct claims that a normative artifact was wrong |
| ✅ | **Three independent readers have built against this** | The third made a Reader claim with all three steps performed |
| ✅ | **The negative set is solid** | 11 of 11, twice running, no missing and no extra findings |
| ✅ | **The artifact/implementation circle is broken** | 0.29 stated the conventions the artifacts had been demonstrating. Q11's empty cascade — a wrong leaf blessed into truth — is the case it was written against |
| ✅ | **`shapes.json` retired** | It predated §12 and asserted a weaker version of the same property in a shape the spec does not describe |
| ○ | The asset resolution tally flag in `scf-check` | Eight of `conformance.md` §4's nine checks. §0.3 makes the root mapping a property of the consuming environment and no flag exists to supply one |

## 6. Reference implementation and packages

| | Item | Notes |
|---|---|---|
| ✅ | Reference implementation, UI-free core | |
| ✅ | Lockfiles committed and in sync | |
| ✅ | **Licence corrected** | `scf-core/package.json` said MIT against an Apache-2.0 root, flagged since rev 2 |
| ✅ | **Built distribution** | `dist/` with declarations. A downstream TypeScript project that emits JS could not compile against the package at all before this |
| ✅ | **Stable public API surface** | 0.34. `src/index.ts` is an explicit list organised by conformance role — **226 names**, down from 259 — and CI enforces that every type named in a public signature is itself public |
| ✅ | **`npx scf-check` works** | It did not: Node refuses to strip types under `node_modules`, so the CLI worked from a checkout and failed once installed. It now resolves through the package's own entry points |
| ✅ | **Packaging proven where consumers meet it** | `pack-test` packs a tarball, installs it, and checks a JS consumer, a TS consumer that emits, and the installed bin. In CI |
| ◑ | Independent implementations: **five** | None maintained; none is the second *maintained* implementation the format needs |
| ○ | **Published package** | Still `"private": true`, **deliberately**. npm blocks unpublish after 72 hours and the format is pre-1.0 with everything disposable by policy (§11.0). Publish at 1.0 |
| ○ | Hosted editor build | |

## 7. Documentation set — ✅ complete

| | Item | Notes |
|---|---|---|
| ✅ | README, design record, glossary, CI documentation | |
| ✅ | `docs/story-structure-spec.md` renamed | It was a second document called a spec, next to the real one |
| ⚠️ | ~38 inbound references to `conventions.md` meaning "the rules" | The nine user-facing `help_text` strings were repointed at spec sections in 0.30; the rest are prose |
| ✅ | **"What is SCF" for a cold reader** | `what-is-scf.md`. Written for someone who has not decided whether to care, rather than for someone about to implement |
| ✅ | **Query reference, entity reference** | Generated, not written — from §12, the published results, `queryPaths.ts` and the registry. CI-checked, explicitly not normative |
| ✅ | **Authoring guide, walkthrough, FAQ, docs site** | All in `docs/`; the site builds and its cross-references resolve in CI |
| ✅ | **Editor design record** | `editor-mvp.md`, new in rev 13. The second-implementation plan lived only as an upload, and four `Part N` references in the source pointed at a document no contributor could open |

**The block that had not moved since rev 10 has moved.** What made it
hard was never tooling: the two documents that could be generated —
the query and entity references — landed in 0.37, and the site in 0.39.
The rest was prose for people not implementing the format, and prose is
the one thing on this list nothing automates.

One caveat worth keeping in front: **none of it has been read by a
stranger yet.** Five reader runs have each started from §0.1 because
that was all there was. The value of section 7 is untested until a run
starts from `what-is-scf.md` instead.

## 8. Licensing and IP — ✅ complete

| | Item | Notes |
|---|---|---|
| ✅ | Apache-2.0, `NOTICE`, DCO, third-party audit tool | |
| ✅ | **SPDX headers: 197 of 197** | Was 0 of 89 sampled. Enforced by CI — a one-off run left six files unstamped within three commits, two of them created by the round that ran the tool |
| ✅ | **Doc licence** | CC BY 4.0 for prose, Apache-2.0 for generated data, boundary stated once in `spec/LICENSE` and enforced per file |
| ✅ | **Corpus licence** | `alexis-nexus.fountain` carries a narrow grant: redistribution with the repository or a fork, and use in developing or testing software. Everything else reserved |
| ✅ | **Trademark statement** | In `NOTICE`. Naming the format to say your software reads it is explicitly fine; implying endorsement is not |

## 9. Governance and process — ✅ complete

| | Item | Notes |
|---|---|---|
| ✅ | Change procedure (nine steps), `CONTRIBUTING.md` | |
| ✅ | **A proposal/RFC path** | `proposals/`, with a template and a stated procedure — and, since rev 12, **live entries**: 0001 implemented in 0.47, 0002 and 0003 open. Was the most conspicuous gap on this list: outside implementers produced roughly seventy findings and none had anywhere to file one |
| ✅ | `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue templates, PR template | |
| ✅ | **Who decides** | `GOVERNANCE.md`. States plainly that the bus factor is two |
| ✅ | Lockfile rule in `conventions.md` §8 | |
| ○ | Roadmap, decision log | The changelog and `proposals/` cover most of what a decision log would |

## 10. Release engineering

| | Item | Notes |
|---|---|---|
| ✅ | **CI — green** | Three jobs. Every artifact in `--check` mode, SPDX coverage, the API surface, the packaging test, and the fixture rebuild |
| ⚠️ | **A git tag** | `schema-2.12`, annotated. **`schema-2.13` shipped in 0.47 and is not tagged** — the one item on this list that regressed since rev 12. Signed tags need a key this project does not have, and a step nobody can run is a step that gets skipped |
| ✅ | **Reproducible fixture build** | 0.35. Published DDL + `hollow_creek.data.json` + the screenplay, from nothing, **byte-identical across runs**, checked in CI |
| ✅ | **`VERSION` in the app** | Topbar shows the app version beside the schema version, commit and build date in the tooltip |
| ○ | A GitHub Release, release notes, downloadable artifacts | Describes a release. Worth doing at 1.0 and not before |
| ○ | Signed tags | Needs a signing key. `-s` substitutes for `-a` wherever one exists |

## 11. Ecosystem and adoption

| | Item | Notes |
|---|---|---|
| ◑ | Proof the format is implementable outside TypeScript | **Five times, independently** — all in Python, all discarded after the run |
| ○ | Announcement, landing page, citable reference, bridge docs, positioning document | Deferred deliberately to a final pass before release |

---

## The short version, rev 13

**Every section on this list is complete, or complete but for a decision
taken deliberately.** Section 6's publish is held until 1.0 because npm
blocks unpublish after 72 hours. Section 11's announcement half is
deferred to a final pass. Section 7 — the block rev 10, 11 and 12 each
named as the largest untouched thing here — is done.

**`stability.md` carries no Unstable rows.** The last three closed in
0.38, and by that document's own definition — a 1.0 is the act of moving
every Unstable row to Provisional — that is what a 1.0 is. It is not a
claim that the format is finished.

**Two things stand between here and a tag worth calling a release.**
Neither is large. `schema-2.13` is untagged, which is a five-minute
regression. And the reference editor has three shipped features the
published fixture does not exercise — beat anchoring, prop tags,
versions — which is not a documentation gap but the same invisible-defect
class that produced the two most serious findings of the last two reader
runs, sitting in the editor rather than in the format.
[`editor-mvp.md`](editor-mvp.md) carries that list.

**And one thing worth carrying forward.** Five reader runs have now
found defects that no test, no artifact and no amount of internal review
had caught, and the most serious were **invisible to every published
artifact** — the fixture could not distinguish a correct implementation
from a broken one. Each round since has added a check for the class
rather than the instance: generated-and-checked artifacts, a packaging
test that runs where a consumer runs, a prose checker that resolves
every name against the registry, a fixture that now exercises its own
fallbacks, and — from run 5 — the rule that **declaring a thing and
authoring a row that exercises it are one change, not two.**

The list of checks is a better record of what this project learned than
the list of fixes.
