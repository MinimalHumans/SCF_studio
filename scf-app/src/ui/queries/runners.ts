// SPDX-License-Identifier: Apache-2.0
/**
 * runners.ts — the query page's engine bindings.
 *
 * Each canonical query declares its parameters, a run() that returns
 * scf-core's NORMATIVE result for it (`qNNResult()`, spec §12), and a
 * toMarkdown() rendering that result as a prompt-ready block. The JSON
 * tab therefore shows exactly what scf-mcp serves and what the
 * `fixtures/expectations/*.result.json` files pin; the human views live
 * in QueryRunner.tsx and composedViews.tsx.
 *
 * Nothing here answers a query. Until 0.65 the app re-derived fourteen
 * of the sixteen in its own SQL, and the copies kept bugs scf-core had
 * fixed: Q04's lineage read `scene_sequence` and `sequence.act_id`
 * instead of span boundaries (§5.4), and its cast ignored the cut
 * filter. A query page owns its markdown and nothing else, and
 * `runners.test.ts` fails if a file under this directory runs SQL
 * through the query context.
 */

import type { SqlValue } from "@scf-core/db.ts";
import type { ScfContext } from "@scf-core/resolution.ts";
import type { Registry } from "@scf-core/registry.ts";
import type { ProjectedRow, QueryResult } from "@scf-core/queryResult.ts";
import {
  mentionsRow, Q00_LAYERS,
  q00Result, q01Result, q02Result, q03Result, q04Result, q05Result,
  q06Result, q07Result, q08Result, q09Result, q10Result, q11Result,
  q12Result, q13Result, q14Result, q15Result,
  type Q00Result, type Q01Result, type Q02Result, type Q03Result,
  type Q04Result, type Q05Result, type Q07Result, type Q09Result,
  type Q10Result, type Q11Result, type Q12Result, type Q13Result,
  type Q14Result, type Q15Result,
} from "@scf-core/canonicalQueries.ts";
import {
  referencesMarkdown, type AssetReference, type Provenance,
  type ResolutionSummary,
} from "@scf-core/mediaReferences.ts";
import type { FileLocator, ResolutionState } from "@scf-core/assets.ts";
import { authoredEntries, field, nameOf, valueText } from "./fields.ts";

/**
 * How Q13 reaches the filesystem.
 *
 * Injected rather than imported: resolution needs the project root,
 * which lives in the app store, and importing that here would drag the
 * SQL worker into a module whose whole point is being runnable without
 * one. The default resolves nothing, which is also the correct
 * behaviour for a session with no folder attached.
 */
let assetLocator: FileLocator = async () => undefined;
let hasRoot = false;

export function setAssetLocator(
  locate: FileLocator | null,
): void {
  assetLocator = locate ?? (async () => undefined);
  hasRoot = locate !== null;
}

export type ParamKind =
  | "character" | "scene" | "sceneB" | "shot" | "subjectType"
  | "subjectId" | "intent" | "target" | "theme" | "entityType"
  | "entityRow";

export interface ParamDef {
  key: string;
  label: string;
  kind: ParamKind;
  optional?: boolean;
}

/**
 * A row parameter is carried twice: its row id under `key`, for the
 * resolvers, and its uuid under `uuidKey(key)`, for the result's
 * envelope (§12.1.1). The picker has both in hand, so nothing here has
 * to look either up.
 */
export type ParamValues = Record<string, SqlValue>;

export const uuidKey = (key: string): string => `${key}:uuid`;

export interface QuerySpec {
  id: string;
  name: string;
  description: string;
  params: ParamDef[];
  run: (ctx: ScfContext, values: ParamValues) =>
    Promise<QueryResult<unknown>>;
  toMarkdown: (payload: QueryResult<unknown>, registry: Registry) => string;
}

const INTENTS = ["visual_identity", "voice_identity", "surface",
                 "environment", "acoustic", "motion",
                 "performance"] as const;
export const INTENT_OPTIONS: readonly string[] = INTENTS;
export const SUBJECT_TYPE_OPTIONS = ["character", "prop",
                                     "location"] as const;
export const WALKABLE_TARGETS = ["Q02", "Q05", "Q06", "Q07", "Q08",
                                 "Q13"] as const;

