/**
 * structureCommit.ts — Fountain sections become acts and sequences.
 *
 * `# ACT II` and `## SEQUENCE 6 — The Siege` are already tokenized,
 * stored, and round-tripped byte-stable; they simply never became
 * entities. This is the same deal headings have with scenes: the author
 * literally typed it, so creating what they named is the feature.
 *
 * A section anchors the span to THE NEXT SCENE HEADING BELOW IT. That is
 * the only fact stored — no end, no per-scene rows — so acts cannot
 * overlap or leave gaps, and a scene inserted mid-act joins it with no
 * write at all. See scf-core/src/structure.ts for the derivation and
 * docs/story-structure-design-record.md for why.
 */

import type { Row, SqlExec } from "@scf-core/db.ts";
import type { ScreenplayRow } from "@scf-core/screenplay/rowModel.ts";
import {
  deriveStructure, sceneOrderHint, scenePositions, type Structure,
} from "@scf-core/structure.ts";
import { restampShotNumber } from "@scf-core/shots.ts";
import { numberingPolicy, setNumberingPolicy }
  from "@scf-core/numbering.ts";

export type StructureKind = "act" | "sequence";

export interface SectionInfo {
  kind: StructureKind;
  /** The section text with its # markers and any ACT/SEQ word removed. */
  label: string;
  depth: number;
}

const ACT_WORD = /\bacts?\b/i;
const SEQUENCE_WORD = /\b(?:sequences?|seq)\b/i;

/**
 * What a section line declares.
 *
 * The text is read before the depth, because `#` is not a reliable
 * convention: plenty of writers use a single `#` for sequences and
 * never write an act line at all. A section that says ACT is an act at
 * any depth; only a section that says neither falls back to depth,
 * where the common `#` = act / `##` = sequence mapping applies.
 */
