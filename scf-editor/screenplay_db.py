"""
Screenplay Database Layer
==========================
SQLite-native screenplay storage. Every line of the screenplay is a row
in `screenplay_lines` with a type classification and optional entity FKs.

No Fountain parsing on save. No anchor injection. The structured data IS
the screenplay.

Tables:
  screenplay_lines             — ordered lines with type + entity links
  screenplay_title_page        — key/value title page metadata
  screenplay_versions          — published version snapshots
  screenplay_version_lines     — snapshot of lines per version
  screenplay_version_title_page — snapshot of title page per version
  screenplay_prop_tags         — inline prop text annotations
"""

import re
from pathlib import Path
from datetime import datetime

import database as db

# ═══════════════════════════════════════════════════════════════════════════
# Constants
# ═══════════════════════════════════════════════════════════════════════════

LINE_TYPES = (
    "heading",         # Scene heading: INT. LOCATION - DAY
    "action",          # Action/description
    "character",       # Character cue (uppercase name)
    "dialogue",        # Dialogue text
    "parenthetical",   # (parenthetical direction)
    "transition",      # CUT TO: / FADE OUT: etc
    "blank",           # Empty line (structural whitespace)
    "section",         # # Section markers
    "synopsis",        # = Synopsis lines
    "centered",        # > Centered text <
    "titlekey",        # Title page key (Title:, Author:, etc)
    "titlevalue",      # Title page continuation value
)

# For parsing heading text into components
_HEADING_RE = re.compile(
    r'^\.?(?P<ie>INT\./EXT|EXT\./INT|INT/EXT|EXT/INT|I/E|INT|EXT|EST)'
    r'[\.\s]+\s*'
    r'(?P<location>.+?)'
    r'(?:\s*[-\.]\s*(?P<tod>DAY|NIGHT|MORNING|EVENING|DAWN|DUSK|AFTERNOON|'
    r'MIDDAY|TWILIGHT|SUNSET|SUNRISE|CONTINUOUS|LATER|MOMENTS?\s+LATER|SAME\s+TIME))?'
    r'\s*$',
    re.IGNORECASE
)

# Phase 1C: lowercase enum values to match the redesigned location.location_type
_INT_EXT_MAP = {
    "INT": "interior", "EXT": "exterior", "I/E": "int/ext",
    "INT./EXT": "int/ext", "EXT./INT": "int/ext",
    "INT/EXT": "int/ext", "EXT/INT": "int/ext",
    "EST": "exterior",
}

# Phase 1C: rewritten against the redesigned scene.time_of_day enum
#   (dawn | morning | midday | afternoon | dusk | night | continuous)
# Notes:
#   - DAY → midday (there is no "day" value)
#   - EVENING / TWILIGHT / SUNSET → dusk
#   - SUNRISE → dawn
#   - LATER / MOMENTS LATER / SAME TIME → continuous
_TIME_MAP = {
    "DAY": "midday", "NIGHT": "night", "MORNING": "morning",
    "EVENING": "dusk", "DAWN": "dawn", "DUSK": "dusk",
    "AFTERNOON": "afternoon", "MIDDAY": "midday",
    "CONTINUOUS": "continuous", "LATER": "continuous",
    "MOMENTS LATER": "continuous", "MOMENT LATER": "continuous",
    "SAME TIME": "continuous", "TWILIGHT": "dusk",
    "SUNSET": "dusk", "SUNRISE": "dawn",
}

# For bare headings without INT/EXT — strips trailing time-of-day
_BARE_TOD_RE = re.compile(
    r'\s*[-\.]\s*(DAY|NIGHT|MORNING|EVENING|DAWN|DUSK|AFTERNOON|MIDDAY|'
    r'TWILIGHT|SUNSET|SUNRISE|CONTINUOUS|LATER|MOMENTS?\s+LATER|SAME\s+TIME)'
    r'\s*$',
    re.IGNORECASE
)

# Phase 1C: lowercase to match scene_prop.significance enum
_CONFIDENCE_TO_SIGNIFICANCE = {
    "high": "key",
    "medium": "present",
    "low": "background",
}


# ═══════════════════════════════════════════════════════════════════════════
# Table Creation
# ═══════════════════════════════════════════════════════════════════════════

def init_screenplay_tables(conn) -> None:
    """Create screenplay tables if they don't exist. Called from database.init_database()."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS screenplay_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scene_id INTEGER REFERENCES scene(id) ON DELETE SET NULL,
            line_order INTEGER NOT NULL,
            line_type TEXT NOT NULL DEFAULT 'action',
            content TEXT NOT NULL DEFAULT '',
            character_id INTEGER REFERENCES character(id) ON DELETE SET NULL,
            location_id INTEGER REFERENCES location(id) ON DELETE SET NULL,
            metadata JSON,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_screenplay_lines_order
        ON screenplay_lines(line_order)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_screenplay_lines_scene
        ON screenplay_lines(scene_id)
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS screenplay_title_page (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL,
            value TEXT NOT NULL DEFAULT '',
            sort_order INTEGER DEFAULT 0
        )
    """)

    # ── Version tables ──
    conn.execute("""
        CREATE TABLE IF NOT EXISTS screenplay_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version_number INTEGER NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            published_at TEXT DEFAULT (datetime('now')),
            line_count INTEGER DEFAULT 0,
            scene_count INTEGER DEFAULT 0,
            character_count INTEGER DEFAULT 0,
            location_count INTEGER DEFAULT 0,
            word_count INTEGER DEFAULT 0
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS screenplay_version_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version_id INTEGER NOT NULL REFERENCES screenplay_versions(id) ON DELETE CASCADE,
            line_order INTEGER NOT NULL,
            line_type TEXT NOT NULL DEFAULT 'action',
            content TEXT NOT NULL DEFAULT '',
            scene_id INTEGER,
            character_id INTEGER,
            location_id INTEGER,
            metadata JSON
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_version_lines_version
        ON screenplay_version_lines(version_id)
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS screenplay_version_title_page (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version_id INTEGER NOT NULL REFERENCES screenplay_versions(id) ON DELETE CASCADE,
            key TEXT NOT NULL,
            value TEXT NOT NULL DEFAULT '',
            sort_order INTEGER DEFAULT 0
        )
    """)

    # ── Prop tags table ──
    conn.execute("""
        CREATE TABLE IF NOT EXISTS screenplay_prop_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tagged_text TEXT NOT NULL,
            prop_id INTEGER NOT NULL REFERENCES prop(id) ON DELETE CASCADE,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_prop_tags_prop
        ON screenplay_prop_tags(prop_id)

    # v2 additive columns: prop tags anchored to line identity + offsets
    # (block-anchored ranges, not text match). Mirrored in the TS
    # implementation's initScreenplayTables; ensure-columns pattern as in
    # database._create_entity_table.
    existing = {row[1] for row in conn.execute("PRAGMA table_info(screenplay_prop_tags)")}
    for col, typ in (("line_uuid", "TEXT"), ("start_offset", "INTEGER"),
                     ("end_offset", "INTEGER")):
        if col not in existing:
            conn.execute(f"ALTER TABLE screenplay_prop_tags ADD COLUMN {col} {typ}")
    """)


