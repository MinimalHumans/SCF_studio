<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# What an "official" SCF release contains

A checklist, with OpenUSD as the reference example. Status against
`SCF_studio@main` as of 2026-08-23, **rev 12** — spec 0.42, schema 2.12,
tag `schema-2.12` published.

✅ have · ◑ partial · ○ missing · ⚠️ needs attention

Checked against the tree, as rev 11 was. Rev 10 lived outside the
repository and had drifted into describing a project that did not exist;
this file has been in `docs/` since 0.36, where the change procedure can
reach it.

---

## Where this stands

**Ten of eleven sections are complete.** Section 7 is not, and nothing
else on this list is technical.

Since rev 11 the specification has been through **four independent
reader runs' worth of correction** and seven revisions. 0.40 and 0.41
answered all twenty-two findings of the fourth run, including two the
run rated critical:

- **§12.1.2 was deleting authored data.** "Any column ending `_id`" also
  matched `external_id` on ten entities. Twelve columns gone from every
  projected row, and **no published artifact could catch it** — the
  fixture authors no `external_id`, so a correct implementation and a
  data-losing one were byte-identical on all sixteen results.
- **§6.6 named two of six `lifecycle_status` values**, while §2.1 says
  the registry wins. Two conforming readers would have answered
  different questions about an `archived` scene.

Both are fixed by making the registry declare what the prose had been
guessing at, and CI now checks that every `entity.column` written in the
specification resolves against it.

## Start here in the next session

1. **Section 7 — documentation for people who are not implementing the
   format.** The only substantial block left. Four independent readers
   have each started from §0.1, which is written for an implementer. The
   query and entity references are generated as of 0.37 and the docs
   site ships as of 0.39; what remains is prose: "what is SCF", an
   authoring guide, a walkthrough, a FAQ.
2. **Publish `@minimalhumans/scf-core`** at 1.0, not before. Packaging
   is proven end to end by CI; only `"private": true` and the npm org
   stand in the way. Held because npm blocks unpublish after 72 hours.
3. **A fifth reader run**, eventually. Worth doing when section 7 has
   something in it, so the run tests the documents a stranger would
   actually start from.

## Where four reader runs left the format

| Run | Result | What was wrong |
|---|---|---|
| 1 | no claim possible | The spec was **silent** about what a reader does |
| 2 | 5/10 queries, claim with 8 divergences | The **artifacts** contradicted the spec, from code bugs |
| 3 | 15/16 queries, claim with 11 divergences | The **spec** was wrong; the artifacts faithfully recorded it |
| 4 | **14/16 queries, 11/11 negatives**, claim declined | The spec was **silent in shape** where it was complete in content — and two artifacts were wrong |

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
| ✅ | **Stable public API surface** | 0.34. `src/index.ts` is an explicit list organised by conformance role — 224 names, down from 259 — and CI enforces that every type named in a public signature is itself public |
| ✅ | **`npx scf-check` works** | It did not: Node refuses to strip types under `node_modules`, so the CLI worked from a checkout and failed once installed. It now resolves through the package's own entry points |
| ✅ | **Packaging proven where consumers meet it** | `pack-test` packs a tarball, installs it, and checks a JS consumer, a TS consumer that emits, and the installed bin. In CI |
| ◑ | Independent implementations: three | None maintained; none is the second *maintained* implementation the format needs |
| ○ | **Published package** | Still `"private": true`, **deliberately**. npm blocks unpublish after 72 hours and the format is pre-1.0 with everything disposable by policy (§11.0). Publish at 1.0 |
| ○ | Hosted editor build | |

## 7. Documentation set — the remaining block

