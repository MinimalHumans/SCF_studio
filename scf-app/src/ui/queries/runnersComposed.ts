/**
 * runnersComposed.ts — the composed and analytic canonical queries.
 *
 * These are assemblies over scf-core resolution and straightforward SQL —
 * per the design doc, "none requires machinery that doesn't already exist
 * in scf-core." Q02 in particular is the flagship: Q01 dossier ⊕
 * position-keyed state ⊕ scene modulation ⊕ moment beats ⊕ media, as an
 * ordered context stack, most specific last.
 *
 * Known absences stated in output rather than hidden:
 *  - Q04's screenplay text arrives with Part 3 (lines-are-rows storage).
 *  - Q10's subtext linkage: `subtext` has no theme reference in schema
 *    2.3, so theme-tagged subtext can't be collected yet.
 *  - Q15's attachment field (`affected_entities`) is unpopulated in
 *    Hollow Creek; unmatched decisions/notes are listed as unattached.
 */

import type { Row, SqlValue } from "@scf-core/db.ts";
import { q } from "@scf-core/db.ts";
import {
  motifStateAt, propStateAt, relationshipStateAt, resolveDirection,
  resolveMedia, rows, sceneOrder, selectLocationVariant, statesInForce,
  type ScfContext,
} from "@scf-core/resolution.ts";
import { mentionsRow } from "@scf-core/canonicalQueries.ts";
import type { ParamValues, QuerySpec } from "./runners.ts";

const num = (v: SqlValue | undefined): number | null =>
  typeof v === "number" ? v : null;

const AUTHORED_SKIP = new Set([
  "id", "uuid", "created_at", "updated_at", "lifecycle_status",
  "external_id", "external_id_namespace", "parent_id", "version_label",
  "superseded_at", "superseded_by_id",
]);

function authoredLines(row: Row, includeName = false): string[] {
  return Object.entries(row)
    .filter(([k, v]) => !AUTHORED_SKIP.has(k) && !k.endsWith("_id") &&
      (includeName || k !== "name") && v !== null && v !== "")
    .map(([k, v]) => `- ${k}: ${String(v)}`);
}

function md(title: string, blocks: string[]): string {
  return `# ${title}\n\n` +
    blocks.filter((b) => b !== "").join("\n");
}

function mdSection(title: string, lines: string[],
                   emptyNote?: string): string {
  if (lines.length === 0) {
    return emptyNote !== undefined ? `## ${title}\n${emptyNote}\n` : "";
  }
  return `## ${title}\n${lines.join("\n")}\n`;
}

async function firstRow(ctx: ScfContext, table: string):
    Promise<Row | null> {
  if (!ctx.registry.entities.has(table)) return null;
  return (await rows(ctx.exec, table))[0] ?? null;
}

// ---------------------------------------------------------------------------
// Q00 — Brief
// ---------------------------------------------------------------------------

const Q00_LAYERS = [
  "project", "project_vision", "project_tone", "visual_identity",
  "project_color_palette", "cinematographic_philosophy", "sonic_identity",
  "look_development", "costume_design_philosophy", "technical_specs",
] as const;

export interface Q00Payload {
  layers: Array<{ entity: string; row: Row | null }>;
  themes: Row[];
}

export const q00: QuerySpec = {
  id: "Q00",
  name: "Brief",
  description: "What film is this, and what are its rules — the complete " +
               "creative and technical rulebook (project, global). The " +
               "context block is the system-prompt payload for " +
               "LLM-assisted sessions.",
  params: [],
  run: async (ctx): Promise<Q00Payload> => {
    const layers = [];
    for (const entity of Q00_LAYERS) {
      layers.push({ entity, row: await firstRow(ctx, entity) });
    }
    return { layers, themes: await rows(ctx.exec, "theme") };
  },
  toMarkdown: (payload): string => {
    const p = payload as Q00Payload;
    const project = p.layers.find((l) => l.entity === "project")?.row;
    return md(
      `Brief — ${String(project?.["name"] ?? "untitled project")}`,
      [
        ...p.layers.map((l) => l.row === null
          ? mdSection(l.entity, [], "*(not yet authored)*")
          : mdSection(l.entity, authoredLines(l.row, l.entity !== "project"))),
        mdSection("Themes", p.themes.map((t) =>
          `- **${String(t["name"])}**` +
          (t["description"] !== null && t["description"] !== ""
            ? `: ${String(t["description"])}` : ""))),
      ]);
  },
};