# ═══════════════════════════════════════════════════════════════════════════
# Load — Read screenplay for editor
# ═══════════════════════════════════════════════════════════════════════════

def load_screenplay(db_path: Path) -> dict:
    """Load the full screenplay for the editor."""
    conn = db.get_connection(db_path)
    try:
        # Title page
        title_rows = conn.execute(
            "SELECT key, value FROM screenplay_title_page ORDER BY sort_order, id"
        ).fetchall()
        title_page = [{"key": r["key"], "value": r["value"]} for r in title_rows]

        # Lines with joined entity names
        lines_rows = conn.execute("""
            SELECT
                sl.id,
                sl.line_order,
                sl.line_type,
                sl.content,
                sl.scene_id,
                sl.character_id,
                sl.location_id,
                sl.metadata,
                s.name AS scene_name,
                c.name AS character_name,
                l.name AS location_name
            FROM screenplay_lines sl
            LEFT JOIN scene s ON s.id = sl.scene_id
            LEFT JOIN character c ON c.id = sl.character_id
            LEFT JOIN location l ON l.id = sl.location_id
            ORDER BY sl.line_order ASC
        """).fetchall()

        lines = []
        for r in lines_rows:
            lines.append({
                "id": r["id"],
                "line_order": r["line_order"],
                "line_type": r["line_type"],
                "content": r["content"],
                "scene_id": r["scene_id"],
                "character_id": r["character_id"],
                "location_id": r["location_id"],
                "metadata": r["metadata"],
                "scene_name": r["scene_name"],
                "character_name": r["character_name"],
                "location_name": r["location_name"],
            })

        return {
            "title_page": title_page,
            "lines": lines,
            "has_content": len(lines) > 0 or len(title_page) > 0,
        }
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# Save — Write screenplay from editor
# ═══════════════════════════════════════════════════════════════════════════