interface Picked { id: number; uuid: string }

function picked(values: ParamValues, key: string): Picked | null {
  const id = values[key];
  const uuid = values[uuidKey(key)];
  return typeof id === "number" && typeof uuid === "string" && uuid !== ""
    ? { id, uuid } : null;
}

function need(values: ParamValues, key: string, what: string): Picked {
  const p = picked(values, key);
  if (p === null) throw new Error(`pick ${what}`);
  return p;
}

const text = (values: ParamValues, key: string, fallback: string): string =>
  typeof values[key] === "string" && values[key] !== ""
    ? String(values[key]) : fallback;

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Typed access to a result body; every spec knows its own. */
const body = <T>(payload: QueryResult<unknown>): T => payload.result as T;

function section(title: string, lines: string[], emptyNote?: string): string {
  if (lines.length === 0) {
    return emptyNote !== undefined ? `## ${title}\n${emptyNote}\n` : "";
  }
  return `## ${title}\n${lines.join("\n")}\n`;
}

/** Title, blank line, sections — the composed pages' layout. */
function md(title: string, blocks: string[]): string {
  return `# ${title}\n\n` + blocks.filter((b) => b !== "").join("\n");
}

function fieldLines(registry: Registry, entity: string | null,
                    row: ProjectedRow, includeName = false): string[] {
  return authoredEntries(registry, entity, row, includeName)
    .map(([k, v]) => `- ${k}: ${valueText(v)}`);
}

/** A named card: the name in bold, its fields indented under it. */
function card(registry: Registry, entity: string | null,
              row: ProjectedRow): string[] {
  return [`- **${nameOf(row, "")}**`,
          ...fieldLines(registry, entity, row).map((l) => `  ${l}`)];
}

/** `- name (k: v; k: v)` for the fields given, where present. */
function rowLine(row: ProjectedRow, keys: string[]): string {
  const parts = keys.flatMap((k) => {
    const v = field(row, k);
    return v === null ? [] : [`${k}: ${v}`];
  });
  return `- ${nameOf(row, "(unnamed)")}` +
    (parts.length > 0 ? ` (${parts.join("; ")})` : "");
}

/** ` (heard)`, ` as the boy` — only what differs from the plain case. */
function presenceNote(presence: string | null,
                      variant: string | null): string {
  return (presence !== null && presence !== "seen" ? ` (${presence})` : "") +
    (variant !== null ? ` as ${variant}` : "");
}

// ---------------------------------------------------------------------------
// Q00 — Brief (§12.12)
// ---------------------------------------------------------------------------

const q00: QuerySpec = {
  id: "Q00",
  name: "Brief",
  description: "What film is this, and what are its rules — the complete " +
               "creative and technical rulebook (project, global). The " +
               "context block is the system-prompt payload for " +
               "LLM-assisted sessions.",
  params: [],
  run: async (ctx) => q00Result(ctx),
  toMarkdown: (payload, registry) => {
    const p = body<Q00Result>(payload);
    const layers = new Map(p.layers.map((l) => [l.entity, l.row]));
    return md(
      `Brief — ${nameOf(layers.get("project"), "untitled project")}`,
      [
        // Every layer §12.12 reports, so an unauthored one says so
        // rather than vanishing from the brief.
        ...Q00_LAYERS.map((entity) => {
          const row = layers.get(entity);
          return row === undefined
            ? section(entity, [], "*(not yet authored)*")
            : section(entity, fieldLines(registry, entity, row,
                                         entity !== "project"));
        }),
        section("Poster", p.posters.map((a, i) =>
          `- ${nameOf(a, "asset")}${i > 0 ? " (alternative)" : ""}`)),
        section("Themes", p.themes.map((t) =>
          `- **${nameOf(t)}**` +
          (field(t, "description") !== null
            ? `: ${field(t, "description")}` : ""))),
      ]);
  },
};

// ---------------------------------------------------------------------------
// Q01 — Subject dossier (§12.15)
// ---------------------------------------------------------------------------

