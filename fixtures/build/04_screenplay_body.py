#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
04_screenplay_body.py — the Hollow Creek screenplay.

Until now the fixture's screenplay was 19 lines: eleven sluglines and
eight section headers, with no action and no dialogue. That made it a
demonstration of SCF-as-outline and nothing else, and it left spec §3.4
— read a scene's text from its heading to the next one, and do not rely
on `screenplay_lines.scene_id` — with no artifact behind it at all.
There was no scene text to walk.

An SCF should work as an outline AND as a finished screenplay, so the
fixture now demonstrates both: four scenes carry action and dialogue, the
rest stay sluglines. A conforming reader has to handle a file where some
scenes have bodies and some do not, which is the normal state of a
project in progress.

THIS SCRIPT IS THE SOURCE. The screenplay lives here as data and the
`.fountain` file beside it is GENERATED, not parsed. Parsing fountain
here would be a second implementation of the tokenizer, free to drift
from `scf-core`'s — the exact failure the second-implementation audit was
run to find. One source, two outputs.

Unlike scripts 01-03 this one IS idempotent: it rewrites
`screenplay_lines` wholesale from the data below, so it can be re-run.

    python3 fixtures/build/04_screenplay_body.py fixtures/hollow_creek.scf

Three deliberate structural facts, beyond the prose:

  * Scene 12A exists — an A-page. It gives the fixture a scene number
    that is not an integer, so §4.2.1's grammar is exercised by the
    artifact meant to demonstrate it. Its row id is the highest while it
    sits mid-script, so row-id order stops matching script order.

  * Scene 16 comes AFTER scene 19 in the script and keeps its number.
    The project is `scene_numbering: fixed`, so this is not damage: it is
    what a locked script looks like after a reorder, and it is the
    hazard §4.1 warns about in as many words. Script order and
    scene-number order now differ.

    Together those two mean screenplay order, scene-number order and
    row-id order are three DIFFERENT orders. Before this, all three
    coincided, and a reader doing the one thing §4.1 explicitly forbids
    passed every blessed expectation.

  * Sequence "The Reckoning" still crosses the Act 2 / Act 3 boundary,
    and now contains the moved scene 16 as well. §5.3 says a crossing
    sequence is legal and must render as the part of it that belongs to
    each act; the fixture keeps proving it.
