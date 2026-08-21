#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
Part 3: the detail the canonical queries actually read.

Scene 12 is deliberately skipped almost everywhere — the conformance
suites assert its motif manifest, its single sound cue, its costume set
and its direction chains exactly, so anything added there is a broken
test rather than a richer demo.
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
    return db.execute(f'INSERT INTO "{table}" ({cols}) VALUES ({qs})',
                      list(vals.values())).lastrowid


def upd(table, row_id, **vals):
    sets = ", ".join(f'"{k}" = ?' for k in vals)
    db.execute(f'UPDATE "{table}" SET {sets} WHERE id = ?',
               [*vals.values(), row_id])


S = {r["scene_number"]: r["id"]
     for r in db.execute("SELECT id, scene_number FROM scene")}
ELEANOR, MARCUS = 1, 2
ADA = db.execute("SELECT id FROM character WHERE name LIKE '%Ada%'"
                 ).fetchone()["id"]
SHAW = db.execute("SELECT id FROM character WHERE name LIKE '%Shaw%'"
                  ).fetchone()["id"]
KITCHEN, CREEK, PORCH = 1, 2, 3
LOCKET, KETTLE = 1, 2
THEME = 1
DOORS, CHIME, UNFINISHED, LOCKET_MOTIF = 1, 2, 3, 4

# --- props ------------------------------------------------------------
upd("prop", LOCKET, prop_type="hand prop", story_function="macguffin",
    narrative_significance="The object that carries the confession. It "
                           "moves three times and is only spoken about "
                           "once.",
    symbolism="What Marcus took from the creek and could not put down.",
    first_appearance="sc 11, saddlebag", realization_status="sourced",
    key_moments="sc 11 pocketed · sc 19 on the table")
upd("prop", KETTLE, prop_type="hand prop", story_function="character "
    "extension", narrative_significance="Eleanor's answer to every "
    "question she will not take.",
    symbolism="Work as a way of not speaking.",
    realization_status="sourced", first_appearance="sc 3")
CHIME_PROP = ins("prop", name="Brass wind chime", prop_type="set dressing",
                 story_function="symbol", realization_status="built",
                 description="Ada hung it by the porch door the spring "
                             "before she died. Irregular, slightly flat.",
                 symbolism="Ada's presence in the house.",
                 narrative_significance="Sounds when a door opens. Down "
                                        "in the mud by sc 24.",
                 first_appearance="sc 3", lifecycle_status="active")
LAMP = ins("prop", name="Oil lamp", prop_type="hand prop",
           story_function="atmosphere", realization_status="sourced",
           description="The kitchen's only light after dark.",
           narrative_significance="Carried up the ridge in sc 21.",
           lifecycle_status="active")
CHAIR = ins("prop", name="Ada's chair", prop_type="set dressing",
            story_function="symbol", realization_status="built",
            description="The fourth chair at a table for three.",
            symbolism="The place still set.", associated_character_id=ADA,
            lifecycle_status="active")

for scene_number, prop_id, significance, note in [
        (3, KETTLE, "key", "She fills it rather than answer him."),
        (3, CHAIR, "background", "Nobody sits in it; nobody says so."),
        (3, CHIME_PROP, "present", "Sounds once as the door swings."),
        (10, CHAIR, "background", "In frame behind the shawl."),
        (11, LOCKET, "key", "Saddlebag to coat pocket."),
        (16, CHIME_PROP, "mentioned", "Shaw remarks on it; she doesn't."),
        (19, LAMP, "present", "The only light on the confession."),
        (21, LAMP, "key", "Carried up the ridge."),
        (24, CHIME_PROP, "key", "Down in the mud, still sounding."),
]:
    ins("scene_prop", scene_id=S[scene_number], prop_id=prop_id,
        significance=significance, usage_note=note)

