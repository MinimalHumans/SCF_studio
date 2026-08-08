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

SCHEMA_VERSION = "2.5"

# Screenplay infrastructure tables. They are not registry entities, but
# they carry uuid row identity on the same terms (schema 2.3), so the
# generator and every initDatabase must know about them.
UUID_EXTRA_TABLES = [
    "screenplay_lines",
    "screenplay_versions",
    "screenplay_version_lines",
    "screenplay_prop_tags",
]

# Backwards-compatible alias for the name the v1 migrations used.
_UUID_EXTRA_TABLES = UUID_EXTRA_TABLES
