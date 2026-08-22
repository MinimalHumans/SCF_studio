#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Part 2: the screenplay spine, the shoot data, and query detail."""

import json
import sqlite3
import sys
import uuid

DB = sys.argv[1] if len(sys.argv) > 1 else "hollow_creek.scf"
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row


NO_UUID = {"screenplay_title_page"}


def ins(table, **vals):
    if table not in NO_UUID:
        vals["uuid"] = str(uuid.uuid4())
    cols = ", ".join(f'"{k}"' for k in vals)
    qs = ", ".join("?" for _ in vals)
    return db.execute(f'INSERT INTO "{table}" ({cols}) VALUES ({qs})',
                      list(vals.values())).lastrowid


def upd(table, row_id, **vals):
    sets = ", ".join(f'"{k}" = ?' for k in vals)
    db.execute(f'UPDATE "{table}" SET {sets} WHERE id = ?',
               [*vals.values(), row_id])


S = {r["scene_number"]: r["id"]
     for r in db.execute("SELECT id, scene_number FROM scene")}
NUM = {v: k for k, v in S.items()}
ELEANOR, MARCUS = 1, 2
ADA = db.execute("SELECT id FROM character WHERE name LIKE '%Ada%'"
                 ).fetchone()["id"]
SHAW = db.execute("SELECT id FROM character WHERE name LIKE '%Shaw%'"
                  ).fetchone()["id"]
PINNED = S[12]

# ---------------------------------------------------------------------
# 6. The screenplay: headings only, with the sections that declare the
#    structure. Written the way the editor writes it, so committing the
#    script in the app re-links to these same rows instead of making new
#    ones — that is what the structureRef in the line metadata is for.
# ---------------------------------------------------------------------
db.execute("DELETE FROM screenplay_lines")
db.execute("DELETE FROM screenplay_title_page")
for order, (key, value) in enumerate([
        ("title", "HOLLOW CREEK"), ("credit", "Written by"),
        ("author", "Minimal Humans"), ("draft date", "1889 / development"),
        ("contact", "hollowcreek@example.com")], start=1):
    ins("screenplay_title_page", key=key, value=value, sort_order=order)

acts = {r["start_scene_id"]: r for r in db.execute(
    "SELECT id, name, start_scene_id FROM act")}
seqs = {r["start_scene_id"]: r for r in db.execute(
    "SELECT id, name, start_scene_id FROM sequence")}

line_order = 0
for number in sorted(S):
    scene_id = S[number]
    if scene_id in acts:
        line_order += 1
        act = acts[scene_id]
        ins("screenplay_lines", line_order=line_order, line_type="section",
            content=f"# {act['name']}",
            metadata=json.dumps({"section": {"depth": 1,
                                             "text": act["name"]},
                                 "structureRef": {"kind": "act",
                                                  "id": act["id"]}}))
    if scene_id in seqs:
        line_order += 1
        seq = seqs[scene_id]
        ins("screenplay_lines", line_order=line_order, line_type="section",
            content=f"## {seq['name']}",
            metadata=json.dumps({"section": {"depth": 2,
                                             "text": seq["name"]},
                                 "structureRef": {"kind": "sequence",
                                                  "id": seq["id"]}}))
    line_order += 1
    heading = db.execute("SELECT name FROM scene WHERE id=?",
                         (scene_id,)).fetchone()["name"]
    ins("screenplay_lines", line_order=line_order, line_type="heading",
        content=heading, scene_id=scene_id)

# scene_sequence, materialized from the boundaries the way the app does.
db.execute("DELETE FROM scene_sequence")
ordered = sorted(S)
starts = sorted(((NUM[r["start_scene_id"]], r["id"]) for r in
                 db.execute("SELECT id, start_scene_id FROM sequence")))
for i, (start_number, seq_id) in enumerate(starts):
    end = starts[i + 1][0] if i + 1 < len(starts) else 10 ** 6
    position = 0
    for number in ordered:
        if start_number <= number < end:
            position += 1
            ins("scene_sequence", scene_id=S[number], sequence_id=seq_id,
                order_in_sequence=position)
for i, (_, seq_id) in enumerate(starts, start=1):
    upd("sequence", seq_id, sequence_number=i)

# ---------------------------------------------------------------------
# 7. Beats and coverage
# ---------------------------------------------------------------------
BEATS = {
    1: [("Setup", "setup", "The road, the ridge, the house getting no "
         "bigger.", MARCUS),
        ("Decision", "decision", "He stops at the gate, then goes on.",
         MARCUS)],
    3: [("Arrival", "setup", "He fills the doorway; she does not turn "
         "around.", ELEANOR),
        ("Deflection", "reaction", "She hands him the water bucket.",
         ELEANOR),
        ("The door", "discovery", "She leaves it ajar behind him without "
         "deciding to.", ELEANOR)],
    7: [("The plaque", "discovery", "The audience learns Ada is dead.",
         ELEANOR),
        ("Shaw's comfort", "action", "Shaw offers a timetable for grief.",
         SHAW)],
    9: [("The crossing", "action", "The horse balks; the water takes her.",
         ELEANOR),
        ("The carry", "decision", "He goes in after her and carries her "
         "up.", MARCUS)],
    10: [("The shawl", "revelation", "She takes Ada's shawl off the hook "
          "and puts it on.", ELEANOR)],
    11: [("The locket", "action", "Saddlebag to coat pocket, quickly.",
          MARCUS)],
    12: [("Held breath", "setup", "Neither speaks; the storm does.",
          ELEANOR),
         ("She speaks first", "revelation", "'You came back.'", ELEANOR)],
    16: [("Shaw's invitation", "action", "He asks her back to the "
          "congregation.", SHAW),
         ("Refusal", "reaction", "She thanks him and does not answer.",
          ELEANOR)],
    19: [("The question", "action", "She asks where he was that day.",
          ELEANOR),
         ("The confession", "revelation", "He was at the creek.", MARCUS),
         ("The locket", "discovery", "He puts it on the table.", MARCUS)],
    21: [("The horses", "action", "They are through the fence and gone.",
          MARCUS),
         ("Into it", "decision", "He goes up the ridge in the dark.",
          MARCUS)],
    24: [("Waiting", "setup", "She is on the porch when he comes down.",
          ELEANOR),
         ("The embrace", "resolution" if False else "revelation",
          "Neither of them goes inside first.", ELEANOR)],
}
existing_beat = db.execute(
    "SELECT id, scene_id FROM story_beat").fetchall()
