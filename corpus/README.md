# SCF parser corpus

The golden corpus for the Part 2 parser (design doc: "the real fix for
'not even most'"). Every parser change runs the whole set; a fix that
breaks another script is visible before merge.

## Tiers

- **public/** — checked in. `spec/` holds small hand-verified fixtures
  covering each Fountain construct (forced elements, dual dialogue,
  notes, boneyard, sections/synopses, title-page grammar, whitespace
  edges) plus `features.fdx` for FDX-specific features. `scripts/` holds
  redistributable full scripts — currently `alexis-nexus.fountain`, a
  first-party feature-length screenplay (127 headings, 45 locations, 27
  speaking characters). Nothing in this tier may be third-party material:
  the public corpus ships with the repo, under the repo's licence.
- **private/** — **gitignored, local-only.** Real scripts that cannot be
  redistributed: PDF→Fountain conversions and FDX files. Their blessed
  expectations live beside them and are equally private (expected files
  imply the text). CI runs green on the public tier alone; a machine
  with the private tier gets the full set automatically.

## Expectations

`<name>.types.txt` beside each script: one line type per input line.

- **spec/ fixtures: hand-verified truth.** Changing these means the
  classifier's spec interpretation changed — review as such.
- **Real scripts: regression baselines.** They record what the current
  classifier does, so drift is visible; they are not a claim that every
  classification is what a human would want. The private tier's
  spec-vs-reality collisions (stray `@` force markers, `>`-prefixed
  numbered headings, OCR-broken `IN_T.` keywords, CSV-quote-wrapped
  lines) are the design input for the future repair/leniency layer —
  documented by the baselines, deliberately NOT absorbed into the
  spec-faithful Stage 1. The repair pass (`src/fountain/repair.ts`)
  addresses exactly the systematic subset — emphasis-shredded and
  number-glued headings — under a stated scope boundary: reasonable
  error-proofing for well-formed screenplays a converter mangled, never
  idiot-proofing for genuine garbage. It runs pre-parse, visibly, on the
  caller's initiative; these baselines stay on raw text.

## Workflow

```
cd scf-core
npm run bless-corpus            # (re)generate expectations
npm run bless-corpus -- --check # CI: stale/missing public tier fails
npx vitest run test/fountain.test.ts test/fdx.test.ts
```
