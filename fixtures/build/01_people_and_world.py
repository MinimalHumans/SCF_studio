#!/usr/bin/env python3
"""
Enrich the Hollow Creek demo fixture.

Two constraints shape everything here:

1. The conformance suites (TS and Python) pin this fixture assertion for
   assertion, and most of them key on SCENE 12 — its motif manifest, its
   sound cue, its costume set, its direction chains, Eleanor's states
   there. So scene 12 is treated as read-only: it gets shots and beats
   (which nothing asserts) and nothing else. Enrichment happens
   everywhere else.

2. Lookups are by name: character LIKE '%Eleanor%', the shot LIKE
   '%12-04%', scenes by scene_number. Surnames may change; those anchors
   may not. Scene numbers stay as they are rather than being made
   sequential, because renumbering would break every scene lookup in
   both suites.

Run against a pristine copy: this script is additive, not idempotent.
"""

import json
import sqlite3
import sys
import uuid

DB = sys.argv[1] if len(sys.argv) > 1 else "hollow_creek.scf"
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row


def ins(table, **vals):
    vals["uuid"] = str(uuid.uuid4())
    cols = ", ".join(f'"{k}"' for k in vals)
    qs = ", ".join("?" for _ in vals)
    cur = db.execute(f'INSERT INTO "{table}" ({cols}) VALUES ({qs})',
                     list(vals.values()))
    return cur.lastrowid


def upd(table, row_id, **vals):
    sets = ", ".join(f'"{k}" = ?' for k in vals)
    db.execute(f'UPDATE "{table}" SET {sets} WHERE id = ?',
               [*vals.values(), row_id])


def scalar(sql, params=()):
    row = db.execute(sql, params).fetchone()
    return None if row is None else row[0]


# Round 20's additive columns, in case this runs against a fixture from
# before them. initDatabase does the same on open; this keeps the file
# usable by the Python side too.
for table, column, sql_type in [("act", "start_scene_id", "INTEGER"),
                                ("sequence", "start_scene_id", "INTEGER"),
                                ("shot", "story_beat_id", "INTEGER"),
                                ("character_relationship", "directionality",
                                 "TEXT")]:
    have = [c["name"] for c in db.execute(f'PRAGMA table_info("{table}")')]
    if column not in have:
        db.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {sql_type}')
db.execute("UPDATE character_relationship SET directionality = 'mutual' "
           "WHERE directionality IS NULL")

# Scene ids by scene_number, so the script reads in story terms.
S = {r["scene_number"]: r["id"]
     for r in db.execute("SELECT id, scene_number FROM scene")}
ELEANOR, MARCUS = 1, 2
KITCHEN, CREEK, PORCH = 1, 2, 3
PINNED = S[12]          # the scene the conformance suites assert on