function dossierMarkdown(registry: Registry, d: Q01Result): string[] {
  return [
    ...d.groups.map((g) => section(g.entity,
      g.rows.flatMap((r) => card(registry, g.entity, r)))),
    section("Motif carriage", d.motifCarriage.map((m) =>
      `- ${nameOf(m.motif, "motif")}` +
      (field(m.appearance, "domain") !== null
        ? ` (${field(m.appearance, "domain")})` : ""))),
    section("Thematic connections", d.thematicConnections.map((t) =>
      `- ${field(t, "nature_of_connection") ?? "connected"}` +
      ` (subtlety: ${field(t, "subtlety_level") ?? "—"})`)),
  ];
}

const q01: QuerySpec = {
  id: "Q01",
  name: "Subject dossier",
  description: "Everything about X, before any scene bends it — the " +
               "timeless subject, walked generically from subject/scope " +
               "registry metadata.",
  params: [
    { key: "subject", label: "Subject type", kind: "subjectType" },
    { key: "subject_id", label: "Subject", kind: "subjectId" },
  ],
  run: async (ctx, values) => {
    const subject = need(values, "subject_id", "a subject");
    return q01Result(ctx, text(values, "subject", "character"),
                     subject.uuid, subject.id);
  },
  toMarkdown: (payload, registry) => {
    const p = body<Q01Result>(payload);
    return md(`Dossier — ${nameOf(p.subject, "?")}`,
              dossierMarkdown(registry, p));
  },
};

// ---------------------------------------------------------------------------
// Q02 — Subject in context (§12.16)
// ---------------------------------------------------------------------------

const q02: QuerySpec = {
  id: "Q02",
  name: "Subject in context",
  description: "Everything needed to realize X in scene Y [shot Z] — the " +
               "ordered context stack, most specific last.",
  params: [
    { key: "subject", label: "Subject type", kind: "subjectType" },
    { key: "subject_id", label: "Subject", kind: "subjectId" },
    { key: "scene_id", label: "Scene", kind: "scene" },
    { key: "shot_id", label: "Shot", kind: "shot", optional: true },
  ],
  run: async (ctx, values) => {
    const subject = need(values, "subject_id", "a subject");
    const scene = need(values, "scene_id", "a scene");
    const shot = picked(values, "shot_id");
    return q02Result(ctx, text(values, "subject", "character"),
                     subject.uuid, subject.id, scene.uuid, scene.id,
                     shot?.uuid ?? null, shot?.id ?? null);
  },
  toMarkdown: (payload, registry) => {
    const p = body<Q02Result>(payload);
    const rowsOf = (entity: string, list: ProjectedRow[]): string[] =>
      list.flatMap((r) => card(registry, entity, r));
    const absent = "*(none — well-defined absence)*";
    const blocks: string[] = [
      section("Dossier (global baseline)",
        p.dossier.groups.flatMap((g) =>
          g.rows.map((r) => `- [${g.entity}] ${nameOf(r, "")}`))),
    ];
    if (p.subjectType === "character") {
      blocks.push(
        section("Variant in force",
          p.characterVariant === null ? []
            : rowsOf("character_variant", [p.characterVariant]), absent),
        section("Costume in force", rowsOf("costume", p.costumes), absent),
        section("Relationship state as of here",
          p.relationshipStates.map((r) =>
            `- ${field(r, "stage_label") ?? nameOf(r, "stage")}`), absent),
        section("Arc stage as of here",
          rowsOf("character_arc_state", p.arcStates), absent),
        section("Performance states in force",
          rowsOf("performance_state", p.performanceStates), absent),
        section("Moment direction (beats)",
          rowsOf("performance_beat", p.beats), absent));
    }
    if (p.subjectType === "location" && p.locationVariant !== null) {
      const v = p.locationVariant;
      blocks.push(section("Variant in force",
        [...(v.variant === null ? []
               : rowsOf("location_variant", [v.variant])),
         ...v.mismatches.map((m) => `- mismatch: ${m}`)], absent));
    }
    if (p.subjectType === "prop") {
      blocks.push(
        section("Variant in force",
          p.propVariant === null ? []
            : rowsOf("prop_variant", [p.propVariant]), absent),
        section("Prop state as of here",
          p.propState === null ? []
            : [`- ${field(p.propState, "whereabouts") ??
                    nameOf(p.propState, "state")}`], absent));
    }
    blocks.push(section(
      `Media in force (${p.media.fromQuery}, intent=${p.media.intent})`,
      p.media.references.map((r) =>
        `- ${r.name ?? r.anchorName ?? "asset"}` +
        (r.role !== null ? ` (${r.role})` : "")),
      "*(nothing resolves)*"));
    return md(`${nameOf(p.subject, "?")} in ${nameOf(p.scene, "scene")} — ` +
              "context stack, most specific last", blocks);
  },
};

