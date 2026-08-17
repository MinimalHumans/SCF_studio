# Fix 4, second half — Hollow Creek becomes a screenplay

Apply after `scf-fixture-column.zip`.

```sh
cd scf-core && npm test && npx tsc --noEmit
cd ../scf-app && npm test && npm run build
cd .. && python3 schema/artifact_manifest.py --check
sha256sum -c spec/SHA256SUMS
```

Verified here:

- `scf-core`: 29 files, **502 passed**, 6 skipped (was 499)
- `scf-app`: 22 files, 249 passed, 1 skipped
- typecheck, build, all five `--check` modes, checksums — clean

Still spec **0.17**; §4.3 changed but no requirement was weakened.

---

## First, something I got wrong

I asked whether you'd write an A-page scene. **The fixture had no prose
at all** — 19 lines, all sluglines and section headers. So there was
nothing to match, and adding a scene was two rows rather than a writing
job. I framed that question badly.

Your answer — that an SCF should work as an outline *and* as a finished
screenplay — is the better shape, and the fixture now demonstrates both
in one file: **four scenes carry action and dialogue, seven stay
sluglines.** A conforming reader meets both, which is the normal state of
a project in progress.

## The writing

Four scenes, drafted from the summaries already in the fixture. Replace
any of it freely — it lives in one Python list.

- **sc 1** — Marcus walking in, action only, no dialogue. The house is
  smaller than he's been remembering it.
- **sc 3** — the arrival. Eleanor's first line is *"Shut it behind you."*
  and Marcus leaves the door open anyway. The open-door motif is already
  in your entity data; this is it happening on the page.
- **sc 12** — the confrontation. Your summary quotes *"You came back."*
  so that is the line. Ends with Eleanor giving him the chance and
  Marcus taking the stairs instead: *"Say it or go to bed." / He goes to
  bed.*
- **sc 19** — the confession, with the locket on the table between them.
  The turn is Eleanor's: she has known since the day after, and has been
  waiting eleven years for him to be the one to say it.

Plus **12A**, a short beat after the confrontation: the lamp out, Eleanor
not moving, the door still open.

I kept the vocabulary to what the fixture already knows about — the
shawl, the locket, the open door, the creek, eleven years — so the prose
and the entity tables describe the same film.

## The structural half, which matters more

**The three orders now differ.** This was the point of the exercise:

| | order |
|---|---|
| screenplay | 1, 3, 7, 9, 10, 11, 12, **12A**, 19, **16**, 21, 24 |
| scene number | 1, 3, 7, 9, 10, 11, 12, 12A, **16, 19**, 21, 24 |
| row id | 1…11 in original order, with **12A last** |

Two changes did it:

- **12A sits mid-script with the highest row id.** Row-id order stops
  matching script order, and the fixture gains a scene number that isn't
  an integer, so §4.2.1's grammar is finally exercised by the artifact
  meant to demonstrate it.
- **Scene 16 now follows scene 19 and keeps its number.** The church
  after the confession — dramatically it reads better anyway, and 16 was
  the least-developed scene so it cost least. This is legal precisely
  because the project is `fixed`: it is what a locked script looks like
  after a reorder, and it is the hazard §4.1 warns about in as many
  words.

Three new invariant tests pin all of it, including one asserting the
three orders are pairwise different. **A reader ordering by
`scene_number` alone now fails** — which is the whole reason the audit
flagged this.

Worth noting: sequence "The Reckoning" still crosses the Act 2 / Act 3
boundary and now contains the moved scene 16 as well, so §5.3's
crossing-sequence rule keeps its demonstration.

## §4.3 now covers all four numbers — your point

It governed scene numbers and shot codes. `act.act_number` and
`sequence.sequence_number` were unmentioned, so an implementation could
renumber acts on a locked project and remain conforming.

All four are now stated as authored, none derived from position, all
governed by `project.scene_numbering`. I also wrote down what the two
modes are *for*, close to how you put it: `derived` while a writer is
still moving the story, `fixed` once the numbers have left the building
on schedules and call sheets and become identifiers. A scene numbered 12
that plays after scene 45 is **correct** under `fixed`.

**One consequence needs your decision.** The field is called
`scene_numbering` and now governs four kinds of number. Renaming it is
non-additive, so it happens before 1.0 or never. It's an Unstable row and
item 2 on the closing list.

## The screenplay has a source now

`fixtures/build/04_screenplay_body.py` holds it as data and **generates**
`hollow_creek.fountain` beside it. Generated, not parsed — a fountain
parser here would be a second implementation of `scf-core`'s tokenizer,
free to drift from it, which is the exact failure the audit existed to
find. One source, two outputs.

Unlike scripts 01–03 this one is idempotent, so it can be re-run when you
rewrite any of the prose.

**Still no build-from-nothing path**, and the README now says so plainly.
The screenplay has a source; the entity data doesn't. Checklist §10's
"reproducible fixture build in CI" remains unsatisfiable until it does.

## What happened to the expectations

Almost nothing, which surprised me. All eight blessed markdown files
still reproduce; only `shapes.json` moved. Q03, Q05–Q08 and Q13 target
scene 12, Q12 compares 9 against 12, and none of those moved. The
divergence is downstream of them.

That's a mild warning in itself: the expectations cluster on one scene,
so they exercise less of the fixture than their count suggests. Worth
widening when the query layer is specified.
