<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# How the fixture came to say what it says

These four scripts built the Hollow Creek fixture between rounds 12 and
30. **They are not run any more** and will not work: they are additive
and non-idempotent, and they assume a database that already has scenes,
characters and locations. Script 01 fails on its first statement against
an empty file, looking up a scene 12 that nothing has created.

That was the problem. There was no build-from-nothing path, the origin
of the base data was lost, and a pull request touching the fixture
showed one line saying a binary file differed — for an artifact whose
exact content eleven conformance suites assert against.

`../build_fixture.py` replaced them in 0.35. It builds from the
published DDL plus `../hollow_creek.data.json`, from nothing, and CI
checks that the rebuild still matches what is checked in.

## Why keep them

For the reasoning, which the data file cannot carry. Several choices in
the fixture look arbitrary until you read why they were made:

- **Scene 12 is pinned.** Most suites key on it — its motif manifest,
  its sound cue, its costume set, its direction chains, Eleanor's states
  there. `01` treats it as read-only and enriches everywhere else.
- **Name anchors are load-bearing.** Lookups go through
  `character LIKE '%Eleanor%'` and the shot `LIKE '%12-04%'`. Surnames
  may change; those anchors may not.
- **Scene numbers are deliberately not sequential.** Renumbering would
  break every scene lookup in both suites.
- **Some gaps are on purpose.** A fixture with nothing missing cannot
  exercise §9.2's requirement to answer usefully on half-placed data.
- **`01` renamed Voss to Cade** across every text column, which is why
  no trace of the earlier name survives.

If you are changing what the fixture contains, read these before
deciding that something in `hollow_creek.data.json` looks like a
mistake. Some of it is load-bearing and none of it is annotated.