// ---------------------------------------------------------------------------
// Q01 — Subject dossier (generic via subject/scope registry metadata)
// ---------------------------------------------------------------------------

export interface DossierGroup { entity: string; rows: Row[]; }
export interface Q01Payload {
  subjectType: string;
  subject: Row | null;
  groups: DossierGroup[];
  motifCarriage: Array<{ appearance: Row; motif: Row | null }>;
  thematicConnections: Row[];
}

async function dossier(ctx: ScfContext, subjectType: string,
                       subjectId: number): Promise<Q01Payload> {
  const subject = (await rows(ctx.exec, subjectType, "id = ?",
                              [subjectId]))[0] ?? null;
  const idField = `${subjectType}_id`;
  const groups: DossierGroup[] = [];
  // The G2 walk: every entity on X's subject axis at global scope,
  // linked by the subject reference. No hand-maintained lists.
  for (const name of ctx.registry.order) {
    const e = ctx.registry.entities.get(name);
    if (e === undefined || e.subject !== subjectType ||
        e.scope !== "global" || name === subjectType) {
      continue;
    }
    if (!e.fields.some((f) => f.name === idField &&
                              f.fieldType === "reference")) {
      continue;
    }
    const found = await rows(ctx.exec, name, `${q(idField)} = ?`,
                             [subjectId]);
    if (found.length > 0) groups.push({ entity: name, rows: found });
  }
  const carriage = await rows(
    ctx.exec, "motif_appearance", "entity_type = ? AND entity_id = ?",
    [subjectType, subjectId]);
  const motifCarriage = [];
  for (const appearance of carriage) {
    const motif = (await rows(ctx.exec, "motif", "id = ?",
                              [appearance["motif_id"] ?? null]))[0] ?? null;
    motifCarriage.push({ appearance, motif });
  }
  const thematicConnections = await rows(
    ctx.exec, "thematic_connection", "entity_type = ? AND entity_id = ?",
    [subjectType, subjectId]);
  return { subjectType, subject, groups, motifCarriage,
           thematicConnections };
}

function dossierMarkdown(p: Q01Payload): string[] {
  return [
    ...p.groups.map((g) => mdSection(g.entity,
      g.rows.flatMap((r) => [
        `- **${String(r["name"] ?? `#${String(r["id"])}`)}**`,
        ...authoredLines(r).map((l) => `  ${l}`),
      ]))),
    mdSection("Motif carriage", p.motifCarriage.map((m) =>
      `- ${String(m.motif?.["name"] ?? "motif")}` +
      (m.appearance["domain"] !== null &&
       m.appearance["domain"] !== undefined
        ? ` (${String(m.appearance["domain"])})` : ""))),
    mdSection("Thematic connections", p.thematicConnections.map((t) =>
      `- ${String(t["nature_of_connection"] ?? "connected")}` +
      ` (subtlety: ${String(t["subtlety_level"] ?? "—")})`)),
  ];
}

export const q01: QuerySpec = {
  id: "Q01",
  name: "Subject dossier",
  description: "Everything about X, before any scene bends it — the " +
               "timeless subject, walked generically from subject/scope " +
               "registry metadata.",
  params: [
    { key: "subject", label: "Subject type", kind: "subjectType" },
    { key: "subject_id", label: "Subject", kind: "subjectId" },
  ],
  run: async (ctx, values): Promise<Q01Payload> => {
    const subjectId = num(values["subject_id"]);
    if (subjectId === null) throw new Error("pick a subject");
    return dossier(ctx, String(values["subject"] ?? "character"),
                   subjectId);
  },
  toMarkdown: (payload): string => {
    const p = payload as Q01Payload;
    return md(`Dossier — ${String(p.subject?.["name"] ?? "?")}`,
              dossierMarkdown(p));
  },
};

// ---------------------------------------------------------------------------
// Q02 — Subject in context (the flagship)
// ---------------------------------------------------------------------------

export interface ContextLayer {
  label: string;
  scope: string;
  kind: "dossier" | "rows" | "media";
  groups?: DossierGroup[];
  rows?: Row[];
  media?: Awaited<ReturnType<typeof resolveMedia>>;
}

export interface Q02Payload {
  subjectType: string;
  subject: Row | null;
  scene: Row | null;
  stack: ContextLayer[];
}