// ---------------------------------------------------------------------------
// Q03 — World state (§12.4)
// ---------------------------------------------------------------------------

const q03: QuerySpec = {
  id: "Q03",
  name: "World state",
  description: "Subjects present at a position × their in-force state, " +
               "pattern-aware.",
  params: [{ key: "scene_id", label: "Position", kind: "scene" }],
  run: async (ctx, values) => {
    const scene = need(values, "scene_id", "a position");
    return q03Result(ctx, scene.uuid, scene.id);
  },
  toMarkdown: (payload) => {
    const p = body<Q03Result>(payload);
    return `# World state — ${nameOf(p.scene, "scene")}\n` +
      section("Characters present", p.characters.map((c) =>
        `- ${nameOf(c.character)}` +
        presenceNote(c.presence, c.variant === null ? null
                                   : nameOf(c.variant)) +
        `: states in force: ` +
        `${c.states.map((s) => nameOf(s)).join(", ") ||
          "none (baseline)"};` +
        ` wearing: ${c.costumes.map((x) => nameOf(x)).join(", ") || "—"}`)) +
      section("Props present", p.props.map((x) =>
        `- ${nameOf(x.prop)}` +
        presenceNote(x.presence, x.variant === null ? null
                                   : nameOf(x.variant)) +
        `: ${field(x.state, "whereabouts") ?? "state not yet established"}`))
      + section("Motifs appearing", p.motifs.map((m) =>
        `- ${m.name}${m.domain !== null ? ` (${m.domain})` : ""}`));
  },
};

// ---------------------------------------------------------------------------
// Q04 — Scene package (§12.17)
// ---------------------------------------------------------------------------

const q04: QuerySpec = {
  id: "Q04",
  name: "Scene package",
  description: "The complete context for a scene — the scene as a work " +
               "surface, its own text included.",
  params: [{ key: "scene_id", label: "Scene", kind: "scene" }],
  run: async (ctx, values) => {
    const scene = need(values, "scene_id", "a scene");
    return q04Result(ctx, scene.uuid, scene.id);
  },
  toMarkdown: (payload, registry) => {
    const p = body<Q04Result>(payload);
    const v = p.locationVariant;
    return md(`Scene package — ${nameOf(p.scene, "?")}`, [
      section("Structural lineage", p.lineage.map((l) =>
        `- [${l.entity}] ${nameOf(l.row)}`)),
      section("Story beats", p.storyBeats.map((b) =>
        `- ${nameOf(b, "")} (${field(b, "beat_type") ?? "beat"})` +
        (field(b, "value_shift") !== null
          ? ` — ${field(b, "value_shift")}` : ""))),
      section("Cast", p.cast.map((c) =>
        `- ${nameOf(c)}` + presenceNote(
          c.presence, c.variant === null ? null : nameOf(c.variant)))),
      section("Props", p.props.map((x) =>
        `- ${nameOf(x)}` + presenceNote(
          x.presence, x.variant === null ? null : nameOf(x.variant)))),
      section("Location", p.location !== null
        ? [`- ${nameOf(p.location)}` +
           (v.variant !== null
             ? ` — variant in force: ${nameOf(v.variant)}` : ""),
           ...v.mismatches.map((m) => `  - mismatch: ${m}`)]
        : []),
      ...p.detail.map((d) => section(d.entity,
        d.rows.flatMap((r) => card(registry, d.entity, r)))),
      section("Staging", [
        ...p.blocking.map((b) => `- blocking: ${nameOf(b, "")}`),
        ...p.stagingBeats.map((b) =>
          `  - beat ${field(b, "beat_order") ?? ""}: ` +
          `${field(b, "name") ?? field(b, "description") ?? ""}`),
      ]),
      section("Screenplay", p.screenplay.map((l) => {
        const type = field(l, "line_type") ?? "";
        return type === "blank" ? "" : `${type}: ${field(l, "content") ?? ""}`;
      }), "*(no lines — the screenplay has not reached this scene)*"),
    ]);
  },
};

