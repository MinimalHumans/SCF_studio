# Spec 0.12 — file identification

Unzip over the repo root. **Apply the scene-numbers zip first** — this
builds on schema 2.9.

```sh
cd scf-core && npm test && npx tsc --noEmit
cd ../scf-app && npm test && npx tsc --noEmit && npm run build
file --magic-file spec/scf.magic fixtures/hollow_creek.scf
```

Verified here:

- `scf-core`: 23 files, **389 passed**, 6 skipped
- `scf-app`: 20 files, **221 passed**, 1 skipped
- both typecheck clean, app builds
- `file(1)` reports: *Story Context Framework document, schema 2.9*

---

## The choices I made

You said you'd defer unless there was a decision you'd rather take. One
is worth a look; the rest are mechanical.

### The application id — the one worth reviewing

`0x53434631` = `1396917809` = **`SCF1`** in big-endian ASCII.

I checked SQLite's `magic.txt` registry directly rather than assuming.
It has eleven entries — Fossil (three), Bentley (two), Monotone,
GeoPackage (two), Esri, MBTiles, TeXnicard — and none is near
`0x53434631`. The collision check is a test, with the registered values
listed, so it fails loudly if that ever changes.

**The trailing `1` is the container generation, not the schema
version.** It changes only if the physical encoding ever breaks
compatibility, which should happen approximately never; the schema
version lives in `user_version`, where it moves freely. GeoPackage set
the precedent by registering both `GPKG` and `GP10`.

If you'd rather have four letters with no digit, the alternatives worth
considering are `SCFD` (`0x53434644`) or `STCF` (`0x53544346`). Both
are unregistered. It's a one-line change plus a fixture re-stamp, but it
has to happen **before** anyone else holds a `.scf`, because the id is
what identifies the file.

### `user_version` encoding

`major * 1000 + minor`, so schema 2.9 → `2009`. Keeps the header
sortable and readable at a glance. Room for 999 minor versions, which is
enough. Zero decodes to `null`, not to "version 0.0" — an unstamped file
never made a claim about its version, and saying it did would be worse
than saying nothing.

### No schema bump

`SCHEMA_VERSION` stays at **2.9**. Header stamps are physical format,
not the entity/field set. This is the first time the two version tracks
in §0.6 have actually paid for themselves rather than just being a
policy — spec 0.12 ships against schema 2.9 unchanged.

### Media type

`application/vnd.minimalhumans.scf`. Vendor tree, so it needs no
registration with IANA. The standards tree would, and would also mean
arguing the format's general interest to a review board, which is not
where this is yet.

---

## What shipped

**`scf-core/src/fileIdentity.ts`** — `SCF_APPLICATION_ID`,
`encodeUserVersion` / `decodeUserVersion`, `stampFileIdentity`, and
`fileIdentity()` which reports rather than validates.

**`initDatabase` stamps the header**, last, after everything else has
succeeded — the claim "this is an SCF document" should only be written
once it is true. That also gives the migration path for free: an
existing `.scf` opened for writing picks the stamps up, with nothing
converted. There is a test for exactly that.

**The reader-tolerance rule is a test, not just prose.** Every file
written before this carries no stamps, including your fixture until this
change. A reader that required them would have rejected the format's own
history. `fileIdentity()` on a plain SQLite file reports
`isScf: false`, `applicationId: 0`, `headerSchemaVersion: null`, and
throws nothing.

**`spec/scf.magic`** — an installable `magic(5)` stanza, not just a
documented pattern:

```sh
mkdir -p ~/.magic.d && cp spec/scf.magic ~/.magic.d/scf
file --magic-file ~/.magic.d/scf yourfile.scf
```

I tested it against the fixture and against a plain SQLite database. It
decodes the version with `belong/1000` and `belong%1000`, so it prints
`schema 2.9` rather than `2009`.

**Both fixture copies re-stamped**, still byte-identical — `SCF1` now
sits at offset 68 in the raw bytes.

**`index.ts`** now also exports `fileIdentity` and `sceneNumbers`, which
were missing from the previous round.

---

## Section 3 leaves one thing open

**Upstreaming the stanza to `sqlite/magic.txt`.** That is what makes a
stock `file(1)` recognise `.scf` without `--magic-file`.

Fair warning from reading the forum threads: there is no formal
registration process, the file has not been updated since 2014, and
requests have gone unanswered. Worth submitting, not worth waiting on —
which is why `stability.md` marks §1.2 Provisional rather than Stable,
with that as the stated reason.

---

## Sections 1, 2 and 3 are now closed

Checklist rev 3 is updated. `stability.md` drops from seven Unstable
rows to **six**.

The remaining work is concentrated in conformance tooling (§5),
packaging (§6), governance (§9) and CI (§10). The two that gate the most
are the **finding vocabulary**, which blocks `scf-check`, and a
**round-trip test**, which is the one property the Writer role rests on.

And CI. Three revisions of this checklist and still no workflow file —
it would now guard a schema generator, two suites, a corpus blessing, a
fixture parity check and a build.