export const q02: QuerySpec = {
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
  run: async (ctx, values): Promise<Q02Payload> => {
    const subjectType = String(values["subject"] ?? "character");
    const subjectId = num(values["subject_id"]);
    const sceneId = num(values["scene_id"]);
    const shotId = num(values["shot_id"] ?? null);
    if (subjectId === null || sceneId === null) {
      throw new Error("pick a subject and a scene");
    }
    const order = await sceneOrder(ctx);
    const d = await dossier(ctx, subjectType, subjectId);
    const scene = (await rows(ctx.exec, "scene", "id = ?",
                              [sceneId]))[0] ?? null;
    const stack: ContextLayer[] = [
      { label: "Dossier (global baseline)", scope: "global",
        kind: "dossier", groups: d.groups },
    ];

    if (subjectType === "character") {
      const costumes = await ctx.exec(
        "SELECT cs.*, c.name AS name FROM costume_scene cs " +
        "JOIN costume c ON c.id = cs.costume_id " +
        "WHERE cs.scene_id = ? AND c.character_id = ?",
        [sceneId, subjectId]);
      stack.push({ label: "Costume in force (pattern 1: explicit rows)",
                   scope: "scene", kind: "rows", rows: costumes });

      const rels = await rows(
        ctx.exec, "character_relationship",
        "character_a_id = ? OR character_b_id = ?",
        [subjectId, subjectId]);
      const relStates: Row[] = [];
      for (const rel of rels) {
        const state = await relationshipStateAt(
          ctx, rel["id"] as number, sceneId, order);
        if (state !== null) {
          relStates.push({ ...state,
                           name: `${String(rel["name"])}: ` +
                                 `${String(state["stage_label"] ?? "")}` });
        }
      }
      stack.push({ label: "Relationship state as of here (latest-wins)",
                   scope: "scene", kind: "rows", rows: relStates });

      stack.push({
        label: "Performance states in force (persistence-aware)",
        scope: "scene", kind: "rows",
        rows: await statesInForce(ctx, subjectId, sceneId, null, order),
      });

      const beats = await rows(
        ctx.exec, "performance_beat",
        "character_id = ? AND scene_id = ?", [subjectId, sceneId]);
      stack.push({ label: "Moment direction (beats)", scope: "moment",
                   kind: "rows", rows: beats });
    }

    if (subjectType === "location") {
      const [variant, mismatches] = await selectLocationVariant(ctx,
                                                                sceneId);
      stack.push({
        label: "Variant in force (G4 selection)" +
          (mismatches.length > 0
            ? ` — mismatches: ${mismatches.join("; ")}` : ""),
        scope: "scene", kind: "rows",
        rows: variant !== null ? [variant] : [],
      });
      stack.push({
        label: "Scene detail at this location", scope: "scene",
        kind: "rows",
        rows: await rows(ctx.exec, "set_dressing", "scene_id = ?",
                         [sceneId]),
      });
    }

    if (subjectType === "prop") {
      const inForce = await propStateAt(ctx, subjectId, sceneId, order);
      stack.push({ label: "Prop state as of here (latest-wins)",
                   scope: "scene", kind: "rows",
                   rows: inForce !== null ? [inForce] : [] });
    }

    const intent = subjectType === "location"
      ? "environment" : "visual_identity";
    stack.push({
      label: `Media in force (Q13, intent=${intent}` +
        `${shotId !== null ? ", shot overrides honored" : ""})`,
      scope: shotId !== null ? "shot" : "scene", kind: "media",
      media: await resolveMedia(ctx, subjectType, subjectId, intent,
                                sceneId, shotId),
    });

    return { subjectType, subject: d.subject, scene, stack };
  },
  toMarkdown: (payload): string => {
    const p = payload as Q02Payload;
    return md(
      `${String(p.subject?.["name"] ?? "?")} in ` +
      `${String(p.scene?.["name"] ?? "scene")} — context stack, ` +
      `most specific last`,
      p.stack.map((layer) => {
        if (layer.kind === "dossier") {
          return mdSection(layer.label,
            (layer.groups ?? []).flatMap((g) =>
              g.rows.map((r) =>
                `- [${g.entity}] ${String(r["name"] ?? "")}`)));
        }
        if (layer.kind === "media") {
          return mdSection(layer.label,
            (layer.media?.assets_most_specific_first ?? []).map((a) =>
              `- ${String(a["name"])}`),
            "*(nothing resolves)*");
        }
        return mdSection(layer.label,
          (layer.rows ?? []).flatMap((r) => [
            `- **${String(r["name"] ?? `#${String(r["id"])}`)}**`,
            ...authoredLines(r).map((l) => `  ${l}`),
          ]),
          "*(none — well-defined absence)*");
      }));
  },
};

