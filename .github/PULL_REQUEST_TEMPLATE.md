<!-- SPDX-License-Identifier: CC-BY-4.0 -->

## What this changes

<!-- One or two sentences. Link the issue or proposal if there is one. -->

## Kind of change

- [ ] Editorial — no requirement changes
- [ ] Implementation — no format change
- [ ] **Format change** — needs an accepted proposal first (`proposals/`)

## If this touches the format

`docs/conventions.md` §8 is the procedure. The steps that are easy to
miss:

- [ ] `schema/entity_registry.py` edited — it is the source of truth,
      not the DDL and not the registry JSON
- [ ] **Everything regenerated, and regenerated LAST** — `SHA256SUMS`
      covers the specification documents, so a manifest rebuilt before
      the prose is written is stale the moment it is written
- [ ] `spec/scf-spec.md` updated, with its version bumped per §11.5
- [ ] The affected row in `spec/stability.md` updated
- [ ] An entry in `spec/CHANGELOG.md`

## If this touches a `package.json`

- [ ] `npm install` run in that package and the lockfile committed here
      too — `npm ci` fails on a mismatch whatever the mismatch is, and
      the failure is invisible where the change is made and total where
      it runs

## Checks

- [ ] `npm test` passes in `scf-core` and `scf-app`
- [ ] `python3 schema/artifact_manifest.py --check` is clean
- [ ] `python3 tools/add_spdx_headers.py --check` is clean — new files
      need a header, and a one-off run does not cover a file added later
- [ ] Commits signed off (`git commit -s`) per `CONTRIBUTING.md`

<!--
If a check above fails for a reason you believe is not your change,
say so here rather than removing the line. A digest mismatch on a
Windows checkout is usually line endings; artifact_manifest.py will
tell you so and tell you not to regenerate.
-->
