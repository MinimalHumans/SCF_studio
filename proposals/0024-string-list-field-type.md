<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0024 — `string_list`: a list is not a blob

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | 29 fields change `fieldType`; `registry.schema.json`; spec §2 and §12.1.2; scf-app's field renderer |

## The problem

**Twenty-nine fields hold a list of short strings, and the registry calls
them `json` — the same type it gives a keyed map and an attachment
list.**

```
visual_identity.primary_materials   ["oak", "brass", "iron", "wool"]
asset.tags                          ["location","kitchen","night"]
performance_beat.emphasis_words     ["back"]
color_script_entry.key_colors       ["hearth amber", "storm blue"]
```

Because the type says only "json", every consumer treats them as opaque:

- **The editor renders a raw JSON textarea.** An author adding a material
  types brackets, quotes and commas by hand, and a misplaced quote
  silently produces a value nothing can parse. No screenwriter or
  designer will do this, and the empty columns say they have not:
  21 of the 29 are empty in the fixture.
- **§12.1.2 projects the stored text**, so a result carries the string
  `"[\"oak\", \"brass\"]"` rather than a list. A consumer parses JSON out of a
  JSON document.
- **Nothing states the shape.** An array of strings is a convention the
  artifacts demonstrate and no text requires.

## The proposal

1. **A new `fieldType`: `string_list`**, alongside `text`, `textarea`,
   `select`, `multiselect`, `json` and the rest. Its stored form is a
   **JSON array of strings**, stated normatively in §2. Null and `[]`
   mean the same thing: nothing.
2. **The 29 fields change type.** No column, no data and no value moves —
   this is a declaration, not a migration. The list:

   `project_vision.aesthetic_priorities`; `visual_identity` ×5;
   `project_color_palette` ×4; `project_tone.tone_blend`;
   `vocal_profile` ×3; `costume` ×3; `prop_surface_profile.secondary_colors`;
   `location_color_scheme.dominant_colors`;
   `location_sound_profile.constant_sounds`; `bundle` ×2;
   `scene_emotional_target.secondary_emotions`;
   `scene_color_palette.dominant_colors`; `set_dressing.hero_objects`;
   `character_color_identity.secondary_colors`;
   `color_script_entry.key_colors`; `performance_beat.emphasis_words`;
   `asset.tags`.
3. **§12.1.2 projects a `string_list` as a JSON array**, not as the stored
   text. An empty list is omitted like any other empty field.
4. **The editor renders chips**: type, comma or Enter to add, click to
   remove. One control for all 29, which is the point of typing them.

`json` keeps its remaining meaning: a structured value whose shape the
field documents (see 0025).

## What it breaks

- **Every published result carrying one of these fields changes shape**,
  from a string to an array. Checked as a category, not row by row:
  `visual_identity`, `project_color_palette`, `color_script_entry` and
  `performance_beat` all carry values in the fixture and all appear in
  canonical queries. Re-blessing is part of the change.
- `registry.schema.json` gains a `fieldType` member; a consumer
  validating against it must accept the new one.
- Schema version moves. The DDL does not: the column stays `TEXT`.

## Alternatives

**Plain text with a separator** — `oak, brass, iron`. Simplest to author
by hand, and it breaks on any value containing the separator, which
`"crow's-feet crease before the mouth moves"` already nearly does in a
neighbouring field. It also throws away the existing values' structure.

**Child tables.** Correct for a list of entities and absurd for a list of
five words; `asset.tags` would become a table with one column.

**Keep `json` and fix only the editor.** The UI improves and the
specification still never says what shape these hold, so a second writer
guesses.

## Unresolved

- **Ordering.** Is a `string_list` ordered (first colour is the dominant
  one) or a set? `primary_colors` reads as ordered;
  `bundle.intended_consumers` does not. State one for all, or add a
  per-field flag?
- **Duplicates and blanks.** A finding, or left alone?
- **Case.** Should `asset.tags` be compared case-insensitively? That is a
  query question, not a storage one, but it belongs in §12 if anywhere.
