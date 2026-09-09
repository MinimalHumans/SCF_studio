<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# `scf-mcp` — design note

An MCP server over a `.scf`, so an agent can answer questions about a
film and assemble a shot prompt without being handed a schema and told
to write SQL.

Written for Jesse. Nothing here is built. Checked against
`SCF_studio@main`, spec 0.51 / schema 2.13.

**Status: proposal. Post-MVP** — see [`editor-mvp.md`](editor-mvp.md).
This is not a format capability being made authorable, so it sits behind
the three unexercised Part 3 features on the list.

---

## 1. What it is for

One sentence, and the whole design falls out of it:

> A user says *"SeeDance 2.5 prompt for shot 10A"* and gets prompt text
> plus a list of reference files to attach.

That is **two tool calls**, not fifteen:

    find("shot", "10A")        → uuid
    shot_context(uuid)         → one payload of resolved film facts

The agent then renders that payload into SeeDance's format using a
template file. Which model is being targeted is knowledge that lives in
**one markdown file the user owns** — not in the format, not in this
server.

### The boundary, stated once

**SCF is the ground truth of the film. It is not the workflow for making
it.** A generated prompt is a fact about a production process, and it
belongs to the tool that generated it. It comes back into the `.scf`
only if it becomes a fact about the film — a character sheet generated
from SCF descriptions and then adopted as the reference is a film fact;
the prompt that produced it is not.

This server therefore **reads**. It has no write tools. If that changes
later it is a different document.

---

## 2. Shape

    scf-core/                     (existing)
      src/naturalKey.ts           NEW — label → uuid
      src/shotContext.ts          NEW — the composite
      test/shotContext.test.ts    NEW — parity against blessed results

    scf-mcp/                      NEW package
      src/server.ts               stdio MCP server, four tools
      src/config.ts               .scf path, root→location map

    templates/
      seedance-2.5.md             NEW — yours, not the format's

**Why the two modules are in `scf-core` and not in the server.** The
fixture and the blessed expectations are in `scf-core`, and the
composite's whole safety property is a test that compares it against
them (§4.3). Put it in the server and the test cannot be written where
it belongs.

**Why `scf-mcp` is a separate package and not a folder in `scf-core`.**
`scf-core` is what a conforming implementation is graded on, and its
`index.ts` is an explicit 226-name public surface with a CI check over
it. An MCP server has no conformance status. Mixing them makes that
check mean less than it does today.

---

## 3. `resolveNaturalKey` — the part that is easy to get wrong

```ts
// scf-core/src/naturalKey.ts
export interface KeyHit { uuid: string; entity: string; label: string; }

export async function resolveNaturalKey(
  ctx: ScfContext, entityType: string, label: string,
): Promise<KeyHit[]>;
```

**Returns an array. Always — including when exactly one row matches.**

That is the entire design decision, and it is deliberate. §6.4 says a
reader MUST report duplicate natural keys rather than reject them. A
signature returning `KeyHit | null` makes that rule something the caller
has to remember; a signature returning `KeyHit[]` makes it something the
caller cannot avoid. The agent sees two hits and asks which one.

**Read the keys from the registry, not from a table in this file.**
§6.3 defines natural keys and `junctionKeyFields` already exposes the
machinery. A hand-written map is a second description that will drift —
`queryPaths.ts`'s `entity` field drifted for twelve revisions and
published blank tables the whole time (spec 0.50).

**Three traps the fixture already contains.** Test against it and these
are free:

| | |
|---|---|
| Scene `12A` exists | §4.2.1's grammar is not "an integer" |
| Scene numbers have gaps — 1, 3, 7, 9 | Do not infer position from the label |
| Scene `16` follows `19` in story order | A number is a **label**, never identity or order (§4.2) |

Add a fourth in the test itself: a deliberate duplicate must come back
as two hits, not one.

### Why this exists at all

`selectors.json` is in `fixtures/expectations/` because a third party
being graded on the queries had no way to name a row except by reading
parameters out of the artifact it was being graded against. An agent
handed the string `"10A"` has exactly that problem. This is that file,
at runtime.

---

## 4. `shotContext` — the composite

```ts
// scf-core/src/shotContext.ts
export interface ShotContext {
  contextFormat: "1.0";
  brief:     Q00Result;       // project register
  scene:     Q04Result;       // the scene, its cast, its text
  look:      Q07Result;       // the frame at this shot
  physical:  Q06Result[];     // per character in frame
  media:     Q13Result[];     // per subject × intent
  readiness: Q14Result;       // what is thin
}

export async function shotContext(
  ctx: ScfContext, shotUuid: string, locate?: FileLocator,
): Promise<ShotContext>;
```

### 4.1 It composes and derives nothing

Every member is the **unmodified return of a canonical query**. No
filtering, no merging, no re-ordering, no picking a winner.

The queries already resolved everything: Q07 returns the direction
cascade's `leaf` and its `layers`; Q13 returns the `trail` and what is
in force at the end of it. **Hand the agent the leaf.** The trail is
useful as explanation for a human reading the prompt, but if the model
chooses from the trail then a normative resolution has been moved into a
nondeterministic component and two runs will disagree.

Any line of resolution logic inside `shotContext` is a second
description of a normative answer. There is already one of those in the
tree — `scf-app/src/ui/queries/runnersComposed.ts` assembles its own Q04
payload rather than calling `q04Result`. It has not diverged yet. A
composite with six members has six chances to.