// ---------------------------------------------------------------------------
// Q04 — Scene package
// ---------------------------------------------------------------------------

const SCENE_DETAIL = ["scene_emotional_target", "scene_color_palette",
                      "lighting_design", "scene_music_design",
                      "dialogue_sound_design", "set_dressing",
                      "tone_marker"] as const;

export interface Q04Payload {
  scene: Row | null;
  lineage: Array<{ entity: string; row: Row }>;
  storyBeats: Row[];
  cast: Row[];
  props: Row[];
  location: Row | null;
  variant: Row | null;
  variantMismatches: string[];
  detail: Array<{ entity: string; rows: Row[] }>;
  blocking: Row[];
  stagingBeats: Row[];
}

export const q04: QuerySpec = {
  id: "Q04",
  name: "Scene package",
  description: "The complete context for a scene — the scene as a work " +
               "surface. (Screenplay text joins when Part 3's " +
               "lines-are-rows storage lands.)",
  params: [{ key: "scene_id", label: "Scene", kind: "scene" }],
  run: async (ctx, values): Promise<Q04Payload> => {
    const sceneId = num(values["scene_id"]);
    if (sceneId === null) throw new Error("pick a scene");
    const scene = (await rows(ctx.exec, "scene", "id = ?",
                              [sceneId]))[0] ?? null;

    const lineage: Array<{ entity: string; row: Row }> = [];
    const links = await rows(ctx.exec, "scene_sequence", "scene_id = ?",
                             [sceneId]);
    for (const link of links) {
      const seq = (await rows(ctx.exec, "sequence", "id = ?",
                              [link["sequence_id"] ?? null]))[0];
      if (seq !== undefined) {
        const act = (await rows(ctx.exec, "act", "id = ?",
                                [seq["act_id"] ?? null]))[0];
        if (act !== undefined) lineage.push({ entity: "act", row: act });
        lineage.push({ entity: "sequence", row: seq });
      }
    }

    const storyBeats = await rows(ctx.exec, "story_beat", "scene_id = ?",
                                  [sceneId]);
    storyBeats.sort((a, b) =>
      ((a["beat_order"] as number) ?? 0) -
      ((b["beat_order"] as number) ?? 0));

    const cast = await ctx.exec(
      "SELECT c.* FROM scene_character sc JOIN character c " +
      "ON c.id = sc.character_id WHERE sc.scene_id = ?", [sceneId]);
    const props = await ctx.exec(
      "SELECT p.* FROM scene_prop sp JOIN prop p " +
      "ON p.id = sp.prop_id WHERE sp.scene_id = ?", [sceneId]);

    const location = scene?.["location_id"] !== null &&
                     scene?.["location_id"] !== undefined
      ? (await rows(ctx.exec, "location", "id = ?",
                    [scene["location_id"]]))[0] ?? null
      : null;
    const [variant, variantMismatches] =
      await selectLocationVariant(ctx, sceneId);

    const detail = [];
    for (const entity of SCENE_DETAIL) {
      if (!ctx.registry.entities.has(entity)) continue;
      const found = await rows(ctx.exec, entity, "scene_id = ?",
                               [sceneId]);
      if (found.length > 0) detail.push({ entity, rows: found });
    }

    const blocking = await rows(ctx.exec, "scene_blocking", "scene_id = ?",
                                [sceneId]);
    const stagingBeats: Row[] = [];
    for (const b of blocking) {
      stagingBeats.push(...await rows(
        ctx.exec, "staging_beat", "scene_blocking_id = ?",
        [b["id"] ?? null]));
    }
    stagingBeats.sort((a, b) =>
      ((a["beat_order"] as number) ?? 0) -
      ((b["beat_order"] as number) ?? 0));

    return { scene, lineage, storyBeats, cast, props, location, variant,
             variantMismatches, detail, blocking, stagingBeats };
  },
  toMarkdown: (payload): string => {
    const p = payload as Q04Payload;
    return md(`Scene package — ${String(p.scene?.["name"] ?? "?")}`, [
      mdSection("Structural lineage", p.lineage.map((l) =>
        `- [${l.entity}] ${String(l.row["name"])}`)),
      mdSection("Story beats", p.storyBeats.map((b) =>
        `- ${String(b["name"] ?? "")} (${String(b["beat_type"] ?? "beat")})` +
        (b["value_shift"] !== null && b["value_shift"] !== ""
          ? ` — ${String(b["value_shift"])}` : ""))),
      mdSection("Cast", p.cast.map((c) => `- ${String(c["name"])}`)),
      mdSection("Props", p.props.map((x) => `- ${String(x["name"])}`)),
      mdSection("Location",
        p.location !== null
          ? [`- ${String(p.location["name"])}` +
             (p.variant !== null
               ? ` — variant in force: ${String(p.variant["name"])}` : ""),
             ...p.variantMismatches.map((m) => `  - mismatch: ${m}`)]
          : []),
      ...p.detail.map((d) => mdSection(d.entity,
        d.rows.flatMap((r) => [
          `- **${String(r["name"] ?? "")}**`,
          ...authoredLines(r).map((l) => `  ${l}`),
        ]))),
      mdSection("Staging", [
        ...p.blocking.map((b) => `- blocking: ${String(b["name"] ?? "")}`),
        ...p.stagingBeats.map((b) =>
          `  - beat ${String(b["beat_order"] ?? "")}: ` +
          `${String(b["name"] ?? b["description"] ?? "")}`),
      ]),
      "\n*Screenplay text joins this package when Part 3 lands.*",
    ]);
  },
};

