<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0030 — Presence: who is seen, heard or only named, in a scene and in a shot

| | |
|---|---|
| **Status** | **implemented** — spec 0.57, schema 2.17 |
| **Author** | Found writing a video-generation prompt for shot 3B through the SCF MCP; drafted with Claude |
| **Opened** | 2026-09-30 |
| **Affects** | §2.4 (two vocabularies gain defined meanings); §12.4 Q03, §12.5 Q12, §12.9 Q14, §12.17 Q04 wording; new entities `shot_character`, `shot_prop`; a new `shot` field; registry option metadata and `registry.schema.json`; the finding catalog; `spec/scf-mcp-design.md` §4.2; a new `stability.md` row; the fixture |

## The problem

**The format cannot say who is in a shot, and what it says about who is
in a scene, it never defines.** These are two gaps with one cause.
Presence is the most basic fact a shot has, and today it is inferred.

### At the scene, the vocabulary carries presence, and the spec never says so

`scene_character.role_in_scene` is a closed vocabulary: `featured`,
`supporting`, `background`, `mentioned`, `voiceover`.
`scene_prop.significance` is another: `key`, `present`, `background`,
`mentioned`. Two of those values mean **not seen**, and one means
**heard, not seen**. The specification defines none of them. The only
normative statement about presence is §12.4's:

> Presence is authored, not inferred: a character appears because a
> `scene_character` link says so, not because a state mentions them.

Read literally, that makes every linked character present, including one
the link itself says is only mentioned. The implementation reads it that
way, and the published artifacts teach it:

- **Q03 and Q12's published results list Ada Cade among the characters
  present** at scene 19. Her link there is `mentioned`, and her own
  summary says she never appears on screen.
- **The shot composite sweeps Ada for visual media** in scene 3, asks
  for her physical direction, and Q14 warns *"Ada Cade is in this scene
  with no appearance profile."* The only way for an author to silence
  that warning is to design the look of a character who is never seen.

### At the shot, nothing records presence at all

There is no `shot_character` or `shot_prop`. `shot_design.subject_placement`
is prose, and optional. `shotContext` documents the gap in its own
source: "in frame" means the scene's whole cast, "the only
registry-derivable notion of presence".