export function classifySection(content: string): SectionInfo | null {
  const m = /^\s*(#+)\s*(.*)$/.exec(content);
  if (m === null) return null;
  const depth = (m[1] ?? "#").length;
  const label = (m[2] ?? "").trim();
  if (label === "") return null;
  const kind: StructureKind =
    ACT_WORD.test(label) ? "act"
    : SEQUENCE_WORD.test(label) ? "sequence"
    : depth <= 1 ? "act" : "sequence";
  return { kind, label, depth };
}

/** The entity a section line is bound to, carried in its line metadata. */
interface StructureRef { kind: StructureKind; id: number }

function readRef(row: ScreenplayRow): StructureRef | null {
  const meta = row.metadata;
  if (meta === null || typeof meta !== "object") return null;
  const ref = (meta as Record<string, unknown>)["structureRef"];
  if (ref === null || typeof ref !== "object") return null;
  const { kind, id } = ref as Record<string, unknown>;
  if ((kind !== "act" && kind !== "sequence") ||
      typeof id !== "number") return null;
  return { kind, id };
}

function writeRef(row: ScreenplayRow, ref: StructureRef): void {
  row.metadata = { ...(row.metadata ?? {}), structureRef: ref };
}

/**
 * Act and sequence numbers follow their boundaries.
 *
 * Exported because the Structure tab moves boundaries too, and used to
 * write `start_scene_id` and stop — so dragging a boundary there left
 * every number stale until the next SCRIPT commit, which is a strange
 * thing to have to know. Both callers run the same pass now.
 *
 * Unlike scene numbers these are not gated on the numbering mode: an act
 * number is a structural label the app has always owned, and no crew
 * holds paper on one. Pass a structure you have already derived, or
 * leave it out to derive from the database.
 */
export async function renumberSpans(
    exec: SqlExec, structure?: Structure): Promise<void> {
  let derived = structure;
  if (derived === undefined) {
    const scenes = await exec("SELECT id, scene_number, name FROM scene");
    const acts = await exec(
      "SELECT id, name, act_number, start_scene_id FROM act");
    const sequences = await exec(
      "SELECT id, name, sequence_number, start_scene_id, act_id " +
      "FROM sequence");
    const headings = await exec(
      "SELECT scene_id, line_order FROM screenplay_lines " +
      "WHERE line_type = 'heading' ORDER BY line_order");
    derived = deriveStructure(scenes, acts, sequences,
                              sceneOrderHint(headings));
  }
  for (const [i, span] of derived.acts.entries()) {
    await exec("UPDATE act SET act_number = ? WHERE id = ? AND " +
               "(act_number IS NULL OR act_number != ?)",
               [i + 1, span.id, i + 1]);
  }
  for (const [i, span] of derived.sequences.entries()) {
    await exec("UPDATE sequence SET sequence_number = ? WHERE id = ? AND " +
               "(sequence_number IS NULL OR sequence_number != ?)",
               [i + 1, span.id, i + 1]);
  }

  /*
   * `sequence.act_id` was READ at commit and never written, so it sat
   * null on every sequence the app has ever made — a stored field that
   * consumers would reasonably trust and that has been empty all along.
   * Act membership is derived from the boundaries, so it can simply be
   * written down: a sequence belongs to the act its START scene falls
   * in, which is also how a sequence crossing a boundary is attributed
   * everywhere else.
   */
  for (const span of derived.sequences) {
    const actId = derived.actOfScene.get(span.startSceneId) ?? null;
    await exec(
      "UPDATE sequence SET act_id = ? WHERE id = ? AND " +
      "(act_id IS NULL OR act_id != ?)", [actId, span.id, actId]);
  }
}

/**
 * Move an act or sequence boundary off a scene that is leaving.
 *
 * Acts and sequences are anchored to a START SCENE, so moving the scene
 * that anchors one drags the whole span with it: dropping the first
 * scene of act one into act two made act one start there too, put act
 * two ahead of it, and left every scene in between belonging to no act.
 * The model was behaving correctly and the result was nonsense, because
 * moving a scene BETWEEN acts should change the scene's act, not the
 * act's position.
 *
 * So a span whose anchor moves re-anchors to the scene that now sits
 * where the old one did — the scene that follows it in the order BEFORE
 * the move. The boundary stays put and the scene travels, which is what
 * dragging it meant.
 *
 * When the moved scene was the last in the script there is no successor,
 * and the span follows it: that is the only remaining reading, and
 * structureFindings reports the shape either way.
 */
export async function reanchorSpansForMove(
    exec: SqlExec, movedSceneId: number,
    orderBefore: readonly number[]): Promise<number> {
  const at = orderBefore.indexOf(movedSceneId);
  const successor = at === -1 ? undefined : orderBefore[at + 1];
  if (successor === undefined) return 0;
  let moved = 0;
  for (const table of ["act", "sequence"] as const) {
    const rows = await exec(
      `SELECT id FROM ${table} WHERE start_scene_id = ?`, [movedSceneId]);
    for (const row of rows) {
      await exec(
        `UPDATE ${table} SET start_scene_id = ?, ` +
        "updated_at = datetime('now') WHERE id = ?",
        [successor, row["id"] as number]);
      moved += 1;
    }
  }
  return moved;
}

export type NumberingMode = "derived" | "fixed";

/**
 * How scene numbers are maintained, stored on the project row.
 *
 * `derived` — recomputed from the script's order at every commit.
 * `fixed`   — never touched. What an imported script needs, and the
 *             first real step toward production locking.
 *
 * Absent means `derived`: a project with no stored preference is one the
 * app has always been free to renumber.
 */
export async function numberingMode(exec: SqlExec): Promise<NumberingMode> {
  // Delegates to scf-core, which owns the precedence between
  // `numbering_policy` and the deprecated `scene_numbering` (spec §4.3).
  // Reading the column directly here is how the two would drift.
  return numberingPolicy(exec);
}

export async function setNumberingMode(
    exec: SqlExec, mode: NumberingMode): Promise<void> {
  await setNumberingPolicy(exec, mode);
}

export interface StructureCommitResult {
  actsCreated: number;
  sequencesCreated: number;
  /** Scenes whose number was recomputed from the script's order. */
  scenesRenumbered: number;
  /** Shot codes restamped to follow their scene's new number. */
  shotsRestamped: number;
  /** Sections whose entity was renamed to follow the line. */
  renamed: number;
  boundariesSet: number;
  /** scene_sequence rows written to match the derived membership. */
  membershipRows: number;
  /**
   * scene_sequence rows no boundary explains — from hand-linking, or
   * from a project that predates boundaries. Reported, never deleted:
   * silently dropping someone's authored links is not a migration.
   */
  unexplainedMembership: number;
  /** Sections with no scene heading below them: they anchor nothing. */
  danglingSections: number;
}

export interface CommitStructurePlan {
  newActs: string[];
  newSequences: string[];
  danglingSections: string[];
}

const norm = (s: string): string => s.trim().toUpperCase();

/** Sections paired with the scene each one anchors to. */
function sectionAnchors(rows: ScreenplayRow[]):
    Array<{ row: ScreenplayRow; info: SectionInfo; sceneId: number | null }> {
  const out: Array<{ row: ScreenplayRow; info: SectionInfo;
                     sceneId: number | null }> = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] as ScreenplayRow;
    if (row.lineType !== "section") continue;
    const info = classifySection(row.content);
    if (info === null) continue;
    let sceneId: number | null = null;
    for (let j = i + 1; j < rows.length; j += 1) {
      const next = rows[j] as ScreenplayRow;
      if (next.lineType === "heading" && next.sceneId !== null) {
        sceneId = next.sceneId;
        break;
      }
    }
    out.push({ row, info, sceneId });
  }
  return out;
}

