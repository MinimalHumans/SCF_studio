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

// ---------------------------------------------------------------------------
// Arcs and relationships (phase 2)
// ---------------------------------------------------------------------------

/**
 * A new arc for a character. Its axis — "trust → betrayal" — is what the
 * writer names; `name` is left empty, because a label derived from the
 * axis at display time cannot go stale when the axis is reworded.
 */
export async function addArc(
    exec: SqlExec, characterId: number, axis: string): Promise<number> {
  const clean = cleanName(axis);
  if (clean === null) throw new Error("Name what changes in this arc.");
  await exec(
    "INSERT INTO character_arc (uuid, character_id, axis) VALUES (?, ?, ?)",
    [newUuid(), characterId, clean]);
  return insertedId(exec);
}

/**
 * A stage starting at a scene. Works for every latest-wins stage table
 * the strip draws; the parent column is named by the table, never by the
 * caller, so it is never interpolated from outside.
 */
const STAGE_PARENT: Record<string, string> = {
  character_arc_state: "character_arc_id",
  relationship_state: "character_relationship_id",
  costume_progression_state: "costume_progression_id",
};

export async function addStage(
    exec: SqlExec, table: string, parentId: number, sceneId: number,
    label: string): Promise<number> {
  const parent = STAGE_PARENT[table];
  if (parent === undefined) throw new Error(`${table} is not a stage table.`);
  const clean = cleanName(label);
  if (clean === null) throw new Error("Give the stage a short label.");
  await exec(
    `INSERT INTO ${q(table)} (uuid, ${q(parent)}, scene_id, stage_label) ` +
    "VALUES (?, ?, ?, ?)", [newUuid(), parentId, sceneId, clean]);
  return insertedId(exec);
}

/** The relationship between two characters in either order, if any. */
export async function relationshipBetween(
    exec: SqlExec, a: number, b: number): Promise<Row | null> {
  return (await exec(
    "SELECT * FROM character_relationship WHERE " +
    "(character_a_id = ? AND character_b_id = ?) OR " +
    "(character_a_id = ? AND character_b_id = ?) ORDER BY id LIMIT 1",
    [a, b, b, a]))[0] ?? null;
}

/**
 * Relate two characters. Returns the existing relationship instead of a
 * second one: two rows for one pair split its stages and its history
 * between them, and nothing reading the file could tell which is meant.
 * A new one starts `mutual` — the writer says otherwise when it is not.
 */
export async function relate(
    exec: SqlExec, characterId: number, otherId: number):
    Promise<{ id: number; created: boolean }> {
  if (characterId === otherId) {
    throw new Error("A character cannot have a relationship with themself.");
  }
  const existing = await relationshipBetween(exec, characterId, otherId);
  if (existing !== null) return { id: Number(existing["id"]), created: false };
  await exec(
    "INSERT INTO character_relationship (uuid, character_a_id, " +
    "character_b_id, directionality) VALUES (?, ?, ?, 'mutual')",
    [newUuid(), characterId, otherId]);
  return { id: await insertedId(exec), created: true };
}

export type Direction = "mutual" | "from" | "to" | null;

/**
 * A relationship as seen from one character: who the other one is, and
 * which way it points relative to the viewer. The workspace always
 * shows a relationship from the selected character's side, whichever
 * column they happen to be stored in.
 */
export function fromPointOfView(row: Row, viewerId: number):
    { otherId: number; direction: Direction } {
  const a = Number(row["character_a_id"]);
  const b = Number(row["character_b_id"]);
  const viewerIsA = a === viewerId;
  const d = row["directionality"];
  return {
    otherId: viewerIsA ? b : a,
    direction: d === "mutual" ? "mutual"
      : d === "a_to_b" ? (viewerIsA ? "from" : "to")
      : null,
  };
}

/**
 * Set which way a relationship points, as the writer reads it: "mutual",
 * or from one named character to the other. `a_to_b` only has one
 * direction, so pointing it the other way swaps the two columns — the
 * only write here that touches which side is A, and only because the
 * meaning changed.
 */
export async function setDirection(
    exec: SqlExec, relationshipId: number,
    direction: "mutual" | { fromId: number }): Promise<void> {
  const row = (await exec(
    "SELECT character_a_id, character_b_id FROM character_relationship " +
    "WHERE id = ?", [relationshipId]))[0];
  if (row === undefined) throw new Error("No such relationship.");
  if (direction === "mutual") {
    await exec(
      "UPDATE character_relationship SET directionality = 'mutual', " +
      "updated_at = datetime('now') WHERE id = ?", [relationshipId]);
    return;
  }
  const a = Number(row["character_a_id"]);
  const b = Number(row["character_b_id"]);
  if (direction.fromId !== a && direction.fromId !== b) {
    throw new Error("That character is not in this relationship.");
  }
  const [from, to] = direction.fromId === a ? [a, b] : [b, a];
  await exec(
    "UPDATE character_relationship SET character_a_id = ?, " +
    "character_b_id = ?, directionality = 'a_to_b', " +
    "updated_at = datetime('now') WHERE id = ?", [from, to, relationshipId]);
}

