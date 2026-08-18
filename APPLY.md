# Spec 0.27 — Q00, Q11, Q15, and a decision withdrawn

Apply after `scf-normative-data.zip`.

```sh
cd scf-core && npm test && npx tsc --noEmit
cd ../scf-app && npm test && npx tsc --noEmit && npm run build
cd .. && python3 schema/artifact_manifest.py --check
sha256sum -c spec/SHA256SUMS
```

Verified here:

- `scf-core`: 32 files, **584 passed**, 6 skipped (was 575)
- `scf-app`: 249 passed, 1 skipped
- **twenty-two** artifacts, checksums verify, build clean

No schema change. Spec 0.26 → **0.27**. **Thirteen of sixteen
specified.**

---

## The nesting decision is withdrawn, and I should say so plainly

You approved it, I recorded it, and it was wrong. Before writing the
composites I read what they actually do, and **no canonical query calls
another.** Q04 does not build a Q03 result and a Q07 result; it
assembles its own answer from the same resolvers. Q01 and Q02 share a
`dossier()` helper — a shared *composition*, not a shared *result*.

So nesting would have invented a relationship the implementation does
not have, and I would have had to either reimplement Q03 inside Q04
(forbidden) or refactor Q04 to call it (a real change, made to satisfy a
spec sentence rather than a need).

§12.1.3 now records the withdrawal and the reason. Each query defines
its own result shape; where two genuinely share a composition, the
shared part is one function in one place. Nesting stays available if a
query is ever built by calling another.

This is the second time my tidy story about "the remaining six" has been
wrong — the first was claiming they took no position parameter. Both
times the error was describing a set by a property I had not checked.

## Q00 — the empty envelope

The only canonical query with no parameters, which is worth having
tested: the envelope has to survive having nothing to put in it. It
does.

Its layer list is **fixed by §12.12 rather than derived**, and the
section says why: what belongs in a brief is an editorial choice, not a
fact the registry knows. Adding one is a spec change. An unauthored
layer is absent rather than present-and-empty.

## Q11 — where everything may be missing

Every field can be absent, and §12.13 states that absence is null or
empty and **never invented**.

While writing it I hit a real one: I guessed the table names
(`audience_information`, `audience_identification`) instead of reading
them. They are `information_strategy` and `identification_strategy`, and
the test failed with `no such table`. Worth reporting because the fix
was not only the names — I also made the fetch **total**, so a file
lacking one of these tables yields nothing rather than throwing. §9.2
already required that, and an older file predating an entity is not an
error. §12.13 now says so.

## Q15 — and a matcher that was in the wrong package

`affected_entities` is free-form: a JSON array, a JSON object, or prose.
`mentionsRow` handled all of that permissively — **inside the app**. Q15
is normative, so its matcher is too, and while it lived there no
independent implementation could know which conventions counted.

Moved to `scf-core`, and §12.14 now writes the conventions down:
`entity:id`, `entity#id`, a bare `entity`, and an object carrying an
entity kind with an optional id. The section also says why permissive is
right: a provenance trail that silently omitted a note would be worse
than one that included a doubtful one.

§12.14 also requires the version-chain walk to **terminate on a cycle
rather than follow it** — a cycle is a finding, not a reason to hang.

---

## What is left

**Three queries: Q01, Q02, Q04.** They share the `dossier` and
scene-assembly compositions, which still live in the app. Those have to
move to `scf-core` first — the same extraction Q03 and Q12 needed, for
the same reason: a normative result must not re-derive what a renderer
already derives.

That is one focused session.

Then the third reader run, which I would still do before calling §12
done. Two things make it a genuinely different experiment from the last:
the artifacts it will check are corrected, and §12 will be complete
rather than two-thirds written.
