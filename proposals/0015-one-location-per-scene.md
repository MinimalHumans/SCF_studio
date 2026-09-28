<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0015 — One location per scene, and intercuts

| | |
|---|---|
| **Status** | draft — recommends **defer** |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | Nothing now. `scene.location_id` and a possible new link if accepted later. |

## The problem

**`scene.location_id` holds one location. Some scenes have two.**

By screenplay convention a scene heading names one place, and a move to
another place is a new scene. SCF follows that convention, and for
almost every scene it is right.

The exception is real: **INTERCUT**. A phone call between a kitchen and
a squad car is one dramatic scene played in two places, and screenplays
write it that way. The only place INTERCUT appears in scf-core is the prop
extractor's stoplist. The format has no way to say a scene is in
two places.

**This has actually bitten, mildly.** Scriptyard lets a writer drop more
than one Location card into a Scene backdrop, and its heading uses the
first. A second card is sometimes an intercut, and more often a location
merely visible or referred to.

## The proposal

**Defer.** Keep `scene.location_id` as the heading's location. Revisit
when an intercut case bites in a real production file rather than in a
mapping exercise.

**Scriptyard's exporter** writes the first Location in row order (the one
its heading uses) and reports the rest as not exported.

## What it breaks

Nothing.

## Alternatives

**A `scene_location` link with a role** (`primary`, `intercut`,
`visible`). Expresses intercuts and "seen through the window". It also
makes every location query ask which role counts, and it puts §12.17's
variant choice — which is keyed to *the* scene location — in question.

**Split intercuts into two scenes.** What many production offices do
anyway for scheduling, and it loses that the two halves are one scene
dramatically.

## Unresolved

- **Is deferring right**, or is intercut common enough in your
  productions to settle now?
- If a link is added later, does `scene.location_id` stay as the primary,
  or move into the link? Keeping it avoids a breaking change after 1.0.
