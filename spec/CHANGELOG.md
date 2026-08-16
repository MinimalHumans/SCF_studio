# SCF specification changelog

Changes to [`scf-spec.md`](scf-spec.md). Governed by its §11.5:

- **patch** — editorial only. No requirement changes meaning.
- **minor** — any MUST or MUST NOT added, removed, or changed in meaning.
- **major** — a change that would make a conforming implementation
  non-conforming.

This tracks the **specification**, not the schema. Schema versions live
in [`../docs/schema-changelog.md`](../docs/schema-changelog.md), and the
two move independently by design (spec §0.6).

Every entry names the schema version the specification described at the
time, so that a reader of an old spec knows what it was describing.

---

## 0.14 — 2026-08-16

*Describes schema 2.9.*

**§9.4 is new: findings are enumerated.** This was the largest normative
gap left in the document. Findings were produced by six modules with no
shared codes, no severity scale and no serialised form, which made a
validator unspecifiable — `conformance.md` §4 has said so since it was
written.

- Codes are `area.condition`, lowercase and dotted, drawn from a closed
  catalog. Adding one is a change to this specification.
- Severity comes from the catalog, not from the point the finding is
  raised, so two producers cannot disagree about how bad the same
  condition is.
- The scale is `error` / `warning` / `info`, and it describes the DATA.
  `error` means two conforming readers would disagree about what the
  file says. It is explicitly not a reason to refuse the file.
- Reports MUST be deterministic over an unchanged file, ordered by
  severity, code, table, then lowest row id. A report that reorders
  itself cannot be diffed.
- The vocabulary is scoped to well-formedness and MUST NOT be conflated
  with readiness, which answers a different question.

The old §9.4 (reports accompany exports) is renumbered §9.5.

Appendix A gains a row for §9.4.

---

## 0.13 — 2026-08-16

*Describes schema 2.9.*

**§10.1 gains a MUST that was previously only implied**, and the whole
of §10 stops being an untested promise.

- §10.3 now states explicitly that a writer MUST preserve `x_` content
  across a write cycle on the same terms as any other unrecognised
  content, and notes that the distinction is intent rather than
  protection: unknown content is preserved because it is unknown,
  whether or not its author followed the convention.
- §10.3 also records that the reference implementation's linter rejects
  any registry name claiming the prefix.
- §1.3 points at `scf-schema.sql`, the published physical DDL.
- §2.1 points at `registry.schema.json` and `ARTIFACTS.md`.

`spec/ARTIFACTS.md` is new: an addressing scheme (`schema-X.Y` tag plus
raw URL) and SHA-256 for every published artifact. It states that `main`
MUST NOT be used to pin a version.

Appendix A gains rows for §2.1, §10.1 and §10.2–10.3. §10.1's
preservation requirement had never been verified; it now is, including
across five repeated write cycles.

---

## 0.12 — 2026-08-15

*Describes schema 2.9.*

**§1.2 file identification is now concrete, and implemented.** It had
said a writer MUST set `application_id` to "the registered SCF value"
without saying what that was — a requirement nobody could satisfy.

- `application_id` = `0x53434631` (`1396917809`), `SCF1` as big-endian
  ASCII. Checked against SQLite's `magic.txt` registry: no collision
  with any of its eleven entries.
- `user_version` = `major * 1000 + minor`; schema 2.9 → `2009`.
- The trailing `1` is the container generation, not the schema version.
  GeoPackage set the precedent by registering both `GPKG` and `GP10`.
- Reader tolerance restated as a MUST NOT: no file may be rejected for
  lacking the stamps.
- Header/`_scf_meta` disagreement is a finding, with `_scf_meta` as the
  authority.
- The `magic(5)` stanza ships as `spec/scf.magic`.
- The media type is `application/vnd.minimalhumans.scf` — vendor tree,
  so no registration is required.

Note that **no schema version was bumped for this**. The header stamps
are physical format, not the entity/field set, which is what the two
tracks in §0.6 exist to keep apart.

Appendix A gains a row for §1.2.

---

## 0.11 — 2026-08-15

*Describes schema 2.9.*

**No requirement changed.** 0.11 records that the implementation caught
up with 0.10 and that the registry now agrees with §4.2.1.

§4.2.3's registry note is rewritten: schema 2.9 declares `scene_number`
as text, so the declared type and the grammar no longer differ. Files
written before 2.9 need no conversion — affinity is a hint, and §4.2.3
already defined the behaviour for any value.

Appendix A gains real entries for §4.2 and §4.4, which were marked
unpinned in 0.10. `sceneNumbers.test.ts` pins the grammar, the ordering,
and — the case worth naming — that the TypeScript comparison and its SQL
twin order the same list identically.

The §11.4 note now records both pre-1.0 non-additive changes rather than
just 2.8's.

---

## 0.10 — 2026-08-15

*Describes schema 2.8.*

**Added: §4.2 scene-number grammar.** `scene_number` had been specified
only as "a label, MAY have gaps, MAY be non-numeric", which is not
enough to implement against. It now carries an ABNF canonical form
(optional bijective base-26 prefix, digits, optional suffix), a total
ordering rule for the §4.1 fallback case, and an explicit statement that
a value which does not parse is opaque rather than invalid.

Ordering yields `A12 < B12 < 12 < 12A < 12B`.

**Added: §4.4 shot codes.** Previously the format defined shot codes
only in code. The section states the canonical form, the zero-based
bijective base-26 letter run, allocation (continue past the highest, do
not backfill), and restamping under `project.scene_numbering`.

**Added: §4.4.2, a new MUST — shot codes are parsed relative to their
scene.** A shot code is read by removing its scene's `scene_number` from
the front, never by taking the trailing letter run in isolation. The two
readings diverge as soon as a scene number ends in a letter, which
§4.2.1 now permits: shot `12AB` in scene `12A` is ordinal 1 under the
correct reading and ordinal 27 under the incorrect one.

This is the change that makes 0.10 a minor rather than a patch.

**Renumbered.** §4.3 (position patterns) is now §4.5; the numbering
policy paragraph that had been folded into §4.2 is now §4.3 in its own
right.

**Editorial.** Scope list in §0.2 names the two new grammars. Appendix A
gains rows for §4.2 and §4.4, both marked with what is and is not pinned.

---

## 0.9 — 2026-08-15

*Describes schema 2.8.*

Initial draft. Extracted from `docs/conventions.md`, which becomes the
design record and states no rules from this version onward.

Sections: §0 scope (including the unit of interchange, what is outside
1.0, the three version tracks, and a glossary), §1 physical format, §2
the entity model, §3 derived versus stored, §4 position and ordering,
§5 structure, §6 identity, §7 the direction cascade, §8 assets and
addressing, §9 findings, §10 extensibility, §11 versioning. Appendix A
maps sections to the tests that pin them.

Newly written rather than extracted: §1, §2, §9, §10, §11. These were
facts about the reference implementation with no document behind them.

Known normative gaps at first draft, tracked in
[stability.md](stability.md): §6.6 (whether resolvers exclude `cut`
rows), the finding vocabulary, and §1.2 file identification.
