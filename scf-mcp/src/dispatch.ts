// SPDX-License-Identifier: Apache-2.0
/**
 * dispatch.ts — reshapes the sixteen canonical queries' positional,
 * (uuid, id)-paired arguments into the named, uuid-only params an agent
 * actually has (spec/scf-mcp-design.md §5, the `query` tool).
 *
 * This is transport glue, not a second description of query semantics:
 * it does not decide what a query means or what its steps require —
 * `QUERY_PATHS` stays the only normative source for that. It only
 * answers "which table does this named param's uuid belong to", which
 * every query already answers by construction (its own parameter
 * names), except Q12, whose `from`/`to` are genuinely untyped — that one
 * uses `findByUuid`'s multi-table search instead of a single guess.
 */

import {
  findByUuid, rows, type FileLocator, type QueryResult, type ScfContext,
  mentionsRow,
  q00Result, q01Result, q02Result, q03Result, q04Result, q05Result,
  q06Result, q07Result, q08Result, q09Result, q10Result, q11Result,
  q12Result, q13Result, q14Result, q15Result,
} from "@minimalhumans/scf-core";

export type QueryParams = Record<string, string | null | undefined>;
type Dispatch = (ctx: ScfContext, params: QueryParams) =>
  Promise<QueryResult<unknown>>;

function required(params: QueryParams, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || v === "") {
    throw new Error(`missing required param "${key}"`);
  }
  return v;
}

function optional(params: QueryParams, key: string): string | null {
  const v = params[key];
  return typeof v === "string" && v !== "" ? v : null;
}

async function idOf(
    ctx: ScfContext, entity: string, uuid: string): Promise<number> {
  const row = (await rows(ctx.exec, entity, "uuid = ?", [uuid]))[0];
  if (row === undefined) {
    throw new Error(`no ${entity} with uuid ${uuid}`);
  }
  return Number(row["id"]);
}

async function optionalId(
    ctx: ScfContext, entity: string, uuid: string | null,
): Promise<number | null> {
  return uuid === null ? null : idOf(ctx, entity, uuid);
}

/** Q12's `from`/`to` carry no type hint — resolved by searching, not by a
 *  fixed table, exactly what `findByUuid` is for. */
async function idOfAny(
    ctx: ScfContext, uuid: string): Promise<number> {
  const hit = (await findByUuid(ctx.exec, ctx.registry, uuid))[0];
  if (hit === undefined) throw new Error(`no row with uuid ${uuid}`);
  return hit.id;
}

/**
 * Q13/Q14 need the session's locator and root-mapped flag, so the
 * dispatch table is built per server instance rather than module-level.
 */
export function buildDispatch(
    locate: FileLocator, rootMapped: boolean): Record<string, Dispatch> {
  return {
    Q00: async (ctx) => q00Result(ctx),

    Q01: async (ctx, p) => {
      const subjectType = required(p, "subjectType");
      const subject = required(p, "subject");
      return q01Result(
        ctx, subjectType, subject, await idOf(ctx, subjectType, subject));
    },

    Q02: async (ctx, p) => {
      const subjectType = required(p, "subjectType");
      const subject = required(p, "subject");
      const scene = required(p, "scene");
      const shot = optional(p, "shot");
      return q02Result(
        ctx, subjectType, subject, await idOf(ctx, subjectType, subject),
        scene, await idOf(ctx, "scene", scene),
        shot, await optionalId(ctx, "shot", shot));
    },

    Q03: async (ctx, p) => {
      const scene = required(p, "scene");
      return q03Result(ctx, scene, await idOf(ctx, "scene", scene));
    },

    Q04: async (ctx, p) => {
      const scene = required(p, "scene");
      return q04Result(ctx, scene, await idOf(ctx, "scene", scene));
    },

    Q05: async (ctx, p) => {
      const character = required(p, "character");
      const scene = required(p, "scene");
      return q05Result(ctx, character, scene,
        await idOf(ctx, "character", character),
        await idOf(ctx, "scene", scene));
    },

    Q06: async (ctx, p) => {
      const character = required(p, "character");
      const scene = required(p, "scene");
      return q06Result(ctx, character, scene,
        await idOf(ctx, "character", character),
        await idOf(ctx, "scene", scene));
    },

    Q07: async (ctx, p) => {
      const scene = required(p, "scene");
      const shot = optional(p, "shot");
      return q07Result(ctx, scene, await idOf(ctx, "scene", scene),
        shot, await optionalId(ctx, "shot", shot));
    },

    Q08: async (ctx, p) => {
      const scene = required(p, "scene");
      return q08Result(ctx, scene, await idOf(ctx, "scene", scene));
    },

    Q09: async (ctx, p) => {
      const scene = required(p, "scene");
      return q09Result(ctx, scene, await idOf(ctx, "scene", scene));
    },

    Q10: async (ctx, p) => {
      const theme = required(p, "theme");
      return q10Result(ctx, theme, await idOf(ctx, "theme", theme));
    },

    Q11: async (ctx, p) => {
      const scene = required(p, "scene");
      return q11Result(ctx, scene, await idOf(ctx, "scene", scene));
    },

    Q12: async (ctx, p) => {
      const from = required(p, "from");
      const to = required(p, "to");
      return q12Result(
        ctx, from, to, await idOfAny(ctx, from), await idOfAny(ctx, to));
    },

    Q13: async (ctx, p) => {
      const subjectType = required(p, "subjectType");
      const subject = required(p, "subject");
      const intent = required(p, "intent");
      const scene = optional(p, "scene");
      const shot = optional(p, "shot");
      return q13Result(
        ctx, subjectType, subject, await idOf(ctx, subjectType, subject),
        intent, scene, await optionalId(ctx, "scene", scene),
        shot, await optionalId(ctx, "shot", shot), locate, rootMapped);
    },

    Q14: async (ctx, p) => {
      const target = required(p, "target");
      const character = optional(p, "character");
      const scene = optional(p, "scene");
      const shot = optional(p, "shot");
      return q14Result(ctx, target,
        character, await optionalId(ctx, "character", character),
        scene, await optionalId(ctx, "scene", scene),
        shot, await optionalId(ctx, "shot", shot));
    },

    Q15: async (ctx, p) => {
      const entityType = required(p, "entityType");
      const row = required(p, "row");
      return q15Result(
        ctx, entityType, row, await idOf(ctx, entityType, row), mentionsRow);
    },
  };
}