// ---------------------------------------------------------------------------
// Q05, Q06 — Voice and physical direction (§12.6)
// ---------------------------------------------------------------------------

function descriptionQuery(id: "Q05" | "Q06", name: string,
                          profileEntity: string,
                          description: string): QuerySpec {
  const result = id === "Q05" ? q05Result : q06Result;
  return {
    id, name, description,
    params: [
      { key: "character_id", label: "Character", kind: "character" },
      { key: "scene_id", label: "Scene", kind: "scene" },
    ],
    run: async (ctx, values) => {
      const character = need(values, "character_id", "a character");
      const scene = need(values, "scene_id", "a scene");
      return result(ctx, character.uuid, scene.uuid, character.id,
                    scene.id);
    },
    toMarkdown: (payload, registry) => {
      const p = body<Q05Result>(payload);
      return `# ${name}\n` +
        section("Baseline", p.baseline === null ? ["- none — no baseline"]
          : fieldLines(registry, profileEntity, p.baseline, true)) +
        section("States in force", p.states.map((s) =>
          rowLine(s, ["persistence", "intensity"]))) +
        section("Merged modulations",
          Object.entries(p.modulations).map(([k, v]) =>
            `- ${k}: ${String(v)}`)) +
        section("Beats", p.beats.map((b) =>
          rowLine(b, ["line_text", "pace", "volume", "physical_action",
                      "visibility"])));
    },
  };
}

const q05 = descriptionQuery("Q05", "Voice direction", "vocal_profile",
  "How this character's lines should sound in a scene.");
const q06 = descriptionQuery("Q06", "Physical direction",
  "physical_character_profile",
  "How this character moves/behaves in a scene.");

// ---------------------------------------------------------------------------
// Q07, Q08 — Look resolution and soundscape (§12.3, §12.7)
// ---------------------------------------------------------------------------

function cascadeMarkdown(name: string, p: Q07Result): string {
  return `# ${name}\n` + section(
    "Cascade, root first (most specific opinion last)",
    p.layers.map((l, i) =>
      `${i + 1}. **${l.entity}**: ${nameOf(l.row, "(unnamed)")}` +
      (i === p.layers.length - 1 ? " ← in force" : "")));
}

const q07: QuerySpec = {
  id: "Q07",
  name: "Look resolution",
  description: "What a frame in this scene/shot should look like.",
  params: [
    { key: "scene_id", label: "Scene", kind: "scene" },
    { key: "shot_id", label: "Shot", kind: "shot", optional: true },
  ],
  run: async (ctx, values) => {
    const scene = need(values, "scene_id", "a scene");
    const shot = picked(values, "shot_id");
    return q07Result(ctx, scene.uuid, scene.id,
                     shot?.uuid ?? null, shot?.id ?? null);
  },
  toMarkdown: (payload) =>
    cascadeMarkdown("Look resolution", body<Q07Result>(payload)),
};

const q08: QuerySpec = {
  id: "Q08",
  name: "Soundscape",
  description: "What this scene sounds like.",
  params: [{ key: "scene_id", label: "Scene", kind: "scene" }],
  run: async (ctx, values) => {
    const scene = need(values, "scene_id", "a scene");
    return q08Result(ctx, scene.uuid, scene.id);
  },
  toMarkdown: (payload) =>
    cascadeMarkdown("Soundscape", body<Q07Result>(payload)),
};

// ---------------------------------------------------------------------------
// Q09 — Motif manifest (§12.10)
// ---------------------------------------------------------------------------