| | Item | Notes |
|---|---|---|
| ✅ | README, design record, glossary, CI documentation | |
| ✅ | `docs/story-structure-spec.md` renamed | It was a second document called a spec, next to the real one |
| ⚠️ | ~38 inbound references to `conventions.md` meaning "the rules" | The nine user-facing `help_text` strings were repointed at spec sections in 0.30; the rest are prose |
| ○ | **"What is SCF" for a cold reader** | Three readers have started from §0.1, which is written for an implementer |
| ✅ | **Query reference, entity reference** | Generated, not written — from §12, the published results, `queryPaths.ts` and the registry. CI-checked, explicitly not normative |
| ○ | Authoring guide, "what is SCF", walkthrough, docs site, FAQ | **The remaining block.** Prose, plus a docs-site build |

**The two references are generated**, as of 0.37, for the same reason
every other derived document here is: a hand-written entity reference
over 99 entities is a second description of the registry, free to drift
from it within a week. A **docs site** is build and CI work. What is
left — "what is SCF", the authoring guide, the walkthrough, the FAQ —
is writing, and no tooling helps.

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
| ✅ | **A proposal/RFC path** | `proposals/`, with a template and a stated procedure. Was the most conspicuous gap on this list: three outside implementers produced roughly seventy findings and none had anywhere to file one |
| ✅ | `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue templates, PR template | |
| ✅ | **Who decides** | `GOVERNANCE.md`. States plainly that the bus factor is two |
| ✅ | Lockfile rule in `conventions.md` §8 | |
| ○ | Roadmap, decision log | The changelog and `proposals/` cover most of what a decision log would |

## 10. Release engineering

| | Item | Notes |
|---|---|---|
| ✅ | **CI — green** | Three jobs. Every artifact in `--check` mode, SPDX coverage, the API surface, the packaging test, and the fixture rebuild |
| ✅ | **A git tag** | `schema-2.12`, annotated. Signed tags need a key this project does not have, and a step nobody can run is a step that gets skipped |
| ✅ | **Reproducible fixture build** | 0.35. Published DDL + `hollow_creek.data.json` + the screenplay, from nothing, **byte-identical across runs**, checked in CI |
| ✅ | **`VERSION` in the app** | Topbar shows the app version beside the schema version, commit and build date in the tooltip |
| ○ | A GitHub Release, release notes, downloadable artifacts | Describes a release. Worth doing at 1.0 and not before |
| ○ | Signed tags | Needs a signing key. `-s` substitutes for `-a` wherever one exists |

## 11. Ecosystem and adoption

| | Item | Notes |
|---|---|---|
| ◑ | Proof the format is implementable outside TypeScript | Three times, independently |
| ○ | Announcement, landing page, citable reference, bridge docs, positioning document | Deferred deliberately to a final pass before release |

---

## The short version, rev 12

**Sections 0, 1, 1A, 2, 3, 4, 5, 8, 9, 10 and 11's technical half are
complete.** Section 6 is complete but for a publish decision that is
deliberately held until 1.0.

**`stability.md` carries no Unstable rows.** The last three closed in
0.38, and by that document's own definition — a 1.0 is the act of moving
every Unstable row to Provisional — that is what a 1.0 is. It is not a
claim that the format is finished, and the paragraph below is why.

**What is missing is section 7**, and it has not moved since rev 10
called it the largest untouched block. Everything else on this list has.
The two items that were generated rather than written — the query and
entity references — landed in 0.37, and the docs site in 0.39. What
remains is prose for people who are not implementing the format: "what
is SCF", an authoring guide, a walkthrough, a FAQ. Four independent
readers have each started from §0.1, which is written for an implementer.

That block is what decides whether anyone outside this project ever
tries.

**And one thing worth carrying forward.** Four reader runs have now
found defects that no test, no artifact and no amount of internal review
had caught, and the two most serious were **invisible to every published
artifact** — the fixture could not distinguish a correct implementation
from a broken one. Each round since has added a check for the class
rather than the instance: generated-and-checked artifacts, a packaging
test that runs where a consumer runs, a prose checker that resolves
every name against the registry, a fixture that now exercises its own
fallbacks. The list of checks is a better record of what this project
learned than the list of fixes.