for scene_number, prop_id, whereabouts, condition, custody in [
        (3, KETTLE, "stove", "hot", ELEANOR),
        (3, CHIME_PROP, "porch door frame", "hung", None),
        (21, LAMP, "carried, ridge", "guttering in rain", MARCUS),
        (24, CHIME_PROP, "in the mud below the step", "cord snapped", None),
]:
    ins("prop_state", prop_id=prop_id, scene_id=S[scene_number],
        whereabouts=whereabouts, condition=condition,
        custody_character_id=custody, lifecycle_status="active")

# --- costume ----------------------------------------------------------
upd("costume", 1, description="Grey wool work dress, sleeves pushed back.",
    silhouette="Straight, unfitted", key_garments="Dress, apron",
    primary_color_name="ash grey", primary_color_hex="#6E6B64",
    fabrics="Wool, cotton apron", texture_qualities="Coarse, softened by "
    "washing", what_reveals="That she has not stopped working since 1882",
    social_signals="Widow who does not dress like one",
    continuity_notes="Creek-soaked from sc 9; dried and stiff after")
upd("costume", 2, silhouette="Draped, too fine for the dress",
    primary_color_name="faded indigo", primary_color_hex="#3F4C63",
    fabrics="Fine knitted wool", what_reveals="That she kept it",
    emotional_state_reflected="Grief handled as a garment",
    continuity_notes="Off the hook from sc 10 onward")
COAT = ins("costume", name="Travelling coat", character_id=MARCUS,
           description="City coat, wrong for the valley.",
           silhouette="Long, fitted", key_garments="Coat, waistcoat",
           primary_color_name="bark brown", primary_color_hex="#4A3B2E",
           fabrics="Worsted wool", condition="worn",
           what_reveals="Seven years of somewhere else",
           social_signals="Money, or the appearance of it",
           continuity_notes="The locket lives in the right pocket from "
                            "sc 11",
           lifecycle_status="active")
SHIRT = ins("costume", name="Work shirt", character_id=MARCUS,
            description="Borrowed from a hook in the porch.",
            silhouette="Loose", primary_color_name="unbleached",
            condition="worn", what_reveals="He has started doing the work",
            emotional_state_reflected="Belonging attempted",
            lifecycle_status="active")
BLACKS = ins("costume", name="Minister's blacks", character_id=SHAW,
             silhouette="Buttoned", primary_color_name="black",
             condition="new", social_signals="Authority, gently worn",
             lifecycle_status="active")
for costume_id, scene_number, condition in [
        (1, S[3], "dry"), (1, S[1], None), (COAT, S[1], "road dust"),
        (COAT, S[3], "road dust"), (COAT, S[11], "buttoned"),
        (SHIRT, S[19], "worn in"), (SHIRT, S[21], "soaked"),
        (SHIRT, S[24], "soaked, drying"), (BLACKS, S[7], None),
        (BLACKS, S[16], None), (2, S[19], None), (2, S[24], "damp")]:
    ins("costume_scene", costume_id=costume_id, scene_id=scene_number,
        condition_in_scene=condition)

# --- motifs -----------------------------------------------------------
for motif_id, scene_number, domain, entity_type, entity_id, note in [
        (DOORS, 3, "visual", "scene", S[3],
         "She leaves it ajar behind him without deciding to."),
        (DOORS, 10, "visual", "scene", S[10],
         "Closed, for the only time in the film."),
        (DOORS, 19, "visual", "scene", S[19], "Wide open; nobody notices."),
        (DOORS, 24, "visual", "scene", S[24],
         "Open behind the embrace — the last image."),
        (CHIME, 3, "sonic", None, None, "One note as he steps through."),
        (CHIME, 16, "sonic", None, None,
         "Absent: the church has a bell instead."),
        (CHIME, 21, "sonic", None, None, "Torn loose in the storm."),
        (CHIME, 24, "sonic", None, None, "Sounding from the mud."),
        (UNFINISHED, 3, "dialogue", None, None,
         "'I didn't know you were —' and then the bucket."),
        (UNFINISHED, 19, "dialogue", None, None,
         "The one sentence he finishes."),
        (LOCKET_MOTIF, 11, "visual", "prop", LOCKET,
         "Moved, not shown to anyone."),
        (LOCKET_MOTIF, 24, "visual", "prop", LOCKET,
         "Left on the table, behind them."),
]:
    ins("motif_appearance", motif_id=motif_id, scene_id=S[scene_number],
        domain=domain, entity_type=entity_type, entity_id=entity_id,
        manifestation_notes=note)

