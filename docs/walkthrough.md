<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Walkthrough

One worked example, against a real file that ships with the format.

Everything below is checked on every commit, so if a command here stops
working, CI says so before you do.

---

## The film

`fixtures/hollow_creek.scf` is **Hollow Creek** — small, complete enough
to be interesting, and deliberately imperfect.

> 1889, an Oregon homestead: a son returns after seven years to the
> mother who has never said aloud that she blames him for his sister's
> drowning.

Four characters: **Eleanor Cade**, her son **Marcus**, her drowned
daughter **Ada**, and **Reverend Shaw**. Fourteen scenes, one of which is outlined and not
yet written. The one
everything keys on is **scene 12 — INT. FARMHOUSE KITCHEN - NIGHT**,
summarised in the file as *"The confrontation. 'You came back.'"*

Every published answer in the format is an answer about this film.

---

## Getting it

```sh
git clone https://github.com/MinimalHumans/SCF_studio
cd SCF_studio
```

The reference implementation is unpublished until 1.0, so you run it
from the checkout:

```sh
cd scf-core && npm ci
```

---

## 1. Look at the file without any of our code

An `.scf` is a SQLite database. Nothing here is special:

```sh
sqlite3 fixtures/hollow_creek.scf \
  "SELECT scene_number, name FROM scene ORDER BY id LIMIT 5;"
```

That is the whole promise of the storage choice. Any language with a
SQLite binding is already an SCF reader, and you can go this far before
deciding whether the format is worth your time.

To see how much is in there:

```sh
sqlite3 fixtures/hollow_creek.scf \
  "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"
```

107 tables — 99 registry entities plus the screenplay's own.

## 2. Check that it says what it claims

```sh
cd scf-core
npm run scf-check -- ../fixtures/hollow_creek.scf
```

```
../fixtures/hollow_creek.scf  (schema 2.12)

  info     structure.scene_not_in_script  [scene 15]
           INT. HOLLOW CREEK CHURCH - VESTRY - DAY has no heading in the
           screenplay, so it has no story position and belongs to no act…

  info     structure.sequence_act_mismatch  [sequence 1]
           The Reckoning spans Act 2 — The Thaw and Act 3 — The Truth.
           That is legal (§5.3); a presenter showing acts and sequences
           as nested must split it into the part belonging to each…

  0 error, 0 warning, 2 info
  This file is readable. Findings above are worth fixing, none prevent reading.
```

**Read those, because they are the format's whole disposition in two
lines.** A scene has been outlined and not yet written. A sequence runs
across an act boundary, which is legal and which anyone drawing this
film as a tree needs to know about. Neither is an error, neither stops
anything, and both are reported anyway — with what they mean and what
is unaffected.

Nothing is wrong with this file. Something in it is unfinished. Those
are different, and a format for work in progress has to be able to say
which.

## 3. Ask it a question

The sixteen queries are the reason the format exists. Here is voice
direction for Eleanor in scene 12 — the question an ADR session, a voice
actor, or a text-to-speech tool all need answered:

```sh
cat ../fixtures/expectations/Q05.result.json
```

The rendered form is easier to read:

```sh
cat ../fixtures/expectations/Q05.expected.md
```

```
# Voice direction
## Baseline
- name: Eleanor voice
- voice_quality: Low and unhurried; the voice of someone used to being
                 obeyed by animals
- pitch_range: low
- speech_pattern: Answers a question with an instruction
- rhythm: halting
- accent: Flat inland Oregon
- listening_behavior: Listens with her whole body.
```

That is not in the screenplay and could not be. It is what somebody
decided about how this woman sounds, in a form a machine can act on.

**The answer has four parts, and the shape matters:** the baseline
(what Eleanor sounds like always), the states in force at this point
(what has happened to her since), the modulations, and the beats (line
by line). The query composes them; you do not have to know where each
one lives.

## 4. See where an answer came from

The look query is the one to try if you want to understand the cascade.
It resolves root-first — project palette, then the colour script, then
the scene's palette, then the shot's design — and **returns the whole
trail rather than only the winner**:

```sh
cat ../fixtures/expectations/Q07.result.json
```

Seven layers come back in order — `project_color_palette`,
`color_script`, `color_script_entry`, `scene_color_palette`,
`look_development`, `lighting_design`, `shot_design` — and `leaf` names
which one is in force. Here it is `shot_design`: the most specific
layer wins.

A DP, a colourist and an image-generation tool ask this same question
and get the same chain, which is the point. You are never handed a
value with no account of where it came from.

## 5. Watch a decision propagate

Scene 12's kitchen has a location variant chosen for it — the dressing
built for a night in a storm. Look at what `Q04` says about it:

```sh
python3 -c "
import json
r = json.load(open('../fixtures/expectations/Q04.result.json'))['result']
print(json.dumps(r['locationVariant'], indent=2))"
```

```
"mismatches": [ "season: scene=\"winter\" variant=\"autumn\"" ]
```

The variant was built for an autumn night and the film uses it in
winter. It is still the best available match — it agrees on time of day
and weather — so it is still the one in force, **and the format says
what it is wrong about rather than pretending or refusing.**

That single line is the difference between a system that describes and
one that enforces.

## 6. Ask what is missing

```sh
cat ../fixtures/expectations/Q14.result.json
```

Readiness takes another query as its parameter and reports the gaps
ordered by consequence. *"Can we shoot scene 12 tomorrow?"* — and,
more usefully day to day, *"where should the next two hours go?"*

Look at the `suggestion` in there:

> Physical state persists here (wounded) with no vocal state — does it
> color the voice?

That is a question, not a defect. Nothing is wrong; something might have
been overlooked. It is also why this one query is not reproduced byte
for byte between implementations — you cannot specify a sentence.

## 7. Open the editor

```sh
cd ../scf-app && npm ci && npm run dev
```

Chromium only, and it reads and writes local files directly. **Nothing
uploads and nothing needs a server** — the browser is running the same
SQLite engine the library uses.

Open `fixtures/hollow_creek.scf`, change something in scene 12, and run
the queries again from the editor's query panel.

---

## What just happened

You opened a film as a database, checked it, asked it five of the
sixteen questions it is built to answer, and saw one of them tell you
honestly where its own answer was imperfect.

The file did not need to be complete for any of that. It has an
unwritten scene and a dressing that is wrong about the season, and every
query answered anyway and said so.

---

## Going further

**Change the fixture and see what moves.** It is a build output — the
authored content lives in `fixtures/build/hollow_creek.data.json` as
reviewable JSON:

```sh
python3 fixtures/build/build_fixture.py        # JSON → .scf
python3 fixtures/build/dump_fixture.py         # .scf → JSON
```

Edit the JSON, rebuild, re-run a query. Two builds from the same source
are byte-identical.

**Verify what you have is what was published:**

```sh
sha256sum -c spec/SHA256SUMS
```

Forty-five artifacts, including the specification documents themselves.

**Write your own reader.** Four people have, from the specification
alone. The [query reference](../spec/query-reference.md) is one page,
and [`spec/conformance.md`](../spec/conformance.md) says what a claim
requires.

| | |
|---|---|
| What this all is | [What is SCF](what-is-scf.md) |
| Building your own file | [Authoring guide](authoring-guide.md) |
| Terms you hit above | [Glossary](glossary.md) |