"""
import json
import sqlite3
import sys
from pathlib import Path

# --- the screenplay -------------------------------------------------
#
# (line_type, content, ref)
#   heading   ref = scene_number, the scene this heading opens
#   section   ref = ("act"|"sequence", entity id)
#   character ref = character name, matched to a character row
#   others    ref = None
#
# Order here IS script order. Scene numbers are labels and do not have
# to ascend — see the module docstring.

SCREENPLAY = [
    ("section", "# Act 1 — Arrival", ("act", 1)),
    ("blank", "", None),
    ("section", "## The Return", ("sequence", 3)),
    ("blank", "", None),

    ("heading", "EXT. HOLLOW CREEK ROAD - DAY", "1"),
    ("blank", "", None),
    ("action", "A road that gave up being a road a mile back. MARCUS CADE "
               "walks it with a bag over one shoulder, coat too good for "
               "the country and too thin for the season.", None),
    ("blank", "", None),
    ("action", "He stops. Ahead, past the fence line, the farmhouse.", None),
    ("blank", "", None),
    ("action", "It is smaller than he has been remembering it. He stands "
               "with that a while.", None),
    ("blank", "", None),
    ("action", "Then he walks on.", None),
    ("blank", "", None),

    ("heading", "INT. FARMHOUSE KITCHEN - DAY (ARRIVAL)", "3"),
    ("blank", "", None),
    ("action", "ELEANOR CADE is at the sink with her back to the door. She "
               "does not turn when it opens.", None),
    ("blank", "", None),
    ("character", "ELEANOR", "Eleanor Cade"),
    ("dialogue", "Shut it behind you.", None),
    ("blank", "", None),
    ("action", "Marcus sets the bag down. He leaves the door where it is.",
     None),
    ("blank", "", None),
    ("character", "MARCUS", "Marcus Cade"),
    ("dialogue", "It's warm out.", None),
    ("blank", "", None),
    ("character", "ELEANOR", "Eleanor Cade"),
    ("parenthetical", "(still not turning)", None),
    ("dialogue", "It isn't.", None),
    ("blank", "", None),
    ("action", "She washes the same cup she has already washed. Behind her "
               "the door stands open on the yard, and neither of them "
               "closes it.", None),
    ("blank", "", None),

    ("heading", "EXT. GRAVESIDE - DUSK", "7"),
    ("blank", "", None),

    ("section", "# Act 2 — The Thaw", ("act", 2)),
    ("blank", "", None),
    ("section", "## The Thaw", ("sequence", 4)),
    ("blank", "", None),

    ("heading", "EXT. CREEK CROSSING - DAY", "9"),
    ("blank", "", None),
    ("heading", "INT. FARMHOUSE KITCHEN - NIGHT (AFTER)", "10"),
    ("blank", "", None),
    ("heading", "EXT. FARMHOUSE PORCH - DAY", "11"),
    ("blank", "", None),

    ("section", "## The Reckoning", ("sequence", 1)),
    ("blank", "", None),

    ("heading", "INT. FARMHOUSE KITCHEN - NIGHT", "12"),
    ("blank", "", None),
    ("action", "One lamp. Eleanor at the table with Ada's shawl around her "
               "shoulders. Marcus in the doorway, coat still on.", None),
    ("blank", "", None),
    ("character", "ELEANOR", "Eleanor Cade"),
    ("dialogue", "You came back.", None),
    ("blank", "", None),
    ("character", "MARCUS", "Marcus Cade"),
    ("dialogue", "I came back.", None),
    ("blank", "", None),
    ("character", "ELEANOR", "Eleanor Cade"),
    ("dialogue", "Eleven years, and you come back for the part where "
                 "there's nothing left to carry.", None),
    ("blank", "", None),
    ("action", "Marcus does not answer. His hand goes to his coat pocket "
               "and stops there.", None),
    ("blank", "", None),
    ("character", "ELEANOR", "Eleanor Cade"),
    ("dialogue", "Say it or go to bed.", None),
    ("blank", "", None),
    ("action", "He goes to bed.", None),
    ("blank", "", None),

    ("heading", "INT. FARMHOUSE KITCHEN - NIGHT (LATER)", "12A"),
    ("blank", "", None),
    ("action", "The lamp is out. Eleanor has not moved.", None),
    ("blank", "", None),
    ("action", "She sits in the dark with the shawl and the open door and "
               "the sound of the creek doing what it does.", None),
    ("blank", "", None),

    ("section", "# Act 3 — The Truth", ("act", 3)),
    ("blank", "", None),

    ("heading", "INT. FARMHOUSE KITCHEN - NIGHT (CONFESSION)", "19"),
    ("blank", "", None),
    ("action", "The lamp again. Marcus has the locket out on the table "
               "between them, chain pooled beside it.", None),
    ("blank", "", None),
    ("character", "MARCUS", "Marcus Cade"),
    ("dialogue", "I was at the creek that day.", None),
    ("blank", "", None),
    ("action", "Eleanor looks at the locket. Not at him.", None),
    ("blank", "", None),
    ("character", "ELEANOR", "Eleanor Cade"),
    ("dialogue", "I know.", None),
    ("blank", "", None),
    ("character", "MARCUS", "Marcus Cade"),
    ("dialogue", "You know.", None),
    ("blank", "", None),
    ("character", "ELEANOR", "Eleanor Cade"),
    ("dialogue", "I've known since the day after. I've been waiting "
                 "eleven years for you to be the one to say it.", None),
    ("blank", "", None),

    ("heading", "INT. HOLLOW CREEK CHURCH - DAY", "16"),
    ("blank", "", None),

    ("section", "## The Storm", ("sequence", 2)),
    ("blank", "", None),
    ("heading", "EXT. RIDGE FOREST - NIGHT (STORM)", "21"),
    ("blank", "", None),

    ("section", "## The Open Door", ("sequence", 5)),
    ("blank", "", None),
    ("heading", "EXT. FARMHOUSE PORCH - DAWN", "24"),
    ("blank", "", None),
]

# Scenes the script contains that the fixture may not have yet.
NEW_SCENES = [
    {
        "scene_number": "12A",
        "name": "INT. FARMHOUSE KITCHEN - NIGHT (LATER)",
        "int_ext": "interior",
        "time_of_day": "night",
        "summary": "Eleanor alone after the confrontation. The lamp is "
                   "out; the door is still open.",
        "location_of": "INT. FARMHOUSE KITCHEN - NIGHT",
    },
]


def emit_fountain(path: Path) -> None:
    """The .fountain beside this script is generated, never parsed."""
    out = []
    for kind, content, _ref in SCREENPLAY:
        out.append("" if kind == "blank" else content)
    path.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf-8")


def main(db_path: str) -> int:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    scene_by_number = {
        str(r["scene_number"]): r["id"]
        for r in con.execute("SELECT id, scene_number FROM scene")
    }
    char_by_name = {
        r["name"]: r["id"] for r in con.execute("SELECT id, name FROM character")
    }

    for spec in NEW_SCENES:
        if spec["scene_number"] in scene_by_number:
            continue
        src = con.execute(
            "SELECT location_id FROM scene WHERE name = ?",
            (spec["location_of"],),
        ).fetchone()
        cur = con.execute(
            "INSERT INTO scene (uuid, name, scene_number, int_ext, "
            "time_of_day, summary, location_id, status, lifecycle_status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'outline', 'active')",
            (
                "00000000-0000-4000-8000-00000000c12a",
                spec["name"], spec["scene_number"], spec["int_ext"],
                spec["time_of_day"], spec["summary"],
                src["location_id"] if src else None,
            ),
        )
        scene_by_number[spec["scene_number"]] = cur.lastrowid
        print(f"  + scene {spec['scene_number']} (id {cur.lastrowid})")

    con.execute("DELETE FROM screenplay_lines")

    order = 0
    for kind, content, ref in SCREENPLAY:
        order += 1
        scene_id = None
        character_id = None
        metadata = None

        if kind == "heading":
            scene_id = scene_by_number[ref]
        elif kind == "section":
            depth = 1 if ref[0] == "act" else 2
            text = content.lstrip("#").strip()
            metadata = json.dumps({
                "section": {"depth": depth, "text": text},
                "structureRef": {"kind": ref[0], "id": ref[1]},
            })
        elif kind == "character":
            character_id = char_by_name[ref]
            metadata = json.dumps({
                "character": {
                    "name": content, "extensions": [],
                    "dual": False, "forced": False,
                },
            })

        con.execute(
            "INSERT INTO screenplay_lines (uuid, scene_id, line_order, "
            "line_type, content, character_id, metadata) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (f"00000000-0000-4000-9000-{order:012d}", scene_id, order,
             kind, content, character_id, metadata),
        )

    con.commit()
    con.execute("VACUUM")
    con.execute("PRAGMA application_id = 1396917809")
    con.execute("PRAGMA user_version = 2010")
    con.commit()

    emit_fountain(Path(__file__).parent / "hollow_creek.fountain")

    headings = sum(1 for k, _, _ in SCREENPLAY if k == "heading")
    print(f"  {order} screenplay lines, {headings} headings")
    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1
                          else "fixtures/hollow_creek.scf"))
