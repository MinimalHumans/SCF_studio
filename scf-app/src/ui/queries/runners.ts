/**
 * runners.ts — the query page's engine bindings.
 *
 * Each supported canonical query declares its parameters and a run()
 * producing the resolved payload. The payload IS the JSON consumer mode
 * (the future MCP payload, previewed); toMarkdown() is the copy-as-context
 * mode (a prompt-ready block); the human views live in QueryRunner.tsx.
 * All resolution comes from scf-core — none of this reimplements
 * semantics.
 *
 * First cut covers the engine-driven queries scf-core computes end to end:
 * Q03, Q05, Q06, Q07, Q08, Q12, Q13, Q14. The composed/analytic pages
 * (Q00 brief, Q01/Q02 dossier, Q04 package, Q09–Q11, Q15) follow.
 */

import type { Row, SqlValue } from "@scf-core/db.ts";
import { q } from "@scf-core/db.ts";
import {
  resolveDescription, resolveDirection, resolveMedia, rows, sceneOrder,
  statesInForce, relationshipStateAt, propStateAt,
  type ScfContext,
} from "@scf-core/resolution.ts";
import { readinessReport } from "@scf-core/readiness.ts";
import { composeQ03, composeQ12 } from "@scf-core/canonicalQueries.ts";
import {
  mediaReferences, referencesMarkdown, type MediaReferences,
} from "@scf-core/mediaReferences.ts";
import type { ResolvedMedia } from "@scf-core/resolution.ts";
import type { FileLocator } from "@scf-core/assets.ts";

/** Q13's payload: the cascade, plus what it references and whether it
 *  resolves. `has_root` travels with it so the report can say "no
 *  project folder attached" instead of implying the assets are gone. */
export type MediaPayload = ResolvedMedia & MediaReferences & {
  has_root: boolean;
};

