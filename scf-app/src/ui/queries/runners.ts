// SPDX-License-Identifier: Apache-2.0
/**
 * runners.ts — the query page's engine bindings.
 *
 * Each canonical query declares its parameters, a run() that returns
 * scf-core's NORMATIVE result for it (`qNNResult()`, spec §12), and a
 * toMarkdown() that hands that result to scf-core's renderer. The JSON
 * tab therefore shows exactly what scf-mcp serves and what the
 * `fixtures/expectations/*.result.json` files pin; the human views live
 * in QueryRunner.tsx and composedViews.tsx.
 *
 * Nothing here answers a query, and nothing here renders one: the
 * markdown is scf-core's (`queryMarkdown`), so the editor's "copy as
 * context" and an MCP client asking for markdown get the same text. A
 * page that re-derives a query in its own SQL keeps whatever bugs
 * scf-core has since fixed — a Q04 lineage read from `scene_sequence`
 * rather than span boundaries (§5.4), a cast that skips the cut filter
 * (§6.6.1). A query page owns its parameters and nothing else, and
 * `runners.test.ts` fails if a file under this directory runs SQL
 * through the query context.
 */

import type { SqlValue } from "@scf-core/db.ts";
import type { ScfContext } from "@scf-core/resolution.ts";
import type { Registry } from "@scf-core/registry.ts";
import type { QueryResult } from "@scf-core/queryResult.ts";
import {
  mentionsRow,
  q00Result, q01Result, q02Result, q03Result, q04Result, q05Result,
  q06Result, q07Result, q08Result, q09Result, q10Result, q11Result,
  q12Result, q13Result, q14Result, q15Result,
} from "@scf-core/canonicalQueries.ts";
import { queryMarkdown } from "@scf-core/queryMarkdown.ts";
import type { FileLocator } from "@scf-core/assets.ts";

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
  toMarkdown: (payload, registry) => queryMarkdown("Q00", payload, registry),
};

// ---------------------------------------------------------------------------
// Q01 — Subject dossier (§12.15)
// ---------------------------------------------------------------------------

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
  toMarkdown: (payload, registry) => queryMarkdown("Q01", payload, registry),
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
  toMarkdown: (payload, registry) => queryMarkdown("Q02", payload, registry),
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
  toMarkdown: (payload, registry) => queryMarkdown("Q03", payload, registry),
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
  toMarkdown: (payload, registry) => queryMarkdown("Q04", payload, registry),
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
    toMarkdown: (payload, registry) =>
      queryMarkdown(id, payload, registry),
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
  toMarkdown: (payload, registry) => queryMarkdown("Q07", payload, registry),
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
  toMarkdown: (payload, registry) => queryMarkdown("Q08", payload, registry),
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
  toMarkdown: (payload, registry) => queryMarkdown("Q09", payload, registry),
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
  toMarkdown: (payload, registry) => queryMarkdown("Q10", payload, registry),
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
  toMarkdown: (payload, registry) => queryMarkdown("Q11", payload, registry),
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
  toMarkdown: (payload, registry) => queryMarkdown("Q12", payload, registry),
};

// ---------------------------------------------------------------------------
// Q13 — Media resolution (§12.8)
// ---------------------------------------------------------------------------

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
  toMarkdown: (payload, registry) => queryMarkdown("Q13", payload, registry),
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
  toMarkdown: (payload, registry) => queryMarkdown("Q14", payload, registry),
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
  toMarkdown: (payload, registry) => queryMarkdown("Q15", payload, registry),
};

export const QUERIES: QuerySpec[] =
  [q00, q01, q02, q03, q04, q05, q06, q07, q08, q09, q10, q11, q12, q13,
   q14, q15];
