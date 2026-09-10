<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Rendering a `shot_context` payload into a Seedance prompt

Not part of the format. Not read by `scf-mcp`. This is yours: how an
agent turns the JSON `shot_context` returns into text and a reference
list one specific video model accepts. When the model changes, this
file changes — `scf-core` and `scf-mcp` do not.

**Sources.** §2–§6 and §9's skeleton are a crafted, hands-on prompt
structure someone shared directly (`templates/Prompt-builder skill.md`)
— treat it as the authoritative shape, not the hedged one. §7's camera
vocabulary and §8's numeric limits are still drawn from third-party
integration guides (fal.ai, seedance.tv, last checked 2026-09), disagree
with each other on hard numbers, and should be re-checked against
whichever provider you actually call before trusting them in
production.

---

## 1. Field mapping

`shot_context` returns six members (`spec/scf-mcp-design.md` §4). This
is what each becomes in the skeleton below (§4).

| Payload | Feeds |
|---|---|
| `brief.result.layers` (`visual_identity`, `project_color_palette`, `cinematographic_philosophy`, `sonic_identity`, `technical_specs`) | The Style Prefix (§2) — write once per project, not per shot |
| `scene.result.scene`, `.location` | LOCATION |
| `scene.result.cast` | Who can appear in SUBJECT; cross-reference `physical`/`media` by uuid |
| `look.result.layers` (leaf: `shot_design` when a shot was given) | STYLE's per-shot 60:30:10 and lighting reinforcement — the shot's own visual opinion, most-specific layer last |
| `physical[]` (one `Q06` per character in the scene) | The beats inside ACTION/SHOT N — write the *action*, not the profile prose verbatim |
| `media[]` (one `Q13` per subject × intent) | The Asset Registry — see §3 |
| `readiness.result` | Gate before writing — see §7 |

**Gap worth knowing about:** the `shot` row's own scalar fields
(`camera_angle`, `camera_movement`, `lens_choice`, `shot_size`,
`duration_seconds`, `description`) are not in `shot_context` today — no
canonical query projects the `shot` table itself, only `shot_design`
(composition/DoF/placement) and `lighting_design`. Camera-movement
intent sometimes leaks into other fields' prose (a
`lighting_design.key_source` mentioning "push-in", a
`staging_beat.camera_note`) but there is no structured field for it
yet. Treat any camera-movement instruction you write as inferred, not
sourced, and say so if asked.