/** Read-only preview for the commit review modal. */
export async function planCommitStructure(
    exec: SqlExec, rows: ScreenplayRow[]): Promise<CommitStructurePlan> {
  const acts = await exec("SELECT id, name FROM act");
  const sequences = await exec("SELECT id, name FROM sequence");
  const byName = (list: Row[]): Set<string> =>
    new Set(list.map((r) => norm(String(r["name"] ?? ""))));
  const known = { act: byName(acts), sequence: byName(sequences) };
  const knownIds = {
    act: new Set(acts.map((r) => Number(r["id"]))),
    sequence: new Set(sequences.map((r) => Number(r["id"]))),
  };

  const plan: CommitStructurePlan = {
    newActs: [], newSequences: [], danglingSections: [],
  };
  for (const { row, info, sceneId } of sectionAnchors(rows)) {
    if (sceneId === null) {
      plan.danglingSections.push(info.label);
      continue;
    }
    const ref = readRef(row);
    // A bound section renames its entity rather than making a new one.
    if (ref !== null && ref.kind === info.kind &&
        knownIds[info.kind].has(ref.id)) continue;
    if (known[info.kind].has(norm(info.label))) continue;
    known[info.kind].add(norm(info.label));
    if (info.kind === "act") plan.newActs.push(info.label);
    else plan.newSequences.push(info.label);
  }
  return plan;
}

/**
 * Apply the structure a script declares. Mutates `rows` (binding each
 * section to its entity in metadata); call inside the commit
 * transaction, after headings have their scene ids.
 */
