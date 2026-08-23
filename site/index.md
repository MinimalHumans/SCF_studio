<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# SCF

**A film, described in a way a machine can answer questions about.**

SCF — the Story Context Framework — is a file format. An `.scf` is a
SQLite database holding what is true of a film: its scenes and their
order, its characters and how they change, what a location looks like on
the night in question, which take was printed, what a costume was doing
in scene 12.

It is not a screenplay format, though it holds a screenplay. It is not a
production database, though a production could run on one. It is the
layer between: the place where "what is this film" stops being spread
across a script, a spreadsheet, a shot list and somebody's memory.

## What you can do with one

Ask it sixteen questions, and get the same answer every time.

The [canonical queries](queries.html) are part of the format rather than
a feature of any tool. *What does this character sound like in this
scene? What is in force here that was not in force twenty pages ago?
Which assets does this shot actually resolve to? Is this scene ready to
shoot, and if not, what is missing?* Each one has a published, normative
answer, and any conforming implementation produces it.

## The shape of it

- **It describes; it does not enforce.** A half-finished film is the
  normal case. Every derivation stays useful on incomplete data and
  reports what is missing rather than refusing to answer.
- **Identity travels, row ids do not.** Every row carries a uuid. What
  is local to one file stays local to it.
- **Nothing derivable is stored twice.** Scene order comes from the
  script. Act membership comes from boundaries. A number that could be
  computed is computed.
- **One file is the unit of interchange.** Not a folder, not a server.

## Where to start

| | |
|---|---|
| Implementing it | [The specification](spec.html), then [conformance](conformance.html) |
| Deciding whether to | [What is stable](stability.html) and the [release checklist](release-checklist.html) |
| Curious why it is like this | [The design record](conventions.html) |
| Wanting to change it | [Proposals](proposals.html) |

## Status

**Pre-1.0 and honest about it.** The specification is a draft, and until
1.0 ships there is no migration path and no backward compatibility owed
to anything already written. What is safe to build against is stated,
per subject, in [stability](stability.html) — including the things that
are not.

Three independent implementations have been written from these
documents by people with no access to the reference code. What they got
wrong is what most of the specification's recent revisions are about.