have_beats = {r["scene_id"] for r in existing_beat}
beat_ids = {}
for number, beats in BEATS.items():
    scene_id = S[number]
    start = 1
    if scene_id in have_beats:
        start = 1 + len(db.execute(
            "SELECT id FROM story_beat WHERE scene_id=?",
            (scene_id,)).fetchall())
    for offset, (name, beat_type, description, pov) in enumerate(beats):
        beat_ids[(number, name)] = ins(
            "story_beat", name=name, scene_id=scene_id,
            beat_order=start + offset, beat_type=beat_type,
            description=description, pov_character_id=pov,
            lifecycle_status="active")

SHOTS = {
    1: [("A", "extreme wide", "eye level", "static", "35mm",
         "The ridge road, a figure a third of the way in.", "Setup"),
        ("B", "medium", "low angle", "tracking", "40mm",
         "Walking with him, boots and road.", "Setup"),
        ("C", "medium close-up", "eye level", "static", "75mm",
         "He stops. The house over his shoulder, soft.", "Decision")],
    3: [("A", "wide", "eye level", "static", "27mm",
         "Kitchen; she is at the stove, back to the door.", "Arrival"),
        ("B", "medium", "eye level", "static", "40mm",
         "He fills the doorway. Held long.", "Arrival"),
        ("C", "close-up", "eye level", "static", "75mm",
         "Her hands stop, then keep going.", "Deflection"),
        ("D", "medium wide", "low angle", "static", "35mm",
         "The door, ajar, behind him.", "The door")],
    9: [("A", "wide", "high angle", "static", "27mm",
         "The ford from the bank; water higher than it looks.",
         "The crossing"),
        ("B", "medium", "eye level", "pan", "40mm", "The horse balks.",
         "The crossing"),
        ("C", "medium close-up", "dutch", "tracking", "50mm",
         "She goes down; the water takes her sideways.", "The crossing"),
        ("D", "medium wide", "eye level", "tracking", "35mm",
         "He carries her up the bank, neither speaking.", "The carry")],
    10: [("A", "close-up", "eye level", "static", "75mm",
          "The shawl on its hook.", "The shawl"),
         ("B", "medium", "eye level", "static", "40mm",
          "She puts it on like a coat, not a keepsake.", "The shawl")],
    11: [("A", "close-up", "high angle", "static", "75mm",
          "Locket in the saddlebag.", "The locket"),
         ("B", "medium close-up", "eye level", "static", "50mm",
          "Into the coat pocket; a glance at the house.", "The locket")],
    12: [("A", "wide", "eye level", "static", "27mm",
          "The kitchen, both of them in it, storm on the glass.",
          "Held breath"),
         ("B", "medium close-up", "eye level", "static", "50mm",
          "Marcus at the table, not looking up.", "Held breath"),
         ("C", "close-up", "eye level", "static", "75mm",
          "The kettle set down.", "Held breath"),
         ("E", "close-up", "eye level", "static", "75mm",
          "Marcus, after. The flicker.", "She speaks first")],
    19: [("A", "medium wide", "eye level", "static", "35mm",
          "Both, table between them.", "The question"),
         ("B", "close-up", "eye level", "push in", "75mm",
          "Marcus. The whole confession in one take.", "The confession"),
         ("C", "close-up", "eye level", "static", "75mm",
          "Eleanor, not moving.", "The confession"),
         ("D", "close-up", "overhead", "static", "50mm",
          "The locket on the boards.", "The locket")],
    21: [("A", "wide", "low angle", "static", "27mm",
          "Timber and rain; a lantern a long way in.", "The horses"),
         ("B", "medium", "eye level", "tracking", "35mm",
          "Running with him, handheld.", "Into it"),
         ("C", "extreme wide", "high angle", "crane", "27mm",
          "The ridge, the storm, one light.", "Into it")],
    24: [("A", "medium wide", "eye level", "static", "35mm",
          "Porch, first light, chime down in the mud.", "Waiting"),
         ("B", "medium close-up", "eye level", "static", "50mm",
          "She sees him on the track.", "Waiting"),
         ("C", "medium", "eye level", "static", "40mm",
          "The embrace. The door open behind them.", "The embrace")],
}
for number, shots in SHOTS.items():
    scene_id = S[number]
    for letter, size, angle, movement, lens, description, beat in shots:
        order = ord(letter) - 64
        ins("shot", name=description.split(";")[0][:60], scene_id=scene_id,
            shot_number=f"{number}{letter}", shot_order=order,
            story_beat_id=beat_ids.get((number, beat)),
            shot_size=size, camera_angle=angle, camera_movement=movement,
            lens_choice=lens, description=description,
            lifecycle_status="active")
# The legacy-numbered shot keeps its authored number and its slot.
upd("shot", 1, story_beat_id=beat_ids.get((12, "She speaks first")),
    camera_angle="eye level",
    notes="Numbered 12-04 under the production's own scheme; the app "
          "shows the derived code beside it rather than renumbering.")
db.commit()