for motif_id, scene_number, stage, subtlety, shift in [
        # No doors state before sc 12: motifStateAt(doors, sc3) is
        # asserted null, and latest-wins would carry an earlier row
        # forward over the one the suite expects at 12.
        (DOORS, 19, "Now unmistakably a choice.", "noticeable",
         "The audience has learned to watch the door."),
        (DOORS, 24, "Stated by the image alone.", "obvious",
         "Forgiveness, held open."),
        (CHIME, 24, "Broken and still sounding.", "noticeable",
         "Ada is not gone because the object failed."),
]:
    ins("motif_state", motif_id=motif_id, scene_id=S[scene_number],
        stage_description=stage, subtlety_level=subtlety,
        meaning_shift=shift, lifecycle_status="active")

# --- theme, subtext, audience ----------------------------------------
# Q10 counts a character-level connection against every scene that
# character appears in, and its whole point is to show where a theme
# goes dark. Eleanor is in nearly every scene, so tagging HER would
# leave no gap anywhere and the accounting would say nothing. Marcus
# and Ada carry the theme instead, and it goes quiet at sc 16 — the
# scene where someone else offers the wrong kind of forgiveness.
for entity_type, entity_id, nature, subtlety, perception in [
        ("character", MARCUS, "explores", "clear", "must recognize"),
        ("character", ADA, "represents", "subtle",
         "reward for careful viewing"),
        ("prop", LOCKET, "represents", "clear", "must recognize"),
        ("scene", S[19], "challenges", "on-the-nose", "must recognize"),
        ("scene", S[24], "resolves", "subtle", "enhances if recognized"),
        ("motif", DOORS, "represents", "subtle",
         "reward for careful viewing"),
]:
    # A link's natural key is the rows it joins, and the fixture already
    # ships four of these — adding a second row for the same pair splits
    # the connection's authored content between them. (Found by
    # duplicateJunctions after this script had already shipped once.)
    if db.execute("SELECT id FROM thematic_connection WHERE theme_id=? "
                  "AND entity_type=? AND entity_id=?",
                  (THEME, entity_type, entity_id)).fetchone() is not None:
        continue
    ins("thematic_connection", theme_id=THEME, entity_type=entity_type,
        entity_id=entity_id, nature_of_connection=nature,
        subtlety_level=subtlety, intended_perception=perception,
        lifecycle_status="active")

for scene_number, surface, under, gap, awareness, purpose in [
        (3, "Where do you want the water?",
         "Do not make me ask why you came.", "large", "mixed",
         "character revelation"),
        (16, "Thank you, Reverend.",
         "You have no idea what you are asking me to forgive.",
         "large", "aware", "dramatic irony"),
        (19, "I was at the creek.",
         "I have been carrying this for seven years and I am putting it "
         "down whatever it costs.", "small", "aware",
         "emotional complexity"),
        (24, "You'll want breakfast.",
         "Stay.", "large", "mixed", "thematic depth"),
]:
    ins("subtext", scene_id=S[scene_number], surface_level=surface,
        subtext_level=under, gap_size=gap, character_awareness=awareness,
        audience_access="first viewing", purpose=purpose,
        lifecycle_status="active")