const q09: QuerySpec = {
  id: "Q09",
  name: "Motif manifest",
  description: "Which motifs should be perceivable in a scene, and how — " +
               "a placement checklist with subtlety, evolution state, and " +
               "cross-modality candidates.",
  params: [{ key: "scene_id", label: "Scene", kind: "scene" }],
  run: async (ctx, values) => {
    const scene = need(values, "scene_id", "a scene");
    return q09Result(ctx, scene.uuid, scene.id);
  },
  toMarkdown: (payload) => {
    const p = body<Q09Result>(payload);
    return md(`Motif manifest — ${nameOf(p.scene, "?")}`, [
      p.dense
        ? `**Density warning:** ${p.manifest.length} motifs in one ` +
          `scene (heuristic threshold ${p.densityThreshold}).\n`
        : "",
      section("Checklist", p.manifest.map((m) =>
        `- [ ] **${nameOf(m.motif, "motif")}** — domain: ` +
        `${field(m.appearance, "domain") ?? "—"}; subtlety: ` +
        `${field(m.state, "subtlety_level") ??
           field(m.motif, "subtlety_level") ?? "—"}` +
        (field(m.appearance, "manifestation_notes") !== null
          ? `; ${field(m.appearance, "manifestation_notes")}` : "")),
        "*(no motifs placed here)*"),
      section("Cross-modality candidates (related motifs not placed)",
        p.candidates.map((c) => `- ${nameOf(c)}`)),
    ]);
  },
};

// ---------------------------------------------------------------------------
// Q10 — Thematic accounting (§12.11)
// ---------------------------------------------------------------------------

const q10: QuerySpec = {
  id: "Q10",
  name: "Thematic accounting",
  description: "Where a theme lives across the story — carriers on the " +
               "scene spine, gaps visible.",
  params: [{ key: "theme_id", label: "Theme", kind: "theme" }],
  run: async (ctx, values) => {
    const theme = need(values, "theme_id", "a theme");
    return q10Result(ctx, theme.uuid, theme.id);
  },
  toMarkdown: (payload) => {
    const p = body<Q10Result>(payload);
    const gaps = p.spine.filter((s) => s.carriers === 0)
      .map((s) => `sc ${s.sceneNumber ?? "?"}`);
    return md(`Thematic accounting — ${nameOf(p.theme, "?")}`, [
      section("Carriers", p.carriers.map((c) =>
        `- ${c.targetEntity}: ${c.targetName ?? "?"} (${
          field(c.connection, "nature_of_connection") ?? "connected"}) — ` +
        `${c.sceneUuids.length} scene(s)`)),
      section("Distribution",
        p.spine.filter((s) => s.carriers > 0).map((s) =>
          `- sc ${s.sceneNumber ?? "?"}: ${s.carriers} carrier(s)`)),
      section("Absent from", gaps.length === p.spine.length
        ? ["- every scene — the theme has no position-keyed carriers"]
        : [`- ${gaps.join(", ") || "nowhere — full coverage"}`]),
    ]);
  },
};

// ---------------------------------------------------------------------------
// Q11 — Audience state (§12.13)
// ---------------------------------------------------------------------------

const q11: QuerySpec = {
  id: "Q11",
  name: "Audience state",
  description: "What the audience knows and should feel at a position — " +
               "known/withheld, identification, and the emotional " +
               "direction cascade (tone root → scene target).",
  params: [{ key: "scene_id", label: "Scene", kind: "scene" }],
  run: async (ctx, values) => {
    const scene = need(values, "scene_id", "a scene");
    return q11Result(ctx, scene.uuid, scene.id);
  },
  toMarkdown: (payload, registry) => {
    const p = body<Q11Result>(payload);
    const id = p.identification;
    return md(`Audience state — ${nameOf(p.scene, "?")}`, [
      section("Known / withheld", p.information !== null
        ? fieldLines(registry, "information_strategy", p.information) : [],
        "*(no information strategy authored)*"),
      section("Identification", id !== null
        ? [`- primary: ${nameOf(id.primary)}`,
           ...(id.secondary !== null
             ? [`- secondary: ${nameOf(id.secondary)}`] : []),
           ...fieldLines(registry, "identification_strategy", id.row)]
        : [], "*(no identification strategy authored)*"),
      section("Emotional beats", p.emotionalBeats.map((e) =>
        `- ${field(e.beat, "target_emotion") ?? nameOf(e.beat, "")}` +
        (e.arc !== null ? ` (arc: ${nameOf(e.arc)})` : ""))),
      section("Tone", p.toneMarkers.flatMap((t) => [
        `- **${field(t, "tone_descriptor") ?? nameOf(t, "")}**`,
        ...fieldLines(registry, "tone_marker", t).map((l) => `  ${l}`),
      ])),
      section("Emotional direction cascade, root first",
        p.emotionalCascade.map((l, i) =>
          `${i + 1}. **${l.entity}**: ${nameOf(l.row, "")}` +
          (i === p.emotionalCascade.length - 1 ? " ← in force" : ""))),
    ]);
  },
};

