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
fixture demonstrates both: every scene in the script carries action
except scene 11, which stays a slugline on purpose. A conforming reader
has to handle a file where some scenes have bodies and some do not,
which is the normal state of a project in progress — and with every
heading filled in, nothing here would demonstrate the outline half any
more. Scene 11 is that demonstration; see conformance.md's list of
fixture properties before filling it in.

Nine scenes carry dialogue as well. Three do not, and each is a silent
presence rather than an oversight: Marcus walks in alone in scene 1 and
goes up the ridge alone in 21, and the reunion on the porch in 24 is
wordless because the whole script is about what does not get said.

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
    The project is `numbering_policy: fixed`, so this is not damage: it is
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
    ("character", "MARCUS", "Marcus Cade"),
    ("dialogue", "Is Ada's room still—", None),
    ("blank", "", None),
    ("action", "Eleanor turns the tap on. That is the whole answer.",
     None),
    ("blank", "", None),
    ("action", "She washes the same cup she has already washed. Behind her "
               "the door stands open on the yard, and neither of them "
               "closes it.", None),
    ("blank", "", None),

    ("heading", "EXT. GRAVESIDE - DUSK", "7"),
    ("blank", "", None),
    ("action", "A short row of stones at the edge of the field. Eleanor "
               "stands at the newest one. REVEREND SHAW keeps a pace "
               "back with his hat in his hands.", None),
    ("blank", "", None),
    ("character", "SHAW", "Reverend Shaw"),
    ("dialogue", "You don't have to come out here to see her.", None),
    ("blank", "", None),
    ("character", "ELEANOR", "Eleanor Cade"),
    ("dialogue", "I know where she is. That's different.", None),
    ("blank", "", None),
    ("action", "Shaw waits to be asked for something. He is not asked.",
     None),
    ("blank", "", None),
    ("section", "# Act 2 — The Thaw", ("act", 2)),
    ("blank", "", None),
    ("section", "## The Thaw", ("sequence", 4)),
    ("blank", "", None),

    ("heading", "EXT. CREEK CROSSING - DAY", "9"),
    ("blank", "", None),
    ("action", "The creek is running high and brown. Eleanor takes the "
               "crossing on foot and the current takes her legs from "
               "under her.", None),
    ("blank", "", None),
    ("action", "She goes down hard on her left side against the stones. "
               "Marcus is in the water before he has decided to be.",
     None),
    ("blank", "", None),
    ("character", "MARCUS", "Marcus Cade"),
    ("dialogue", "Hold on to me.", None),
    ("blank", "", None),
    ("character", "ELEANOR", "Eleanor Cade"),
    ("parenthetical", "(through her teeth)", None),
    ("dialogue", "I am.", None),
    ("blank", "", None),
    ("action", "He carries her up the bank. Neither of them looks back "
               "at the water.", None),
    ("blank", "", None),

    ("heading", "INT. FARMHOUSE KITCHEN - NIGHT (AFTER)", "10"),
    ("blank", "", None),
    ("action", "Eleanor sits with her left arm held against her. Ada's "
               "shawl is folded over the back of the chair, where it "
               "has been folded for eleven years.", None),
    ("blank", "", None),
    ("action", "She puts it around her shoulders.", None),
    ("blank", "", None),

    # Scene 11 is DELIBERATELY left as a slugline — see conformance.md's
    # fixture properties. An SCF is legitimately an outline or a
    # finished screenplay, and a conforming reader has to meet both in
    # one file; with every heading carrying a body, nothing in the
    # fixture demonstrates the first any more.
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

    ("heading", "EXT. FARMHOUSE YARD - NIGHT (CUT)", "12B"),
    ("blank", "", None),
    ("action", "Marcus crosses the yard to the truck and stands with his "
               "hand on the door. He does not open it.", None),
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
    ("dialogue", "Ada was already in the water.", None),
    ("blank", "", None),
    ("character", "ELEANOR", "Eleanor Cade"),
    ("dialogue", "I know that too.", None),
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
    ("action", "Empty pews and one lit lamp. Eleanor sits near the "
               "back. Shaw does not ask her to come further forward.",
     None),
    ("blank", "", None),
    ("character", "SHAW", "Reverend Shaw"),
    ("dialogue", "He's staying, then.", None),
    ("blank", "", None),
    ("character", "ELEANOR", "Eleanor Cade"),
    ("dialogue", "He's stayed longer than I gave him.", None),
    ("blank", "", None),
    ("section", "## The Storm", ("sequence", 2)),
    ("blank", "", None),
    # Wordless on purpose. Marcus is alone on the ridge and there is
    # nobody on the porch either of them is willing to talk to yet, so
    # the cast links here stay unjustified by any cue line — which is
    # what a silent presence looks like, and the integrity panel is
    # right to keep asking about it.
    ("heading", "EXT. RIDGE FOREST - NIGHT (STORM)", "21"),
    ("blank", "", None),
    ("action", "Rain coming sideways through the pines. Marcus goes up "
               "the ridge after the horses with a lamp that is no use "
               "to him.", None),
    ("blank", "", None),
    ("action", "Ahead of him, hoofprints filling with water.", None),
    ("blank", "", None),

    ("section", "## The Open Door", ("sequence", 5)),
    ("blank", "", None),
    ("heading", "EXT. FARMHOUSE PORCH - DAWN", "24"),
    ("blank", "", None),
    ("action", "First light on the yard. The door stands open, as it "
               "has stood since he came.", None),
    ("blank", "", None),
    ("action", "Eleanor is on the porch when Marcus comes up from the "
               "barn. She holds on to him. It takes him a moment to "
               "understand that is what is happening.", None),
    ("blank", "", None),
]

