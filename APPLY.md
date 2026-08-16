# Stability note — the title-page decision

One file. `spec/stability.md` only; nothing else changes.

The known-table-set row now records your decision: `screenplay_title_page`
and `screenplay_version_title_page` are properties of the screenplay
rather than rows in their own right, so they carry no uuids.

That changes what the fix is, not just whether to do it. Adding them to
`UUID_EXTRA_TABLES` would have given them uuid columns, which is now
explicitly the wrong move. What §1.3 needs instead is a **second declared
list**: SCF-owned tables that carry no identity, alongside the ones that
do. The single list was conflating "this table is ours" with "this table
carries row identity", and those turn out to be different questions.

That lands naturally in session 2 alongside `scf-check`, since it is the
validator that currently mislabels them.
