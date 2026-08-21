<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Proposals

Where a change to the **format** gets argued before it gets built.

Three independent implementations have been written against this
specification. Between them their authors produced roughly seventy
findings — defects, ambiguities, missing rules, things the artifacts
demonstrated and the text never said. **None of them had anywhere to
file one.** Two of the three sent prose that was read once and acted on
by one person, and the reasoning behind what was accepted and what was
not exists nowhere. That is the gap this directory closes.

## What belongs here

A proposal is for a change that **outlives the discussion**: anything
that changes what a conforming implementation must do, or would make
someone reading the specification in a year ask "why is it like this?"

| | |
|---|---|
| **File a proposal** | A new entity, field or query. A change to a normative rule. A new closed vocabulary, or a new member of one. Anything that moves a `stability.md` row. Retiring something. A convention that binds implementations rather than this repository. |
| **File an issue** | A defect — the text says one thing and the artifacts do another. A rule that cannot be implemented as written. A missing definition. Anything where nobody has to be persuaded, only told. |
| **Open a pull request** | An editorial fix. A typo. A test. A clarification that changes no requirement. |

**A defect is not a proposal.** If the specification is simply wrong,
say so in an issue and it gets fixed — three reader runs found dozens of
those and every one of them was worth having quickly, without ceremony.
Proposals are for the changes where the answer is genuinely arguable and
the argument is the valuable part.

If you are not sure, file an issue. Someone will say "this is a
proposal" and that costs nothing.

## How it works

1. **Copy `0000-template.md`** to `NNNN-short-name.md`, where `NNNN` is
   the next unused number. Numbers are allocated by using them; a
   collision is resolved by whoever pushes second.
2. **Open a pull request** adding just that file. The pull request is
   where the discussion happens, so that the argument and the text stay
   together.
3. **A maintainer accepts, declines or defers it** — see
   [`GOVERNANCE.md`](../GOVERNANCE.md) for who that is and what they
   weigh.
4. **An accepted proposal is merged with its status set to `accepted`**,
   and then implemented through the nine-step change procedure in
   `docs/conventions.md` §8. Merging a proposal is not implementing it.
5. **A declined proposal is merged too**, with `declined` and the reason
   written into it.

**Declined proposals stay in this directory.** This is the part that is
easy to skip and worth insisting on: a rejected idea that leaves no
trace gets proposed again, and the second time nobody remembers what was
wrong with it. The record of what was considered and refused is as much
a part of the format's design as the record of what was built.

## Status

`draft` · `accepted` · `declined` · `deferred` · `implemented`

`deferred` means the idea is sound and the timing is not — most often
because it depends on something that does not exist yet. It carries a
note saying what it is waiting for.

`implemented` is set when the change has landed and `stability.md`
records it. Until then an accepted proposal is a promise, not a
description.

## Before 1.0

The specification is a draft and, per spec §11.0, **existing `.scf`
files are disposable until 1.0 ships**. A proposal that would be a
breaking change today is not therefore a bad proposal — it is much
cheaper now than it will ever be again. Say plainly what it breaks; do
not argue that it breaks nothing.

## Where the existing findings are

The seventy-odd findings from the three reader runs are not in this
directory. They arrived as prose, were triaged by hand, and most were
fixed directly in the specification — `spec/CHANGELOG.md` records what
changed and why, revision by revision. What remains open is in
`spec/stability.md`: the Unstable rows are the honest list of what is
known to be unfinished.

Backfilling them as proposals would be writing history rather than
recording it. Anything still genuinely open and genuinely arguable
should be filed here fresh.