for scene_number, primary, intensity, function, relationship in [
        (1, "anticipation", "moderate", "setup", "observation"),
        (3, "held breath", "moderate", "build", "empathy"),
        (9, "fear", "high", "shift", "empathy"),
        (19, "devastation", "high", "release", "sympathy"),
        (21, "dread", "high", "build", "empathy"),
        (24, "relief", "moderate", "release", "empathy"),
]:
    ins("scene_emotional_target", scene_id=S[scene_number],
        primary_emotion=primary, primary_intensity=intensity,
        emotional_function=function,
        audience_character_relationship=relationship,
        lifecycle_status="active")

for scene_number, asymmetry, withheld, position in [
        (3, "mystery", "Why he left, and why she has not asked.",
         "with characters"),
        (11, "dramatic irony", "The locket's meaning.",
         "ahead of characters"),
        (19, "shifting", "Nothing — this is the scene that pays it out.",
         "with characters"),
]:
    ins("information_strategy", scene_id=S[scene_number],
        knowledge_asymmetry=asymmetry, information_withheld=withheld,
        audience_position=position, lifecycle_status="active")

for scene_number, primary, secondary, position, technique in [
        (1, MARCUS, None, "with character", "Single POV, no cutaways."),
        (9, ELEANOR, MARCUS, "with character",
         "Handheld inside her panic; his rescue seen from her level."),
        (19, MARCUS, ELEANOR, "observing character",
         "The confession played in one unbroken close-up."),
        (24, ELEANOR, MARCUS, "with character", "She sees him first."),
]:
    ins("identification_strategy", scene_id=S[scene_number],
        primary_character_id=primary, secondary_character_id=secondary,
        audience_position=position, identification_technique=technique,
        lifecycle_status="active")

ARC = db.execute("SELECT id FROM emotional_arc").fetchone()["id"]
for order, (scene_number, emotion, intensity, trigger) in enumerate([
        (1, "anticipation", "moderate", "The house comes into view."),
        (3, "unease", "moderate", "She hands him a bucket."),
        (9, "terror", "high", "The water takes her."),
        (19, "devastation", "high", "'I was at the creek.'"),
        (21, "dread", "high", "He goes up the ridge."),
        (24, "release", "moderate", "Neither goes inside.")], start=2):
    ins("emotional_beat", emotional_arc_id=ARC, scene_id=S[scene_number],
        beat_order=order, target_emotion=emotion, intensity=intensity,
        beat_trigger=trigger, lifecycle_status="active")

# --- performance ------------------------------------------------------
for scene_number, character, order, modality, vals in [
        (3, ELEANOR, 1, "physical",
         dict(physical_action="Fills the kettle without turning round.",
              description="Her back is the whole performance.",
              visibility="clearly seen")),
        (3, MARCUS, 2, "vocal",
         dict(line_text="I didn't know you were —",
              emphasis_words=json.dumps(["know"]), pace="fast",
              volume="soft", delivery_notes="Trails off; she doesn't help.")),
        (9, ELEANOR, 1, "physical",
         dict(physical_action="Reaches for the rope line and misses.",
              body_part_focus="hands", visibility="clearly seen")),
        (19, MARCUS, 1, "vocal",
         dict(line_text="I was at the creek.",
              emphasis_words=json.dumps(["was"]), pace="slow",
              volume="soft",
              emotional_subtext="Relief disguised as confession.")),
        (19, ELEANOR, 2, "facial",
         dict(description="Nothing moves. That is the choice.",
              visibility="subtle", trigger="the word 'creek'")),
        (19, ELEANOR, 3, "physical",
         dict(physical_action="Puts both hands flat on the table.",
              visibility="clearly seen")),
        (21, MARCUS, 1, "physical",
         dict(physical_action="Takes the lamp and does not look back.",
              visibility="clearly seen")),
        (24, ELEANOR, 1, "vocal",
         dict(line_text="You'll want breakfast.",
              emphasis_words=json.dumps(["breakfast"]), pace="measured",
              volume="soft",
              emotional_subtext="Played: practicality. Underneath: stay.")),
        (24, MARCUS, 2, "facial",
         dict(description="He hears the other sentence and lets it land.",
              visibility="subtle")),
]:
    ins("performance_beat", scene_id=S[scene_number], character_id=character,
        beat_order=order, modality=modality, lifecycle_status="active",
        name=f"{modality}-{scene_number}-{order}", **vals)

