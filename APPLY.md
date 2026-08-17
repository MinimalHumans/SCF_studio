# Spec 0.20 — §12 exists: Q05 and Q07

Apply after `scf-ci.zip`.

```sh
cd scf-core && npm test && npx tsc --noEmit
cd ../scf-app && npm test
cd .. && python3 schema/artifact_manifest.py --check
sha256sum -c spec/SHA256SUMS
```

Verified here:

- `scf-core`: 31 files, **529 passed**, 6 skipped (was 512)
- `scf-app`: 22 files, 249 passed, 1 skipped
- typecheck clean, artifacts and checksums current (**nine** artifacts now)

No schema change. Spec 0.19 → **0.20**.

---

## The shape, and whether it held

I specified Q05 and Q07 only, deliberately, and picked them because they
stress genuinely different machinery:

- **Q05** — position pattern 2 (persistence), a baseline that may be
  absent, and a merge over an opaque JSON column.
- **Q07** — the `refines` cascade, one row per entity, and a leaf that
  changes depending on the parameters.

**One envelope and one projection rule served both**, which is the
evidence I was after. Extending to the other fourteen now looks like
repetition plus whatever the harder queries break, rather than a design
problem.

## §12.1 — what makes a result portable

The envelope names the query, its own format version, the schema read,
and the parameters as uuids. Then the rule the section turns on:

- **row ids MUST NOT appear** — they are file-local (§6.2);
- `id`, `created_at`, `updated_at` omitted;
- null and empty fields omitted, so absence is unambiguous;
- **reference columns resolved to uuids** — `scene_id` → `scene_uuid`;
- field names are the registry's own, because a result is made of
  registry fields and a second vocabulary is a second thing to drift.

And: **the normative answer is the result structure. Any rendering is a
convenience and is not normative.** Two implementations that agree on
the result and print it differently are both conforming.

One decision worth naming: an unmapped reference column is **dropped**,
not emitted raw. Emitting the row id would be worse than losing the
field, because it would look like data. There is a test asserting the
number never appears in the output.

## §12.3.1 — the leaf is a property of the question

`scene_color_palette` for a scene; `shot_design` when a shot is named.

This is what §7.1 meant by the leaf not being derivable, finally said in
the place an implementer will look for it — the independent reader had
to hard-code both leaves after every heuristic failed. There is a test
asserting the same scene answers with a different leaf depending on the
parameters, which is the property in one line.

## Where the code lives, and why

`scf-core/src/queryResult.ts` and `canonicalQueries.ts` — **in the core,
not beside the runners in the app.** The queries are part of the format
now, so the normative answer belongs where the format lives. The app
renders; the core answers.

The builders wrap `resolveDescription` and `resolveDirection` rather than
reimplementing them. A second description of "what is in force at scene
12" is a second answer, and this project has already paid for that
mistake once.

## What I checked rather than assumed

Both results reproduce the blessed markdown's content exactly, including
its **empty** sections — Q05 has no states and no modulations for
Eleanor at scene 12, and the markdown omits those sections while the
result carries them as `[]` and `{}`. That is the rendering/result
distinction working rather than a disagreement.

The portability test walks the whole serialised output of both results
and asserts no key is `id`, `created_at`, `updated_at`, or ends `_id`.
It is written over the files rather than over a projection in isolation,
so it cannot pass by agreeing with a mistake upstream.

---

## Still open in §12

- **Fourteen queries.** Q00–Q04, Q06, Q08–Q11, Q12, Q13, Q14, Q15.
- **Whether a result excludes `cut` rows.** This waits on §6.6, and it
  is worth knowing the cost: settling §6.6 changes *every* blessed
  result. Doing it before the other fourteen are blessed is meaningfully
  cheaper than after.

That second point is my recommendation for what comes next. §6.6 needs a
fixture containing cut rows, which is cheap now that the fixture has a
build script — and doing it now means fourteen queries get blessed once
instead of twice.
