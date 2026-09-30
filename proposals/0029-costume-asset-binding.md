<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0029 — Costume media has nowhere to be bound

| | |
|---|---|
| **Status** | **implemented** — spec 0.56, schema 2.16 |
| **Author** | Found by the `asset.bundle_unbound` finding on the fixture; written up by the maintainers |
| **Opened** | 2026-09-30 |
| **Affects** | New entity `costume_asset_binding`; `SUBJECTS` gains `costume`; §8.6; §12.8's subject kinds; the fixture |

## The problem

**Three media subjects have a binding entity. Costume, which has
references like the others, has none.**

The media cascade (§7) starts at a subject and reaches assets through
`<subject>_asset_binding → bundle → bundle_asset`. That chain exists for
`character`, `prop` and `location`. A bundle of costume references could
be assembled, filled with images, and bound to nothing — not because
anyone forgot, but because there was no row type that could bind it.

`asset.bundle_unbound` made it visible: the fixture's only such finding
was `Ada's Shawl`, a bundle holding a costume reference that no query at
any position could return. The workaround available was to bind the
image to the CHARACTER, which says something different — a costume is
worn in some scenes and not others, and belongs to a character in
general.

## The proposal

Add `costume_asset_binding`, the same shape as `prop_asset_binding`
minus what does not apply:

- `costume_id`, `bundle_id`, `is_baseline`, `precedence`,
  `scene_range_start_id` / `scene_range_end_id`, `notes`.
- **No variant filter** — costume has no variant entity, and 0027
  removed the two variant filters that had nothing to evaluate.
- **No act filter**, removed everywhere by 0027.

`SUBJECTS` gains `costume`. A costume is about its character, which is
why the `costume` entity itself is classified under `character`; a
costume ASSET BINDING is about the costume, and Q13 finds a binding by
the subject column the ontology names.

**Nothing else changed.** `bundleReach`, `unboundBundleIds`, the
editor's bind form and its media checks all derive their subject list
from the registry, so every one of them covered the new entity the day
it was declared. The only code that had to change was a test asserting
the list of subjects — which is the argument for deriving it.

## What it breaks

Nothing. A new entity is additive; `initDatabase` ALTER-adds it on open
(§11.0). The fixture's one `asset.bundle_unbound` finding goes away,
so the finding moved to a twelfth negative fixture rather than becoming
a rule nothing exercises.

## Alternatives

**Bind costume media to the character.** Available today, and it says
the wrong thing: it makes the image part of the character's identity
rather than of a garment worn in some scenes.

**A generic `subject_asset_binding` with a polymorphic subject.** One
table instead of four, and it loses the typed reference — `costume_id`
resolves, `subject_id` needs a discriminator read correctly by every
consumer (§8.6's orphan case is what that costs when someone does not).

**Do nothing and document it.** The finding would stay on the fixture
forever as a known limitation, which is how a gap becomes furniture.