### 4.2 It is one call because the fan-out is expensive

Q13's parameters are `subjectType`, `subject`, `intent`, `scene`, `shot`
— **one call per subject per intent**. A shot with three characters, a
location and two props is a dozen calls. Left to the agent that is a
dozen round trips it has to plan; done here it is a loop.

The subject list comes from `scene` (Q04's cast, props, location). The
intents come from `readiness-rubrics.json`, which publishes each media
step's `intent` in machine-readable form — do not hard-code
`visual_identity`.

### 4.3 The test is the point

`test/shotContext.test.ts` runs against `hollow_creek.scf` and asserts
**each member is byte-identical to the corresponding blessed
`.result.json`**.

This buys drift protection without publishing a seventeenth normative
artifact. A composite that can only be wrong by disagreeing with a
published result cannot quietly rot. It is the cheapest available
version of the property the whole conformance suite is built on.

### 4.4 Version the payload

`contextFormat: "1.0"`, on its own track — the same reasoning as
§12.1.1's `resultFormat`, which exists because envelopes needed to
version independently of the schema. Adding a version later is a
breaking change to whatever is already consuming it; adding it now costs
one field.

### 4.5 Not a Q16

§12.0 is explicit that defining the sixteen does not preclude asking
others, so a composite needs no spec change and gets none.

Promote it only if a **second implementation** needs it. §12 is for
things every conforming reader must agree on; until someone else wants
it, this is one tool's convenience.

---

## 5. The server

Four tools. Two are the ones above; two exist so the agent is not stuck
when they do not fit.

| Tool | | |
|---|---|---|
| `find` | `(entityType, label)` | → `resolveNaturalKey` |
| `shot_context` | `(shotUuid)` | → `shotContext` |
| `query` | `(id, params)` | any of the sixteen, unwrapped |
| `readiness` | `(queryId, params)` | Q14 directly, for pre-flight |

`query` matters more than it looks. Every `qNNResult` is already in
`index.ts`, so this is a dispatch table — and it means an agent asked
something `shot_context` does not cover can still answer it instead of
inventing SQL.

Transport is **stdio**. `scf-core/node` supplies `openNodeDatabase`,
which is what conformance CI and the scripts already use.

### 5.1 Root mapping is configuration, and its absence is an answer

`q13Result` already takes a `FileLocator` and a `rootMapped` flag, so
the seam exists — the server's job is to supply it from config:

```
{ scf: "/path/to/film.scf",
  roots: { project: "/vol/film", plates: "/vol/plates" } }
```

`FileLocator` returns `undefined` for a root it does not know, which is
deliberately different from `null` for a file that is not there. Keep
that distinction all the way out to the agent: §8.3's `unaddressed` for
an unmapped root, `missing` for a mapped root with nothing at the path.

**Do not omit unresolvable references.** "I know what is in force but
cannot locate it" is different information from "there is nothing," and
the second is a lie. This is the same reason a Reader that does not
resolve assets MUST report `unaddressed` rather than `missing`.

The root map is not in the `.scf` on purpose (§0.3, §8.2). The file is
portable; where the bytes live is not.

---

## 6. The template

`templates/seedance-2.5.md` — prompt structure, camera vocabulary, how
reference images are passed, length limits. The agent reads it beside
the payload and writes to it.

**Not in `scf-core`. Not in the server.** If `shot_context` took a
`target: "seedance-2.5"` parameter, the server would ship a new version
every time a model updated, and the query layer would start accumulating
opinions about video generators. Keep the server returning film facts.
`veo-4.md` then sits next to it and nothing else moves.

---

## 7. Order to build

1. **`resolveNaturalKey`.** Nothing works without label → uuid, and it
   is where the conformance traps are.
2. **`shotContext` + the parity test.** Write the test first; it is the
   design.
3. **The server.** By then it is plumbing.
4. **The template**, once the payload is real enough to write against.

### 7.1 Do (1) and (2) and stop for a moment

Pointing an agent at the query layer and asking it for a shot prompt is
**a sixth reader run, and the most adversarial one so far.** It will
find shape gaps of exactly the kind runs 4 and 5 found by hand — a
member whose form cannot be inferred, a parameter that cannot be
supplied, an empty answer that reads as an error — in minutes, and for
nothing.

Do that before the template exists. The findings are worth more than the
feature.

---

## 8. Two things standing in the way

- **`scf-core` is `"private": true`** and held until 1.0, because npm
  blocks unpublish after 72 hours. `scf-mcp` can depend on a workspace
  path locally; nobody outside can install it until that changes.

---

## 9. Open questions

- **Does `shot_context` need a scene-level sibling?** Q07 takes a null
  shot and answers for the scene. A `scene_context` is the same
  composite minus the shot leaf — probably yes, probably trivial, but
  worth confirming against a real request rather than assumed.
- **What does the agent do with `readiness`?** Refuse to write a prompt
  when a `required` step is missing, or write it and say what is thin?
  Second, most likely — Q14's own framing is that absence is not an
  error — but it is a product decision, not a technical one.
- **How much of Q04's screenplay member belongs in a shot prompt?** The
  scene's text is now in the payload (§12.17.1, spec 0.49). For a shot
  it may be too much context, or exactly the right amount. Unknown until
  tried.
