// SPDX-License-Identifier: Apache-2.0
/**
 * elementOps.ts — the writes the narrative-element workspaces make.
 *
 * The workspaces author by INTENT ("cast Ana Ruiz as Eleanor") and this
 * module turns an intent into rows. It is the one place that does, so
 * the Profile tab, a later Look tab and any MCP tool that wants the same
 * behaviour cannot drift apart — two code paths writing the same rows
 * is the failure this project keeps paying for.
 *
 * Headless on purpose: no view imports, so tests run it against a real
 * SQLite database without the worker (see shootOps.ts for the pattern).
 * Each function writes ordinary SCF rows that a hand-authored file could
 * contain; nothing here is app-only state.
 *
 * Phase 1 covers what the Profile tab needs: a character, its fields,
 * who plays it, and its variants. The media wiring (bundles, bindings,
 * anchors) arrives with the Look tab.
 */

import { newUuid, q, type Row, type SqlExec, type SqlValue } from
  "@scf-core/db.ts";
import type { Registry } from "@scf-core/registry.ts";

const insertedId = async (exec: SqlExec): Promise<number> =>
  Number((await exec("SELECT last_insert_rowid() AS id"))[0]?.["id"]);

/** Trim, and treat whitespace-only as nothing. */
export function cleanName(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
}

/**
 * Characters already called this, ignoring case and spacing. A second
 * "Eleanor Cade" is allowed — two guards may share a name — but the
 * workspace asks first, because a duplicate silently splits every cue
 * match and scene link between two rows.
 */
export async function charactersNamed(
    exec: SqlExec, name: string): Promise<Row[]> {
  const clean = cleanName(name);
  if (clean === null) return [];
  return exec(
    "SELECT id, name, lifecycle_status FROM character " +
    "WHERE lower(trim(name)) = lower(?) ORDER BY id", [clean]);
}

/** A new character with only its name. Returns its id. */
export async function createCharacter(
    exec: SqlExec, name: string): Promise<number> {
  const clean = cleanName(name);
  if (clean === null) throw new Error("A character needs a name.");
  await exec("INSERT INTO character (uuid, name) VALUES (?, ?)",
             [newUuid(), clean]);
  return insertedId(exec);
}

/**
 * Write ONE column of one row, and nothing else.
 *
 * The schema form saves the whole row from a draft; the workspace saves
 * field by field as the writer works, so a single-column UPDATE is what
 * keeps a slow save of one field from overwriting a quick edit to
 * another. Refuses a field the registry does not declare on the entity:
 * the column name is interpolated, so it must come from the registry,
 * never from the caller's say-so.
 */
export async function setField(
    exec: SqlExec, registry: Registry, entity: string, id: number,
    field: string, value: SqlValue): Promise<void> {
  const edef = registry.entities.get(entity);
  const fdef = edef?.fields.find((f) => f.name === field);
  if (edef === undefined || fdef === undefined || fdef.autoInjected) {
    throw new Error(`${entity}.${field} is not an authored field.`);
  }
  if (field === edef.nameField && fdef.required &&
      (value === null || String(value).trim() === "")) {
    throw new Error(`A ${edef.label.toLowerCase()} needs a name.`);
  }
  const stored = typeof value === "string" && value.trim() === ""
    ? null : value;
  await exec(
    `UPDATE ${q(entity)} SET ${q(field)} = ?, ` +
    "updated_at = datetime('now') WHERE id = ?", [stored, id]);
}

/**
 * The actor of that name, or a new one. Matching ignores case and
 * spacing so "ana ruiz" and "Ana  Ruiz" are the same person; the stored
 * spelling is whichever came first.
 */
export async function findOrCreateActor(
    exec: SqlExec, name: string): Promise<{ id: number; created: boolean }> {
  const clean = cleanName(name);
  if (clean === null) throw new Error("An actor needs a name.");
  const found = await exec(
    "SELECT id FROM actor WHERE lower(trim(name)) = lower(?) " +
    "ORDER BY id LIMIT 1", [clean]);
  if (found[0] !== undefined) return { id: Number(found[0]["id"]), created: false };
  await exec("INSERT INTO actor (uuid, name) VALUES (?, ?)",
             [newUuid(), clean]);
  return { id: await insertedId(exec), created: true };
}

/**
 * Cast someone: one field to the writer, an `actor` (matched or created)
 * plus an `actor_character_role` underneath.
 */
export async function castActor(
    exec: SqlExec, characterId: number, actorName: string,
    roleType = "principal"): Promise<{ actorId: number; roleId: number }> {
  const actor = await findOrCreateActor(exec, actorName);
  await exec(
    "INSERT INTO actor_character_role " +
    "(uuid, actor_id, character_id, role_type) VALUES (?, ?, ?, ?)",
    [newUuid(), actor.id, characterId, roleType]);
  return { actorId: actor.id, roleId: await insertedId(exec) };
}

/**
 * Change who fills an existing role. Re-points the role; NEVER renames
 * the actor row, which other roles — other characters, a stunt double —
 * may share. Retyping "Ana Ruiz" as "Ana Ruíz" therefore makes a second
 * actor, which is the honest result: the two spellings are two rows
 * until someone merges them in Schema.
 */
export async function reassignActor(
    exec: SqlExec, roleId: number, actorName: string): Promise<number> {
  const actor = await findOrCreateActor(exec, actorName);
  await exec(
    "UPDATE actor_character_role SET actor_id = ?, " +
    "updated_at = datetime('now') WHERE id = ?", [actor.id, roleId]);
  return actor.id;
}

/** A new variant of a character, named. Returns its id. */
export async function addVariant(
    exec: SqlExec, characterId: number, name: string): Promise<number> {
  const clean = cleanName(name);
  if (clean === null) throw new Error("A variant needs a name.");
  await exec(
    "INSERT INTO character_variant (uuid, name, character_id) " +
    "VALUES (?, ?, ?)", [newUuid(), clean, characterId]);
  return insertedId(exec);
}

export interface CastRole {
  role: Row;
  actorName: string | null;
}

export interface CharacterProfile {
  character: Row;
  roles: CastRole[];
  variants: Row[];
}

/** Everything the Profile tab shows, in one read. */
export async function loadProfile(
    exec: SqlExec, characterId: number): Promise<CharacterProfile | null> {
  const character = (await exec(
    "SELECT * FROM character WHERE id = ?", [characterId]))[0];
  if (character === undefined) return null;
  const roles = (await exec(
    "SELECT r.*, a.name AS actor_name FROM actor_character_role r " +
    "LEFT JOIN actor a ON a.id = r.actor_id WHERE r.character_id = ? " +
    "ORDER BY CASE r.role_type WHEN 'principal' THEN 0 ELSE 1 END, r.id",
    [characterId])).map(({ actor_name, ...role }) => ({
      role, actorName: actor_name === null || actor_name === undefined
        ? null : String(actor_name),
    }));
  const variants = await exec(
    "SELECT * FROM character_variant WHERE character_id = ? " +
    "AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut') " +
    "ORDER BY id", [characterId]);
  return { character, roles, variants };
}