# Eleanor's states are asserted through sc 12 — hers start after.
ins("performance_state", name="storm-cold", character_id=MARCUS,
    scene_id=S[21], modality="physical", persistence="until_resolved",
    resolved_at_scene_id=S[24],
    state_description="Soaked through and shaking by the ridge.",
    modulations=json.dumps({"movement": "stiff", "tension": "clenched"}),
    lifecycle_status="active")
ins("performance_state", name="wrung-out", character_id=ELEANOR,
    scene_id=S[19], modality="vocal", persistence="scene_only",
    state_description="Voice gone thin after the confession.",
    modulations=json.dumps({"volume": "quieter"}),
    emotional_coloring="hollowed", lifecycle_status="active")

ins("physical_habit", name="Doorframe touch", character_id=ELEANOR,
    description="Touches the doorframe entering any room.",
    body_parts_involved="right hand", frequency="constant",
    meaning="Checking the house is still standing.",
    character_awareness="unaware", lifecycle_status="active")
ins("physical_habit", name="Pocket check", character_id=MARCUS,
    description="Presses the coat pocket flat through the cloth.",
    body_parts_involved="left hand", habit_trigger="any mention of Ada",
    frequency="frequent", meaning="The locket, and whether it shows.",
    character_awareness="sometimes aware", lifecycle_status="active")

ins("character_environment_physicality", name="Marcus in the kitchen",
    character_id=MARCUS, location_id=KITCHEN, comfort_level="alert",
    interaction_pattern="Waits to be told where to sit; stands too long.",
    spatial_use="Keeps the table between them.",
    object_interaction="Handles things and puts them back wrong.",
    lifecycle_status="active")
ins("character_environment_physicality", name="Eleanor at the creek",
    character_id=ELEANOR, location_id=CREEK, comfort_level="uncomfortable",
    interaction_pattern="Crosses fast and does not look at the water.",
    lifecycle_status="active")

# --- staging, look, sound --------------------------------------------
for scene_number, concept, geography, proxemics, camera in [
        (3, "She never crosses to him; he crosses to her twice.",
         "Stove upstage, table centre, door behind him.",
         "Never closer than the table's width until the bucket.",
         "Camera stays on her side of the room."),
        (19, "The table becomes the creek: neither crosses it.",
         "Both seated, locket between them by the end.",
         "Fixed distance for the whole scene.",
         "Two close-ups, no two-shot until the locket lands."),
        (24, "The first scene in which they occupy the same space.",
         "Porch step, door open behind.",
         "Contact.", "One slow push, no cuts."),
]:
    blocking = ins("scene_blocking", name=f"sc {scene_number} blocking",
                   scene_id=S[scene_number], staging_concept=concept,
                   character_geography=geography, proxemics=proxemics,
                   camera_relationship=camera, lifecycle_status="active")
    for order, description in enumerate([
            "Positions established.", "The move that costs something.",
            "New positions held to the end."], start=1):
        ins("staging_beat", scene_blocking_id=blocking, beat_order=order,
            description=description, lifecycle_status="active")

for scene_number, style, mood, key_source, quality in [
        (1, "naturalistic", "Flat winter overcast; no hero light.",
         "Sky", "soft"),
        (9, "naturalistic", "White water glare, no shadow to hide in.",
         "Overcast sky", "soft"),
        (19, "chiaroscuro", "One lamp, everything else given up.",
         "Practical oil lamp on the table", "hard"),
        (21, "stylized", "Lantern and lightning; darkness as weather.",
         "Carried lamp", "hard"),
        (24, "naturalistic", "First light, no colour in it yet.",
         "Dawn sky", "soft"),
]:
    ins("lighting_design", name=f"sc {scene_number} lighting",
        scene_id=S[scene_number], lighting_style=style, overall_mood=mood,
        key_source=key_source, key_quality=quality, light_quality=quality,
        lifecycle_status="active")