// ---------------------------------------------------------------------------
// Q09 — Motif manifest
// ---------------------------------------------------------------------------

/** Heuristic density threshold — flagged in the UI as a heuristic. */
export const MOTIF_DENSITY_THRESHOLD = 3;

export interface Q09Payload {
  scene: Row | null;
  manifest: Array<{
    appearance: Row; motif: Row | null; state: Row | null;
  }>;
  candidates: Row[];
  dense: boolean;
}

export const q09: QuerySpec = {
  id: "Q09",
  name: "Motif manifest",
  description: "Which motifs should be perceivable in a scene, and how — " +
               "a placement checklist with subtlety, evolution state, and " +
               "cross-modality candidates.",
  params: [{ key: "scene_id", label: "Scene", kind: "scene" }],
  run: async (ctx, values): Promise<Q09Payload> => {
    const sceneId = num(values["scene_id"]);
    if (sceneId === null) throw new Error("pick a scene");
    const order = await sceneOrder(ctx);
    const scene = (await rows(ctx.exec, "scene", "id = ?",
                              [sceneId]))[0] ?? null;
    const appearances = await rows(ctx.exec, "motif_appearance",
                                   "scene_id = ?", [sceneId]);
    const manifest = [];
    const presentMotifIds = new Set<number>();
    for (const appearance of appearances) {
      const mid = num(appearance["motif_id"]);
      const motif = mid !== null
        ? (await rows(ctx.exec, "motif", "id = ?", [mid]))[0] ?? null
        : null;
      if (mid !== null) presentMotifIds.add(mid);
      manifest.push({
        appearance, motif,
        state: mid !== null
          ? await motifStateAt(ctx, mid, sceneId, order) : null,
      });
    }
    // Cross-links: if the door is in frame, the chime is a candidate.
    const candidates: Row[] = [];
    for (const { motif } of manifest) {
      const related = num(motif?.["related_motif_id"]);
      if (related !== null && !presentMotifIds.has(related)) {
        const r = (await rows(ctx.exec, "motif", "id = ?", [related]))[0];
        if (r !== undefined &&
            !candidates.some((c) => c["id"] === r["id"])) {
          candidates.push(r);
        }
      }
    }
    return { scene, manifest, candidates,
             dense: manifest.length > MOTIF_DENSITY_THRESHOLD };
  },
  toMarkdown: (payload): string => {
    const p = payload as Q09Payload;
    return md(`Motif manifest — ${String(p.scene?.["name"] ?? "?")}`, [
      p.dense
        ? `**Density warning:** ${p.manifest.length} motifs in one ` +
          `scene (heuristic threshold ${MOTIF_DENSITY_THRESHOLD}).\n`
        : "",
      mdSection("Checklist", p.manifest.map((m) =>
        `- [ ] **${String(m.motif?.["name"] ?? "motif")}** — domain: ` +
        `${String(m.appearance["domain"] ?? "—")}; subtlety: ` +
        `${String(m.state?.["subtlety_level"] ??
                  m.motif?.["subtlety_level"] ?? "—")}` +
        (m.appearance["manifestation_notes"] !== null &&
         m.appearance["manifestation_notes"] !== ""
          ? `; ${String(m.appearance["manifestation_notes"])}` : "")),
        "*(no motifs placed here)*"),
      mdSection("Cross-modality candidates (related motifs not placed)",
        p.candidates.map((c) => `- ${String(c["name"])}`)),
    ]);
  },
};

