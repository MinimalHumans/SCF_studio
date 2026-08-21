<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Security

## Reporting

Report privately, not in a public issue.

Use GitHub's **private vulnerability reporting** on this repository:
Security → Report a vulnerability. If that is unavailable to you, email
**info@minimalhumans.com**.

Please include what you did, what happened, and what you expected. A
`.scf` file that reproduces it is the most useful thing you can send —
see the note on attachments below.

**What to expect.** This is a two-person project ([`GOVERNANCE.md`](GOVERNANCE.md)),
not a vendor with an on-call rotation. Acknowledgement within a week is
realistic. There is no bounty. There is no embargo policy beyond asking
that you give a fix a reasonable chance to land before publishing, and
"reasonable" is a conversation rather than a number.

## What is in scope

The interesting surface is **reading a file you did not write**, because
that is what this format is for. An `.scf` moves between a writer, an
editor, a pipeline and a shot-list tool, and each of those reads bytes
somebody else produced.

Specifically:

- **A malicious `.scf` that harms a reader.** It is a SQLite database
  and it arrives as an ordinary file. Anything where opening one causes
  more than a finding is in scope: a crash that is not a clean error, a
  read outside the database, an unbounded allocation, an infinite loop
  in a derivation.
- **Asset addresses that escape the root.** Spec §8.2 addresses assets
  relative to a mapped root, and §8.3 defines an `out-of-root`
  resolution state precisely because an address can point outside it. A
  reader that follows one and touches the file anyway is a path
  traversal. `fixtures/negative/asset-escapes-root.expected.json` and
  `asset-absolute.expected.json` are the fixtures for this, and they
  exist because it is a real category rather than a theoretical one.
- **Anything in the reference implementation that executes content.**
  Screenplay text, entity names, `help_text`, findings, rendered
  markdown. None of it should ever reach an evaluator, a shell, or an
  HTML sink unescaped.
- **A published artifact whose checksum does not match.** If a file
  fetched at a `schema-X.Y` tag disagrees with `spec/SHA256SUMS`, that
  is either a bug in the release procedure or something worse. Report it
  either way.

## What is not

- **A file that is merely wrong.** SCF describes; it does not enforce.
  Contradictory data, dangling references, malformed uuids and unknown
  tables are all expected input, and the answer to every one of them is
  a finding (spec §9), not an error and not a refusal. The eleven
  negative fixtures are exactly this: files that are wrong in a stated
  way, which a conforming reader must read and report on rather than
  reject. **A reader that refuses one of them is the bug.**
- **`line_type` values outside the published vocabulary** (spec §1.3.1).
  Deliberately not a finding, and deliberately not a security issue:
  the column is free `TEXT`, and the rule is on implementations.
- **The unresolved items in `spec/stability.md`.** They are published as
  unfinished. Unstable rows are a to-do list, not a disclosure.
- **Anything requiring the attacker to already control the machine.**

## A note on attachments

Do not send a `.scf` built from a screenplay you do not have the right
to redistribute. This applies to security reports exactly as it applies
to test fixtures ([`CONTRIBUTING.md`](CONTRIBUTING.md)). If the bug
needs specific content to reproduce, describe the shape of it and we
will build a fixture — `fixtures/negative/CASES.json` shows how the
existing ones are constructed, each from a recipe rather than a
donated file.

## Supported versions

**Only `main`.** The format is pre-1.0 and, per spec §11.0, existing
`.scf` files are disposable until 1.0 ships. There are no maintenance
branches and nothing is backported. `schema-X.Y` tags exist to make
artifacts addressable and verifiable, not to mark a supported release.

This changes at 1.0, and this section will change with it.
