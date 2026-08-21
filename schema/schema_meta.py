# SPDX-License-Identifier: Apache-2.0
"""
schema_meta.py — the format's version and the tables outside the
registry that still carry row identity.

These two constants used to live in the v1 editor's migrations.py,
which meant regenerating the registry required a file that belonged to
a retired application. They are facts about the FORMAT, so they live
with it.

Changing SCHEMA_VERSION is a deliberate act: record what changed in
docs/schema-changelog.md in the same commit.
"""

SCHEMA_VERSION = "2.12"

# Screenplay infrastructure tables. They are not registry entities, but
# they carry uuid row identity on the same terms (schema 2.3), so the
# generator and every initDatabase must know about them.
UUID_EXTRA_TABLES = [
    "screenplay_lines",
    "screenplay_versions",
    "screenplay_version_lines",
    "screenplay_prop_tags",
]

# SCF's own tables that carry NO row identity. Spec §1.3 used to define
# the known table set as the registry plus UUID_EXTRA_TABLES, which
# conflated two questions: is this table ours, and does it carry row
# identity. They are not the same question, and the gap showed the first
# time a validator enumerated a real file — SCF reported two of its own
# tables as third-party content.
#
# A title page is a PROPERTY of the screenplay rather than a row in its
# own right, so these do not gain uuids. They are simply ours.
OWNED_TABLES = [
    "screenplay_title_page",
    "screenplay_version_title_page",
]

# Every table this format defines, whatever it carries. What a reader
# means by "unknown content" (spec §10.1) is: not in here.
KNOWN_EXTRA_TABLES = UUID_EXTRA_TABLES + OWNED_TABLES

# Backwards-compatible alias for the name the v1 migrations used.
_UUID_EXTRA_TABLES = UUID_EXTRA_TABLES