// ---------------------------------------------------------------------------
// Q10 — Thematic accounting
// ---------------------------------------------------------------------------

export interface Q10Payload {
  theme: Row | null;
  connections: Array<{
    connection: Row; targetName: string; sceneIds: number[];
  }>;
  spine: Array<{ scene: Row; count: number }>;
}

export const q10: QuerySpec = {
  id: "Q10",
  name: "Thematic accounting",
  description: "Where a theme lives across the story — carriers on the " +
               "scene spine, gaps visible. (Theme-tagged subtext awaits a " +
               "schema link; `subtext` carries no theme reference in 2.3.)",
  params: [{ key: "theme_id", label: "Theme", kind: "theme" }],
  run: async (ctx, values): Promise<Q10Payload> => {
    const themeId = num(values["theme_id"]);
    if (themeId === null) throw new Error("pick a theme");
    const theme = (await rows(ctx.exec, "theme", "id = ?",
                              [themeId]))[0] ?? null;
    const scenes = await rows(ctx.exec, "scene");
    const order = await sceneOrder(ctx);
    scenes.sort((a, b) =>
      (order.get(a["id"] as number) ?? 0) -
      (order.get(b["id"] as number) ?? 0));

    const connections = [];
    const counts = new Map<number, number>();
    const bump = (sceneId: number): void => {
      counts.set(sceneId, (counts.get(sceneId) ?? 0) + 1);
    };
    for (const connection of await rows(
        ctx.exec, "thematic_connection", "theme_id = ?", [themeId])) {
      const targetType = String(connection["entity_type"] ?? "");
      const targetId = num(connection["entity_id"]);
      let targetName = targetType;
      const sceneIds: number[] = [];
      if (targetId !== null && ctx.registry.entities.has(targetType)) {
        const target = (await rows(ctx.exec, targetType, "id = ?",
                                   [targetId]))[0];
        targetName = `${targetType}: ` +
          `${String(target?.["name"] ?? `#${targetId}`)}`;
        if (targetType === "scene") {
          sceneIds.push(targetId);
        } else if (targetType === "motif") {
          for (const a of await rows(ctx.exec, "motif_appearance",
                                     "motif_id = ?", [targetId])) {
            const sid = num(a["scene_id"]);
            if (sid !== null) sceneIds.push(sid);
          }
        } else if (targetType === "character") {
          for (const link of await rows(ctx.exec, "scene_character",
                                        "character_id = ?", [targetId])) {
            const sid = num(link["scene_id"]);
            if (sid !== null) sceneIds.push(sid);
          }
        }
      }
      for (const sid of sceneIds) bump(sid);
      connections.push({ connection, targetName, sceneIds });
    }
    return {
      theme, connections,
      spine: scenes.map((scene) => ({
        scene, count: counts.get(scene["id"] as number) ?? 0,
      })),
    };
  },
  toMarkdown: (payload): string => {
    const p = payload as Q10Payload;
    const gaps = p.spine.filter((s) => s.count === 0)
      .map((s) => `sc ${String(s.scene["scene_number"] ?? "?")}`);
    return md(`Thematic accounting — ${String(p.theme?.["name"] ?? "?")}`, [
      mdSection("Carriers", p.connections.map((c) =>
        `- ${c.targetName} (${String(
          c.connection["nature_of_connection"] ?? "connected")}) — ` +
        `${c.sceneIds.length} scene(s)`)),
      mdSection("Distribution",
        p.spine.filter((s) => s.count > 0).map((s) =>
          `- sc ${String(s.scene["scene_number"] ?? "?")}: ` +
          `${s.count} carrier(s)`)),
      mdSection("Absent from", gaps.length === p.spine.length
        ? ["- every scene — the theme has no position-keyed carriers"]
        : [`- ${gaps.join(", ") || "nowhere — full coverage"}`]),
    ]);
  },
};

