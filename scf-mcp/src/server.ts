#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * server.ts — scf-mcp, a stdio MCP server over one `.scf` file
 * (spec/scf-mcp-design.md §5).
 *
 * Five tools:
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
 * Local process, no hosting: the `.scf` path and any root mappings come
 * from the command line (or an optional --config file), the same way
 * any locally-run stdio MCP server is pointed at its target by the
 * client that spawns it.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  listEntities, loadRegistry, resolveNaturalKey, shotContext,
  type RegistryJson, type ScfContext,
} from "@minimalhumans/scf-core";
import { openNodeDatabase } from "@minimalhumans/scf-core/node";
import registryJson from "@minimalhumans/scf-core/registry.json" with { type: "json" };
import { parseConfig } from "./config.ts";
import { buildDispatch, type QueryParams } from "./dispatch.ts";
import { makeNodeLocator } from "./nodeLocator.ts";

const config = parseConfig(process.argv.slice(2));
const db = openNodeDatabase(config.scfPath, { readOnly: true });
const registry = loadRegistry(registryJson as unknown as RegistryJson);
const ctx: ScfContext = { exec: db.exec, registry };

const locate = makeNodeLocator(config.roots);
const rootMapped = Object.keys(config.roots).length > 0;
const dispatch = buildDispatch(locate, rootMapped);
const q14 = dispatch["Q14"];
if (q14 === undefined) throw new Error("internal: Q14 dispatch missing");

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function err(e: unknown): CallToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: message }], isError: true };
}

const server = new McpServer({ name: "scf-mcp", version: "0.1.0" });

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
    return ok(await resolveNaturalKey(ctx, entityType, label));
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
    return ok(await listEntities(ctx, entityType, filter));
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
    return ok(await shotContext(ctx, shotUuid, locate, rootMapped));
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
  },
}, async ({ id, params }) => {
  const run = dispatch[id];
  if (run === undefined) {
    return err(new Error(
      `unknown query id "${id}" — expected one of ` +
      `${Object.keys(dispatch).sort().join(", ")}`));
  }
  try {
    return ok(await run(ctx, (params ?? {}) as QueryParams));
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
  },
}, async ({ queryId, params }) => {
  try {
    const merged: QueryParams = { ...(params ?? {}), target: queryId };
    return ok(await q14(ctx, merged));
  } catch (e) {
    return err(e);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