# ---------------------------------------------------------------------
# 1. Voss -> Cade, everywhere it appears
# ---------------------------------------------------------------------
for table in [r["name"] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")]:
    try:
        cols = [c["name"] for c in db.execute(f'PRAGMA table_info("{table}")')
                if c["type"].upper().startswith("TEXT")]
    except sqlite3.Error:
        continue
    for col in cols:
        db.execute(
            f'UPDATE "{table}" SET "{col}" = REPLACE("{col}", ?, ?) '
            f'WHERE "{col}" LIKE ?', ("Voss", "Cade", "%Voss%"))

# ---------------------------------------------------------------------
# 2. The people
# ---------------------------------------------------------------------
upd("character", ELEANOR,
    archetype="the keeper of the house",
    gender="female", pronouns="she/her",
    occupation="Homesteader; midwife to the valley",
    summary="Sixty-one, widowed, running the Cade homestead alone since "
            "her daughter drowned. Competence is how she holds grief at "
            "arm's length.",
    backstory="Came west at nineteen. Buried a husband at forty-two and "
              "a daughter at fifty-four. Has not left the valley since.",
    motivation="To keep the place standing, and to not have to say aloud "
               "what she believes about the day Ada died.",
    flaw="Mistakes silence for mercy — to others and to herself.",
    internal_goal="To stop blaming her son without having to forgive him.",
    external_goal="Get the homestead through the winter.",
    greatest_fear="That saying it aloud makes it true forever.",
    core_belief="Work is what love looks like when you can't speak.",
    arc_description="From a woman who answers questions with tasks to a "
                    "woman who says the thing and lets it cost her.",
    skills_abilities="Midwifery, horse handling, reading weather")
upd("character", MARCUS,
    archetype="the returning prodigal",
    gender="male", pronouns="he/him",
    occupation="Railroad surveyor",
    summary="Thirty-four, back after seven years without warning. Carries "
            "his sister's locket and the reason he left.",
    backstory="Was at the creek the day Ada drowned and has never told "
              "anyone. Left within the month; sent money, never letters.",
    motivation="To be told he is not what he believes he is.",
    flaw="Confesses only when cornered, then calls it honesty.",
    internal_goal="Absolution he cannot ask for directly.",
    external_goal="Winter over at the homestead and mend what he can.",
    greatest_fear="That his mother already knows.",
    core_belief="A debt can be worked off if you work hard enough.",
    arc_description="From a man performing ease to a man who says the "
                    "true sentence and survives the silence after it.")

ADA = ins("character", name="Ada Cade", role="minor",
          archetype="the absent daughter", age="19 at her death",
          gender="female", pronouns="she/her",
          casting_status="tbd", lifecycle_status="active",
          summary="Drowned at the creek crossing seven years before the "
                  "story opens. Present in the film only as objects: a "
                  "shawl, a locket, a chime by the door.",
          core_belief="Never appears on screen; every design decision "
                      "about her is an absence decision.")
SHAW = ins("character", name="Reverend Shaw", role="supporting",
           archetype="the well-meaning bystander", age="58",
           gender="male", pronouns="he/him", casting_status="tbd",
           lifecycle_status="active",
           occupation="Minister, Hollow Creek church",
           summary="Buried Ada. Believes grief is a thing you can be "
                   "walked through on a schedule.",
           motivation="To get Eleanor back into the congregation.",
           flaw="Comfort delivered as instruction.")

# A cast has more than one relationship in it. These are safe to add now
# that the suites order their lookup and directionality is declared.
ins("character_relationship", name="Eleanor & Ada",
    character_a_id=ELEANOR, character_b_id=ADA, relationship_type="family",
    directionality="a_to_b", specific_relationship="mother and daughter",
    emotional_valence="complex", power_dynamic="none — memory only",
    history="Nineteen years, ended at the creek.",
    current_status="Unspoken. Eleanor keeps her chair at the table.",
    lifecycle_status="active")
ins("character_relationship", name="Marcus & Ada",
    character_a_id=MARCUS, character_b_id=ADA, relationship_type="family",
    directionality="a_to_b", specific_relationship="brother and sister",
    emotional_valence="complex",
    history="He was meant to be watching her.",
    current_status="The locket he has not been able to put down.",
    lifecycle_status="active")
ins("character_relationship", name="Eleanor & Shaw",
    character_a_id=ELEANOR, character_b_id=SHAW,
    relationship_type="colleague", directionality="mutual",
    specific_relationship="parishioner and minister, lapsed",
    emotional_valence="neutral",
    current_status="He calls; she is always busy.",
    lifecycle_status="active")

# Voice and body, filled out. Eleanor's timbre is asserted — untouched.
upd("vocal_profile", 1,
    voice_quality="Low and unhurried; the voice of someone used to being "
                  "obeyed by animals",
    volume_tendency="soft", breathiness_level="slight",
    rhythm="halting", fluency="filled pauses",
    accent="Flat inland Oregon", class_markers="Plain, unornamented",
    accent_authenticity="native", emotional_access="controlled",
    interruption_tendencies="Never interrupts; waits a beat too long",
    vocal_habits="Drops the ends of sentences she does not want to finish",
    speech_pattern="Answers a question with an instruction")
# Marcus's vocal profile is left THIN on purpose: the readiness suite
# asserts that Q05 warns about it. An authored gap is part of what this
# fixture demonstrates, so filling it in would delete the lesson.
upd("physical_character_profile", 1,
    center_of_gravity="low", movement_style="Economical; nothing wasted",
    movement_speed="deliberate", movement_fluidity="smooth",
    movement_economy="efficient", movement_weight="grounded",
    eye_contact_patterns="Meets eyes only when giving instructions",
    gaze_direction_tendencies="Looks at hands, doors, weather",
    spatial_presence="takes up space", physical_comfort="at home in body",
    physical_training_visible="Forty years of physical work",
    injuries_visible_in_movement="After sc 9, guards the left side")
upd("physical_character_profile", 2,
    posture="asymmetric", center_of_gravity="high", tension_level="variable",
    energy_quality="restless", movement_speed="quick",
    movement_fluidity="smooth", movement_economy="wasteful",
    movement_weight="light", resting_face="pleasant, alert",
    expressiveness_level="mobile",
    eye_contact_patterns="Holds too long, then breaks first",
    smile_authenticity="Reaches the mouth before the eyes",
    spatial_presence="minimizes self", physical_comfort="disconnected",
    emotional_manifestations=json.dumps({
        "guilt": {"face": "flickers at the word 'back'",
                  "body": "turns a quarter away"},
        "relief": {"body": "shoulders drop two inches"}}),
    physical_notes="Hands never idle: hat brim, coat button, the locket "
                   "through the cloth of a pocket")

# ---------------------------------------------------------------------
# 3. The world
# ---------------------------------------------------------------------
upd("location", KITCHEN, setting="The heart of the Cade homestead",
    time_period="1889", geography="Willamette foothills, Oregon",
    realization_status="built",
    key_features="Cast-iron stove; a long table with one chair nobody "
                 "uses; a door to the porch that never quite latches",
    notes="Eleanor's arena. She moves through it without looking.")
upd("location", CREEK, setting="The ford below the homestead",
    time_period="1889", geography="Willamette foothills, Oregon",
    realization_status="real_location",
    key_features="Shale bed, fast water after rain, a rope line strung "
                 "the spring after Ada died",
    notes="Where Ada drowned and where Eleanor is thrown. The film "
          "returns here three times and never says why.")
upd("location", PORCH, setting="The threshold of the house",
    time_period="1889", geography="Willamette foothills, Oregon",
    realization_status="built",
    key_features="Brass wind chime by the door; two boots by the step",
    notes="Every act begins or ends on this threshold.")
CHURCH = ins("location", name="Hollow Creek Church", location_type="interior",
             setting="Clapboard chapel, twenty pews", time_period="1889",
             geography="Willamette foothills, Oregon",
             realization_status="real_location",
             key_features="Cold light through plain glass; Ada's name on "
                          "a plaque nobody looks at",
             lifecycle_status="active")
FOREST = ins("location", name="Ridge Forest", location_type="exterior",
             setting="The timber above the homestead", time_period="1889",
             geography="Willamette foothills, Oregon",
             realization_status="plate_captured",
             key_features="Doug fir, no path, the sound of water always "
                          "somewhere below",
             lifecycle_status="active")
upd("scene", S[16], location_id=CHURCH)
upd("scene", S[21], location_id=FOREST)

ins("location_variant", name="Porch — dawn, after the storm",
    location_id=PORCH, is_baseline=0, time_of_day="dawn", weather="clearing",
    season="winter", post_event_state="Storm debris; the chime is down",
    physical_differences="Branch across the step; chime lying in the mud",
    lighting_differences="First flat light, no sun yet",
    emotional_shift="Exhaustion that has stopped being defensive",
    lifecycle_status="active")
ins("location_variant", name="Creek — winter flood",
    location_id=CREEK, is_baseline=0, time_of_day="midday",
    weather="rain-swollen", season="winter",
    post_event_state="Water a foot over the ford",
    physical_differences="Rope line taut, shale invisible",
    lighting_differences="Flat white overcast, no shadows",
    emotional_shift="The place stops being scenery and becomes a threat",
    lifecycle_status="active")

# ---------------------------------------------------------------------
# 4. Scenes: the fields the queries actually read
# ---------------------------------------------------------------------
SCENES = {
    1: dict(int_ext="exterior", summary="Marcus walks the last mile in. "
            "The house is smaller than he remembers.",
            purpose="Establish the distance he has to cross, literally.",
            tone="withheld", tension_level="low",
            emotional_beat="Anticipation with dread underneath",
            characters_present="Marcus", estimated_duration="1:40"),
    3: dict(int_ext="interior",
            purpose="Establish Eleanor's competence as armour, and the "
                    "door she does not close.",
            tone="held breath", tension_level="medium",
            emotional_beat="Recognition refused",
            characters_present="Eleanor, Marcus", estimated_duration="3:10",
            character_dynamics="She gives him tasks instead of answers."),
    7: dict(int_ext="exterior",
            purpose="Reveal Ada without exposition.",
            tone="cold, plain", tension_level="low",
            emotional_beat="The audience understands the silence",
            characters_present="Eleanor, Reverend Shaw",
            estimated_duration="2:00"),
    9: dict(int_ext="exterior",
            purpose="Force contact: he has to carry her.",
            tone="sudden, physical", tension_level="high",
            emotional_beat="Terror, then a touch neither can refuse",
            characters_present="Eleanor, Marcus", estimated_duration="2:30"),
    10: dict(int_ext="interior",
             purpose="Grief made visible as an object.",
             tone="quiet after violence", tension_level="medium",
             emotional_beat="Tenderness misfiled as practicality",
             characters_present="Eleanor", estimated_duration="1:20"),
    11: dict(int_ext="exterior",
             purpose="Plant the locket where the audience sees it move.",
             tone="furtive", tension_level="medium",
             emotional_beat="Dramatic irony arms itself",
             characters_present="Marcus", estimated_duration="0:50"),
    16: dict(int_ext="interior",
             purpose="An outside voice names the thing wrongly.",
             tone="well-meant, unbearable", tension_level="medium",
             emotional_beat="Eleanor's refusal hardens",
             characters_present="Eleanor, Reverend Shaw",
             estimated_duration="2:10"),
    19: dict(int_ext="interior",
             purpose="The confession, and the locket revealed.",
             tone="rupture", tension_level="high",
             emotional_beat="The worst thing said aloud",
             characters_present="Eleanor, Marcus", estimated_duration="4:20"),
    21: dict(int_ext="exterior",
             purpose="Action as penance; he goes out into it.",
             tone="chaotic", tension_level="high",
             emotional_beat="Fear for him, which is forgiveness starting",
             characters_present="Marcus", estimated_duration="3:00"),
    24: dict(int_ext="exterior",
             purpose="The door, open, chosen this time.",
             tone="earned quiet", tension_level="low",
             emotional_beat="Release",
             characters_present="Eleanor, Marcus", estimated_duration="1:30"),
}
for number, vals in SCENES.items():
    upd("scene", S[number], **vals)
upd("scene", S[16], name="INT. HOLLOW CREEK CHURCH - DAY")
upd("scene", S[21], name="EXT. RIDGE FOREST - NIGHT (STORM)")

# Scene 12 keeps its asserted content; only the unasserted framing fields.
upd("scene", PINNED, int_ext="interior", tone="held breath",
    tension_level="high", characters_present="Eleanor, Marcus",
    estimated_duration="3:40")

for row in db.execute("SELECT id, scene_id, character_id "
                      "FROM scene_character"):
    lead = row["character_id"] in (ELEANOR, MARCUS)
    upd("scene_character", row["id"],
        role_in_scene="featured" if lead else "supporting")
for scene_number, character, role in [
        (1, MARCUS, "featured"), (7, ELEANOR, "featured"),
        (7, SHAW, "supporting"), (16, ELEANOR, "featured"),
        (16, SHAW, "featured"), (21, MARCUS, "featured"),
        (3, ADA, "mentioned"), (19, ADA, "mentioned")]:
    exists = scalar("SELECT id FROM scene_character WHERE scene_id=? "
                    "AND character_id=?", (S[scene_number], character))
    if exists is None:
        ins("scene_character", scene_id=S[scene_number],
            character_id=character, role_in_scene=role)

# ---------------------------------------------------------------------
# 5. Structure: boundaries, and the sections that declare them
# ---------------------------------------------------------------------
upd("act", 1, start_scene_id=S[1], act_number=1,
    function="Establish the silence and what it costs to keep it.",
    dramatic_question="Will she let him back in the house?",
    shift="From a closed house to a door left ajar.",
    summary="Marcus returns unannounced; Eleanor absorbs him into the "
            "work of the day rather than acknowledge him.")
upd("act", 2, start_scene_id=S[9], act_number=2,
    function="Force proximity until speech becomes possible.",
    dramatic_question="Can they be in the same room without the truth?",
    shift="From arm's length to a thaw neither will name.",
    summary="The accident at the crossing puts her in his arms; the "
            "locket moves from saddlebag to pocket.")
upd("act", 3, start_scene_id=S[19], act_number=3,
    function="Say it, survive it, choose each other after.",
    dramatic_question="Is forgiveness possible once it is deserved?",
    shift="From rupture to an embrace at an open door.",
    summary="Marcus confesses. The storm takes the horses and he goes "
            "after them; she is afraid for him, which is the answer.")

upd("sequence", 1, name="The Reckoning", start_scene_id=S[12], act_id=2,
    goal="Get through one evening in the same room.",
    conflict="Neither will speak first; the storm keeps them there.",
    outcome="Eleanor speaks first — 'You came back.'",
    turning_point="The kettle set down.",
    purpose="The film's held breath.")
upd("sequence", 2, name="The Storm", start_scene_id=S[21], act_id=3,
    goal="Bring the horses in before the ridge floods.",
    conflict="The weather, and what he is trying to work off.",
    outcome="He comes back down at dawn with two of the three.",
    turning_point="She is waiting on the porch.",
    purpose="Penance as action.")
SEQ_RETURN = ins("sequence", name="The Return", start_scene_id=S[1],
                 act_id=1, status="outline", lifecycle_status="active",
                 goal="Cross the last mile and get through the door.",
                 conflict="Seven years of not writing.",
                 outcome="He is given a task instead of a welcome.",
                 turning_point="The door left ajar behind him.",
                 purpose="Establish the distance.")
SEQ_THAW = ins("sequence", name="The Thaw", start_scene_id=S[9], act_id=2,
               status="outline", lifecycle_status="active",
               goal="Survive the crossing.",
               conflict="Her body fails at the worst moment.",
               outcome="He carries her home; the shawl comes out.",
               turning_point="The touch neither can refuse.",
               purpose="Force contact.")
SEQ_DOOR = ins("sequence", name="The Open Door", start_scene_id=S[24],
               act_id=3, status="outline", lifecycle_status="active",
               goal="Say the thing that has no task attached to it.",
               conflict="Habit.",
               outcome="The embrace.",
               turning_point="She does not go inside first.",
               purpose="Release.")
db.commit()
