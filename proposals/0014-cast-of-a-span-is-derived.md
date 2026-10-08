<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0014 — The cast of an act is derived, not linked

| | |
|---|---|
| **Status** | **declined** — the cast of a span is derived; see Resolution |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | Nothing if declined. A sentence in `docs/authoring-guide.md` if accepted as a clarification. |

## The problem

**Scriptyard lets a writer place a Character or Prop directly in an Act
or Sequence backdrop. SCF has no link for that.**

Characters and props connect to story structure only through scenes:
`scene_character`, `scene_prop` (plus `costume_scene`,
`action_sequence_character`, and so on). There is no `act_character`.

The question is whether there should be.

## The proposal

**No new link. State that the cast of a span is derived:** the union of
`scene_character` over the span's derived membership (§5.1). Likewise
props.

The reason is §3.1. "Eleanor is in Act 2" is true *because* she is in
scenes 7, 9 and 12. Stored separately, it is a second truth that goes
stale the first time a scene moves across an act boundary — and scenes
move across act boundaries by editing the script, with no write to any
link (§5.1).

**Scriptyard's exporter** reports span-level placements as not exported,
rather than guessing which scenes they meant.

## What it breaks

Nothing, if declined. Scriptyard boards that use span-level placement as
a planning aid ("these three characters matter in Act 2") lose that in
the export, visibly.

## Alternatives

**Add `act_character` / `sequence_character` links.** Expresses the
planning intent and contradicts §3.1 for every case where the intent is
also true of the scenes.

**Fan out to every scene of the span.** Invents presence the writer never
claimed.

## Unresolved

- **The absent presence.** A character who is felt across an act without
  appearing — the dead father, the offscreen antagonist — is a **claim**,
  not a connection, and is not derivable. Is that a thematic connection,
  a `scene_character` with `role_in_scene = mentioned` per scene, or a
  case that justifies a span-level claim entity after all?

---

## Resolution

**Declined, 2026-10-08.** Settled in the 1.0 decision pass
(`docs/release-checklist.md` §A).

SCF gains no `act_character`, `sequence_character` or span-level prop
link. **The cast of an act or sequence is the union of its scenes'
casts over derived membership (§5.1)**, for the reason given above: a
stored span-level link is a second truth that goes stale the first time
an edit to the script moves a scene across a boundary, with no write to
any link. Scriptyard's exporter reports span-level placements as not
exported.

**The open question about absent presence is not settled by this
decline.** A character felt across an act without appearing is a claim,
not a connection. Proposal 0030 has since given `mentioned` a defined
meaning per scene (named, not seen), which covers the case scene by
scene; whether a span-level *claim* is ever needed is a new proposal,
not a reopening of this one.
