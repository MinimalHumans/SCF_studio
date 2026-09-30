<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0031 — When several bindings apply: precedence, and add or replace

| | |
|---|---|
| **Status** | draft |
| **Author** | Found reading the scene 3 and scene 12 media results through the SCF MCP; drafted with Claude |
| **Opened** | 2026-09-30 |
| **Affects** | §12.8 (a new §12.8.2); `precedence` gains a meaning and help text on every `*_asset_binding`; a new `combine` field on every `*_asset_binding`; the order of Q13's `trail`; two findings; the fixture |

## The problem

**Several bindings can apply to one subject, for one intent, at one
position, and the specification does not say how they combine.** §12.8
defines three layers (shot overrides, then anchors, then bundles) and
§12.8.1 defines when a single binding applies. Between those two, nothing
says what happens when two bundles both apply. The implementation takes
all of them, ordered by `precedence`, highest first. That is a reasonable
guess, and it is only a guess: `precedence` has no help text on any of
the four binding entities, and the spec mentions it once, in passing.

Three things in the fixture show the gap is real.

**Adding everything up contaminates.** At scene 12, a night storm, the
Farmhouse Kitchen resolves its night references, and also `kitchen_day.png`
and `kitchen_no_table_day.png`. They come from the location's baseline,
"Kitchen – Day Ref", which carries no filter and so applies everywhere.
A prompt for a night scene is handed day plates, with nothing in the
result to say they do not belong.

**Replacing everything would be worse.** At a position where Eleanor is
wounded, "Eleanor while wounded" contributes the lamplit look. It is
meant to **add** to her identity bundle, not stand in for it. If the more
specific binding replaced the less specific one, her full-body references
would disappear exactly where continuity needs them most.

**`precedence` is already used both ways.** For the kitchen, higher
means more specific: the scene-3 plate is 2, the night reference 1, the
baseline 0. For Eleanor it means the opposite: her baseline is 10 and her
wounded state is 1. Both files were written in good faith by someone
guessing what the number meant. Two bindings at one position also share
a precedence (the scene-3 plate and the storm-night build are both 2),
and nothing says how that tie orders.

**The trail is in the wrong order, for the same reason.** §12.8 says
`trail` runs broadest first. The implementation lists bindings in
precedence order, highest first, which for the kitchen is most specific
first: "Scene 03 – Kitchen – Day" before the baseline. Eleanor's trail
only looks broadest first because her precedence is inverted. Once
`precedence` means something, the trail's order follows from it; until
then, neither the implementation nor the published result can be wrong.

So neither global rule is right. Which one applies is a property of the
binding, and only its author knows it: a night plate replaces the day
plate, and a wounded look adds to a face.

## The proposal

### A. `precedence` orders, and never excludes on its own

Add to §12.8, as §12.8.2:

> **Bindings in force are taken in order of `precedence`, highest
> first.** Equal precedence is ordered by row id, lower first. Precedence
> only orders: two bindings in force both contribute unless one of them
> replaces (below).
>
> The order is the order of `references` within the bundle layer, and so
> the order a consumer meets them in. **`trail` lists the same bindings
> in the reverse order**, lowest precedence first, before the anchors and
> the shot overrides, so that it runs broadest first as §12.8 already
> requires.
>
> Precedence is an author's ranking. The format does not rank bindings by
> what they filter on. **Higher precedence is the more specific
> opinion**, which is what makes the two orders above the right way
> round, and what `replace` (below) relies on.

And give `precedence` help text on every binding entity saying so.

### B. A binding declares whether it adds or replaces

A new closed field on every `*_asset_binding`:

| Field | Values | Default |
|---|---|---|
| `combine` | `add`, `replace` | `add` |