def save_screenplay(db_path: Path, title_page: list[dict], lines: list[dict]) -> dict:
    """
    Save the full screenplay from the editor. Replaces all content.

    The save process:
    1. Replace title_page rows
    2. Replace screenplay_lines rows
    3. Auto-create/link entities where IDs are missing but content suggests them
    4. Rebuild scene_character junctions from line data
    5. Update scene entity fields from heading content

    Returns summary dict.
    """
    conn = db.get_connection(db_path)
    summary = {
        "lines_written": 0,
        "scenes_created": 0,
        "scenes_updated": 0,
        "characters_created": 0,
        "locations_created": 0,
        "junctions_rebuilt": 0,
        "errors": [],
    }

    try:
        # ── 1. Title page ──
        conn.execute("DELETE FROM screenplay_title_page")
        for i, tp in enumerate(title_page):
            conn.execute(
                "INSERT INTO screenplay_title_page (key, value, sort_order) VALUES (?, ?, ?)",
                (tp.get("key", ""), tp.get("value", ""), i)
            )

        # ── 2. Write lines ──
        # Carry row identity (uuid, schema 2.3) across the replace: lines
        # echoing a prior id keep that row's uuid; new lines mint one.
        # (v1's save is replace-all, so identity stability depends on the
        # client echoing ids; v2's editor owns true line identity.)
        from uuid import uuid4
        prior_uuids = dict(conn.execute(
            "SELECT id, uuid FROM screenplay_lines WHERE uuid IS NOT NULL"))
        conn.execute("DELETE FROM screenplay_lines")

        current_scene_id = None
        current_character_id = None
        scene_number = 0

        for i, line in enumerate(lines):
            line_type = line.get("line_type", "action")
            content = line.get("content", "")
            scene_id = line.get("scene_id")
            character_id = line.get("character_id")
            location_id = line.get("location_id")
            metadata = line.get("metadata")

            # ── Heading: resolve scene + location ──
            if line_type == "heading":
                scene_number += 1
                current_character_id = None

                parsed = parse_heading(content)

                # Every heading gets a location
                if not location_id:
                    loc_name = parsed["location_name"]
                    if not loc_name:
                        loc_name = _smart_title(content.strip().lstrip(".").strip())
                    if loc_name:
                        location_id = _find_or_create_location(
                            conn, loc_name,
                            parsed["int_ext"], summary
                        )

                # Scene resolution
                if not scene_id:
                    scene_id = _find_or_create_scene(
                        conn, content, scene_number,
                        location_id, parsed, summary
                    )
                else:
                    _update_scene_from_heading(
                        conn, scene_id, content, scene_number,
                        location_id, parsed, summary
                    )

                current_scene_id = scene_id

            # ── Character cue: resolve character ──
            elif line_type == "character":
                if not character_id and content.strip():
                    char_name = _clean_character_name(content)
                    if char_name:
                        character_id = _find_or_create_character(
                            conn, char_name, summary
                        )
                current_character_id = character_id

            # ── Dialogue/parenthetical: inherit character ──
            elif line_type in ("dialogue", "parenthetical"):
                if not character_id:
                    character_id = current_character_id

            # ── Blank: reset character context ──
            elif line_type == "blank":
                current_character_id = None

            # All non-heading lines inherit current scene
            if line_type != "heading" and not scene_id:
                scene_id = current_scene_id

            line_uuid = prior_uuids.get(line.get("id")) or str(uuid4())
            conn.execute(
                """INSERT INTO screenplay_lines
                   (line_order, line_type, content, scene_id, character_id,
                    location_id, metadata, uuid)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (i, line_type, content, scene_id, character_id,
                 location_id, metadata, line_uuid)
            )
            summary["lines_written"] += 1

        # ── 3. Rebuild scene_character junctions ──
        summary["junctions_rebuilt"] = _rebuild_junctions(conn)

        # ── 4. Update screenplay_meta ──
        _update_meta(conn, scene_number, len(lines))

        conn.commit()

    except Exception as e:
        conn.rollback()
        summary["errors"].append(str(e))
        raise
    finally:
        conn.close()

    return summary


# ═══════════════════════════════════════════════════════════════════════════
# Scene list / navigator queries
# ═══════════════════════════════════════════════════════════════════════════

def get_scenes(db_path: Path) -> list[dict]:
    """Get scene list for the navigator panel."""
    conn = db.get_connection(db_path)
    try:
        rows = conn.execute("""
            SELECT
                sl.scene_id,
                sl.content AS heading,
                sl.line_order,
                sl.location_id,
                s.name AS scene_name,
                s.scene_number,
                l.name AS location_name
            FROM screenplay_lines sl
            LEFT JOIN scene s ON s.id = sl.scene_id
            LEFT JOIN location l ON l.id = sl.location_id
            WHERE sl.line_type = 'heading'
            ORDER BY sl.line_order ASC
        """).fetchall()

        scenes = []
        for r in rows:
            scene_id = r["scene_id"]

            chars = []
            if scene_id:
                char_rows = conn.execute("""
                    SELECT DISTINCT c.id, c.name
                    FROM screenplay_lines sl
                    JOIN character c ON c.id = sl.character_id
                    WHERE sl.scene_id = ? AND sl.character_id IS NOT NULL
                    ORDER BY c.name
                """, (scene_id,)).fetchall()
                chars = [{"id": cr["id"], "name": cr["name"]} for cr in char_rows]

            scenes.append({
                "scene_id": scene_id,
                "scene_number": r["scene_number"] or (len(scenes) + 1),
                "heading": r["heading"],
                "line_number": r["line_order"],
                "location_name": r["location_name"],
                "location_id": r["location_id"],
                "character_count": len(chars),
                "characters": chars,
            })

        return scenes
    finally:
        conn.close()


def get_characters(db_path: Path) -> list[dict]:
    """Get character list with scene counts for the navigator."""
    conn = db.get_connection(db_path)
    try:
        rows = conn.execute("""
            SELECT
                c.id AS character_id,
                c.name AS display_name,
                COUNT(DISTINCT sl.scene_id) AS scene_count
            FROM screenplay_lines sl
            JOIN character c ON c.id = sl.character_id
            WHERE sl.character_id IS NOT NULL AND sl.scene_id IS NOT NULL
            GROUP BY c.id, c.name
            ORDER BY scene_count DESC, c.name ASC
        """).fetchall()

        return [
            {
                "character_id": r["character_id"],
                "display_name": r["display_name"],
                "name": r["display_name"].upper(),
                "scene_count": r["scene_count"],
                "is_mapped": True,
            }
            for r in rows
        ]
    finally:
        conn.close()


def get_locations(db_path: Path) -> list[dict]:
    """Get location list with scene counts for the navigator."""
    conn = db.get_connection(db_path)
    try:
        rows = conn.execute("""
            SELECT
                l.id AS location_id,
                l.name,
                COUNT(DISTINCT sl.scene_id) AS scene_count
            FROM screenplay_lines sl
            JOIN location l ON l.id = sl.location_id
            WHERE sl.location_id IS NOT NULL AND sl.line_type = 'heading'
            GROUP BY l.id, l.name
            ORDER BY scene_count DESC, l.name ASC
        """).fetchall()

        return [
            {
                "location_id": r["location_id"],
                "name": r["name"],
                "scene_count": r["scene_count"],
                "is_mapped": True,
            }
            for r in rows
        ]
    finally:
        conn.close()


def get_props(db_path: Path) -> list[dict]:
    """Get prop list with scene counts for the navigator."""
    conn = db.get_connection(db_path)
    try:
        rows = conn.execute("""
            SELECT
                p.id AS prop_id,
                p.name,
                COUNT(DISTINCT sp.scene_id) AS scene_count
            FROM prop p
            LEFT JOIN scene_prop sp ON sp.prop_id = p.id
            GROUP BY p.id, p.name
            ORDER BY scene_count DESC, p.name ASC
        """).fetchall()

        return [
            {
                "prop_id": r["prop_id"],
                "name": r["name"],
                "scene_count": r["scene_count"],
            }
            for r in rows
        ]
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# Heading parsing
# ═══════════════════════════════════════════════════════════════════════════

def parse_heading(text: str) -> dict:
    """Parse a scene heading into components."""
    result = {"int_ext": "", "location_name": "", "time_of_day": ""}
    raw = text.strip()
    if not raw:
        return result

    m = _HEADING_RE.match(raw)
    if m:
        ie_raw = m.group("ie").upper().replace(".", "")
        result["int_ext"] = _INT_EXT_MAP.get(ie_raw, "")
        result["location_name"] = _smart_title(m.group("location").strip().rstrip("-."))
        tod = m.group("tod")
        if tod:
            # Phase 1C: fallback lowercases instead of title-casing
            result["time_of_day"] = _TIME_MAP.get(tod.upper(), tod.lower())
        return result

    loc = raw
    tod_match = _BARE_TOD_RE.search(loc)
    if tod_match:
        # Phase 1C: fallback lowercases instead of title-casing
        result["time_of_day"] = _TIME_MAP.get(
            tod_match.group(1).upper(),
            tod_match.group(1).lower(),
        )
        loc = loc[:tod_match.start()].strip().rstrip("-. ")

    loc = loc.lstrip(".").strip()

    if loc:
        result["location_name"] = _smart_title(loc)

    return result


# ═══════════════════════════════════════════════════════════════════════════
# Entity resolution helpers (used during save)
# ═══════════════════════════════════════════════════════════════════════════

def _find_or_create_location(conn, name: str, int_ext: str, summary: dict) -> int:
    """Find existing location by name or create a new one. Returns location ID."""
    row = conn.execute(
        "SELECT id FROM location WHERE LOWER(name) = LOWER(?)", (name,)
    ).fetchone()
    if row:
        return row["id"]

    loc_data = {"name": name}
    if int_ext:
        loc_data["location_type"] = int_ext

    from entity_registry import get_entity
    entity_def = get_entity("location")
    valid_fields = {f.name for f in entity_def.fields}
    filtered = {k: v for k, v in loc_data.items() if k in valid_fields and v}
    cols = ", ".join(filtered.keys())
    placeholders = ", ".join(["?"] * len(filtered))
    cursor = conn.execute(
        f"INSERT INTO location ({cols}) VALUES ({placeholders})",
        list(filtered.values())
    )
    summary["locations_created"] += 1
    return cursor.lastrowid


def _find_or_create_character(conn, name: str, summary: dict) -> int:
    """Find existing character by name or create a new one. Returns character ID."""
    row = conn.execute(
        "SELECT id FROM character WHERE LOWER(name) = LOWER(?)", (name,)
    ).fetchone()
    if row:
        return row["id"]

    row = conn.execute(
        "SELECT id FROM character WHERE UPPER(name) = UPPER(?)", (name,)
    ).fetchone()
    if row:
        return row["id"]

    tc_name = _title_case_name(name)
    cursor = conn.execute(
        "INSERT INTO character (name) VALUES (?)", (tc_name,)
    )
    summary["characters_created"] += 1
    return cursor.lastrowid


def _find_or_create_scene(conn, heading: str, scene_number: int,
                           location_id: int | None, parsed: dict,
                           summary: dict) -> int:
    """Create a new scene entity from a heading. Returns scene ID."""
    scene_data = {
        "name": heading.strip(),
        "scene_number": scene_number,
    }
    if location_id:
        scene_data["location_id"] = location_id
    if parsed["int_ext"]:
        scene_data["int_ext"] = parsed["int_ext"]
    if parsed["time_of_day"]:
        scene_data["time_of_day"] = parsed["time_of_day"]

    from entity_registry import get_entity
    entity_def = get_entity("scene")
    valid_fields = {f.name for f in entity_def.fields}
    filtered = {k: v for k, v in scene_data.items() if k in valid_fields and v is not None}
    cols = ", ".join(filtered.keys())
    placeholders = ", ".join(["?"] * len(filtered))
    cursor = conn.execute(
        f"INSERT INTO scene ({cols}) VALUES ({placeholders})",
        list(filtered.values())
    )
    summary["scenes_created"] += 1
    return cursor.lastrowid


def _update_scene_from_heading(conn, scene_id: int, heading: str,
                                scene_number: int, location_id: int | None,
                                parsed: dict, summary: dict) -> None:
    """Update an existing scene entity with current heading data."""
    updates = {"name": heading.strip(), "scene_number": scene_number}
    if location_id:
        updates["location_id"] = location_id
    if parsed["int_ext"]:
        updates["int_ext"] = parsed["int_ext"]
    if parsed["time_of_day"]:
        updates["time_of_day"] = parsed["time_of_day"]

    set_parts = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [scene_id]
    conn.execute(f"UPDATE scene SET {set_parts} WHERE id = ?", values)
    summary["scenes_updated"] += 1


def _rebuild_junctions(conn) -> int:
    """Rebuild scene_character junctions from screenplay_lines data."""
    scene_ids = [r["scene_id"] for r in conn.execute(
        "SELECT DISTINCT scene_id FROM screenplay_lines WHERE scene_id IS NOT NULL"
    ).fetchall()]

    if not scene_ids:
        return 0

    placeholders = ", ".join(["?"] * len(scene_ids))
    conn.execute(
        f"DELETE FROM scene_character WHERE scene_id IN ({placeholders})",
        scene_ids
    )

    pairs = conn.execute("""
        SELECT DISTINCT scene_id, character_id
        FROM screenplay_lines
        WHERE scene_id IS NOT NULL AND character_id IS NOT NULL
    """).fetchall()

    count = 0
    for pair in pairs:
        scene_id = pair["scene_id"]
        character_id = pair["character_id"]

        char_count = conn.execute(
            """SELECT COUNT(DISTINCT character_id) FROM screenplay_lines
               WHERE scene_id = ? AND character_id IS NOT NULL""",
            (scene_id,)
        ).fetchone()[0]

        # Phase 1C: lowercase to match the redesigned scene_character.role_in_scene enum
        role = "featured" if char_count <= 3 else "supporting"

        conn.execute(
            """INSERT INTO scene_character (scene_id, character_id, role_in_scene, name)
               VALUES (?, ?, ?, '')""",
            (scene_id, character_id, role)
        )
        count += 1

    return count


def _update_meta(conn, scene_count: int, line_count: int) -> None:
    """Update screenplay_meta with current stats."""
    total_pages = max(1, line_count // 55)
    now = datetime.now().isoformat(timespec="seconds")

    meta_exists = conn.execute(
        "SELECT id FROM screenplay_meta WHERE id = 1"
    ).fetchone()

    if meta_exists:
        conn.execute(
            """UPDATE screenplay_meta SET
                   total_scenes = ?, total_pages = ?, last_synced = ?
               WHERE id = 1""",
            (scene_count, total_pages, now)
        )
    else:
        conn.execute(
            """INSERT INTO screenplay_meta
               (id, total_scenes, total_pages, last_synced)
               VALUES (1, ?, ?, ?)""",
            (scene_count, total_pages, now)
        )


# ═══════════════════════════════════════════════════════════════════════════
# Character name cleaning
# ═══════════════════════════════════════════════════════════════════════════

_CHAR_EXTENSION_RE = re.compile(
    r'\s*\((?:V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT\'?D?)\)\s*$',
    re.IGNORECASE
)


def _clean_character_name(text: str) -> str:
    """Extract character name from a character cue line."""
    name = text.strip()
    name = name.lstrip("@")
    name = _CHAR_EXTENSION_RE.sub("", name).strip()
    name = re.sub(r'\([^)]*\)', '', name).strip()
    name = re.sub(r'\s{2,}', ' ', name)
    return name


def _title_case_name(name: str) -> str:
    """Title-case a character name with apostrophe handling."""
    parts = name.split()
    result = []
    for part in parts:
        if '-' in part:
            result.append('-'.join(w.capitalize() for w in part.split('-')))
        elif "'" in part:
            idx = part.index("'")
            before = part[:idx+1].capitalize()
            after = part[idx+1:]
            if after.upper() == 'S':
                result.append(before + 's')
            elif len(after) > 1:
                result.append(before + after.capitalize())
            else:
                result.append(before + after.lower())
        else:
            result.append(part.capitalize())
    return ' '.join(result)


def _smart_title(text: str) -> str:
    """Title-case location text."""
    return _title_case_name(text)


# ═══════════════════════════════════════════════════════════════════════════
# Structural Blank Stripping — Phase 6
# ═══════════════════════════════════════════════════════════════════════════
# After import, removes blank lines that are purely structural separators.
# CSS margins in the editor handle visual spacing between element types.
# Keeps intentional blanks (consecutive blanks, blanks between same-type lines).

def _strip_structural_blanks_from_db(conn) -> int:
    """
    Remove structural blank lines from screenplay_lines and re-number line_order.
    Returns the number of blanks removed.
    """
    rows = conn.execute(
        "SELECT id, line_order, line_type, content FROM screenplay_lines ORDER BY line_order"
    ).fetchall()

    to_delete = []
    for i, row in enumerate(rows):
        # A line is "blank" if its content is empty, regardless of stored type
        if row["content"].strip() != "":
            continue

        prev = rows[i - 1] if i > 0 else None
        nxt = rows[i + 1] if i < len(rows) - 1 else None

        if _is_structural_blank(prev, nxt):
            to_delete.append(row["id"])

    if not to_delete:
        return 0

    # Delete structural blanks
    placeholders = ",".join(["?"] * len(to_delete))
    conn.execute(
        f"DELETE FROM screenplay_lines WHERE id IN ({placeholders})", to_delete
    )

    # Re-number line_order to be contiguous
    remaining = conn.execute(
        "SELECT id FROM screenplay_lines ORDER BY line_order"
    ).fetchall()
    for i, row in enumerate(remaining):
        conn.execute(
            "UPDATE screenplay_lines SET line_order = ? WHERE id = ?",
            (i, row["id"])
        )

    return len(to_delete)


def _is_structural_blank(prev, nxt) -> bool:
    """
    Determine if a blank line is structural (CSS handles the spacing)
    vs intentional (user-inserted paragraph break).

    Structural: single blank between two different non-blank content types.
    Intentional: consecutive blanks, or blank between same-type content lines.
    """
    if not prev or not nxt:
        return False

    prev_empty = prev["content"].strip() == ""
    next_empty = nxt["content"].strip() == ""

    # Adjacent to another blank → intentional spacing, keep both
    if prev_empty or next_empty:
        return False

    # Between two same-type content lines → intentional paragraph break
    if prev["line_type"] == nxt["line_type"]:
        return False

    # Single blank between two different content types → structural
    return True


# ═══════════════════════════════════════════════════════════════════════════
# Fountain Import → screenplay_lines
# ═══════════════════════════════════════════════════════════════════════════

def import_fountain_to_lines(db_path: Path, fountain_text: str) -> dict:
    """
    Parse a Fountain screenplay and write it into screenplay_lines.
    Also creates/links scene, character, location, and prop entities.

    After writing all lines, structural blanks are stripped — CSS margins
    in the editor handle visual spacing between element types.

    Returns summary dict.
    """
    from fountain_parser import parse as fountain_parse, _match_scene_heading

    parsed = fountain_parse(fountain_text)
    conn = db.get_connection(db_path)
    summary = {
        "lines_written": 0,
        "scenes_created": 0,
        "characters_created": 0,
        "locations_created": 0,
        "props_created": 0,
        "scene_props_created": 0,
        "junctions_rebuilt": 0,
        "blanks_stripped": 0,
        "errors": [],
    }

    try:
        # Clear existing screenplay data
        conn.execute("DELETE FROM screenplay_lines")
        conn.execute("DELETE FROM screenplay_title_page")

        # ── Title page ──
        if parsed.title:
            conn.execute(
                "INSERT INTO screenplay_title_page (key, value, sort_order) VALUES (?, ?, ?)",
                ("Title", parsed.title, 0)
            )
        if parsed.author:
            conn.execute(
                "INSERT INTO screenplay_title_page (key, value, sort_order) VALUES (?, ?, ?)",
                ("Author", parsed.author, 1)
            )

        # ── Build entity lookup maps ──
        char_map = {}
        for row in conn.execute("SELECT id, name FROM character").fetchall():
            char_map[row["name"].lower()] = row["id"]

        loc_map = {}
        for row in conn.execute("SELECT id, name FROM location").fetchall():
            loc_map[row["name"].lower()] = row["id"]

        # Create entities from parsed data.
        # Phase 1C: dropped `hair` from the character INSERT — it lives in
        # character_appearance_profile (Tier 2) under the redesigned schema.
        for char in parsed.characters:
            key = char.name.lower()
            if key not in char_map:
                cursor = conn.execute(
                    "INSERT INTO character (name, summary) VALUES (?, ?)",
                    (char.name, char.description or None)
                )
                char_map[key] = cursor.lastrowid
                summary["characters_created"] += 1

        for loc in parsed.locations:
            key = loc.name.lower()
            if key not in loc_map:
                has_int = any("INT" in h.upper().split('.')[0] for h in loc.raw_headings)
                has_ext = any("EXT" in h.upper().split('.')[0] for h in loc.raw_headings)
                # Phase 1C: lowercase to match location.location_type enum
                loc_type = (
                    "int/ext" if (has_int and has_ext)
                    else ("interior" if has_int
                          else ("exterior" if has_ext else None))
                )
                cursor = conn.execute(
                    "INSERT INTO location (name, location_type) VALUES (?, ?)",
                    (loc.name, loc_type)
                )
                loc_map[key] = cursor.lastrowid
                summary["locations_created"] += 1

        # Create scene entities
        scene_map = {}
        for scene in parsed.scenes:
            loc_key = scene.location_name.lower()
            location_id = loc_map.get(loc_key)

            scene_data_vals = [
                scene.name,
                scene.scene_number,
                scene.int_ext or None,
                scene.time_of_day or None,
                location_id,
                (scene.summary[:2000] if scene.summary else None),
            ]
            cursor = conn.execute(
                """INSERT INTO scene (name, scene_number, int_ext, time_of_day,
                   location_id, summary) VALUES (?, ?, ?, ?, ?, ?)""",
                scene_data_vals
            )
            scene_map[scene.scene_number - 1] = cursor.lastrowid
            summary["scenes_created"] += 1

        # ═════════════════════════════════════════════════════════════
        # Create prop entities and scene_prop junctions
        # ═════════════════════════════════════════════════════════════
        prop_map = {}
        for row in conn.execute("SELECT id, name FROM prop").fetchall():
            prop_map[row["name"].lower()] = row["id"]

        for prop in parsed.props:
            key = prop.name.lower()
            if key not in prop_map:
                prop_data = {"name": prop.name}
                if prop.context:
                    prop_data["narrative_significance"] = prop.context[:500]
                if prop.first_scene < len(parsed.scenes):
                    scene_name = parsed.scenes[prop.first_scene].name
                    prop_data["first_appearance"] = f"Scene {prop.first_scene + 1}: {scene_name}"

                cursor = conn.execute(
                    """INSERT INTO prop (name, narrative_significance, first_appearance)
                       VALUES (?, ?, ?)""",
                    (prop_data["name"],
                     prop_data.get("narrative_significance"),
                     prop_data.get("first_appearance"))
                )
                prop_map[key] = cursor.lastrowid
                summary["props_created"] += 1

        # Build existing scene_prop junctions for dedup
        existing_sp = set()
        for row in conn.execute("SELECT scene_id, prop_id FROM scene_prop").fetchall():
            existing_sp.add((row["scene_id"], row["prop_id"]))

        for prop in parsed.props:
            prop_id = prop_map.get(prop.name.lower())
            if not prop_id:
                continue

            scene_id = scene_map.get(prop.first_scene)
            if not scene_id:
                continue

            if (scene_id, prop_id) in existing_sp:
                continue

            # Phase 1C: _CONFIDENCE_TO_SIGNIFICANCE now returns lowercase values
            significance = _CONFIDENCE_TO_SIGNIFICANCE.get(prop.confidence, "present")
            conn.execute(
                """INSERT INTO scene_prop (scene_id, prop_id, name, significance)
                   VALUES (?, ?, '', ?)""",
                (scene_id, prop_id, significance)
            )
            existing_sp.add((scene_id, prop_id))
            summary["scene_props_created"] = summary.get("scene_props_created", 0) + 1

        # ── Walk the raw text line-by-line and classify ──
        text = fountain_text.replace('\r\n', '\n').replace('\r', '\n')
        raw_lines = text.split('\n')

        from fountain_parser import _parse_title_page
        _, _, content_start = _parse_title_page(raw_lines)

        line_order = 0
        current_scene_idx = -1
        current_scene_id = None
        current_char_id = None
        in_dialogue = False
        prev_blank = True

        for line_num in range(content_start, len(raw_lines)):
            raw = raw_lines[line_num].rstrip()
            stripped = raw.strip()

            # Blank line
            if stripped == '':
                conn.execute(
                    """INSERT INTO screenplay_lines
                       (line_order, line_type, content, scene_id, character_id, location_id)
                       VALUES (?, 'blank', '', ?, NULL, NULL)""",
                    (line_order, current_scene_id)
                )
                line_order += 1
                summary["lines_written"] += 1
                prev_blank = True
                in_dialogue = False
                current_char_id = None
                continue

            # Scene heading
            heading_match = _match_scene_heading(stripped)
            if heading_match:
                current_scene_idx += 1
                current_scene_id = scene_map.get(current_scene_idx)
                current_char_id = None
                in_dialogue = False

                loc_id = None
                if current_scene_id:
                    row = conn.execute(
                        "SELECT location_id FROM scene WHERE id = ?",
                        (current_scene_id,)
                    ).fetchone()
                    if row:
                        loc_id = row["location_id"]

                conn.execute(
                    """INSERT INTO screenplay_lines
                       (line_order, line_type, content, scene_id, character_id, location_id)
                       VALUES (?, 'heading', ?, ?, NULL, ?)""",
                    (line_order, stripped, current_scene_id, loc_id)
                )
                line_order += 1
                summary["lines_written"] += 1
                prev_blank = False
                continue

            # Transition
            from fountain_parser import _TRANSITION_RE
            if _TRANSITION_RE.match(stripped):
                conn.execute(
                    """INSERT INTO screenplay_lines
                       (line_order, line_type, content, scene_id, character_id, location_id)
                       VALUES (?, 'transition', ?, ?, NULL, NULL)""",
                    (line_order, stripped, current_scene_id)
                )
                line_order += 1
                summary["lines_written"] += 1
                prev_blank = False
                in_dialogue = False
                continue

            # Character cue (must follow blank line)
            from fountain_parser import _is_character_cue, _CHAR_EXTENSION_RE as FP_CHAR_EXT
            if prev_blank and not in_dialogue:
                cue_candidate = stripped.lstrip('@').rstrip('^').strip()
                cue_candidate = cue_candidate.strip('*').strip()
                cue_candidate = re.sub(r'\s*\[\[[^\]]*\]\]', '', cue_candidate).strip()

                if _is_character_cue(cue_candidate):
                    clean_name = FP_CHAR_EXT.sub('', cue_candidate).strip()
                    if '(' in clean_name:
                        clean_name = re.sub(r'\([^)]*\)', '', clean_name).strip()
                        clean_name = re.sub(r'\s{2,}', ' ', clean_name)

                    tc_name = _title_case_name(clean_name)
                    char_id = char_map.get(tc_name.lower()) or char_map.get(clean_name.lower())

                    conn.execute(
                        """INSERT INTO screenplay_lines
                           (line_order, line_type, content, scene_id, character_id, location_id)
                           VALUES (?, 'character', ?, ?, ?, NULL)""",
                        (line_order, stripped, current_scene_id, char_id)
                    )
                    line_order += 1
                    summary["lines_written"] += 1
                    current_char_id = char_id
                    in_dialogue = True
                    prev_blank = False
                    continue

            # Parenthetical (in dialogue)
            from fountain_parser import _PARENTHETICAL_RE
            if in_dialogue and _PARENTHETICAL_RE.match(raw):
                conn.execute(
                    """INSERT INTO screenplay_lines
                       (line_order, line_type, content, scene_id, character_id, location_id)
                       VALUES (?, 'parenthetical', ?, ?, ?, NULL)""",
                    (line_order, stripped, current_scene_id, current_char_id)
                )
                line_order += 1
                summary["lines_written"] += 1
                prev_blank = False
                continue

            # Dialogue (in dialogue context)
            if in_dialogue:
                conn.execute(
                    """INSERT INTO screenplay_lines
                       (line_order, line_type, content, scene_id, character_id, location_id)
                       VALUES (?, 'dialogue', ?, ?, ?, NULL)""",
                    (line_order, stripped, current_scene_id, current_char_id)
                )
                line_order += 1
                summary["lines_written"] += 1
                prev_blank = False
                continue

            # Action (default)
            conn.execute(
                """INSERT INTO screenplay_lines
                   (line_order, line_type, content, scene_id, character_id, location_id)
                   VALUES (?, 'action', ?, ?, NULL, NULL)""",
                (line_order, stripped, current_scene_id)
            )
            line_order += 1
            summary["lines_written"] += 1
            prev_blank = False
            in_dialogue = False

        # ── Strip structural blanks (Phase 6) ──
        # CSS margins in the editor handle visual spacing between element types.
        # Only intentional blanks (consecutive, or between same-type lines) are kept.
        summary["blanks_stripped"] = _strip_structural_blanks_from_db(conn)

        # ── Rebuild junctions ──
        summary["junctions_rebuilt"] = _rebuild_junctions(conn)

        # ── Update meta ──
        final_line_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM screenplay_lines"
        ).fetchone()["cnt"]
        _update_meta(conn, len(parsed.scenes), final_line_count)

        conn.commit()

    except Exception as e:
        conn.rollback()
        summary["errors"].append(str(e))
        raise
    finally:
        conn.close()

    return summary


# ═══════════════════════════════════════════════════════════════════════════
# Prop Tags — Create / Delete / List
# ═══════════════════════════════════════════════════════════════════════════

def create_prop_tag(db_path: Path, tagged_text: str,
                    prop_id: int = None, new_name: str = None) -> dict:
    """
    Create a prop tag linking a text string to a prop entity.

    If prop_id is given, uses that prop directly.
    If new_name is given instead, finds an existing prop by name or creates one.

    Returns dict with tag_id, tagged_text, prop_id, prop_name, is_new.
    """
    conn = db.get_connection(db_path)
    try:
        is_new = False

        if not prop_id and new_name:
            # Find existing prop by name
            row = conn.execute(
                "SELECT id FROM prop WHERE LOWER(name) = LOWER(?)", (new_name,)
            ).fetchone()
            if row:
                prop_id = row["id"]
            else:
                # Create new prop entity
                cursor = conn.execute(
                    "INSERT INTO prop (name) VALUES (?)", (new_name,)
                )
                prop_id = cursor.lastrowid
                is_new = True

        if not prop_id:
            raise ValueError("prop_id or new_name required")

        # Verify prop exists
        prop_row = conn.execute(
            "SELECT id, name FROM prop WHERE id = ?", (prop_id,)
        ).fetchone()
        if not prop_row:
            raise ValueError(f"Prop #{prop_id} not found")

        # Check for duplicate tag
        existing = conn.execute(
            "SELECT id FROM screenplay_prop_tags WHERE LOWER(tagged_text) = LOWER(?) AND prop_id = ?",
            (tagged_text, prop_id)
        ).fetchone()
        if existing:
            return {
                "tag_id": existing["id"],
                "tagged_text": tagged_text,
                "prop_id": prop_id,
                "prop_name": prop_row["name"],
                "is_new": False,
                "duplicate": True,
            }

        cursor = conn.execute(
            "INSERT INTO screenplay_prop_tags (tagged_text, prop_id) VALUES (?, ?)",
            (tagged_text, prop_id)
        )
        conn.commit()

        return {
            "tag_id": cursor.lastrowid,
            "tagged_text": tagged_text,
            "prop_id": prop_id,
            "prop_name": prop_row["name"],
            "is_new": is_new,
            "duplicate": False,
        }
    finally:
        conn.close()


def delete_prop_tag(db_path: Path, tag_id: int) -> bool:
    """Delete a prop tag. Returns True if deleted."""
    conn = db.get_connection(db_path)
    try:
        cursor = conn.execute(
            "DELETE FROM screenplay_prop_tags WHERE id = ?", (tag_id,)
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def list_prop_tags(db_path: Path) -> list[dict]:
    """List all prop tags with prop names. Used by the editor for inline highlights."""
    conn = db.get_connection(db_path)
    try:
        rows = conn.execute("""
            SELECT pt.id AS tag_id, pt.tagged_text, pt.prop_id,
                   p.name AS prop_name
            FROM screenplay_prop_tags pt
            JOIN prop p ON p.id = pt.prop_id
            ORDER BY pt.tagged_text ASC
        """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# Versioning — Publish / Restore / List / Delete
# ═══════════════════════════════════════════════════════════════════════════

def publish_version(db_path: Path, description: str = "") -> dict:
    """Snapshot the current live screenplay as a published version."""
    conn = db.get_connection(db_path)
    try:
        row = conn.execute(
            "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_num FROM screenplay_versions"
        ).fetchone()
        version_number = row["next_num"]

        line_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM screenplay_lines"
        ).fetchone()["cnt"]

        if line_count == 0:
            raise ValueError("Cannot publish an empty screenplay")

        scene_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM screenplay_lines WHERE line_type = 'heading'"
        ).fetchone()["cnt"]

        char_count = conn.execute(
            "SELECT COUNT(DISTINCT character_id) AS cnt FROM screenplay_lines WHERE character_id IS NOT NULL"
        ).fetchone()["cnt"]

        loc_count = conn.execute(
            "SELECT COUNT(DISTINCT location_id) AS cnt FROM screenplay_lines WHERE location_id IS NOT NULL"
        ).fetchone()["cnt"]

        all_content = conn.execute(
            "SELECT content FROM screenplay_lines WHERE content != ''"
        ).fetchall()
        word_count = sum(len(r["content"].split()) for r in all_content)

        cursor = conn.execute(
            """INSERT INTO screenplay_versions
               (version_number, description, line_count, scene_count,
                character_count, location_count, word_count)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (version_number, description, line_count, scene_count,
             char_count, loc_count, word_count)
        )
        version_id = cursor.lastrowid

        conn.execute(
            """INSERT INTO screenplay_version_lines
               (version_id, line_order, line_type, content,
                scene_id, character_id, location_id, metadata)
               SELECT ?, line_order, line_type, content,
                      scene_id, character_id, location_id, metadata
               FROM screenplay_lines
               ORDER BY line_order""",
            (version_id,)
        )

        conn.execute(
            """INSERT INTO screenplay_version_title_page
               (version_id, key, value, sort_order)
               SELECT ?, key, value, sort_order
               FROM screenplay_title_page
               ORDER BY sort_order, id""",
            (version_id,)
        )

        conn.commit()

        return {
            "version_id": version_id,
            "version_number": version_number,
            "description": description,
            "line_count": line_count,
            "scene_count": scene_count,
            "character_count": char_count,
            "location_count": loc_count,
            "word_count": word_count,
            "published_at": datetime.now().isoformat(timespec="seconds"),
        }

    finally:
        conn.close()