for scene_number, temperature, colors, intent in [
        (1, "cool", "slate, bark, bone", "Distance."),
        (9, "cool", "white water, wet shale", "Shock; colour drains."),
        (19, "warm", "lamp amber against black", "Confession as heat."),
        (21, "cool", "blue-black, lantern gold", "One warm point in it."),
        (24, "transitional", "grey warming to straw", "Release."),
]:
    ins("color_script_entry", name=f"sc {scene_number}",
        scene_id=S[scene_number], temperature=temperature,
        key_colors=colors, emotional_intent=intent,
        lifecycle_status="active")

for scene_number, sound_type, description, function in [
        (1, "ambient", "Wind in high timber; boots on frozen ruts.",
         "Distance and cold."),
        (3, "foley", "The chime, once, as the door swings.",
         "Ada, unannounced."),
        (9, "effect", "Water over shale, then the fall — sound drops out.",
         "Subjective shock."),
        (10, "ambient", "House settling; nothing else.", "Aloneness."),
        (19, "ambient", "Lamp hiss under the whole scene.",
         "The room holding still."),
        (21, "design", "Storm as pressure, not noise.", "Dread."),
        (24, "foley", "The broken chime sounding from the mud.",
         "Ada, present, unresolved."),
]:
    ins("sound_cue", name=f"sc {scene_number} — {sound_type}",
        scene_id=S[scene_number], sound_type=sound_type,
        description=description, emotional_function=function,
        lifecycle_status="active")

for scene_number, perspective, pov, logic in [
        (9, "subjective", ELEANOR,
         "Underwater dulling; her hearing, not the room's."),
        (19, "objective", None, "Nothing favours either of them."),
        (21, "subjective", MARCUS, "Inside the coat, inside the weather."),
]:
    ins("sound_perspective", name=f"sc {scene_number} perspective",
        scene_id=S[scene_number], perspective_type=perspective,
        pov_character_id=pov, psychological_logic=logic,
        lifecycle_status="active")

for scene_number, rhythm, pauses, silence in [
        (3, "staccato", "She answers before he finishes.",
         "Two long ones; both hers."),
        (19, "legato", "He is allowed to finish for the first time.",
         "The silence after is the longest in the film."),
        (24, "varying", "Neither hurries.", "Comfortable."),
]:
    ins("dialogue_rhythm", name=f"sc {scene_number} rhythm",
        scene_id=S[scene_number], overall_rhythm=rhythm,
        pause_pattern=pauses, silence_pattern=silence,
        lifecycle_status="active")

for scene_number, descriptor, intensity, mood in [
        (1, "withheld", "moderate", "Cold open, no score."),
        (9, "sudden", "heavy", "Violence without villain."),
        (19, "rupture", "heavy", "Everything paid out at once."),
        (24, "earned quiet", "light", "Warmth with the cost still visible."),
]:
    ins("tone_marker", name=f"sc {scene_number} tone",
        scene_id=S[scene_number], tone_descriptor=descriptor,
        intensity=intensity, mood_atmosphere=mood,
        lifecycle_status="active")

# Composition notes on a few of the new shots.
for number, composition, depth, focus in [
        ("19B", "centered", "shallow",
         "Held on his eyes; the locket out of focus in the foreground."),
        ("24C", "asymmetric", "deep",
         "The open door sharp behind them — the point of the frame."),
        ("9C", "dynamic", "shallow", "Nothing stable to hold on to."),
]:
    shot = db.execute("SELECT id FROM shot WHERE shot_number=?",
                      (number,)).fetchone()
    if shot is not None:
        ins("shot_design", name=f"{number} composition", shot_id=shot["id"],
            composition_type=composition, depth_of_field=depth,
            focus_strategy=focus, lifecycle_status="active")

