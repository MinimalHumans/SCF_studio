// SPDX-License-Identifier: Apache-2.0
/**
 * queryTools.ts — one MCP tool per canonical query, precisely typed.
 *
 * Originally these sixteen went through a single generic `query(id,
 * params)` tool with a loose `Record<string, string>` schema. In use,
 * an agent given that shape had no way to know which params a given id
 * needed short of guessing or reading source — the same discoverability
 * failure `list` was built to fix for enumeration, here for parameters.
 *
 * The fix leans on something that already existed and was already
 * authoritative: every query's name, one-line purpose and exact
 * parameter names are published in spec/scf-spec.md §12 (Q00 §12.12
 * through Q15 §12.14) — copied here as data, not re-derived, so this
 * catalog can't say something the spec doesn't. Each entry becomes one
 * `registerTool` call with a Zod shape naming exactly the params
 * dispatch.ts's `buildDispatch` already expects, so a wrong or missing
 * parameter is rejected by schema validation before it reaches the
 * server at all, not discovered by a failed call.
 *
 * Q14 is deliberately not here — the friendlier, separately-named
 * `readiness` tool in server.ts already is Q14, and a "Q14" tool
 * alongside it would be the same capability under two names.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import { buildDispatch, type QueryParams } from "./dispatch.ts";
import { currentProject } from "./projectCache.ts";

interface QueryToolSpec {
  id: string;
  /** spec/scf-spec.md §12 title, e.g. "Subject in context". */
  title: string;
  section: string;
  /** The spec's own bolded one-line summary. */
  summary: string;
  /** This query's own params — nothing else is added. */
  shape: ZodRawShape;
}

const uuid = (of: string): z.ZodString =>
  z.string().describe(`Uuid of the ${of}, e.g. from find() or list().`);

const subjectFields: ZodRawShape = {
  subjectType: z.string().describe(
    "Registry entity name of the subject's kind, e.g. \"character\", " +
    "\"location\", \"prop\"."),
  subject: uuid("subject"),
};

const CATALOG: QueryToolSpec[] = [
  { id: "Q00", title: "Brief", section: "§12.12",
    summary: "What film is this, and what are its rules.",
    shape: {} },
  { id: "Q01", title: "Subject dossier", section: "§12.15",
    summary: "Everything about a subject, before any scene bends it.",
    shape: { ...subjectFields } },
  { id: "Q02", title: "Subject in context", section: "§12.16",
    summary: "Everything needed to realise a subject in a scene, and " +
      "optionally a shot.",
    shape: { ...subjectFields, scene: uuid("scene"),
             shot: uuid("shot").optional() } },
  { id: "Q03", title: "World state", section: "§12.4",
    summary: "Everything true at one position.",
    shape: { scene: uuid("scene") } },
  { id: "Q04", title: "Scene package", section: "§12.17",
    summary: "The complete context for a scene, as a unit of work.",
    shape: { scene: uuid("scene") } },
  { id: "Q05", title: "Voice direction", section: "§12.2",
    summary: "How this character's lines should sound in this scene.",
    shape: { character: uuid("character"), scene: uuid("scene") } },
  { id: "Q06", title: "Physical direction", section: "§12.6",
    summary: "How this character moves and behaves in this scene.",
    shape: { character: uuid("character"), scene: uuid("scene") } },
  { id: "Q07", title: "Look resolution", section: "§12.3",
    summary: "What a frame in this scene, or this shot, should look " +
      "like.",
    shape: { scene: uuid("scene"), shot: uuid("shot").optional() } },
  { id: "Q08", title: "Soundscape", section: "§12.7",
    summary: "What this scene sounds like. No shot — sound is " +
      "authored at the scene.",
    shape: { scene: uuid("scene") } },
  { id: "Q09", title: "Motif manifest", section: "§12.10",
    summary: "Which motifs should be perceivable in this scene, and " +
      "how.",
    shape: { scene: uuid("scene") } },
  { id: "Q10", title: "Thematic accounting", section: "§12.11",
    summary: "Where a theme lives across the whole story, and where " +
      "it does not.",
    shape: { theme: uuid("theme") } },
  { id: "Q11", title: "Audience state", section: "§12.13",
    summary: "What the audience knows and should feel at a position.",
    shape: { scene: uuid("scene") } },
  { id: "Q12", title: "Continuity", section: "§12.5",
    summary: "What changed between two positions, in story order " +
      "(never by scene number).",
    shape: { from: uuid("first scene"), to: uuid("second scene") } },
  { id: "Q13", title: "Media resolution", section: "§12.8",
    summary: "Which assets are in force for a subject and an intent.",
    shape: { ...subjectFields,
             intent: z.string().describe(
               "Asset intent, e.g. \"visual_identity\", " +
               "\"voice_identity\", \"motion\"."),
             scene: uuid("scene").optional(),
             shot: uuid("shot").optional() } },
  { id: "Q15", title: "Provenance", section: "§12.14",
    summary: "Why is this value what it is, and who touched it.",
    shape: { entityType: z.string().describe(
               "Registry entity name of the row asked about."),
             row: uuid("row") } },
];

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function err(e: unknown): CallToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerQueryTools(server: McpServer): void {
  for (const spec of CATALOG) {
    server.registerTool(spec.id, {
      description: `${spec.title} (spec ${spec.section}). ${spec.summary}`,
      inputSchema: { ...spec.shape },
    }, async (args) => {
      try {
        const project = currentProject();
        const dispatch = buildDispatch(project.locate, project.rootMapped);
        const run = dispatch[spec.id];
        if (run === undefined) {
          throw new Error(`internal: no dispatch entry for "${spec.id}"`);
        }
        return ok(await run(project.ctx, args as QueryParams));
      } catch (e) {
        return err(e);
      }
    });
  }
}