export async function commitStructure(
    exec: SqlExec, rows: ScreenplayRow[],
    createNew: boolean): Promise<StructureCommitResult> {
  const result: StructureCommitResult = {
    actsCreated: 0, sequencesCreated: 0, scenesRenumbered: 0, shotsRestamped: 0, renamed: 0, boundariesSet: 0,
    membershipRows: 0, unexplainedMembership: 0, danglingSections: 0,
  };

  const load = async (): Promise<{ act: Row[]; sequence: Row[] }> => ({
    act: await exec("SELECT id, name, start_scene_id FROM act"),
    sequence: await exec("SELECT id, name, start_scene_id FROM sequence"),
  });
  let existing = await load();
  const index = (list: Row[]): Map<string, number> => new Map(
    list.map((r) => [norm(String(r["name"] ?? "")), Number(r["id"])]));
  const byName = {
    act: index(existing.act), sequence: index(existing.sequence),
  };
  const idsOf = (list: Row[]): Set<number> =>
    new Set(list.map((r) => Number(r["id"])));
  const known = {
    act: idsOf(existing.act), sequence: idsOf(existing.sequence),
  };

  for (const { row, info, sceneId } of sectionAnchors(rows)) {
    if (sceneId === null) {
      result.danglingSections += 1;
      continue;
    }
    const table = info.kind;
    const ref = readRef(row);
    let id: number | null = null;

    if (ref !== null && ref.kind === info.kind && known[table].has(ref.id)) {
      // Bound already: the entity follows the line, including renames.
      id = ref.id;
      const current = existing[table].find((r) => Number(r["id"]) === id);
      if (current !== undefined &&
          String(current["name"] ?? "") !== info.label) {
        await exec(
          `UPDATE ${table} SET name = ?, updated_at = datetime('now') ` +
          "WHERE id = ?", [info.label, id]);
        result.renamed += 1;
      }
    } else {
      id = byName[table].get(norm(info.label)) ?? null;
      if (id === null && createNew) {
        await exec(
          `INSERT INTO ${table} (name, start_scene_id) VALUES (?, ?)`,
          [info.label, sceneId]);
        id = Number(((await exec(
          "SELECT last_insert_rowid() AS id"))[0] as Row)["id"]);
        byName[table].set(norm(info.label), id);
        known[table].add(id);
        if (table === "act") result.actsCreated += 1;
        else result.sequencesCreated += 1;
        result.boundariesSet += 1;
        writeRef(row, { kind: info.kind, id });
        continue;
      }
    }
    if (id === null) continue;
    writeRef(row, { kind: info.kind, id });
    await exec(
      `UPDATE ${table} SET start_scene_id = ?, ` +
      "updated_at = datetime('now') WHERE id = ? AND " +
      "(start_scene_id IS NULL OR start_scene_id != ?)",
      [sceneId, id, sceneId]);
    result.boundariesSet += 1;
  }

  existing = await load();
  const scenes = await exec(
    "SELECT id, scene_number, name FROM scene");
  // The script owns scene order, so the derivation must read it rather
  // than the stored numbers it is about to recompute.
  const headings = await exec(
    "SELECT scene_id, line_order FROM screenplay_lines " +
    "WHERE line_type = 'heading' ORDER BY line_order");
  const orderHint = sceneOrderHint(headings);
  const structure = deriveStructure(
    scenes, existing.act, existing.sequence, orderHint);

  /*
   * SCENE numbers follow the script's order.
   *
   * They are labels for a position, not the position itself — which is
   * why they can be recomputed at all. Before this, a scene moved in the
   * script kept its old number, so the rail, the outlines and every
   * "sc 12 — …" label disagreed with the page.
   *
   * NUMBERING MODE is the gate. `derived` keeps them true while the
   * script is live; `fixed` never touches them, which is what an
   * imported script needs — a production's own numbering is data, may be
   * gapped or out of sequence, and renumbering it on the first commit
   * would destroy it silently. Imports set `fixed`; a blank screenplay
   * gets `derived`. This is the smallest piece of production LOCKING and
   * it could not be deferred, because scene renumbering is meaningless
   * without it.
   *
   * A scene with no heading in the script has no position, so its number
   * is cleared rather than left pointing at a place it no longer holds.
   */
  if (await numberingMode(exec) === "derived") {
    const positioned = structure.scenes.filter((s) =>
      orderHint.has(s.id));
    for (const [i, scene] of positioned.entries()) {
      // Written as TEXT, not as a number: scene_number is a LABEL
      // (spec §4.2), the column is text since 2.9, and the driver binds
      // JS numbers as doubles — so `i + 1` stored "1.0" rather than "1".
      const label = String(i + 1);
      await exec(
        "UPDATE scene SET scene_number = ?, updated_at = datetime('now') " +
        "WHERE id = ? AND (scene_number IS NULL OR scene_number != ?)",
        [label, scene.id, label]);
    }
    for (const scene of structure.scenes) {
      if (orderHint.has(scene.id)) continue;
      await exec(
        "UPDATE scene SET scene_number = NULL WHERE id = ? AND " +
        "scene_number IS NOT NULL", [scene.id]);
    }
    result.scenesRenumbered = positioned.length;

    /*
     * Shot codes track their scene's number while numbering is derived.
     *
     * shots.ts protects a stored code because `42A` is an identifier a
     * crew holds on paper — but nobody holds paper on an unlocked
     * script, and `42A` sitting in a scene now numbered 43 is not a
     * stable identifier, it is a stale one. The same flag governs both:
     * `fixed` freezes scene numbers and shot codes together, which is
     * exactly the state a distributed shot list needs.
     */
    for (const [i, scene] of positioned.entries()) {
      const shots = await exec(
        "SELECT id, shot_number FROM shot WHERE scene_id = ?", [scene.id]);
      for (const shot of shots) {
        // §4.4.2: the parse needs the number the code was minted
        // under. `scene.number` is the pre-renumber value, read before
        // the UPDATE above.
        const next = restampShotNumber(
          (shot["shot_number"] ?? null) as string | null,
          scene.number, i + 1);
        if (next === null) continue;
        await exec(
          "UPDATE shot SET shot_number = ?, updated_at = datetime('now') " +
          "WHERE id = ?", [next, shot["id"] as number]);
        result.shotsRestamped += 1;
      }
    }
  }

  await renumberSpans(exec, structure);

  // Materialize scene_sequence so existing queries keep working. The
  // boundary is the truth; these rows are its shadow.
  const positions = new Map(
    scenePositions(scenes, orderHint).map((s) => [s.id, s.index]));
  const links = await exec(
    "SELECT id, scene_id, sequence_id FROM scene_sequence");
  const have = new Set(links.map((r) =>
    `${String(r["scene_id"])}:${String(r["sequence_id"])}`));
  const wanted = new Set<string>();
  for (const span of structure.sequences) {
    for (const sceneId of span.sceneIds) {
      const key = `${String(sceneId)}:${String(span.id)}`;
      wanted.add(key);
      const order = (positions.get(sceneId) ?? 0) - span.startIndex + 1;
      if (have.has(key)) {
        await exec(
          "UPDATE scene_sequence SET order_in_sequence = ? " +
          "WHERE scene_id = ? AND sequence_id = ? AND " +
          "(order_in_sequence IS NULL OR order_in_sequence != ?)",
          [order, sceneId, span.id, order]);
        continue;
      }
      await exec(
        "INSERT INTO scene_sequence (scene_id, sequence_id, " +
        "order_in_sequence) VALUES (?, ?, ?)", [sceneId, span.id, order]);
      result.membershipRows += 1;
    }
  }
  result.unexplainedMembership = links.filter((r) =>
    !wanted.has(`${String(r["scene_id"])}:${String(r["sequence_id"])}`))
    .length;
  return result;
}