def list_versions(db_path: Path) -> list[dict]:
    """List all published versions, newest first."""
    conn = db.get_connection(db_path)
    try:
        rows = conn.execute(
            """SELECT id, version_number, description, published_at,
                      line_count, scene_count, character_count,
                      location_count, word_count
               FROM screenplay_versions
               ORDER BY version_number DESC"""
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def restore_version(db_path: Path, version_id: int) -> dict:
    """Restore a published version as the live screenplay."""
    conn = db.get_connection(db_path)
    summary = {
        "version_id": version_id,
        "version_number": 0,
        "lines_restored": 0,
        "junctions_rebuilt": 0,
        "errors": [],
    }

    try:
        ver = conn.execute(
            "SELECT version_number, description FROM screenplay_versions WHERE id = ?",
            (version_id,)
        ).fetchone()
        if not ver:
            raise ValueError(f"Version {version_id} not found")

        summary["version_number"] = ver["version_number"]

        conn.execute("DELETE FROM screenplay_lines")
        conn.execute("DELETE FROM screenplay_title_page")

        conn.execute(
            """INSERT INTO screenplay_lines
               (line_order, line_type, content, scene_id,
                character_id, location_id, metadata)
               SELECT line_order, line_type, content, scene_id,
                      character_id, location_id, metadata
               FROM screenplay_version_lines
               WHERE version_id = ?
               ORDER BY line_order""",
            (version_id,)
        )
        summary["lines_restored"] = conn.execute(
            "SELECT COUNT(*) AS cnt FROM screenplay_lines"
        ).fetchone()["cnt"]

        conn.execute(
            """INSERT INTO screenplay_title_page (key, value, sort_order)
               SELECT key, value, sort_order
               FROM screenplay_version_title_page
               WHERE version_id = ?
               ORDER BY sort_order, id""",
            (version_id,)
        )

        summary["junctions_rebuilt"] = _rebuild_junctions(conn)

        scene_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM screenplay_lines WHERE line_type = 'heading'"
        ).fetchone()["cnt"]
        _update_meta(conn, scene_count, summary["lines_restored"])

        conn.commit()

    except Exception as e:
        conn.rollback()
        summary["errors"].append(str(e))
        raise
    finally:
        conn.close()

    return summary


def delete_version(db_path: Path, version_id: int) -> bool:
    """Delete a published version. Returns True if deleted."""
    conn = db.get_connection(db_path)
    try:
        cursor = conn.execute(
            "DELETE FROM screenplay_versions WHERE id = ?",
            (version_id,)
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()