**This has actually bitten.** Writing a prompt for shot 3B ("He fills the
doorway. Held long.") needed Marcus in the doorway and Eleanor's back in
the soft foreground. Nothing in the file says so: it had to be inferred
from the scene's blocking prose. That was the one point in the whole
prompt that needed interpretation rather than reading. Shot 3C ("Her
hands stop, then keep going") has the same problem: the file cannot say
it is Eleanor's hands and not Eleanor.

An inferred answer is exactly what `scf-mcp-design.md` §4.1 argues
against. Two agents writing a prompt for the same shot will cast it
differently, and neither is wrong by anything the file says.

## The proposal

Five parts. §A alone fixes Ada. §A to §C together fix 3B.

### A. Define what the scene vocabularies say about presence

Every value of `scene_character.role_in_scene` and
`scene_prop.significance` gets a **presence**, declared as metadata on
the option in `schema/entity_registry.py`, so the registry stays the
source of truth (`docs/conventions.md` §8) and a generic editor can show
it. The spec's table is generated from the registry, not written beside
it:

| Presence | Means |
|---|---|
| **seen** | It can appear on screen. |
| **heard** | It can be heard and is not seen. |
| **named** | It is referred to and is neither seen nor heard. |

| `scene_character.role_in_scene` | Presence |
|---|---|
| `featured`, `supporting`, `background` | seen |
| `voiceover` | heard |
| `mentioned` | named |

| `scene_prop.significance` | Presence |
|---|---|
| `key`, `present`, `background` | seen |
| `mentioned` | named |

A link with no value is **seen**. That is the reading every file written
so far assumes.

`background` is seen. Whether seen should split into directed and
undirected is left until a case needs it.

Replace §12.4's paragraph with:

> Presence is authored, not inferred: a character is at a position
> because a `scene_character` link says so, not because a state mentions
> them. What the link says about being seen is its presence (§2.4). A
> `mentioned` character is at the position and is not on screen.

Q03, Q12 and Q04 keep every linked subject, so their shape does not
change. Each projected character and prop gains `presence`, so a reader
cannot mistake a named subject for a seen one.

### B. Record presence at the shot

Two junctions, per kind, like the scene's own:

| Entity | Fields |
|---|---|
| `shot_character` | `shot_id`, `character_id`, `framing`, `facing`, `focus`, `notes` |
| `shot_prop` | `shot_id`, `prop_id`, `framing`, `focus`, `notes` |

How a subject reads in a shot has three independent parts, so it is
three closed fields rather than one list of cases. Each field is small,
every real combination can be written, and the impossible ones cannot.

| `framing` | Means | Presence |
|---|---|---|
| `full` | The whole subject is in frame. | seen |
| `cropped` | Part of the subject is in frame: the hands (Eleanor in 3C), a shoulder, a hand reaching in. | seen |
| `off_screen` | Not in frame, and heard in the shot. | heard |

| `facing` (characters only) | Means |
|---|---|
| `toward` | The face reads. |
| `profile` | Side on. The face reads in part. |
| `away` | Back to camera. The character reads by build, posture and costume. |

| `focus` | Means |
|---|---|
| `sharp` | In the plane of focus. |
| `soft` | Out of focus: a foreground or background presence. |

A prop has no `facing`. Eleanor in 3B is `full`, `away`, `soft`.

An unset field is **unknown**, not a default. A row with `framing` unset
puts the subject on screen, with its framing unrecorded. `facing` and
`focus` describe what is on screen, so they are empty when `framing` is
`off_screen`.

Where in the frame and how it is lit stay in `shot_design`. These rows
say only **who is there, and how they read**.

And one field on `shot`:

| Field | Type | Means |
|---|---|---|
| `presence_complete` | boolean | The shot's `shot_character` and `shot_prop` rows are its whole frame. |

### C. The rule: presence at a shot

Add to §4, as §4.6:

> **Presence at a shot.** A subject is at a shot if a `shot_character`
> or `shot_prop` row puts it there. Its presence is its `framing`'s
> (§B): **seen**, or **heard** when `off_screen`.
>
> If `shot.presence_complete` is true, those rows are the whole frame. A
> subject with no row is not in the shot, and a shot with no rows has
> nobody and nothing in it.
>
> Otherwise, every subject the shot's scene links as **seen** (§2.4) and
> no row names **may** also be in the shot, with framing, facing and
> focus unknown. A shot with no rows and `presence_complete` unset is
> **unrecorded**, not empty. It answers exactly as the scene does.
>
> Presence at a shot is never wider than presence at its scene. Per
> §9.2, what follows is kept and reported rather than refused:
>
> | Code | Severity | Raised when |
> |---|---|---|
> | `presence.shot_subject_not_in_scene` | warning | A shot row names a subject with no link to the shot's scene. |
> | `presence.named_but_on_screen` | warning | A shot row puts on screen a subject whose scene link is **named**. |
> | `presence.off_screen_described` | warning | A row is `off_screen` and sets `facing` or `focus`. |
> | `presence.complete_but_empty` | info | `presence_complete` is true and the shot has no rows. Legitimate for an empty frame, and a flag set by mistake empties the shot silently, so it is made visible. |

The flag and the rows compose. An insert of the kettle is one
`shot_prop` row and `presence_complete` true: nobody else is in it. A
shot where the author recorded only the characters leaves the flag
unset, and its props still come from the scene.

### D. A shot's location is its scene's

Add, as normative text beside §C:

> **A shot is at its scene's location.** A shot has no location of its
> own, and there is no rule for one. A change of place is a new scene,
> including a flashback and each side of an intercut.

This is a deliberate line, and it will sometimes cut across screenplay
convention, where an intercut is written as one scene. A writer
importing such a script splits it. The cost falls on the writer once,
instead of on every reader of every shot, who would otherwise have to ask
where each shot is.

### E. What the consumers do with it

These follow from §A to §D rather than adding rules:

- **`shotContext`** gains a `presence` member: each subject at the shot,
  with its framing, facing and focus, and whether that came from a shot
  row (**recorded**) or from the scene (**inherited**). The marker is how
  a reader tells what the file says from what it leaves open, so no
  finding is raised for an inherited subject. The subject sweep uses it:
  - **seen** subjects are asked for every intent, as today;
  - **heard** subjects (`off_screen`, or `voiceover` in the scene) are
    asked for voice and acoustic intents only, and get **no physical
    direction**;
  - **named** subjects are listed in `swept` with a note and asked for
    nothing.
- **Q14's appearance-profile check** applies only to subjects seen at
  the position. Ada stops being a warning.
- **Q06 physical direction** is asked for characters seen at the
  position.

## What it breaks

- **Published results.** Q03, Q12 and Q04 gain a `presence` member on
  each character and prop, and are re-blessed.
  `ShotContext-readiness` does not change, because Ada is not in scene 12.
- **The fixture** gains `shot_character` and `shot_prop` rows for scene
  3's shots: 3A recorded and inherited, 3B and 3C complete, 3D
  unrecorded. Scene 12 is left alone, since the fixture's history treats
  it as pinned, so 12-04 is the published inherited case.
  That exercises all three paths: recorded and complete, recorded and
  partial, and inherited (the rest of scene 12).
- **The schema.** Two new entities and a new field is a minor version
  bump. `initDatabase` adds them to existing files on open, and existing
  files stay valid: a file with no shot rows reads exactly as today.
- **The registry format.** Options gain metadata, so `registry.schema.json`
  and whatever reads options change. Any third-party reader of
  `registry.json` sees a new shape.
- **The finding catalog** gains four codes. `finding-catalog.json`,
  `SHA256SUMS` and possibly the negative fixtures regenerate.
- **Writers.** Scriptyard's export, and any other writer, is required to
  do nothing new for presence: a shot with no rows is unrecorded, which
  is today's meaning. **§D does ask something of importers:** an
  intercut or a flashback written as one scene has to become several.
- **Q14 results** anywhere a named character used to trigger a warning.

## Alternatives

**Do nothing.** Every consumer keeps inferring presence at the shot from
prose, and keeps treating a mentioned character as seen. Two runs cast
the same shot differently, and the file cannot settle it.

**Fix only §A.** This removes the Ada warning and the visual sweep of
characters who are never seen, and costs no new entities. It does not
say who is in 3B. Worth doing even if §B is declined.

**One polymorphic `shot_subject`** (`entity_type`, `entity_id`, and
the presence fields). One table instead of two. Declined because every other
presence link is per-kind (`scene_character`, `scene_prop`), a
polymorphic reference pays §12.1.2's cost on every read, and under §D the
one other subject it could reach, the location, never varies within a
scene.

**A finding for every inherited subject.** Declined: with
`presence_complete` unset, inheriting is the rule working, not a fault.
`shotContext` marks each subject recorded or inherited, and that is
enough for a reader to tell them apart.

**Rows alone are the whole frame, with no flag.** Simpler, and it can
express an empty insert. But a shot whose author recorded only the
characters would then claim no props are in it, and lose the kettle's
references. Treating each kind separately fixes that and loses the empty
insert. The flag keeps both.

**One `visibility` vocabulary** (`in_frame`, `back_to_camera`, `soft`,
`cropped`, `off_screen`). Declined: the values are not exclusive.
Eleanor in 3B is back to camera **and** soft, and one value per row makes
the author drop one. A single `partial` value is worse again: "back to
camera", "out of focus" and "cut by the frame" want different prompts.

**A string list of those values**, using the field type proposal 0024
added in schema 2.15. Expresses every combination, including
contradictory ones (`off_screen` and `soft`) that separate closed fields
rule out by construction.

**Two fields, `framing` and `read` (`face`, `back`, `soft`).** Still
cannot say back **and** soft: facing and focus are independent, so they
are separate fields.

**Put it in `shot_design.subject_placement`.** That field is prose and
already exists. It cannot be queried, and a reader cannot tell a subject
omitted from one never considered.

**Derive it from the screenplay or the blocking.** §9.3: anything
extracted is a proposal, not a fact. Useful as a writer's suggestion,
not as the answer.

**A location per shot.** Declined by §D.

## Unresolved

None open. The questions this draft opened with were settled in
discussion before it was put up:

| Question | Settled as |
|---|---|
| Is a shot's frame complete across all kinds at once, or per kind? | Neither: an explicit `presence_complete` flag on `shot` (§B, §C). |
| One value for "partially seen", or several? | Several, then three independent closed fields, because the several values were not exclusive (§B). |
| Does an off-screen character get physical direction? | No. `off_screen` means heard only. A hand reaching in is `cropped`, which is seen (§B, §E). |
| Is `background` seen? | Yes. Directed and undirected can split when a case needs it (§A). |
| Does a shot have a location of its own? | No. A new location is a new scene, flashbacks and intercuts included (§D). |
| Where does the §A mapping live? | As metadata on the registry's options, with the spec's table generated from it (§A). |
| Should a complete frame with no rows be confirmed? | An `info` finding, `presence.complete_but_empty` (§C). §9.4's scale is `error`, `warning`, `info`; `suggestion` is readiness's. |
| Should an inherited subject raise a finding? | No. The recorded or inherited marker in `shotContext` is enough (§E). |
| The flag's name? | `presence_complete`: it says what it covers. |

---

<!-- A maintainer fills this in when the proposal is resolved. -->

## Resolution

**Accepted and implemented, 2026-09-30.** Spec 0.57, schema 2.17.

The questions this draft opened with were settled before it was put up,
and are recorded above. Implementing it changed three details, all
reflected in the text:

- **§C's rule is §4.6**, beside the position patterns, rather than a
  subsection of §12.1: it says who is at a position, which is §4's
  subject, not what a query returns.
- **`presence.complete_but_empty` is `info`.** The draft said
  `suggestion`, which is readiness's scale, not §9.4's.
- **Scene 12 has no shot rows.** The fixture's history treats it as
  pinned, and leaving it unrecorded makes every result published at
  12-04 the inherited case.

One consequence was not foreseen: a Q14 message about a character at a
shot has to say whether they are recorded there. "On screen in this
shot" is only true of a recorded character; an inherited one is "in
this scene", which is what the published result at 12-04 still says.
