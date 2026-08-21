<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Governance

## Who decides

Two maintainers: **Christopher Smallfield** and **Jesse Kretschmer**.
Either can accept a change. Either can ask for a second opinion, and
neither has to.

That is the whole structure, and stating it plainly is the point. This
is a two-person project with three outside implementers and no
foundation, no steering committee and no vote. A governance document
describing a process that does not exist would be worse than none,
because someone would rely on it.

**What this means for you as a contributor:** decisions are quick, they
are made by people who wrote most of the code, and the bus factor is
two. If that is a risk for what you are building, it is a real one and
you should weigh it. The mitigation on offer is that the format is
specified, checksummed and independently implementable — three people
have implemented it — so the specification outlives the maintainers'
attention in a way the code does not.

## What a maintainer weighs

In roughly this order:

1. **Does it make the format describe films more truthfully?** SCF
   describes; it does not enforce. A change that makes it easier to
   record what is actually the case beats one that makes it harder to
   record something wrong.
2. **Can a second implementation do it from the text alone?** A rule
   that only works if you have read this repository's TypeScript is not
   a rule. This has been the single most common defect found by outside
   readers, and it is the one thing a proposal is most likely to be sent
   back for.
3. **Does it create a second place for one fact to live?** Anything
   derivable that is written by hand eventually disagrees with itself.
   Generated-and-checked artifacts, single resolvers, one source of
   truth.
4. **Is it total on half-placed data?** A derivation that throws on a
   half-finished project is useless, because every real project is
   half-finished for most of its life. Report a finding instead.
5. **What does it cost the people already using it?** Before 1.0 this is
   cheap by policy (spec §11.0). After 1.0 it is the constraint that
   dominates everything above.

## How a decision is recorded

- **A change to the format** — a proposal in [`proposals/`](proposals/),
  merged with its status and its reasoning, whether accepted or
  declined.
- **A change to the specification** — an entry in
  `spec/CHANGELOG.md`, and the affected row in `spec/stability.md`.
- **A change to how the repository works** — `docs/conventions.md`,
  which is the design record and states no rules about the format
  itself.

A decision that leaves no trace in one of those three has not been
recorded, and will be re-litigated.

## Becoming a maintainer

There is no process, because there has never been a case. If you have
contributed enough that the absence of one is a problem, that is a good
problem and you should say so in an issue — and this section should be
rewritten before the answer is needed rather than after.

## If this project stops

The specification, its artifacts and their checksums are published under
`schema-X.Y` tags and are enough to implement the format without the
maintainers. `spec/` is licensed CC BY 4.0 precisely so that someone
else can carry it on, including under a different name. Nothing here is
contingent on this repository continuing to exist.