> A binding in force whose `combine` is **`replace`** excludes every
> binding for the same subject and intent **with lower precedence**. A
> replaced binding appears in `trail` as EXCLUDED, naming the binding
> that replaced it (§12.8.1's rule that an absence carries its reason).
>
> Replacing reaches the bundle layer only. **Anchors and shot overrides
> are never replaced by a binding**: an anchor is identity, and a shot
> override is already the most specific thing the file can say.
>
> A binding of equal precedence is not replaced. A tie is ordered, not
> resolved.

`add` is the default because it is today's behaviour: a file that never
sets `combine` answers exactly as it does now.

### C. Two findings, and a recommendation

Both findings are checked on the bindings as written, not at a position,
so a file is reported the same way however it is queried:

| Finding | Severity | Raised when |
|---|---|---|
| `binding.baseline_replaces` | `warning` | A binding with `is_baseline` true has `combine = replace`. A baseline applies everywhere, so it would exclude every lower binding at every position. That is almost never what was meant, and the answer is still the rule's, so it is reported rather than refused (§9.2). |
| `binding.replace_tie` | `info` | A binding with `combine = replace` shares its subject, its bundle's intent and its precedence with another binding. Equal precedence is never replaced, so the author's `replace` does nothing against that binding, and their order comes from row ids. Legitimate between two adding bindings, which is why only a tie involving `replace` is reported. |

And a recommendation in §12.8.2:

> A baseline SHOULD have precedence 0, so that every binding scoped to
> something ranks above the one that applies everywhere, and "higher is
> more specific" holds without exception. This is a recommendation, not a
> rule: an author may have a reason to rank a baseline above a narrower
> binding, and the ordering rule still answers.

### D. The fixture shows both, and fixes its own contradiction

- **"Kitchen at night"** becomes `combine = replace`. At scene 12 the day
  baseline is then excluded, and says why, so the night prompt stops
  getting day plates. At scene 3, where the night binding does not apply,
  nothing changes: the scene-3 plate and the day baseline both add.
  That is item 2's original question answered, by the file rather than by
  a global rule.
- **"Eleanor while wounded"** stays `add`, so her identity bundle survives.
- **Eleanor's baseline precedence** drops from 10 to 0, so that
  precedence means one thing across the file: higher is more specific.
  Her wounded bundle holds only `eleanor_lamplit.png`, which at 12-04
  already arrives as a shot override, so the published references do not
  move. With the trail in ascending order (§A), her trail reads exactly
  as it is published now: baseline, then wounded.

## What it breaks

- **The schema.** One new field on four entities, with a default that
  reproduces today's answer: a minor bump, additive.
- **Published results: none are expected to change**, going by the
  fixture's bundle contents; re-blessing during implementation will
  confirm it. §D's precedence change and §A's trail order cancel for Eleanor
  (see §D), `Q13-scene3` has only her baseline in force, and scene 12's
  kitchen is in no published result. The day plates leaving scene 12
  shows in tests, which is its own argument for a published kitchen
  result at a night position.
- **The trail order changes** for any subject whose bindings were not
  already ascending. The kitchen's is the visible one: its trail at scene
  3 now reads baseline first.
- **The finding catalog** gains two codes, and `finding-catalog.json`
  regenerates. The fixture raises neither.
- **Writers.** Nothing is required. A writer that knows a binding
  supersedes another gains somewhere to say so.
- **Anyone reading `precedence` as specificity already.** The spec now
  says it is an author's ranking. That was the only reading the
  implementation ever had, so no answer changes, but a reader who assumed
  otherwise was wrong before and is now told so.

## Alternatives

**Most specific wins, derived from the filters.** Rank a binding with a
scene range above one with a state filter above a baseline, and let the
top one win. Declined: whether a scene range is more specific than a
physical state has no answer, and "wins" would drop Eleanor's identity
bundle at every position where she is wounded.

**Add everything up, and write that down.** The status quo, specified. It
costs nothing and leaves day plates in every night prompt. The only fix
available to an author is filtering the baseline, and `time_of_day_filter`
is one value, so "any time but night" cannot be said.

**Filters that can say "not" or "any of".** A day baseline filtered to
`morning, midday, afternoon, dusk` would stop the contamination without
`combine`. Worth having for other reasons, and it moves the problem
rather than solving it: every new night binding would need its day
counterpart re-filtered. `replace` puts the fact on the binding that
knows it.

**Replace by role.** A night plate replaces only the day assets with the
same `role_in_bundle` (staging replaces staging, and a reference image
survives). Finer, and it makes the answer depend on a free-form field the
registry does not constrain (§12.8's `role`). Not taken, and no
`combine` value is reserved for it: if it is ever wanted it can arrive
with its own proposal, as a new value of a closed vocabulary.

**Replace everything, including anchors.** Declined: an anchor is the
identity the other references are consistent with, and a bundle that
could remove it could make a character unrecognisable at one position.

**Do nothing.** The implementation keeps guessing, the fixture keeps
using the number both ways, and every night scene keeps its day plates.

## Unresolved

None open. The questions this draft opened with were settled in
discussion before it was put up:

| Question | Settled as |
|---|---|
| Can a baseline replace? | Yes, and it is reported: `binding.baseline_replaces`, `warning` (§C). |
| Is a precedence tie a finding? | Only when a `replace` binding is part of it: `binding.replace_tie`, `info` (§C). |
| Reserve `replace_role` for replacing by role? | No. Replacing by role is declined for now, and would arrive with its own proposal. |
| Should baselines sit at precedence 0? | Yes, as a SHOULD in §12.8.2, not a rule (§C). |
