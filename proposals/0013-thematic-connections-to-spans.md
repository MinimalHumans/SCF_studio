<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0013 — Thematic connections to acts and sequences

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | `thematic_connection.entity_type`; spec §12.11 (Q10); the fixture |

## The problem

**A theme can be connected to a character, scene, location, prop, costume
or motif — but not to an act or a sequence.**

"Act 2 is where the story argues about forgiveness" is an ordinary
authorial claim. It is not derivable from scenes: an act can carry a
theme that no single scene in it states. `thematic_connection` is already
a **claim** (§6.6: it carries its own `lifecycle_status` for exactly that
reason). This is a claim it cannot make.

Q10 (§12.11) spells out how each carrier reaches scenes: a scene at
itself, a motif wherever it appears, a character wherever present, and
"anything else reaches no scenes".

**This has actually bitten.** A Scriptyard Theme card placed directly in
an Act or Sequence backdrop has no SCF equivalent. The exporter's options
are to drop the placement, or to fan it out to every scene of the act —
which invents claims per scene that the author never made.

## The proposal

1. **Add `act` and `sequence` to `thematic_connection.entity_type`.**
   `polymorphicType` already resolves the target through `entity_type`,
   so no resolution code changes.
2. **§12.11:** an act or sequence carries the theme at **every scene of
   its derived membership** (§5.1). That membership is derived at query
   time, so a scene moved between acts moves its count with it.
3. **Fixture:** one act-level connection, so Q10's spine shows a span
   carrier.

## What it breaks

- Q10's published result moves: new carriers, higher spine counts.
- Readers that switch on `entity_type` meet two new values.
- `junction-keys.json` is unchanged, since `entity_type` is already
  part of the natural key.

## Alternatives

**Fan out at write time** — one connection per scene. That is §3.1's
stored derivation, and it goes stale as soon as a scene moves act.

**A new span-theme link.** More machinery for the same meaning.

**Do nothing.** Act-level thematic intent stays in prose (`act.function`,
`theme.evolution`).

## Unresolved

- **Structural beats too**, if 0009 is accepted?
- **Should a span carrier count separately** in Q10's spine from
  scene-level carriers? A scene reached only through its act is a
  different fact from one that carries the theme itself.
