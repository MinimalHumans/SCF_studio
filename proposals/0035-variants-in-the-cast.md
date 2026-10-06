<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0035 — The cast names the variant

| | |
|---|---|
| **Status** | **implemented** — spec 0.61, schema 2.21 |
| **Author** | Left open by [0033](0033-variants-in-force.md); drafted with Claude |
| **Opened** | 2026-10-05 |
| **Affects** | §4.8; §12.4 Q03, §12.5 Q12, §12.17 Q04 result members |

## The problem

0033 defined the variant in force and reported it in Q02 for one
subject. The queries that list who and what is in a scene did not: Q04's
package for scene 25 listed Marcus Cade, and nothing in it said he
appears as a nine-year-old. For anyone casting, dressing or generating
the scene that answer is wrong, not merely incomplete.

## The proposal

| Query | Member | Shape |
|---|---|---|
| Q03 | `variant` on each `characters` and `props` entry | The variant in force (§4.8), projected, or null |
| Q04 | `variant` on each `cast` and `props` row | As Q03 |
| Q12 | `variantFrom`, `variantTo` on each `characters` and `props` entry | The variant's **name**, or null — Q12 reports states and stages as labels, and this follows it |

Props get it too, for symmetry: a prop variant in force (§4.8) is as
much a dressing instruction as a character's.

All three call `variantInForce`, the one definition 0033 introduced.

## What it breaks

The published Q03, Q04 and Q12 gain null members and nothing else: none
of their normative positions has a variant in force. Scene 25 is where
the members are non-null, and `variants.test.ts` pins Q03, Q04 and Q12
there.

## Not done

`shotContext` lists subjects through `presenceAtShot`, not through these
queries, and does not yet name the variant. At a shot the variant in
force is the scene's (§4.8), so adding it is mechanical; it is left for
the shot workspace, which is where it would be read.

## Resolution

**Accepted and implemented, 2026-10-05**, together with 0034. Spec 0.61,
schema 2.21.