// ---------------------------------------------------------------------------
// Wardrobe and physicality (phase 4)
// ---------------------------------------------------------------------------

/** A named row owned by a character: a costume, a habit. */
async function addOwned(exec: SqlExec, entity: string, characterId: number,
                        name: string, what: string): Promise<number> {
  const clean = cleanName(name);
  if (clean === null) throw new Error(`Name the ${what}.`);
  await exec(`INSERT INTO ${q(entity)} (uuid, name, character_id) ` +
             "VALUES (?, ?, ?)", [newUuid(), clean, characterId]);
  return insertedId(exec);
}

export const addCostume = (exec: SqlExec, characterId: number,
                           name: string): Promise<number> =>
  addOwned(exec, "costume", characterId, name, "costume");

export const addHabit = (exec: SqlExec, characterId: number,
                         name: string): Promise<number> =>
  addOwned(exec, "physical_habit", characterId, name, "habit");

/**
 * Say a costume is worn in a scene. `costume_scene` is a link whose
 * natural key is the pair, so wearing it there twice is one link: the
 * existing row is returned.
 */
export async function wearIn(exec: SqlExec, costumeId: number,
                             sceneId: number): Promise<number> {
  const found = await exec(
    "SELECT id FROM costume_scene WHERE costume_id = ? AND scene_id = ?",
    [costumeId, sceneId]);
  if (found[0] !== undefined) return Number(found[0]["id"]);
  await exec("INSERT INTO costume_scene (uuid, costume_id, scene_id) " +
             "VALUES (?, ?, ?)", [newUuid(), costumeId, sceneId]);
  return insertedId(exec);
}

/**
 * The character's costume progression — the row wardrobe stages hang
 * from — made on first need, so a stage can be added straight from the
 * strip without a separate "create progression" step.
 */
export async function ensureProgression(exec: SqlExec,
                                        characterId: number): Promise<number> {
  const found = await exec(
    "SELECT id FROM costume_progression WHERE character_id = ? " +
    "AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut') " +
    "ORDER BY id LIMIT 1", [characterId]);
  if (found[0] !== undefined) return Number(found[0]["id"]);
  await exec("INSERT INTO costume_progression (uuid, character_id) " +
             "VALUES (?, ?)", [newUuid(), characterId]);
  return insertedId(exec);
}

/**
 * A makeup and hair design for one scene. The baseline — no scene — is
 * made by its fields on first edit; this is for the per-scene ones, and
 * returns the existing design if the scene already has one.
 */
export async function addMakeupFor(exec: SqlExec, characterId: number,
                                   sceneId: number): Promise<number> {
  const found = await exec(
    "SELECT id FROM makeup_hair_design WHERE character_id = ? AND scene_id = ?",
    [characterId, sceneId]);
  if (found[0] !== undefined) return Number(found[0]["id"]);
  await exec("INSERT INTO makeup_hair_design (uuid, character_id, scene_id) " +
             "VALUES (?, ?, ?)", [newUuid(), characterId, sceneId]);
  return insertedId(exec);
}

/** How a character is in one location: one row per pair. */
export async function addPlaceFor(exec: SqlExec, characterId: number,
                                  locationId: number): Promise<number> {
  const found = await exec(
    "SELECT id FROM character_environment_physicality " +
    "WHERE character_id = ? AND location_id = ?", [characterId, locationId]);
  if (found[0] !== undefined) return Number(found[0]["id"]);
  await exec("INSERT INTO character_environment_physicality " +
             "(uuid, character_id, location_id) VALUES (?, ?, ?)",
             [newUuid(), characterId, locationId]);
  return insertedId(exec);
}

/**
 * Put a character in a scene. One link per pair (§6.3): linking again
 * returns the existing link. The role is left unset — "seen" (§2.4.1) —
 * until the writer says otherwise.
 */
export async function linkToScene(exec: SqlExec, characterId: number,
                                  sceneId: number): Promise<number> {
  const found = await exec(
    "SELECT id FROM scene_character WHERE character_id = ? AND scene_id = ?",
    [characterId, sceneId]);
  if (found[0] !== undefined) return Number(found[0]["id"]);
  await exec("INSERT INTO scene_character (uuid, character_id, scene_id) " +
             "VALUES (?, ?, ?)", [newUuid(), characterId, sceneId]);
  return insertedId(exec);
}