// ---------------------------------------------------------------------------
// Q12 — Continuity (§12.5)
// ---------------------------------------------------------------------------

const q12: QuerySpec = {
  id: "Q12",
  name: "Continuity",
  description: "Two positions → the state diff, pattern-aware.",
  params: [
    { key: "scene_a", label: "From", kind: "scene" },
    { key: "scene_b", label: "To", kind: "sceneB" },
  ],
  run: async (ctx, values) => {
    const from = need(values, "scene_a", "two positions");
    const to = need(values, "scene_b", "two positions");
    return q12Result(ctx, from.uuid, to.uuid, from.id, to.id);
  },
  toMarkdown: (payload) => {
    const p = body<Q12Result>(payload);
    const diff = (x: string | null, y: string | null): string =>
      x === y ? `${x ?? "—"} (unchanged)` : `${x ?? "—"} → ${y ?? "—"}`;
    // A variant line only where one is in force at either end, so a
    // diff with no versions in play reads as it always did.
    const variant = (a: string | null, b: string | null): string =>
      a === null && b === null ? "" : `; version: ${diff(a, b)}`;
    return `# Continuity — ${nameOf(p.from, "?")} → ${nameOf(p.to, "?")}\n` +
      section("Character states", p.characters.map((c) =>
        `- ${nameOf(c.character)}: ` +
        diff(c.statesFrom.join(", ") || "baseline",
             c.statesTo.join(", ") || "baseline") +
        variant(c.variantFrom, c.variantTo))) +
      section("Relationships", p.relationships.map((r) =>
        `- ${nameOf(r.relationship, "relationship")}: ` +
        diff(r.stageFrom, r.stageTo))) +
      section("Props", p.props.map((x) =>
        `- ${nameOf(x.prop)}: ` + diff(x.whereFrom, x.whereTo) +
        variant(x.variantFrom, x.variantTo)));
  },
};

// ---------------------------------------------------------------------------
// Q13 — Media resolution (§12.8)
// ---------------------------------------------------------------------------

/**
 * The references section, from the result. `referencesMarkdown` takes
 * the resolver's shape, which carries row ids; a result carries none,
 * so the shape is rebuilt from what the result does carry.
 */
function q13References(p: Q13Result): string {
  const references: AssetReference[] = p.references.map((r) => ({
    ...r, id: -1, name: r.name ?? r.anchorName ?? r.uuid ?? "asset",
    provenance: r.provenance as Provenance,
    state: r.state as ResolutionState,
  }));
  const summary: ResolutionSummary = {
    referenced: references.length,
    counts: p.counts as Record<ResolutionState, number>,
    unresolved: references.filter((r) => r.state !== "resolved")
      .map((r) => ({ name: r.name, identifier: r.identifier,
                     state: r.state })),
  };
  return referencesMarkdown({ references, summary }, p.rootMapped);
}

