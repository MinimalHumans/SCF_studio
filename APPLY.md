# Section 5, part 3 of 3 — the round trip, expectations as data, the claim process

Apply the earlier section-5 zips first. Then unzip this over the repo
root.

```sh
cd scf-core && npm test && npx tsc --noEmit
cd ../scf-app && npm test && npx tsc --noEmit && npm run build
```

Verified here:

- `scf-core`: 28 files, 488 passed, 6 skipped
- `scf-app`: 22 files, **249 passed**, 1 skipped (was 221)
- typecheck, build, and all four `--check` modes clean

**Section 5 is complete.**

---

## 1. The round trip — the Writer role's defining property

`scf-app/test/roundTrip.test.ts`, ten tests against the app's own
open→edit→save cycle.

The reason this was testable headlessly at all: the app's save is
`sqlite3_js_db_export` — a **serialisation of the live database**, not a
rewrite — so writing a real file with the Node driver exercises the same
guarantee. And the editor operations live in `src/editor/`, deliberately
outside `ui/`, so they run without a store or a worker.

What it pins: ten cycles with no edits change nothing; three cycles
preserve an `x_` table, an `x_` column with its values, and an
**unprefixed** unknown table; an edit shows up in exactly one table and
nowhere else; authored shot numbers, `fixed` scene numbering, and the
header stamps all survive.

One test guards the guard — it drops a table and asserts the dump
notices. A dump that silently skipped unknown content would report
success while the very thing §10.1 protects went missing.

**Still untested, and stated as such:** a cycle driven through the
browser's own `sqlite3_js_db_export` and the File System Access adapter.
The Node driver exercises the same serialise-and-write guarantee, not
that code path.

## 2. What a round trip is compared on — spec §11.6

`conformance.md` §3 had this as an open question, and it needed
answering before the test could mean anything.

**Not bytes.** SQLite reorders pages, reuses freelist space and changes
file size without any row changing, so two byte-different files
routinely say exactly the same thing. A byte comparison would fail
constantly and prove nothing when it passed.

So `scf-core/src/canonical.ts` — every table sorted by name, rows sorted
by uuid where there is one and by full content where there isn't,
columns sorted by name, row ids excluded because they are not identity
(§6.2), `_scf_meta` excluded because its `updated_at` changes on every
save without the document changing.

Unknown tables are **included**. That's the point rather than an
oversight.

`diffDumps()` describes what moved rather than throwing, in keeping with
§9.1 — whether a difference is a defect depends on what the caller was
doing between the two dumps.

## 3. Query expectations as data — and why not the payloads

`fixtures/expectations/`, blessed and checked on every test run.

I tried blessing the runner payloads first and threw it away. They carry
`id`, `created_at` and `updated_at`, and **every foreign key is a row
id**. Row ids are file-local (§6.2), so a second implementation reading
the same fixture would legitimately produce different ones, and
timestamps change whenever the fixture is rebuilt. Expectations that
fail for reasons unrelated to correctness are worse than none, because
the response is to stop believing them.

Two artifacts instead, neither containing anything file-local:

- **`<Q>.expected.md`** — the rendered context markdown, which is what a
  consumer of these queries actually receives. Names, not ids. Diffs
  legibly.
- **`shapes.json`** — the payload's structure: keys, array lengths,
  tuple positions, volatile fields dropped, foreign keys recorded as
  `<row-ref>` rather than as values.

Parameters resolve from **selectors** — scene number 12, the character
named Eleanor — recorded alongside so another implementation can resolve
them itself.

Two things worth knowing:

**The first shape function was too weak.** It shaped arrays as
`{length, of: shapeOf(first)}`, which collapsed the cascade's
`[["sonic_identity", {…30 fields}]]` to "an array of two strings" —
losing exactly the row structure worth pinning. Tuple lists are now
shaped positionally.

**No new dependency.** Blessing needs the `@scf-core` alias, which only
Vite resolves. Rather than add `vite-node`, blessing runs through vitest
in a custom mode: `npm run bless-queries` is
`vitest run … --mode bless`. Cross-platform, and the check runs as part
of `npm test` automatically rather than as a separate `--check` you have
to remember.

I verified the check fails when tampered with, rather than assuming it.

**Eight of sixteen queries** are covered — those taking a position or
subject. The other eight take no parameters or enumerate the whole
project, so their output is a function of the fixture rather than of a
position in it. `conformance.md` §5.4 says so rather than implying
completeness.

## 4. The claim process — `conformance.md` §6

Self-certification, per role, with the reports published. No certifying
body, no registry, no fee — the artifacts are public and the checks are
runnable, which is the entire mechanism.

Reader: `scf-check` the fixture (exit 0), reproduce the query
expectations for the queries you implement, and report the negative
fixtures' codes at the catalog's severities. Extra findings permitted
and disclosed; missing ones a failure.

Writer: plus a canonical-dump-identical round trip, including one with
third-party content.

Editor: plus a statement of which derived state you maintain. **No
mechanical test** — it's a description, and §6 says it should read as
one rather than pretending otherwise.

§6.3 says what a claim is *not*: not a guarantee, not an endorsement,
not a licence to the name.

## 5. Appendix A is complete

With two rows marked *unpinned on purpose*: §11.1 (additive-only
changes) and §11.4 (the deprecation window) are policies about how the
format may change, not properties of a file. No test can check that a
future change will be additive; only review can. Saying that is more
useful than leaving them blank.

The remaining gap is §2 — the registry's *content*, as opposed to its
structure and the behaviour derived from it, both of which are pinned.

---

## Docs

- **spec 0.16** — §11.6 document equality; Appendix A completed.
- **`spec/conformance.md`** — §3 rewritten (the open question answered,
  status stated), §5.4 rewritten, §6 written, §7 updated.
- **`spec/stability.md`** — four new Provisional rows; the
  unknown-content row now cites the app cycle rather than just
  `initDatabase`.
- **`conventions.md` §8** step 6 now blesses query expectations too — a
  schema change can alter what a runner returns without any test failing
  on its own terms.

---

## Where the checklist stands

Section 5 is done. Rev 5 is owed and will also correct rev 4's claim that
`CONTRIBUTING.md` and contributor terms are missing — they're on main and
I built rev 4 from a stale tree.

What's left across the whole checklist is now mostly **not spec work**:
packaging (§6), governance files (§9), CI (§10), and adoption (§11). The
single highest-value remaining item is still a **second implementation**
— everything §6 now describes as claimable has never been claimed by
anyone but you.
