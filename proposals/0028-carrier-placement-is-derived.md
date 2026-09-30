<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0028 — A theme's carrier reaches the scenes it is placed in

| | |
|---|---|
| **Status** | **implemented** — spec 0.55. Accepted on the strength of the defect; declining it reverts one query, one section and one artifact |
| **Author** | Found by the first `scf-mcp` session; written up by the maintainers |
| **Opened** | 2026-09-28 |
| **Affects** | Spec §12.11; `fixtures/expectations/Q10.result.json` |

## The problem

**§12.11 listed four kinds of carrier and meant "wherever it is
placed".** A scene carried a theme at itself, a motif wherever it
appeared, a character wherever they were present, an act or sequence
across its derived membership — and anything else reached no scenes at
all, stated as a legitimate answer.

Ada's locket exists in Hollow Creek as both a `motif` and a `prop`, each
connected to Forgiveness. The motif carrier reached three scenes; the
prop carrier reached none, while `scene_prop` placed the prop in three
scenes. The published Q10 result recorded the empty array as correct.
Costumes and locations were in the same position — `costume_scene` and
`scene.location_id` place them and Q10 could not see either.

A list of entity kinds inside a query is the hand-maintained rule this
project keeps finding by being bitten: a subject kind gaining a
placement link is not reached until someone remembers to edit the query.

## The proposal

State the rule the registry already implies. A carrier reaches a scene
when:

1. it **is** the scene;
2. it is an **act or sequence**, at every scene of its derived
   membership (§5.1) — unchanged;
3. a **link entity** (`subject: link`) declares both `scene_id` and the
   subject's own reference column, and a live row joins the two —
   `scene_character`, `scene_prop`, `motif_appearance`, `costume_scene`;
4. **`scene` itself declares a reference to the subject** —
   `scene.location_id`.

Cases 3 and 4 are read from the registry, never from a list.

**Placement is not description.** `performance_beat` names a character
and a scene; `prop_state` names a prop and a scene;
`makeup_hair_design` names a character and a scene. None of them places
its subject — `scene_character` and `scene_prop` do — and a blanket
"any table naming both" rule would have quietly changed what a character
carrier means, adding scenes where a character has a beat and no cast
link. The registry's `subject: link` is the line between the two, and it
is declared rather than guessed.

## What it breaks

**Q10's published result.** The locket's prop carrier gains three
scenes and the spine's counts rise at those three. Nothing else in the
fixture moves, which is the evidence that this generalises the old
behaviour rather than replacing it.

An implementation that matched the old four-kind list is now
non-conforming for props, costumes and locations. Per §11.0 that is
cheap today.

## Alternatives

**Do nothing.** Keep the four kinds and tell authors to attach themes to
motifs rather than props. That is a real answer — the motif row is
arguably where thematic meaning belongs — but it makes the format's
answer depend on which of two rows an author picked, with nothing
saying so.

**Any entity naming both a scene and the subject.** Simpler to state and
wrong: it conflates being in a scene with being described in one, and it
would have changed two carriers in the fixture that nobody intended to
change.

**Link the prop row to the motif row** so one resolves through the
other. That is a different proposal — it says the same object modelled
twice should be joined — and it does not fix costumes or locations.