// ---------------------------------------------------------------------------
// Q11 — Audience state
// ---------------------------------------------------------------------------

export interface Q11Payload {
  scene: Row | null;
  information: Row | null;
  identification: {
    row: Row; primary: Row | null; secondary: Row | null;
  } | null;
  emotionalBeats: Array<{ beat: Row; arc: Row | null }>;
  toneMarkers: Row[];
  emotionalCascade: Array<[string, Row]>;
}

export const q11: QuerySpec = {
  id: "Q11",
  name: "Audience state",
  description: "What the audience knows and should feel at a position — " +
               "known/withheld, identification, and the emotional " +
               "direction cascade (tone root → scene target).",
  params: [{ key: "scene_id", label: "Scene", kind: "scene" }],
  run: async (ctx, values): Promise<Q11Payload> => {
    const sceneId = num(values["scene_id"]);
    if (sceneId === null) throw new Error("pick a scene");
    const scene = (await rows(ctx.exec, "scene", "id = ?",
                              [sceneId]))[0] ?? null;
    const information = (await rows(
      ctx.exec, "information_strategy", "scene_id = ?",
      [sceneId]))[0] ?? null;

    const identRow = (await rows(
      ctx.exec, "identification_strategy", "scene_id = ?",
      [sceneId]))[0];
    let identification: Q11Payload["identification"] = null;
    if (identRow !== undefined) {
      const get = async (field: string): Promise<Row | null> => {
        const id = num(identRow[field]);
        return id === null ? null
          : (await rows(ctx.exec, "character", "id = ?", [id]))[0] ?? null;
      };
      identification = {
        row: identRow,
        primary: await get("primary_character_id"),
        secondary: await get("secondary_character_id"),
      };
    }

    const emotionalBeats = [];
    for (const beat of await rows(ctx.exec, "emotional_beat",
                                  "scene_id = ?", [sceneId])) {
      const arc = (await rows(ctx.exec, "emotional_arc", "id = ?",
                              [beat["emotional_arc_id"] ?? null]))[0]
        ?? null;
      emotionalBeats.push({ beat, arc });
    }

    return {
      scene, information, identification, emotionalBeats,
      toneMarkers: await rows(ctx.exec, "tone_marker", "scene_id = ?",
                              [sceneId]),
      emotionalCascade: await resolveDirection(
        ctx, "scene_emotional_target", sceneId),
    };
  },
  toMarkdown: (payload): string => {
    const p = payload as Q11Payload;
    return md(`Audience state — ${String(p.scene?.["name"] ?? "?")}`, [
      mdSection("Known / withheld", p.information !== null
        ? authoredLines(p.information) : [],
        "*(no information strategy authored)*"),
      mdSection("Identification", p.identification !== null
        ? [`- primary: ${String(
              p.identification.primary?.["name"] ?? "—")}`,
           ...(p.identification.secondary !== null
             ? [`- secondary: ${String(
                   p.identification.secondary["name"])}`] : []),
           ...authoredLines(p.identification.row)]
        : [], "*(no identification strategy authored)*"),
      mdSection("Emotional beats", p.emotionalBeats.map((e) =>
        `- ${String(e.beat["target_emotion"] ?? e.beat["name"] ?? "")}` +
        (e.arc !== null ? ` (arc: ${String(e.arc["name"])})` : ""))),
      mdSection("Tone", p.toneMarkers.flatMap((t) => [
        `- **${String(t["tone_descriptor"] ?? t["name"] ?? "")}**`,
        ...authoredLines(t).map((l) => `  ${l}`),
      ])),
      mdSection("Emotional direction cascade, root first",
        p.emotionalCascade.map(([entity, row], i) =>
          `${i + 1}. **${entity}**: ` +
          `${String(row["name"] ?? "")}` +
          (i === p.emotionalCascade.length - 1 ? " ← in force" : ""))),
    ]);
  },
};

// ---------------------------------------------------------------------------
// Q15 — Provenance
// ---------------------------------------------------------------------------

export interface Q15Payload {
  entityType: string;
  row: Row | null;
  versionChain: Row[];
  attached: { decisions: Row[]; notes: Row[] };
  unattached: { decisions: Row[]; notes: Row[] };
}