# Scenes the script contains that the fixture may not have yet.
NEW_SCENES = [
    {
        # CUT — spec §6.6. This scene must not appear in story order, in
        # any span, or in any query result, and adding it must therefore
        # change NOTHING. That is the whole test: a cut row is not in the
        # film, and the fixture proves it by carrying one that no answer
        # is allowed to notice.
        #
        # It keeps its heading in the screenplay on purpose. A cut scene
        # in a real script is struck through rather than deleted, and a
        # reader that rebuilt story order from headings alone would
        # resurrect it — which is the mistake this row is here to catch.
        "scene_number": "12B",
        "name": "EXT. FARMHOUSE YARD - NIGHT (CUT)",
        "int_ext": "exterior",
        "time_of_day": "night",
        "summary": "Marcus almost leaves. Cut in the edit — the beat is "
                   "carried by his hand stopping on the door in 12A.",
        "location_of": "EXT. FARMHOUSE PORCH - DAY",
        "lifecycle_status": "cut",
    },
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
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'outline', ?)",
            (
                # Deterministic and WELL-FORMED: the last group is
                # exactly 12 hex digits. A first attempt interpolated the
                # scene number without padding and produced a 35-char
                # uuid, which auditIdentity caught on the next run.
                "00000000-0000-4000-8000-{:0>12}".format(
                    "c" + "".join(ch for ch in spec["scene_number"].lower()
                                  if ch in "0123456789abcdef")),
                spec["name"], spec["scene_number"], spec["int_ext"],
                spec["time_of_day"], spec["summary"],
                src["location_id"] if src else None,
                spec.get("lifecycle_status", "active"),
            ),
        )
        scene_by_number[spec["scene_number"]] = cur.lastrowid
        print(f"  + scene {spec['scene_number']} (id {cur.lastrowid})")

    # A cut performance beat in the pinned scene. Every answer about
    # scene 12 must be identical with and without it (spec §6.6), which
    # is a stronger statement than the fixture could make by having no
    # cut rows at all.
    eleanor = con.execute(
        "SELECT id FROM character WHERE name LIKE '%Eleanor%'").fetchone()
    scene12 = con.execute(
        "SELECT id FROM scene WHERE scene_number = '12'").fetchone()
    if eleanor is not None and scene12 is not None:
        # Reuse the existing row id rather than letting SQLite allocate a
        # fresh one. Delete-then-insert without this is not idempotent in
        # ids: each run advances sqlite_sequence, so the same source
        # produced a different file every time and the rebuild diverged
        # from the checked-in fixture on this one row. The uuid was
        # already pinned; the row id was not, and row ids are what every
        # foreign key in the file points at.
        prior = con.execute(
            "SELECT id, created_at, updated_at FROM performance_beat "
            "WHERE name = ?",
            ("kettle-reprise",)).fetchone()
        con.execute("DELETE FROM performance_beat WHERE name = ?",
                    ("kettle-reprise",))
        con.execute(
            "INSERT INTO performance_beat (id, created_at, updated_at, "
            "uuid, name, character_id, scene_id, modality, beat_order, "
            "line_text, pace, volume, lifecycle_status) "
            "VALUES (?, COALESCE(?, CURRENT_TIMESTAMP), "
            "COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, "
            "'vocal', 99, ?, 'slow', 'soft', 'cut')",
            (prior["id"] if prior is not None else None,
             prior["created_at"] if prior is not None else None,
             prior["updated_at"] if prior is not None else None,
             "00000000-0000-4000-8000-00000000cb01", "kettle-reprise",
             eleanor["id"], scene12["id"],
             "You never could leave a kettle alone."))

    # Timestamps on generated rows are VALUES, not observations.
    #
    # These lines are deleted and rewritten on every run, so letting the
    # column default to CURRENT_TIMESTAMP made the build unreproducible
    # in the most literal way available: two builds from identical source,
    # minutes apart, differed in 106 rows and agreed about everything
    # that means anything. Preserve what a previous build wrote where
    # there is one, and otherwise use a fixed value, so that building
    # from nothing twice gives the same file both times.
    prior_written = {
        r["uuid"]: (r["created_at"], r["updated_at"])
        for r in con.execute(
            "SELECT uuid, created_at, updated_at FROM screenplay_lines")}
    GENERATED_AT = "2026-01-01 00:00:00"

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

        line_uuid = f"00000000-0000-4000-9000-{order:012d}"
        created, updated = prior_written.get(
            line_uuid, (GENERATED_AT, GENERATED_AT))
        con.execute(
            "INSERT INTO screenplay_lines (uuid, scene_id, line_order, "
            "line_type, content, character_id, metadata, created_at, "
            "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (line_uuid, scene_id, order,
             kind, content, character_id, metadata, created, updated),
        )

    con.commit()
    con.execute("VACUUM")

    # Header, spec §1.2. The schema version is READ FROM the file rather
    # than written in here: it was hardcoded to 2010 and stayed there
    # through 2.11 and 2.12, so every run of this script silently
    # backdated the fixture's user_version by two schema versions. It
    # went unnoticed because the fixture was never rebuilt from nothing
    # — the value in the checked-in file came from somewhere else, and
    # this line quietly disagreed with it.
    con.execute("PRAGMA application_id = 1396917809")
    meta = con.execute(
        "SELECT value FROM _scf_meta WHERE key = 'schema_version'").fetchone()
    if meta is not None:
        major, _, minor = str(meta["value"]).partition(".")
        con.execute(f"PRAGMA user_version = {int(major) * 1000 + int(minor)}")
    con.commit()

    emit_fountain(Path(__file__).parent / "hollow_creek.fountain")

    headings = sum(1 for k, _, _ in SCREENPLAY if k == "heading")
    print(f"  {order} screenplay lines, {headings} headings")
    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1
                          else "fixtures/hollow_creek.scf"))