**Audio mismatch worth knowing about too:** this skeleton's Style
Prefix is fixed to `Environmental SFX only. No music. No subtitles` —
no dialogue. SCF's `media[]` still resolves a `voice_identity`
reference per character (Q05's domain), but nothing in §2–§6 uses it,
because this skill wasn't built for lip-synced dialogue. If a shot's
`scene.result.screenplay` carries dialogue for this beat, that's a real
gap between what the film calls for and what this prompt structure
produces — say so rather than silently dropping the lines, and override
the AUDIO line for that one prompt if you need spoken dialogue.

## 2. Global Style Prefix

Written once per project, prepended verbatim to every prompt:

```
Style: 8K cinematic. Photorealistic — no 3D render, no game engine, no game-cutscene aesthetic.
Cinematography: naturalistic master cinematography.
Lighting: Natural light only — contre-jour backlight, camera on shadow side, atmospheric haze. Key light from sky and windows only.
Color: 60:30:10 — dominant / secondary / accent.
Camera: Physical cine lens. 180° shutter motion blur.
Skin: Pore-level realism — vellus hair, asymmetric moles, capillary flush, pore-shadow matching on-set light.
Acting: top-tier cinematic — micro-pauses before reactions, precise eye-line, wet living eyes with catch-lights, visible breath and chest rise.
Physics: Gravity and inertia respected — mass has real weight, correct contact shadows. No floating props.
Composition: Rule of thirds + golden ratio. Every person moving from frame one.
Continuity: Characters, props, environment identical across every cut. No identity drift.
Technical: 24fps smooth motion. 8K detail. No jitter.
Audio: Environmental SFX only. No music. No subtitles.
```

If the project has its own visual/lighting philosophy authored
(`brief.result.layers` — `cinematographic_philosophy`,
`visual_identity`, `sonic_identity`), fold its specifics in rather than
using the prefix blind: `naturalistic` vs. `stylized`
`aesthetic_genre`, `movement_philosophy` ("motivated" vs. "kinetic"),
`silence_philosophy` all belong here, once, not re-derived per shot.

## 3. Asset Registry — `media[]` as `@tag`s

Every recurring person/prop/location gets one `@tag`; the tag must
match the Element name uploaded to Seedance exactly.

**Tag naming:** derive from the subject's own name field
(`scene.result.cast[].fields.name`, lowercased, spaces to hyphens —
`Eleanor Cade` → `@eleanor-cade`), not an invented role like `@hero`.
SCF doesn't encode "hero"/"rival" and guessing wrong is worse than a
plain, always-correct name. (`character.fields.role` — "protagonist",
"deuteragonist" — exists if a semantic tag genuinely fits better for a
given film; use it deliberately, not by default.)

**Which `media[]` entries become a tag's reference upload:**

1. For each `media[]` entry, filter `references` to `state ===
   "resolved"` — the only state with actual bytes to upload as an
   Element. Everything else (`unaddressed`, `missing`, `unmaterialised`,
   `out-of-root`) is a real asset the film calls for that isn't
   reachable from here; **name it to the human, don't drop it silently**
   (`spec/scf-mcp-design.md` §5.1 — omitting an unresolved reference is
   a lie about what's true, not a simplification).
2. `references` is ordered most-specific-first — `references[0]` is the
   opinion in force. That's the tag's primary Element image. Add a
   second only if it's genuinely complementary (a face anchor beside a
   full turnaround); more than two undifferentiated images per tag
   muddies identity rather than reinforcing it.
3. Skip anything whose `format` isn't an uploadable Element (a `.zip`
   texture bundle isn't one). Note it exists; don't attach it.
4. `intent: "motion"` references are a candidate for a *second*, video
   Element on the same tag (motion reference), kept separate from the
   identity image — don't make one Element do both jobs.

## 4. The Prompt Skeleton

```
[FULL STYLE PREFIX — verbatim, §2]

SUBJECT — Who/what is in this shot, each @tag "matches input 100%". One line on the goal + emotional beat. WB <temp>. MULTISHOT.

LOCATION — @location is a STYLE REFERENCE ONLY, not a fixed keyframe. Mood/architecture/light. The model may freely extend the world; the subject moves through space — NOT pinned to the input frame. Do not reproduce the reference 1:1.

[LAYOUT — optional: use @scheme (aerial layout) as a positional reference so recurring elements stay in consistent places.]

ACTION — one line of intent, then break the clip into shots:
SHOT 1 (0:00–0:0X) — blocking, gesture, eye-line, the beat. Hard cut.
SHOT 2 (0:0X–0:0Y) — next beat. Hard cut.
SHOT 3 (...) — final beat.

CAMERA — per shot: angle, height, lens feel, movement, motivation.

STYLE — Dominant 60% / Secondary 30% / Accent 10% for THIS shot. WB <temp>. Reinforce lighting (sun/window position, haze).

CONSTRAINTS — hard rules: 16:9, NO/USE slow-motion, camera behavior, legibility, scale locks, continuity must-holds, NO eye glow.
```

**Mapping into it:** SUBJECT/ACTION's beats come from `physical[]` (the
character's current beat/modulation, in plain action language — not the
profile's prose fields verbatim). LOCATION comes from
`scene.result.location`. STYLE's 60:30:10 and WB come from
`look.result.layers`' `scene_color_palette`/`project_color_palette`
(`dominant_colors`, `focal_color`) and `lighting_design`
(`key_color_temperature`). CAMERA is the one line without a reliable
source today — see the gap noted in §1.

## 5. Consistency rules

- One prompt fills its whole clip; no dead air. Split a scene with more
  beats than fit into `Na`/`Nb`/`Nc` under the same scene number rather
  than cramming everything into one prompt (see §6).
- Generalize physics — describe weight/gravity broadly; exact speeds
  and angles break physics more often than they help.
- Camera is intentional: angle + height + movement + WHY, not just a
  label. Mix locked-off, handheld+shake+dutch, FPV drone, super-macro,
  crane, continuous one-take across a scene rather than repeating one
  move.
- Slow-motion is opt-in: default NO slow-mo; call SPEED-RAMPING on
  specific beats only, and ramp back.
- `@location` is a reference, not a keyframe — the subject travels
  through the space; don't ask the model to reproduce the input 1:1.
- Continuity lives inside SUBJECT/ACTION language, never a separate
  visible block.
- Avoid named IP, real people, or brands; use generic descriptors —
  this matters doubly for a fictional production like Hollow Creek,
  where nothing should accidentally resolve to a real person's likeness.
- Tag scale when it matters ("small 0.33L can", "human-scale 1.85m");
  repeat "normal size, NOT oversized" in CONSTRAINTS if a prop's scale
  is load-bearing for the shot.
- Write acting in specifics — "eyes widen, lips part, a half-beat
  pause," not "he's surprised." `physical[].result.baseline`'s
  `emotional_manifestations` field is already written this way; reuse
  its language rather than paraphrasing it into something vaguer.

## 6. One SCF shot, or several, per prompt

`shot_context(shotUuid)` resolves exactly one SCF shot. This skeleton's
`SHOT N` beats are finer-grained than that — a single ~15s prompt can
hold several. Two valid mappings, pick per scene:

- **One SCF shot → one prompt, one `SHOT 1` beat.** Simplest; use when
  a scene's shots are visually distinct enough that each deserves its
  own generation (Hollow Creek's scene 12: `12-04`, `12A`, `12B`, `12C`,
  `12E` are five different compositions, not five beats of one take).
- **Several SCF shots in the same scene → one prompt, one `SHOT N` per
  shot, in shot order.** Use when consecutive SCF shots are the same
  take's beats (a push-in that holds, then a reaction) rather than
  genuinely different setups. Call `shot_context` once per shot
  (`list("shot", {field:"scene_id", uuid: sceneUuid})` first to get
  the set, in order), and combine.

Either way, `Na`/`Nb`/`Nc` numbering (§5) is for splitting one SCF
shot's own action across multiple prompts if it's too long for one
clip — a different situation from combining several SCF shots into one.

## 7. Readiness gate

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

## 8. Length and technical limits

This skeleton's own working convention is **~15s per prompt, 16:9** —
treat that as the default rather than the platform's outer bound. The
platform's actual hard limits are still unverified and the guides
researched disagree with each other:

- **fal.ai:** 480p/720p, duration 4–30s (or `auto`), up to 30 images +
  10 video + 10 audio references (50 total). Parameters named:
  `image_urls`, `video_urls`, `duration`, `generate_audio`.
- **seedance.tv:** native 4K/10-bit, single continuous 30-second
  output, up to 50 references total.

If you're integrating against a specific endpoint, replace this section
with that endpoint's actual documented limits.

## 9. Worked example — Hollow Creek, shot 12-04

Rendered from a real `shot_context(shotUuid)` call against
`fixtures/hollow_creek.scf` (`fixtures/expectations/Q00.result.json`,
`Q04.result.json`, `Q07.result.json`, `Q06.result.json`,
`Q13.result.json` are the same data, byte for byte).

The shot: Eleanor Cade, scene 12 (`INT. FARMHOUSE KITCHEN — NIGHT`),
storm outside, one oil lamp. `shot_design` places "Eleanor left third;
Marcus soft right background," shallow depth of field, rule-of-thirds.
`scene_color_palette`: dominant `hearth amber` / secondary `creek
slate`. `lighting_design.key_source`: "oil lamp, closer wrap for the
push-in" — the only camera-movement hint available (§1's gap).
Eleanor's `Q06` beat: "Sets the kettle down slowly — the scene's held
breath." `readiness` for `Q07` came back with one warning (Marcus has
no `character_appearance_profile`) and zero blockers — proceed, but say
so. This scene has real dialogue (`"You came back." / "I came back."`)
that the skeleton's silent/SFX-only AUDIO line doesn't carry — flagged
below rather than silently dropped, per §1.