# A second theme with deliberately narrow carriage. Q10's job is to show
# where a theme goes dark, and a theme carried by both leads is lit in
# every scene — true, but it demonstrates nothing. This one lives in
# three places and is absent from the rest, which is what the accounting
# is for.
WATER = ins("theme", name="What the water keeps",
            lifecycle_status="active")
for entity_type, entity_id, nature, subtlety, perception in [
        ("motif", LOCKET_MOTIF, "represents", "subtle",
         "reward for careful viewing"),
        ("scene", S[9], "explores", "clear", "must recognize"),
        ("scene", S[19], "resolves", "clear", "must recognize"),
]:
    ins("thematic_connection", theme_id=WATER, entity_type=entity_type,
        entity_id=entity_id, nature_of_connection=nature,
        subtlety_level=subtlety, intended_perception=perception,
        lifecycle_status="active")

# --- provenance -------------------------------------------------------
for name, decision_type, description, rationale, alternatives in [
        ("Ada is never shown", "narrative",
         "No flashbacks, no photographs of Ada's face.",
         "The locket's portrait is never shown to camera; the audience "
         "builds her out of other people's behaviour.",
         "A single flashback at the confession — cut: it explains what "
         "the silence already carries."),
        ("One lamp for the confession", "visual",
         "sc 19 lit by a single practical.",
         "The scene is about what can be said in the dark.",
         "Firelight — rejected as too warm for a rupture."),
        ("No score until sc 24", "audio",
         "Music enters only at the final scene.",
         "Silence is the film's grammar; scoring the grief would do the "
         "audience's work for them.",
         "A theme under sc 19 — tested and dropped."),
        ("Scene numbers are not sequential", "technical",
         "The demo keeps its original scene numbers with gaps.",
         "The conformance suites address scenes by number; renumbering "
         "would break every lookup in both implementations.",
         "Renumber 1..11 — rejected for that reason."),
]:
    ins("creative_decision", name=name, decision_type=decision_type,
        description=description, rationale=rationale,
        alternatives_considered=alternatives, decided_by="Direction",
        lifecycle_status="active")

# --- media ------------------------------------------------------------
# Assets carry a rooted IDENTIFIER (conventions §9).
kitchen_plate = ins("asset", name="kitchen_night_plate_v2.exr",
                    identifier="@project/assets/locations/"
                               "kitchen_night_plate_v2.exr",
                    description="Night interior plate, storm outside.",
                    tags="location,kitchen,night", source="Plate unit",
                    lifecycle_status="active")
locket_scan = ins("asset", name="locket_scan_v1.glb",
                  identifier="@project/assets/props/locket_scan_v1.glb",
                  description="Photogrammetry of the hero locket.",
                  tags="prop,locket", source="Art department",
                  lifecycle_status="active")
chime_rec = ins("asset", name="chime_hero_takes.wav",
                identifier="@project/assets/sound/chime_hero_takes.wav",
                description="Twelve takes of the practical chime.",
                tags="sound,chime", source="Sound design",
                lifecycle_status="active")
kitchen_bundle = ins("bundle", name="Farmhouse kitchen — night",
                     intent="visual_identity",
                     description="Reference for the kitchen after dark.",
                     coverage_summary="Plate, lighting stills, chime audio",
                     intended_consumers="Lighting, comp, sound",
                     provenance="Shot on location, Nov unit",
                     lifecycle_status="active")
for order, asset_id in enumerate([kitchen_plate, chime_rec], start=1):
    ins("bundle_asset", bundle_id=kitchen_bundle, asset_id=asset_id,
        order=order, role_in_bundle="reference")
ins("entity_anchor", name="Locket, canonical", subject_type="prop",
    subject_id=LOCKET, anchor_type="visual", asset_id=locket_scan,
    canonical_status="verified",
    condition_description="Hero condition, before the creek.",
    lifecycle_status="active")

db.commit()
