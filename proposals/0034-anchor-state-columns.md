<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0034 — The anchor state columns nothing reads

| | |
|---|---|
| **Status** | **implemented** — spec 0.61, schema 2.21 |
| **Author** | Left open by [0033](0033-variants-in-force.md); drafted with Claude |
| **Opened** | 2026-10-05 |
| **Affects** | §12.8; `entity_anchor.physical_state`, `vocal_state`, `environmental_state` removed; `condition_description` help text |

## The problem

`entity_anchor` declared three free-text columns — `physical_state` (for
characters and props), `vocal_state` (characters) and
`environmental_state` (locations) — and §12.8 read none of them. An
anchor an author recorded as *the wounded face* was returned as the face
at every position, and its trail line said nothing. This is the class
[0027](0027-binding-filters-that-nothing-reads.md) removed from bindings
and 0033 fixed for `subject_variant_id`, on the last three columns that
had it.

No fixture row set any of them, so every published result read the same
whether an implementation honoured them or not.

## Options considered

| Option | For | Against |
|---|---|---|
| **(a) Read all three**, as the binding state filters are read | Nothing removed | Only a character has named states to match (`performance_state.name`). A prop's state is a `prop_state` condition, a location's at most a variant's `post_event_state` sentence: two matching rules would have to be invented for this alone. |
| **(b) Remove all three** | One way to scope media by state — the binding filter, which already works — and one way to scope by design — the variant | Loses pinning a frame or region inside a state-specific asset as an *anchor*. The asset itself can still be bound under a state filter. |
| **(c) Read the two character columns, remove the rest** | Keeps the region precision for characters | A fourth way to scope character media, beside bindings, variants and shot overrides, for one entity |

## The proposal

**(b).** Remove the three columns. §12.8 states that an anchor carries no
state filter: it applies wherever §12.8 says. `condition_description`
stays, and its help text now says it describes the asset for a reader
and never scopes the anchor.

What an author meant by a state column has a home either way: a state
is a binding with `physical_state_filter` or `vocal_state_filter`
(§12.8.1); a different design is a variant (§4.8).

## What it breaks

- Schema bump, 2.20 → 2.21. A 2.20 file keeps the three columns as
  columns the registry no longer declares, preserved per §10.1; nothing
  reads them, which is what they were.
- No fixture row, no published result and no editor code touched them.

## Resolution

**Accepted and implemented, 2026-10-05**, together with 0035. Spec 0.61,
schema 2.21. Option (b), as proposed.
