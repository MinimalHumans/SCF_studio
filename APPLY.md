# Spec 0.24 — Q09, Q10, and a correction

Apply after `scf-queries-8.zip`.

```sh
cd scf-core && npm test && npx tsc --noEmit
cd ../scf-app && npm test && npm run build
cd .. && python3 schema/artifact_manifest.py --check
sha256sum -c spec/SHA256SUMS
```

Verified here:

- `scf-core`: 32 files, **564 passed**, 6 skipped (was 556)
- `scf-app`: 22 files, 249 passed, 1 skipped
- **seventeen** published artifacts, checksums verify, build clean

No schema change. Spec 0.23 → **0.24**. **Ten of sixteen specified.**

---

## A correction, first

Last session I wrote — in `stability.md`, in `conformance.md`, and in my
notes to you — that the specified queries were *"every query taking a
position"* and that the eight remaining *"enumerate the whole project"*.

**That was wrong.** I checked the parameter list before writing Q09 and
found Q02, Q04, Q09 and Q11 all take a `scene_id`. The claim was a
tidy-sounding story about a split that did not exist, and I had put it
in two normative documents.

Both are corrected. What the remaining six actually have in common is
that they are **composites** — a brief, a dossier, a subject in context,
a scene package, an audience state, a provenance trail. That is a real
distinction and it changes what is left to decide (below).

## Q10 was the interesting one

It is the **first query whose answer spans the whole story** rather than
a position, which is why I took it now: if the envelope needed anything
for project-wide answers, better to find out before six composites
depend on it.

**It needed nothing.** Same envelope, same projection rule.

§12.11 states the rule that makes the query worth having: **the spine
MUST include every scene, carriers or not.** A spine listing only the
scenes a theme reaches cannot answer the question the query exists for,
which is where the theme is *absent*. The blessed result shows it
working:

```
1:1  3:4  7:1  9:2  10:1  11:1  12:3  12A:0  19:6  16:1  21:1  24:5
```

`19` before `16` — story order, not scene-number order. `12A:0` is a
real gap. The cut scene is absent entirely, and a carrier reaching it
reaches nowhere, so its scene list and the spine's counts agree rather
than disagreeing at one position.

## Q09 states its own heuristic

`dense` is a flag, not a finding (§9.1), so a result MUST publish the
`densityThreshold` that produced it. A consumer should be able to see
the number rather than infer it from a count, and a different
implementation may choose a different threshold and must say which.

§12.10 also says a **candidate is not an obligation** — it is a related
motif *absent* from this scene, offered because a placement decision is
easier when you can see what is adjacent. Nothing is wrong with a scene
that places none.

---

## What is left, and the question it raises

Six remain: **Q00, Q01, Q02, Q04, Q11, Q15.** All composites.

The envelope has now held for a position query, a two-position diff, a
cascade, a media resolution, a readiness rubric and a whole-story spine.
So the open question is no longer the envelope. It is:

**Does a composite result nest the results it is built from, or restate
them?**

Q04 "Scene package" is the clearest case — it is Q03 plus Q07 plus Q08
plus more, at one scene. Nesting means a `Q04` result contains whole
`Q03` and `Q07` results, envelopes and all, which is honest about what
it is but verbose and awkward to version. Restating means Q04 defines
its own flat shape and the relationship to Q03 is documentation rather
than structure.

I lean toward **nesting the `result` bodies without their envelopes** —
a composite carries `{ worldState: <Q03 result>, look: <Q07 result> }`
and names which query each came from. It keeps one definition per
answer, and a consumer already holding a Q03 result can compare directly.

That is a decision worth your input before I write six sections that all
assume it.

## Next

Either you settle the nesting question and I do the six, or — and this
is what I would actually suggest — **re-run the independent reader
first**, now that ten queries are specified. The kit and prompt exist,
so it is cheap, and it is the only way to find out whether §12 reads as
a specification to someone who did not write it. Finding that out before
the last six is better than after.
