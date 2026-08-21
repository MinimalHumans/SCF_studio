# CI fix — two causes, both mine

Unzip over the repo root. **Three files.**

```
.github/workflows/ci.yml     action majors bumped
scf-core/package-lock.json   NEW — was never committed
scf-app/package-lock.json    regenerated — was out of sync
```

Then push, or re-run the workflow.

---

## What was actually wrong

I diagnosed both against your repository rather than guessing, and
reproduced the failure locally.

### Cause 1 — `scf-core/package-lock.json` does not exist on `main`

Nothing ignores it. **I wrote CI to use `npm ci` and never shipped the
lockfile it requires.** That produced the cache warning you saw twice —
`cache-dependency-path: scf-core/package-lock.json` cannot resolve a
file that isn't there — and `npm ci` cannot install without it either.

### Cause 2 — `scf-app/package-lock.json` was stale

This is the `exit code 1`. Reproduced exactly:

```
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json are in sync.
npm error Missing: esbuild@0.28.2 from lock file
```

The committed lockfile predates several dependency changes. Both are
regenerated and in sync here.

**Worth saying plainly:** `npm ci` failing on a stale lockfile is the
feature working. It refuses to install something other than what the
lockfile says. The alternative — `npm install` in CI — would have
silently drifted and passed.

## The Node 20 warnings

Separate from the failure, and not about your `NODE_VERSION`. They are
about the runtime **the actions themselves** run on. Node 20 reached end
of life in April 2026 and is being removed from the runners this autumn.

I checked the current majors rather than assuming, and bumped all three:

| | was | now |
|---|---|---|
| `actions/checkout` | v4 | **v7** |
| `actions/setup-node` | v4 | **v7** |
| `actions/setup-python` | v5 | **v7** |

**`NODE_VERSION` stays at 22.** That is the Node your jobs run, it is
still in LTS maintenance, and `node:sqlite` plus type stripping are
known to work on it. Moving the job runtime and the action runtime at
the same time would have been two changes with one test. The comment in
the file now says which is which.

## Verified, not assumed

Fetched `main`, applied only this zip, deleted both `node_modules`, and
ran the full workflow:

- `npm ci` clean in **both** packages from nothing
- **artifacts job**: registry, lint, schema SQL, finding catalog,
  normative data, negative fixtures, corpus, manifest, all 41 checksums
- **core job**: typecheck, **592 passed** / 6 skipped, `scf-check` on the
  fixture → *no findings*
- **app job**: typecheck, **249 passed** / 1 skipped, production build

All three jobs pass.

---

## The uncomfortable part

CI has been on `main` since I shipped it, and it has **never passed
once**. I wrote it, verified the twelve commands by running them in my
own environment where `node_modules` already existed, and never
exercised the `npm ci` path that a real runner starts from.

That is the same mistake this project keeps finding: something verified
in the place it was written rather than the place it runs. The broken
import that gave you a white screen would have been caught by the `core`
job — which could not have run, because the job before it could not
install.

Two things follow from that, and I'd take both:

1. **Add a `package-lock.json` freshness check to `conventions.md` §8.**
   Any change to a `package.json` needs `npm install` and the lockfile
   committed with it. `npm ci` enforces it, but only where CI runs.
2. **Treat the first green run as the real completion of §10's CI item.**
   Rev 9 marks CI ✅; it should have been ⚠️ until a run went green. I'll
   correct that in the next revision once you've seen one pass.
