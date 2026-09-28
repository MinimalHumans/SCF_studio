<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0017 — `external_id` on structural and thematic entities

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | `has_external_id` on `act`, `sequence`, `story_beat`, `theme` (and `motif`); generated artifacts |

## The problem

**Ten entities carry `external_id` and `external_id_namespace`.** They
are `project`, `character`, `location`, `prop`, `scene`, `actor`,
`take`, `clip`, `shot` and `asset`. Structure and theme do not.

`external_id` is how a row says "I am the same thing as that row in that
other system". §6.2 forbids matching by uuid across files, so it is the
**only** sanctioned hook for re-syncing with another tool. scf-app already
uses the namespace as a provenance mark (`scf:import`, `scf:editor`).

The ten were chosen for production systems — OMC, EIDR, a production
database — which identify scenes, shots and assets. Story tools also
identify acts, sequences, beats and themes. Those are the rows a writer's
tool reorganises most often.

**This has actually bitten.** Scriptyard can stamp its own ids on
characters, locations, props, scenes and shots. It cannot stamp them on
acts, sequences, beats or themes. A future "re-export and merge" would
have to match those by name, which is the guess the format otherwise
works hard to avoid.

## The proposal

**Set `has_external_id=True` on `act`, `sequence`, `story_beat`, `theme`
and `motif`**, and on any span or arc entity accepted from 0008 or 0009.
The fields are injected by the registry, so this is a one-line change per
entity.

## What it breaks

- Schema version moves; additive.
- §12.1.2 projection already keeps `external_id` (fixed in 0.40), so no
  result changes unless the fixture authors one.

## Alternatives

**`x_scriptyard_id` columns** (§10.3). Legal, private to one tool, and it
repeats for every tool that wants the same thing.

**Every entity.** Link entities have no identity columns at all.
scf-app's import pipeline notes that it cannot mark imported links as
machine-created for that reason. That is a larger question than this one.

**Do nothing.**

## Unresolved

- **The rule behind the list.** Should `has_external_id` default to true
  for tier-0 and tier-1 principal entities, instead of being chosen per
  entity?
- **Links.** Is the importer's noted gap — no provenance on junction rows —
  worth its own proposal?