export const q15: QuerySpec = {
  id: "Q15",
  name: "Provenance",
  description: "Why is this value what it is, and who touched it — " +
               "decisions, notes, and lifecycle/version metadata for a " +
               "row. Unattached decisions are listed rather than hidden.",
  params: [
    { key: "entity_type", label: "Entity type", kind: "entityType" },
    { key: "row_id", label: "Row", kind: "entityRow" },
  ],
  run: async (ctx, values): Promise<Q15Payload> => {
    const entityType = String(values["entity_type"] ?? "");
    const rowId = num(values["row_id"]);
    if (!ctx.registry.entities.has(entityType) || rowId === null) {
      throw new Error("pick an entity and a row");
    }
    const row = (await rows(ctx.exec, entityType, "id = ?",
                            [rowId]))[0] ?? null;

    // Version chain (versionable entities): walk parent links back,
    // successor links forward.
    const versionChain: Row[] = [];
    const edef = ctx.registry.entities.get(entityType);
    if (edef?.versionable === true && row !== null) {
      let cursor: Row | null = row;
      const seen = new Set<number>();
      while (cursor !== null) {
        const pid = num(cursor["parent_id"]);
        if (pid === null || seen.has(pid)) break;
        seen.add(pid);
        cursor = (await rows(ctx.exec, entityType, "id = ?",
                             [pid]))[0] ?? null;
        if (cursor !== null) versionChain.unshift(cursor);
      }
      versionChain.push(row);
      cursor = row;
      while (cursor !== null) {
        const sid = num(cursor["superseded_by_id"]);
        if (sid === null || seen.has(sid)) break;
        seen.add(sid);
        cursor = (await rows(ctx.exec, entityType, "id = ?",
                             [sid]))[0] ?? null;
        if (cursor !== null) versionChain.push(cursor);
      }
    }

    const decisions = await rows(ctx.exec, "creative_decision");
    const notes = await rows(ctx.exec, "collaboration_note");
    const split = <T extends Row>(items: T[]): [T[], T[]] => {
      const attached = items.filter((d) =>
        mentionsRow(d["affected_entities"], entityType, rowId));
      return [attached,
              items.filter((d) => !attached.includes(d) &&
                (d["affected_entities"] === null ||
                 d["affected_entities"] === ""))];
    };
    const [attachedD, unattachedD] = split(decisions);
    const [attachedN, unattachedN] = split(notes);
    return {
      entityType, row, versionChain,
      attached: { decisions: attachedD, notes: attachedN },
      unattached: { decisions: unattachedD, notes: unattachedN },
    };
  },
  toMarkdown: (payload): string => {
    const p = payload as Q15Payload;
    const card = (r: Row): string[] => [
      `- **${String(r["name"] ?? "")}**`,
      ...authoredLines(r).map((l) => `  ${l}`),
    ];
    return md(
      `Provenance — ${p.entityType}: ${String(p.row?.["name"] ?? "?")}`, [
      mdSection("Lifecycle", p.row !== null ? [
        `- lifecycle_status: ${String(p.row["lifecycle_status"] ?? "—")}`,
        `- created: ${String(p.row["created_at"] ?? "—")}`,
        `- updated: ${String(p.row["updated_at"] ?? "—")}`,
        `- uuid: ${String(p.row["uuid"] ?? "—")}`,
      ] : []),
      mdSection("Version chain", p.versionChain.map((v) =>
        `- ${String(v["version_label"] ?? `#${String(v["id"])}`)}` +
        (v["id"] === p.row?.["id"] ? " ← this row" : "") +
        (v["superseded_at"] !== null && v["superseded_at"] !== ""
          ? ` (superseded ${String(v["superseded_at"])})` : ""))),
      mdSection("Attached decisions",
        p.attached.decisions.flatMap(card)),
      mdSection("Attached notes", p.attached.notes.flatMap(card)),
      mdSection("Unattached decisions (no affected_entities recorded)",
        p.unattached.decisions.flatMap(card)),
      mdSection("Unattached notes (no affected_entities recorded)",
        p.unattached.notes.flatMap(card)),
    ]);
  },
};

export const COMPOSED_QUERIES: QuerySpec[] =
  [q00, q01, q02, q04, q09, q10, q11, q15];
