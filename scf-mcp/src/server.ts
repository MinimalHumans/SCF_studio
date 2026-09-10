#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * server.ts — scf-mcp, a stdio MCP server over `.scf` files
 * (spec/scf-mcp-design.md §5).
 *
 * Tools:
 *   open          open (or switch to) a film, with optional root
 *                 mappings — returns a quick summary
 *   find          label -> uuid (resolveNaturalKey)
 *   list          every row of an entity type, optionally filtered
 *                 (listEntities) — for a caller with nothing in hand
 *   shot_context  the "prompt for shot X" composite (shotContext)
 *   Q00..Q13, Q15 one tool per canonical query, precisely typed
 *                 (queryTools.ts) — each id's own params, not a
 *                 generic bag, so a wrong one is a schema error before
 *                 the call is even sent, not a runtime failure
 *   readiness     Q14 directly, for pre-flight
 *
 * This server READS. It has no write tools, per the design doc's
 * boundary: SCF is the ground truth of the film, not the workflow for
 * making it.
 *
 * Exactly one film is open at a time, held in process state — see
 * projectCache.ts. `open` is the only tool that names a `.scf` path;
 * every other tool reads whatever `open` loaded most recently and
 * errors clearly if nothing has been opened yet. `set_root` maps
 * `@root/...` asset identifiers to real directories and is callable at
 * any time, independently of `open`. `--scf`/`--root` open a default
 * project at startup so a single-film setup needs no tool call at all
 * before querying.
 *
 * There used to be one generic `query(id, params)` tool covering all
 * sixteen. It's gone: with `params` typed as a loose string map, an
 * agent had no way to know which keys a given id needed short of
 * guessing or reading source, and got it wrong often enough to be
 * worth fixing. The sixteen dedicated tools below replace it entirely
 * — there is nothing a generic `query` could do that they cannot.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  listEntities, q00Result, resolveNaturalKey, shotContext,
} from "@minimalhumans/scf-core";
import { parseConfig } from "./config.ts";
import { buildDispatch, type QueryParams } from "./dispatch.ts";
import { currentProject, openProject, setRoots } from "./projectCache.ts";
import { registerQueryTools } from "./queryTools.ts";

const config = parseConfig(process.argv.slice(2));
if (config.scfPath !== undefined) openProject(config.scfPath, config.roots);

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function err(e: unknown): CallToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: message }], isError: true };
}

const server = new McpServer({ name: "scf-mcp", version: "0.1.0" });

server.registerTool("open", {
  description: "Open (or switch to) a film, optionally mapping asset " +
    "roots. This is the only tool that takes a file path — every other " +
    "tool operates on whichever film was opened most recently, so call " +
    "this once per film per conversation before anything else. Calling " +
    "it again for a film already open adds any new roots without " +
    "dropping the ones already set. Returns a quick summary so you can " +
    "confirm you opened the right file.",
  inputSchema: {
    scfPath: z.string().describe("Path to the .scf file."),
    roots: z.record(z.string(), z.string()).optional().describe(
      "Root name -> absolute directory, e.g. " +
      "{ \"project\": \"/path/to/project\" }. Matches the `@root/...` " +
      "prefix asset identifiers use inside the file."),
  },
}, async ({ scfPath, roots }) => {
  try {
    const project = openProject(scfPath, roots ?? {});
    const brief = await q00Result(project.ctx);
    const scenes = await listEntities(project.ctx, "scene");
    const shots = await listEntities(project.ctx, "shot");
    const name = brief.result.layers.find((l) => l.entity === "project")
      ?.row.fields["name"] ?? null;
    return ok({
      opened: project.scfPath,
      project: name,
      sceneCount: scenes.length,
      shotCount: shots.length,
      rootMapped: project.rootMapped,
      roots: project.roots,
    });
  } catch (e) {
    return err(e);
  }
});

server.registerTool("set_root", {
  description: "Map @root/... asset identifiers to real directories on " +
    "this machine, for the currently open film. Independent of `open` " +
    "and callable at any time — before or after it, and repeatable to " +
    "add more roots or change existing ones without reopening the file.",
  inputSchema: {
    roots: z.record(z.string(), z.string()).describe(
      "Root name -> absolute directory, e.g. { \"project\": " +
      "\"/path/to/project\" }. Matches the `@root/...` prefix asset " +
      "identifiers use inside the file. Merges into whatever roots " +
      "are already set."),
  },
}, async ({ roots }) => {
  try {
    const project = setRoots(roots);
    return ok({ roots: project.roots, rootMapped: project.rootMapped });
  } catch (e) {
    return err(e);
  }
});

