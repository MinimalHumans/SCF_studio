#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * server.ts — scf-mcp, a stdio MCP server over `.scf` files
 * (spec/scf-mcp-design.md §5).
 *
 * Six tools:
 *   open          open (or switch to) a film, with optional root
 *                 mappings — returns a quick summary
 *   find          label -> uuid (resolveNaturalKey)
 *   list          every row of an entity type, optionally filtered
 *                 (listEntities) — for a caller with nothing in hand
 *   shot_context  the "prompt for shot X" composite (shotContext)
 *   query         any of the sixteen canonical queries, unwrapped
 *   readiness     Q14 directly, for pre-flight
 *
 * This server READS. It has no write tools, per the design doc's
 * boundary: SCF is the ground truth of the film, not the workflow for
 * making it.
 *
 * Every tool but `open` takes an optional `scfPath` — see
 * projectCache.ts for why. `--scf`/`--root` set a default project at
 * startup so a single-film setup needs neither `open` nor a `scfPath`
 * argument anywhere; both stay fully optional.
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
import { currentProject, openProject } from "./projectCache.ts";

const config = parseConfig(process.argv.slice(2));
if (config.scfPath !== undefined) openProject(config.scfPath, config.roots);

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function err(e: unknown): CallToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: message }], isError: true };
}

const scfPathArg = z.string().optional().describe(
  "Which film — omit to use whichever project was opened or used " +
  "most recently in this server. An absolute path is safest; a " +
  "relative one resolves against the server process's own working " +
  "directory, not the caller's.");

const server = new McpServer({ name: "scf-mcp", version: "0.1.0" });

server.registerTool("open", {
  description: "Open (or switch to) a film, optionally mapping asset " +
    "roots. Every other tool defaults to whichever film was opened or " +
    "used most recently, so call this once per film per conversation " +
    "— then omit scfPath elsewhere. Calling it again for a film " +
    "already open adds any new roots without dropping the ones " +
    "already set. Returns a quick summary so you can confirm you " +
    "opened the right file.",
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
    scfPath: scfPathArg,
  },
}, async ({ entityType, label, scfPath }) => {
  try {
    const project = currentProject(scfPath);
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
    scfPath: scfPathArg,
  },
}, async ({ entityType, filter, scfPath }) => {
  try {
    const project = currentProject(scfPath);
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
    scfPath: scfPathArg,
  },
}, async ({ shotUuid, scfPath }) => {
  try {
    const project = currentProject(scfPath);
    return ok(await shotContext(
      project.ctx, shotUuid, project.locate, project.rootMapped));
  } catch (e) {
    return err(e);
  }
});

const paramsSchema = z.record(z.string(), z.union([z.string(), z.null()]))
  .optional().describe("Named uuid/string parameters the query needs " +
    "(e.g. {\"scene\": \"<uuid>\", \"shot\": \"<uuid>\"}). See each " +
    "query's own description in spec §12 for what it takes.");

server.registerTool("query", {
  description: "Any of the sixteen canonical queries (Q00-Q15), by id, " +
    "with named uuid parameters instead of the row ids the library " +
    "itself takes.",
  inputSchema: {
    id: z.string().describe("A query id, e.g. \"Q04\"."),
    params: paramsSchema,
    scfPath: scfPathArg,
  },
}, async ({ id, params, scfPath }) => {
  try {
    const project = currentProject(scfPath);
    const dispatch = buildDispatch(project.locate, project.rootMapped);
    const run = dispatch[id];
    if (run === undefined) {
      return err(new Error(
        `unknown query id "${id}" — expected one of ` +
        `${Object.keys(dispatch).sort().join(", ")}`));
    }
    return ok(await run(project.ctx, (params ?? {}) as QueryParams));
  } catch (e) {
    return err(e);
  }
});

server.registerTool("readiness", {
  description: "Q14 directly: what is thin for a given target query " +
    "and position, for pre-flight before writing a prompt.",
  inputSchema: {
    queryId: z.string().describe(
      "The target query to assess, e.g. \"Q05\", \"Q07\"."),
    params: paramsSchema,
    scfPath: scfPathArg,
  },
}, async ({ queryId, params, scfPath }) => {
  try {
    const project = currentProject(scfPath);
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
