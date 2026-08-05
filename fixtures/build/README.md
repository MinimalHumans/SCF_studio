# Rebuilding the Hollow Creek fixture

Three additive passes over a copy of the fixture, in order:

```sh
cp fixtures/hollow_creek.scf /tmp/hc.scf
python fixtures/build/01_people_and_world.py /tmp/hc.scf
python fixtures/build/02_screenplay_and_coverage.py /tmp/hc.scf
python fixtures/build/03_query_detail.py /tmp/hc.scf
cp /tmp/hc.scf fixtures/hollow_creek.scf
cp /tmp/hc.scf scf-app/public/hollow_creek.scf
```

They are **additive, not idempotent** — run them once, against a
pristine copy.

The two copies must stay identical: `fixtures/` is what the conformance
suites open, `scf-app/public/` is what the app fetches for the demo.

Read `docs/conventions.md` §8 before changing what these produce. The
fixture's content is asserted by the conformance suites and several of
its properties are load-bearing — scene 12 in particular is pinned, and
some gaps in it are deliberate.