const q13: QuerySpec = {
  id: "Q13",
  name: "Media resolution",
  description: "Assets in force for a subject and intent — the cascade " +
               "trail visualized.",
  params: [
    { key: "subject", label: "Subject type", kind: "subjectType" },
    { key: "subject_id", label: "Subject", kind: "subjectId" },
    { key: "intent", label: "Intent", kind: "intent" },
    { key: "scene_id", label: "Scene", kind: "scene", optional: true },
    { key: "shot_id", label: "Shot", kind: "shot", optional: true },
  ],
  run: async (ctx, values) => {
    const subject = need(values, "subject_id", "a subject");
    const scene = picked(values, "scene_id");
    const shot = picked(values, "shot_id");
    // A query carries references, never bytes: the addresses plus
    // whether anything is there. Resolution needs the project root,
    // which the query layer does not own, so the locator is handed in.
    return q13Result(ctx, text(values, "subject", "character"),
                     subject.uuid, subject.id,
                     text(values, "intent", "visual_identity"),
                     scene?.uuid ?? null, scene?.id ?? null,
                     shot?.uuid ?? null, shot?.id ?? null,
                     assetLocator, hasRoot);
  },
  toMarkdown: (payload) => {
    const p = body<Q13Result>(payload);
    return `# Media resolution — ${p.subjectKind}, ${p.intent}\n` +
      section("Resolution trail", p.trail.map((t) => `- ${t}`)) +
      section("Anchors", p.references
        .filter((r) => r.provenance === "anchor")
        .map((r) => `- ${r.anchorName ?? r.name ?? "anchor"}`)) +
      q13References(p);
  },
};

// ---------------------------------------------------------------------------
// Q14 — Readiness (§12.9)
// ---------------------------------------------------------------------------

const q14: QuerySpec = {
  id: "Q14",
  name: "Readiness",
  description: "What's missing for a target query, ranked by how much " +
               "it blocks.",
  params: [
    { key: "target", label: "Target query", kind: "target" },
    { key: "character_id", label: "Character", kind: "character",
      optional: true },
    { key: "scene_id", label: "Scene", kind: "scene" },
    { key: "shot_id", label: "Shot", kind: "shot", optional: true },
  ],
  run: async (ctx, values) => {
    const character = picked(values, "character_id");
    const scene = picked(values, "scene_id");
    const shot = picked(values, "shot_id");
    return q14Result(ctx, text(values, "target", "Q05"),
                     character?.uuid ?? null, character?.id ?? null,
                     scene?.uuid ?? null, scene?.id ?? null,
                     shot?.uuid ?? null, shot?.id ?? null);
  },
  toMarkdown: (payload) => {
    const p = body<Q14Result>(payload);
    return `# Readiness — ${p.target} (${p.targetName})\n` +
      section("Findings", p.findings.map((f) =>
        `- [${f.severity}] ${f.entity}: ${f.message}`));
  },
};

// ---------------------------------------------------------------------------
// Q15 — Provenance (§12.14)
// ---------------------------------------------------------------------------

const q15: QuerySpec = {
  id: "Q15",
  name: "Provenance",
  description: "Why is this value what it is, and who touched it — " +
               "decisions, notes, and lifecycle/version metadata for a " +
               "row.",
  params: [
    { key: "entity_type", label: "Entity type", kind: "entityType" },
    { key: "row_id", label: "Row", kind: "entityRow" },
  ],
  run: async (ctx, values) => {
    const entityType = text(values, "entity_type", "");
    const row = picked(values, "row_id");
    if (!ctx.registry.entities.has(entityType) || row === null) {
      throw new Error("pick an entity and a row");
    }
    return q15Result(ctx, entityType, row.uuid, row.id, mentionsRow);
  },
  toMarkdown: (payload, registry) => {
    const p = body<Q15Result>(payload);
    const cards = (entity: string, list: ProjectedRow[]): string[] =>
      list.flatMap((r) => card(registry, entity, r));
    return md(`Provenance — ${p.entityType}: ${nameOf(p.row, "?")}`, [
      section("Lifecycle", p.row !== null ? [
        `- lifecycle_status: ${field(p.row, "lifecycle_status") ?? "—"}`,
        `- uuid: ${p.row.uuid ?? "—"}`,
      ] : []),
      section("Version chain", p.versionChain.map((v) =>
        `- ${field(v, "version_label") ?? v.uuid ?? "?"}` +
        (v.uuid === p.row?.uuid ? " ← this row" : "") +
        (field(v, "superseded_at") !== null
          ? ` (superseded ${field(v, "superseded_at")})` : ""))),
      section("Attached decisions",
        cards("creative_decision", p.attached.decisions)),
      section("Attached notes",
        cards("collaboration_note", p.attached.notes)),
    ]);
  },
};

export const QUERIES: QuerySpec[] =
  [q00, q01, q02, q03, q04, q05, q06, q07, q08, q09, q10, q11, q12, q13,
   q14, q15];
