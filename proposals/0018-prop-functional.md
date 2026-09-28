<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0018 — `prop.story_function`: a plainly functional prop

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | `prop.story_function` vocabulary |

## The problem

**`story_function` has no value for a prop that is simply used.**

The vocabulary is `macguffin`, `character extension`, `plot device`,
`symbol`, `atmosphere` and `other`. A kettle someone makes tea with, or
a rifle someone loads, is none of these. It gets `other`, which also
catches everything genuinely unclassifiable.

**This has actually bitten.** Scriptyard's Story Function offers Practical,
Symbolic, MacGuffin and Atmospheric:

- Symbolic, MacGuffin and Atmospheric map directly.
- Practical — the most common prop of all — has no home.

## The proposal

**Add `functional`**: the prop is used in the action and carries no
further story weight.

The value is deliberately **not** named `practical`. On set, "practical"
means a *working* prop or light: a practical lamp is one that turns on.
That is a production fact, not a story function. Scriptyard maps its
Practical to `functional`.

## What it breaks

A new vocabulary member; additive. Nothing else.

## Alternatives

**Leave it as `other`.** Makes `other` the largest bucket in any real
file.

**Name it `practical`**, matching Scriptyard. Collides with the
production meaning, and SCF is aimed at productions as well as writers.

## Unresolved

- Is `functional` the right word? Other candidates are `utilitarian` and
  `used`.
