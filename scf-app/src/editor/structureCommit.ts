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
 * docs/story-structure-spec.md for why.
 */

import type { Row, SqlExec } from "@scf-core/db.ts";
import type { ScreenplayRow } from "@scf-core/screenplay/rowModel.ts";
import { deriveStructure, scenePositions } from "@scf-core/structure.ts";

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

export interface StructureCommitResult {
  actsCreated: number;
  sequencesCreated: number;
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
    actsCreated: 0, sequencesCreated: 0, renamed: 0, boundariesSet: 0,
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
  const structure = deriveStructure(scenes, existing.act, existing.sequence);

  // Numbers follow the boundaries. They are labels, not order, so the
  // app keeps them true while the script is live; a production that
  // locks its numbering will want this switched off at that point.
  for (const [i, span] of structure.acts.entries()) {
    await exec("UPDATE act SET act_number = ? WHERE id = ? AND " +
               "(act_number IS NULL OR act_number != ?)",
               [i + 1, span.id, i + 1]);
  }
  for (const [i, span] of structure.sequences.entries()) {
    await exec("UPDATE sequence SET sequence_number = ? WHERE id = ? AND " +
               "(sequence_number IS NULL OR sequence_number != ?)",
               [i + 1, span.id, i + 1]);
  }

  // Materialize scene_sequence so existing queries keep working. The
  // boundary is the truth; these rows are its shadow.
  const positions = new Map(
    scenePositions(scenes).map((s) => [s.id, s.index]));
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