server.registerTool("find", {
  description: "Resolve a natural-key label (a scene number, shot " +
    "number, or name) to the uuid(s) of matching rows. Always returns " +
    "an array; more than one hit means the label is ambiguous in this " +
    "film, not that the tool failed.",
  inputSchema: {
    entityType: z.string().describe(
      "Registry entity name, e.g. \"scene\", \"shot\", \"character\"."),
    label: z.string().describe(
      "The label as written, e.g. \"10A\", \"12-04\", \"Eleanor\"."),
  },
}, async ({ entityType, label }) => {
  try {
    const project = currentProject();
    return ok(await resolveNaturalKey(project.ctx, entityType, label));
  } catch (e) {
    return err(e);
  }
});

server.registerTool("list", {
  description: "Every row of an entity type, optionally filtered to " +
    "rows one reference field points at (e.g. every shot in a scene). " +
    "For a question with no starting uuid or label — \"how many shots " +
    "are there\" — rather than guessing labels through find one at a " +
    "time.",
  inputSchema: {
    entityType: z.string().describe(
      "Registry entity name, e.g. \"scene\", \"shot\", \"character\"."),
    filter: z.object({
      field: z.string().describe(
        "A reference field entityType declares, e.g. \"scene_id\" on " +
        "\"shot\"."),
      uuid: z.string().describe("The uuid the field must point at."),
    }).optional().describe(
      "Narrow to rows pointing at one uuid, e.g. { field: \"scene_id\", " +
      "uuid: \"<scene uuid>\" } for every shot in one scene. Omit to " +
      "list every row of entityType."),
  },
}, async ({ entityType, filter }) => {
  try {
    const project = currentProject();
    return ok(await listEntities(project.ctx, entityType, filter));
  } catch (e) {
    return err(e);
  }
});

server.registerTool("shot_context", {
  description: "Everything needed to write a shot prompt: project " +
    "brief, the scene and its cast, the resolved look, physical " +
    "direction per character, media in force per subject, and a " +
    "pre-flight readiness check. One call in place of the dozen it " +
    "replaces.",
  inputSchema: {
    shotUuid: z.string().describe(
      "A shot's uuid, e.g. from find(\"shot\", \"10A\")."),
  },
}, async ({ shotUuid }) => {
  try {
    const project = currentProject();
    return ok(await shotContext(
      project.ctx, shotUuid, project.locate, project.rootMapped));
  } catch (e) {
    return err(e);
  }
});

registerQueryTools(server);

const READINESS_TARGETS = ["Q02", "Q05", "Q06", "Q07", "Q08", "Q13"] as const;

server.registerTool("readiness", {
  description: "Q14 directly (spec §12.9): what is thin for a given " +
    "target query and position, for pre-flight before writing a " +
    "prompt. Each target needs different params:\n" +
    "  Q02 (Subject in context) — character, scene, shot?\n" +
    "  Q05 (Voice direction)    — character, scene\n" +
    "  Q06 (Physical direction) — character, scene\n" +
    "  Q07 (Look resolution)    — scene, shot?\n" +
    "  Q08 (Soundscape)         — scene\n" +
    "  Q13 (Media resolution)   — subjectType, subject, intent, scene?, shot?",
  inputSchema: {
    queryId: z.enum(READINESS_TARGETS).describe(
      "The target query to assess — only these six have a readiness " +
      "rubric (spec/scf-mcp-design.md §4.2); the other ten are " +
      "analytic and read whatever exists."),
    params: z.record(z.string(), z.union([z.string(), z.null()]))
      .optional().describe(
        "The target's own params by name — see the tool description " +
        "for which ones queryId needs."),
  },
}, async ({ queryId, params }) => {
  try {
    const project = currentProject();
    const dispatch = buildDispatch(project.locate, project.rootMapped);
    const q14 = dispatch["Q14"];
    if (q14 === undefined) throw new Error("internal: Q14 dispatch missing");
    const merged: QueryParams = { ...(params ?? {}), target: queryId };
    return ok(await q14(project.ctx, merged));
  } catch (e) {
    return err(e);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