/**
 * How a runner reaches the filesystem.
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

export type ParamValues = Record<string, SqlValue>;

export interface QuerySpec {
  id: string;
  name: string;
  description: string;
  params: ParamDef[];
  run: (ctx: ScfContext, values: ParamValues) => Promise<unknown>;
  toMarkdown: (payload: unknown, values: ParamValues) => string;
}

const INTENTS = ["visual_identity", "voice_identity", "surface",
                 "environment", "acoustic", "motion",
                 "performance"] as const;
export const INTENT_OPTIONS: readonly string[] = INTENTS;
export const SUBJECT_TYPE_OPTIONS = ["character", "prop",
                                     "location"] as const;

const num = (v: SqlValue | undefined): number | null =>
  typeof v === "number" ? v : null;

function section(title: string, lines: string[]): string {
  return lines.length > 0 ? `## ${title}\n${lines.join("\n")}\n` : "";
}

function rowLine(r: Row, fields: string[]): string {
  const parts = fields
    .filter((f) => r[f] !== null && r[f] !== undefined && r[f] !== "")
    .map((f) => `${f}: ${String(r[f])}`);
  return `- ${String(r["name"] ?? `#${String(r["id"])}`)}` +
    (parts.length > 0 ? ` (${parts.join("; ")})` : "");
}

// ---------------------------------------------------------------------------

export interface Q03Payload {
  scene: Row | null;
  characters: Array<{ character: Row; states: Row[]; costumes: Row[] }>;
  props: Array<{ prop: Row; state: Row | null }>;
  motifs: Row[];
}

const q03: QuerySpec = {
  id: "Q03",
  name: "World state",
  description: "Subjects present at a position × their in-force state, " +
               "pattern-aware.",
  params: [{ key: "scene_id", label: "Position", kind: "scene" }],
  run: async (ctx, values): Promise<Q03Payload> => {
    const sceneId = num(values["scene_id"]);
    if (sceneId === null) throw new Error("pick a position");
    // The composition lives in scf-core (spec §12.4). Deriving "who is
    // present and what is true of them" here as well would be a second
    // answer to the same question.
    return composeQ03(ctx, sceneId);
  },
  toMarkdown: (payload): string => {
    const p = payload as Q03Payload;
    const head = `# World state — ${String(p.scene?.["name"] ?? "scene")}\n`;
    return head + section("Characters present",
      p.characters.map((c) =>
        `- ${String(c.character["name"])}: states in force: ` +
        `${c.states.map((s) => String(s["name"])).join(", ") ||
          "none (baseline)"};` +
        ` wearing: ${c.costumes.map((x) => String(x["name"]))
          .join(", ") || "—"}`)) +
      section("Props present", p.props.map((x) =>
        `- ${String(x.prop["name"])}: ` +
        `${String(x.state?.["whereabouts"] ?? "state not yet established")}`))
      + section("Motifs appearing", p.motifs.map((m) =>
        `- ${String(m["name"])}${m["domain"] !== null ?
          ` (${String(m["domain"])})` : ""}`));
  },
};

// ---------------------------------------------------------------------------

function descriptionQuery(id: string, name: string, modality: string,
                          description: string): QuerySpec {
  return {
    id, name, description,
    params: [
      { key: "character_id", label: "Character", kind: "character" },
      { key: "scene_id", label: "Scene", kind: "scene" },
    ],
    run: async (ctx, values) => {
      const cid = num(values["character_id"]);
      const sid = num(values["scene_id"]);
      if (cid === null || sid === null) {
        throw new Error("pick a character and a scene");
      }
      return resolveDescription(ctx, cid, sid, modality);
    },
    toMarkdown: (payload): string => {
      const p = payload as Awaited<ReturnType<typeof resolveDescription>>;
      const profile = p.profile === null ? ["- none — no baseline"]
        : Object.entries(p.profile)
            .filter(([k, v]) => v !== null && v !== "" &&
              !["id", "uuid", "created_at", "updated_at",
                "lifecycle_status", "character_id"].includes(k) &&
              !k.endsWith("_id"))
            .map(([k, v]) => `- ${k}: ${String(v)}`);
      return `# ${name}\n` +
        section("Baseline", profile) +
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

const q05 = descriptionQuery("Q05", "Voice direction", "vocal",
  "How this character's lines should sound in a scene.");
const q06 = descriptionQuery("Q06", "Physical direction", "physical",
  "How this character moves/behaves in a scene.");

// ---------------------------------------------------------------------------

function directionQuery(id: string, name: string, leaf: string,
                        shotLeaf: string | null,
                        description: string): QuerySpec {
  const params: ParamDef[] = [
    { key: "scene_id", label: "Scene", kind: "scene" },
  ];
  if (shotLeaf !== null) {
    params.push({ key: "shot_id", label: "Shot", kind: "shot",
                  optional: true });
  }
  return {
    id, name, description, params,
    run: async (ctx, values) => {
      const sid = num(values["scene_id"]);
      const shotId = num(values["shot_id"] ?? null);
      if (sid === null) throw new Error("pick a scene");
      const effectiveLeaf = shotId !== null && shotLeaf !== null
        ? shotLeaf : leaf;
      const layers = await resolveDirection(ctx, effectiveLeaf, sid,
                                            shotId);
      return { leaf: effectiveLeaf, layers };
    },
    toMarkdown: (payload): string => {
      const p = payload as {
        leaf: string; layers: Array<[string, Row]>;
      };
      return `# ${name}\n` + section(
        "Cascade, root first (most specific opinion last)",
        p.layers.map(([entity, row], i) =>
          `${i + 1}. **${entity}**: ` +
          `${String(row["name"] ?? `#${String(row["id"])}`)}` +
          (i === p.layers.length - 1 ? " ← in force" : "")));
    },
  };
}

const q07 = directionQuery("Q07", "Look resolution", "scene_color_palette",
  "shot_design", "What a frame in this scene/shot should look like.");
const q08 = directionQuery("Q08", "Soundscape", "scene_music_design", null,
  "What this scene sounds like.");

// ---------------------------------------------------------------------------

export interface Q12Payload {
  a: Row | null;
  b: Row | null;
  characters: Array<{
    character: Row; statesA: string[]; statesB: string[];
  }>;
  relationships: Array<{
    relationship: Row; stageA: string | null; stageB: string | null;
  }>;
  props: Array<{
    prop: Row; whereA: string | null; whereB: string | null;
  }>;
}

const q12: QuerySpec = {
  id: "Q12",
  name: "Continuity",
  description: "Two positions → the state diff, pattern-aware.",
  params: [
    { key: "scene_a", label: "From", kind: "scene" },
    { key: "scene_b", label: "To", kind: "sceneB" },
  ],
  run: async (ctx, values): Promise<Q12Payload> => {
    const a = num(values["scene_a"]);
    const b = num(values["scene_b"]);
    if (a === null || b === null) throw new Error("pick two positions");
    return composeQ12(ctx, a, b);   // scf-core, spec §12.5
  },
  toMarkdown: (payload): string => {
    const p = payload as Q12Payload;
    const label = (r: Row | null): string => String(r?.["name"] ?? "?");
    const diff = (x: string | null, y: string | null): string =>
      x === y ? `${x ?? "—"} (unchanged)` : `${x ?? "—"} → ${y ?? "—"}`;
    return `# Continuity — ${label(p.a)} → ${label(p.b)}\n` +
      section("Character states", p.characters.map((c) =>
        `- ${String(c.character["name"])}: ` +
        diff(c.statesA.join(", ") || "baseline",
             c.statesB.join(", ") || "baseline"))) +
      section("Relationships", p.relationships.map((r) =>
        `- ${String(r.relationship["name"] ?? "relationship")}: ` +
        diff(r.stageA, r.stageB))) +
      section("Props", p.props.map((x) =>
        `- ${String(x.prop["name"])}: ` + diff(x.whereA, x.whereB)));
  },
};

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
    const subject = String(values["subject"] ?? "character");
    const subjectId = num(values["subject_id"]);
    const intent = String(values["intent"] ?? "visual_identity");
    if (subjectId === null) throw new Error("pick a subject");
    const media = await resolveMedia(ctx, subject, subjectId, intent,
                                     num(values["scene_id"] ?? null),
                                     num(values["shot_id"] ?? null));
    // A query carries references, never bytes (conventions §9): the
    // addresses plus whether anything is there, for the consumer to
    // fetch. Resolution needs the project root, which the query layer
    // does not own, so the locator is handed in by the caller.
    const refs = await mediaReferences(media, assetLocator);
    return { ...media, ...refs, has_root: hasRoot };
  },
  toMarkdown: (payload): string => {
    const p = payload as MediaPayload;
    return `# Media resolution — ${p.subject} #${p.subject_id}, ` +
      `${p.intent}\n` +
      section("Resolution trail", p.trail.map((t) => `- ${t}`)) +
      section("Assets, most specific first",
        p.assets_most_specific_first.map((a) =>
          `- ${String(a["name"])}` +
          (a["role_in_bundle"] !== null && a["role_in_bundle"] !== undefined
            ? ` (${String(a["role_in_bundle"])})` : ""))) +
      section("Anchors", p.anchors.map((a) =>
        `- ${String(a["name"] ?? `#${String(a["id"])}`)} ` +
        `[${String(a["canonical_status"] ?? "unverified")}]`)) +
      referencesMarkdown(
        { references: p.references, summary: p.summary },
        p.has_root);
  },
};

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
    const target = String(values["target"] ?? "Q05");
    return readinessReport(ctx, target, {
      character_id: num(values["character_id"] ?? null) ?? undefined,
      scene_id: num(values["scene_id"]) ?? undefined,
      shot_id: num(values["shot_id"] ?? null) ?? undefined,
    });
  },
  toMarkdown: (payload): string => {
    const p = payload as Awaited<ReturnType<typeof readinessReport>>;
    return `# Readiness — ${p.query} (${p.meta.name})\n` +
      section("Findings", p.findings.map((f) =>
        `- [${f.severity}] ${f.entity}: ${f.message}`));
  },
};

export const WALKABLE_TARGETS = ["Q02", "Q05", "Q06", "Q07", "Q08",
                                 "Q13"] as const;

import { COMPOSED_QUERIES } from "./runnersComposed.ts";

export const QUERIES: QuerySpec[] =
  [...COMPOSED_QUERIES, q03, q05, q06, q07, q08, q12, q13, q14]
    .sort((a, b) => a.id.localeCompare(b.id));
