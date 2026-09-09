<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Rendering a `shot_context` payload into a Seedance 2.5 prompt

Not part of the format. Not read by `scf-mcp`. This is yours: how an
agent turns the JSON `shot_context` returns into text and a reference
list one specific video model accepts. When the model changes, this
file changes — `scf-core` and `scf-mcp` do not.

**Sources, last checked 2026-09:** the Seedance-specific facts below
(prompt formula, camera vocabulary, reference limits) are drawn from
third-party integration guides, not an Anthropic-verified spec, and two
of them disagree on hard numbers (resolution, duration cap) — see
"Length and technical limits" below. Re-check against whichever
provider you actually call (fal.ai, ByteDance direct, or another
aggregator) before trusting a number here in production:
[fal.ai's Seedance 2.5 prompting guide](https://fal.ai/learn/devs/seedance-2-5-prompting-guide),
[seedance.tv's prompt guide](https://www.seedance.tv/blog/seedance-2-5-prompt-guide).

---

## 1. Field mapping

`shot_context` returns six members (`spec/scf-mcp-design.md` §4). This
is what each becomes here.

| Payload | Feeds |
|---|---|
| `brief.result.layers` (`visual_identity`, `project_color_palette`, `cinematographic_philosophy`, `sonic_identity`, `technical_specs`) | Style/lighting vocabulary, aspect ratio, the film's standing rules — apply once, don't re-derive per shot |
| `scene.result.scene`, `.location`, `.screenplay` | The setting and the line(s), if any, this shot covers |
| `scene.result.cast` | Who can appear; cross-reference against `physical`/`media` by uuid |
| `look.result.layers` (leaf: `shot_design` when a shot was given) | Composition, depth of field, subject placement, color emphasis — the shot's own visual opinion, most-specific layer last |
| `physical[]` (one `Q06` per character in the scene) | Posture, movement quality, current modulation, any beat authored for this scene — write the *action*, not the profile prose verbatim |
| `media[]` (one `Q13` per subject × intent) | The reference list — see §3 |
| `readiness.result` | Gate before writing — see §4 |

**Gap worth knowing about:** the `shot` row's own scalar fields
(`camera_angle`, `camera_movement`, `lens_choice`, `shot_size`,
`duration_seconds`, `description`) are not in `shot_context` today — no
canonical query projects the `shot` table itself, only `shot_design`
(composition/DoF/placement) and `lighting_design`. Camera-movement intent
sometimes leaks into other fields' prose (a `lighting_design.key_source`
mentioning "push-in", a `staging_beat.camera_note`) but there is no
structured field for it yet. Until that's added to `scf-core`, treat any
camera-movement instruction you write as inferred, not sourced, and say
so if asked.

## 2. Seedance 2.5 prompt structure

The fullest documented template (fal.ai) — use only the sections a shot
actually needs; a short action doesn't need a timeline or continuity list:

```
FORMAT
[duration], [aspect ratio], [single take or cuts], [real-time or specified speed]

REFERENCE ROLES
@Image1 controls only [identity/wardrobe/environment] — do not copy [pose/lighting/camera angle]
@Video1 controls only [camera path/motion rhythm] — do not copy [subject/wardrobe/setting]

STARTING STATE
[positions, held objects, camera position, environment state]

TIMELINE
0-Xs: [first action]   Xs-Ys: [second]   Ys-Zs: [settling state]

CAMERA
[path, screen-space position, when movement starts/stops]

CONTINUITY
[identity, object, direction, clothing, geometry invariants]

AUDIO
[dialogue in quotes / room tone / contact sounds / music or silence]

ENDING STATE
[exact final position of character, objects, camera]

CONSTRAINTS
[no cuts / no slow motion / no repetition / no extra objects, text, logos]
```

A shorter formula from the same body of guides, fine for a simple shot:
**Subject + Action + Camera + Lighting + Style (+ Audio)**.

Lead with subject and action — Seedance weights the opening words most
heavily. Save style/lighting/atmosphere for after the subject is
anchored. One to three sentences is typical; specificity beats length.

## 3. Reference roles, from `media[]`

Each `media[]` entry is one `Q13` call: `{subjectKind, intent,
references[]}`, `references` ordered most-specific-first (the winning
asset is `references[0]`; the rest is bundle/anchor context). SCF's own
intents happen to line up with Seedance's reference-role grammar almost
exactly:

| SCF intent | Seedance role | Attach as |
|---|---|---|
| `visual_identity` | "controls only identity/wardrobe — do not copy pose/background/lighting/camera angle" | `@ImageN` |
| `motion` | "controls only camera path/performance/motion rhythm — do not copy subject/wardrobe/setting" | `@VideoN` |
| `voice_identity` | reference audio for the character's voice | `@AudioN` — **verify the parameter name against your actual endpoint**; none of the guides sourced above confirm it explicitly |

Build the list:

1. For each `media[]` entry, filter `references` to `state ===
   "resolved"` — that's the only state with actual bytes to attach.
   Everything else (`unaddressed`, `missing`, `unmaterialised`,
   `out-of-root`) is a real asset the film calls for that isn't
   reachable from here; **name it to the human, don't drop it silently**
   (`spec/scf-mcp-design.md` §5.1 — omitting an unresolved reference is a
   lie about what's true, not a simplification).
2. Within a `resolved` set, prefer `references[0]` (the opinion in
   force). Take one or two more only if they're genuinely
   complementary (e.g. a face anchor alongside a full turnaround) —
   more than two or three undifferentiated images for one identity
   role muddies rather than reinforces it.
3. Skip anything whose `format` isn't renderable as the target role
   (a `.zip` texture bundle isn't an `@Image`). Note it exists; don't
   attach it.
4. Number references in the order you attach them and use that number
   consistently in `REFERENCE ROLES` and everywhere else in the prompt
   — Seedance numbers `@Image1`/`@Video1`/`@Audio1` by upload order, and
   a caption pointing at the wrong number is worse than no caption.
5. Once a character has reference images, write "the character from
   the reference images" rather than re-describing their appearance in
   prose — that's what keeps identity stable shot to shot, and it's the
   same reason `shot_context` hands you the resolved image rather than
   a text description of it.

## 4. Readiness gate

`readiness.result` is `Q14` for `Q07` (this shot's own look) —
`spec/scf-mcp-design.md` §9 leaves the policy an open product decision;
this is the default this template takes, adjust if you want stricter or
looser:

- **`counts.blocker > 0`:** stop. Report the blocking findings instead
  of writing a prompt — a required layer (e.g. no `visual_identity`
  root at all) means there isn't yet a coherent answer to render.
- **`counts.warning > 0` or `counts.suggestion > 0`:** write the prompt
  anyway, but list what's thin alongside it (e.g. "Marcus Cade has no
  appearance profile — his look below is inferred from cast/costume
  notes, not a resolved identity reference"). Absence is a fact worth
  surfacing, not an error (`Q14`'s own framing) — but the person reading
  the prompt should still see it.

## 5. Camera vocabulary

Name both size and move; vague terms ("cinematic", "the camera
follows") give the model nothing to act on.

- **Size:** wide, medium-wide, medium, medium close-up, close-up, full-body
- **Move:** dolly/push in, dolly out/pull back, pan left/right, tilt
  up/down, orbit/arc, crane up/down, tracking/follow, handheld, static/locked-off
- Modify with **slow / smooth / fast**; state where the move starts and stops.
- One or two moves per shot. Three tends to visibly fight itself
  (guides converge on this specific point). Combine at most two with
  "+" or "while" — e.g. "slow push-in while camera holds level."

## 6. Length and technical limits

The guides researched disagree here — treat both as approximate, not
as the number to build validation against:

- **fal.ai:** 480p/720p, duration 4–30s (or `auto`), up to 30 images +
  10 video + 10 audio references (50 total), each video/audio
  reference 1.8–30.2s, combined reference duration per modality capped
  at 30.2s. Parameters named: `image_urls`, `video_urls`, `duration`,
  `generate_audio`.
- **seedance.tv:** native 4K/10-bit, single continuous 30-second
  output, up to 50 references total across images/audio/3D/style.

If you're integrating against a specific endpoint, replace this section
with that endpoint's actual documented limits — this file is meant to
be edited, not treated as ground truth once you know better.

## 7. Worked example — Hollow Creek, shot 12-04

Rendered from a real `shot_context(shotUuid)` call against
`fixtures/hollow_creek.scf` (`fixtures/expectations/Q00.result.json`,
`Q04.result.json`, `Q07.result.json`, `Q06.result.json`, `Q13.result.json`
are the same data, byte for byte).

The shot: Eleanor and Marcus, scene 12 (`INT. FARMHOUSE KITCHEN —
NIGHT`), storm outside, one oil lamp. `shot_design` places "Eleanor
left third; Marcus soft right background," shallow depth of field,
rule-of-thirds. `lighting_design`'s `key_source` for this shot reads
"oil lamp, closer wrap for the push-in" — the only camera-movement hint
available (see the gap noted in §1). Eleanor's `Q06` beat: "Sets the
kettle down slowly — the scene's held breath." `readiness` for `Q07`
came back with one warning (Marcus has no `character_appearance_profile`)
and zero blockers — proceed, but say so.

```
FORMAT
6s, 1.85:1, single take, real-time

REFERENCE ROLES
@Image1 controls only Eleanor's identity and costume — do not copy pose, lighting, or camera angle

STARTING STATE
Eleanor at a long wooden table, oil lamp between her and camera, kettle
in hand. Marcus soft-focus in the background, right of frame, coat
still on. Storm-blue window light behind him.

CAMERA
Slow push-in on Eleanor, closer wrap as the lamp fills more of the
frame; camera holds level, no pan. Starts wide-medium, settles
medium-close by the end of the move.

TIMELINE
0-4s: Eleanor sets the kettle down slowly, deliberate, economical movement.
4-6s: She goes still. Held breath — nothing moves but the lamp flame.

CONTINUITY
Eleanor's shawl stays around her shoulders throughout. Kettle remains
on the table once set down. Marcus does not enter frame.

AUDIO
Storm against the window, low and constant. The kettle's dull knock on
wood at 0-1s. No music (scene is scored tacet).

ENDING STATE
Eleanor still, hands on the table either side of the kettle, eyes on
Marcus offscreen. Lamp flame steady. Marcus unchanged in the background.

CONSTRAINTS
No cuts. No camera shake beyond the natural handheld-free push-in. No
text, logos, or objects not described above.
```

**Caveats to surface alongside this prompt** (from `readiness` and
`media`): Marcus has no appearance profile authored, so his background
presence above is inferred from cast notes, not a resolved reference.
Eleanor's `visual_identity`/`voice_identity`/`motion` bundle references
all came back `unaddressed` — this session had no `@project` root
configured (`rootMapped: false`), so `@Image1` above names an asset
(`eleanor_1204_lamplit_crop.png`) that exists in the film but could not
actually be attached; a real render needs `scf-mcp` started with
`--root project=<path>` first.
