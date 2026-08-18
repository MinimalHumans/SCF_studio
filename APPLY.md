# Spec 0.28 — §12 is complete

Apply after `scf-q00-q11-q15.zip`.

```sh
cd scf-core && npm test && npx tsc --noEmit
cd ../scf-app && npm test && npx tsc --noEmit && npm run build
cd .. && python3 schema/artifact_manifest.py --check
sha256sum -c spec/SHA256SUMS
```

Verified here:

- `scf-core`: 32 files, **592 passed**, 6 skipped (was 584)
- `scf-app`: 249 passed, 1 skipped
- **twenty-five** artifacts, checksums verify, build clean

No schema change. Spec 0.27 → **0.28**. **All sixteen queries
specified**, each with a published normative result.

---

## Q01 — a dossier that maintains itself

`groups` is **derived, not listed**: any entity whose registry `subject`
is this kind, at `scope: global`, carrying a reference back to it.

That means adding a new entity about characters puts it in every
character's dossier with no change to the spec or the code. It is the
clearest payoff so far for the registry carrying `subject` and `scope`
at all, and the test asserts the property rather than the current
answer — every group it returns must satisfy those three conditions.

## Q02 — the one place nesting is real

0.27 withdrew nesting as a general rule because no query built on
another. **Exactly one does.** Q02's media layer *is* Q13's answer at a
position, so it carries **Q13's result body without its envelope**, with
`fromQuery: "Q13"`.

There is a test asserting the nested body equals a freshly computed Q13
result and that it carries no `resultFormat` or `parameters` — an
envelope inside an envelope would let an inner version disagree with the
outer one.

So the mechanism §12.1.3 kept available is now used, once, where it is
honest. That is a better outcome than either the original decision (nest
everywhere, on a false premise) or the withdrawal alone (describe a
mechanism nothing uses).

§12.16 also states that fields not applying to a subject's kind are
**null or empty, never omitted**: a consumer must be able to tell "not
applicable here" from "unauthored", and an absent key says neither.

## Q04 — and what it deliberately does not do

Q04 covers some of the same ground as Q03 and Q07 and **does not nest
either**. It assembles its own answer, and §12.17 says so outright
rather than leaving a reader to infer a relationship the implementation
does not have.

Its `detail` list is fixed by the section, like Q00's layers — what
belongs in a scene package is an editorial choice, not a fact the
registry knows.

## The extraction

`composeDossier` moved to `scf-core`, shared by Q01 and Q02, for the
reason Q03's and Q12's compositions did: a normative result must not
re-derive what a renderer already derives.

`dossierMarkdown` **stayed in the app** — I removed it by accident with
the function above it, the typecheck caught it, and putting it back was
the right call rather than moving it too. It is rendering. Core
composes, app renders, result projects.

All 249 app tests and every blessed markdown expectation passed
unchanged across the move, which is what "behaviour-neutral" has to mean
here.

---

## Where this leaves the project

`stability.md` is down to **five** Unstable rows, and the query layer —
the largest gap in the document since it was written — is not among
them:

1. Rubric step labels resolving to entities (§12.9.1)
2. A view for what was cut (§6.6.2)
3. The asset resolution tally flag in `scf-check`
4. `scene_sequence` shadow rows — survive 1.0 or go
5. Artifact addressing — one `git tag`

## What I would do next

**The third reader run.** It is now a genuinely different experiment
from the first two: the artifacts are corrected, and §12 is complete
rather than partial. The kit and prompt exist, so the cost is one
session of yours.

Two things I would change in the kit: include all sixteen
`.result.json` files, and drop the instruction not to attempt
unspecified queries, since there are none.

If that run comes back clean, the honest next question is not another
fix — it is whether to tag `schema-2.12`, close section 4, and start
treating this as something you release rather than something you
harden.