```
[STYLE PREFIX — §2, project's naturalistic/actor-focused philosophy folded in]

SUBJECT — @eleanor-cade (matches input 100%), sixty-one, widowed, at the kitchen table. Holds the room's silence while Marcus waits in it. WB 3200K. MULTISHOT.

LOCATION — @farmhouse-kitchen STYLE REFERENCE ONLY, not a fixed keyframe. 1889 Oregon homestead kitchen, cast-iron stove, long table, storm-blue window light. Model extends the world; Eleanor moves through the space around the table.

ACTION — Eleanor sets down what she has been holding and lets the silence answer for her.
SHOT 1 (0:00–0:04) — Eleanor sets the kettle down slowly, deliberate and economical, no wasted motion. Hard cut.
SHOT 2 (0:04–0:06) — She goes still. Held breath — nothing moves but the lamp flame.

CAMERA — SHOT 1: eye-level medium-wide, slow push-in, camera holds level, no pan, motivated by the kettle's weight settling. SHOT 2: same frame, hold — the stillness is the point.

STYLE — Dominant hearth amber 60% / Secondary creek slate 30% / Accent lamp-flame gold 10%. WB 3200K. Single oil lamp key, storm-blue window fill, hard key quality.

CONSTRAINTS — 16:9. No slow-motion. No cuts within SHOT 1. Eleanor's shawl stays on throughout; kettle stays on the table once set down. Marcus stays soft-focus background, does not enter frame. NO eye glow.
```

**Caveats to surface alongside this prompt:**
- Marcus has no appearance profile authored (`readiness` warning) — his
  background presence above is inferred from cast notes, not a resolved
  reference.
- This scene has spoken dialogue the skeleton's fixed `Audio:
  Environmental SFX only. No music. No subtitles` line doesn't carry —
  if the shot needs Eleanor's line delivered, that's a deliberate
  override of §2's prefix for this one prompt, not this template's
  default.
- Eleanor's `visual_identity`/`voice_identity`/`motion` bundle
  references all came back `unaddressed` in a session with no
  `@project` root configured — `@eleanor-cade`'s Element image above
  names an asset (`eleanor_1204_lamplit_crop.png`) that exists in the
  film but couldn't actually be attached; a real render needs
  `scf-mcp` opened with a root mapped first (`open(scfPath, {roots:
  {project: "<path>"}})`, or `--root project=<path>` at startup).

## 10. Output

When given a script/scene/shot to turn into prompts: read it as a
director, build the Asset Registry (§3) from `scene.result.cast` +
`.props` + `.location`, decide the SCF-shot-to-prompt mapping (§6), then
write each prompt with the skeleton (§4). Deliver as a single
self-contained editable HTML shotlist (collapsible Style Prefix block,
per-scene checkbox saved to localStorage, a Copy button per prompt)
when the user wants a shotlist to work through; otherwise output the
prompts as copy-ready blocks.
