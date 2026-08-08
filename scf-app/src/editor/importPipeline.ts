/**
 * editor/importPipeline.ts — the import flow behind the staging screen.
 *
 * Two halves with the staging screen between them:
 *
 *  prepareImport(text|fdx): repair (reported) → Stage-1 parse →
 *    Stage-3 proposals. Nothing is written; the result is what the
 *    staging screen shows.
 *
 *  applyImport(exec, prepared, accepted): create entity rows for the
 *    ACCEPTED proposals (marked machine-created via
 *    external_id_namespace='scf:import'), thread ids with
 *    applyAssignments, and write the screenplay as blank-free rows —
 *    the editor's document. Junction links join scene↔character for
 *    accepted pairs. Field values are only set where the mapping is
 *    certain (DAY has no slot in scene.time_of_day's vocabulary, so it
 *    stays in the heading text and the field stays null — no guessing).
 */

import type { SqlExec } from "@scf-core/db.ts";
import { setNumberingMode } from "./structureCommit.ts";
import { q, withTransaction } from "@scf-core/db.ts";
import { parseFountain, serialize } from "@scf-core/fountain/index.ts";
import { repairConversionArtifacts, type RepairRecord }
  from "@scf-core/fountain/repair.ts";
import { parseFdx } from "@scf-core/fdx/parser.ts";
import type { FountainDocument } from "@scf-core/fountain/types.ts";
import {
  applyAssignments, linesToRows, writeScreenplay, type ScreenplayRows,
} from "@scf-core/screenplay/rowModel.ts";
import {
  normalizeCue, propose, type ProposalSet,
} from "@scf-core/proposals/propose.ts";
import { rowsToBlocks } from "./screenplayDoc.ts";

export interface PreparedImport {
  kind: "fountain" | "fdx";
  doc: FountainDocument;
  repairs: RepairRecord[];
  proposals: ProposalSet;
}

export function prepareImport(
    raw: string, kind: "fountain" | "fdx"): PreparedImport {
  if (kind === "fdx") {
    const doc = parseFdx(raw);
    return { kind, doc, repairs: [], proposals: propose(doc) };
  }
  const { text, repairs } = repairConversionArtifacts(raw);
  const doc = parseFountain(text);
  return { kind, doc, repairs, proposals: propose(doc) };
}

/** What the staging screen hands back: the proposals the user accepted
 * (possibly renamed), keyed by their identity in the ProposalSet. */
export interface AcceptedImport {
  scenes: boolean; // scenes+locations accept as a unit (near-determin.)
  characterNames: Map<string, string>; // cue key -> final display name
  props: Map<string, string>; // prop key -> final display name
}

export interface ImportResult {
  scenes: number;
  locations: number;
  characters: number;
  links: number;
  props: number;
  /** scene_prop rows: where each accepted prop actually appears. */
  propLinks: number;
  lines: number;
}

const INT_EXT_MAP: Record<string, string> = {
  "INT": "interior", "EXT": "exterior", "INT/EXT": "int/ext",
};
const TIME_MAP: Record<string, string> = {
  "DAWN": "dawn", "MORNING": "morning", "AFTERNOON": "afternoon",
  "DUSK": "dusk", "NIGHT": "night", "CONTINUOUS": "continuous",
};

/**
 * `mark` stamps external_id_namespace='scf:import' — machine-created,
 * queryable, and safe for future rebuilds to filter on. Principal
 * entities only: schema 2.3 gives junction tables no identity columns,
 * so imported LINKS currently cannot carry the machine-created mark the
 * design calls for. That is a real, stated gap needing an additive
 * schema change (identity columns for Connections-category entities) —
 * a shared-schema decision, not one to fake via a notes field.
 */
async function insert(exec: SqlExec, table: string,
                      values: Record<string, unknown>,
                      mark = true): Promise<number> {
  const keys = Object.keys(values);
  const cols = [...keys.map(q),
                ...(mark ? ["external_id_namespace"] : [])];
  const slots = [...keys.map(() => "?"),
                 ...(mark ? ["'scf:import'"] : [])];
  await exec(
    `INSERT INTO ${q(table)} (${cols.join(", ")})
     VALUES (${slots.join(", ")})`,
    keys.map((k) => values[k] as never));
  const row = await exec("SELECT last_insert_rowid() AS id");
  return row[0]!["id"] as number;
}

export async function applyImport(
    exec: SqlExec, prepared: PreparedImport,
    accepted: AcceptedImport,
    onProgress: (step: string) => void = () => undefined):
    Promise<ImportResult> {
  return withTransaction(exec, () =>
    applyImportInner(exec, prepared, accepted, onProgress));
}

async function applyImportInner(
    exec: SqlExec, prepared: PreparedImport,
    accepted: AcceptedImport,
    onProgress: (step: string) => void): Promise<ImportResult> {
  const { doc, proposals } = prepared;
  const result: ImportResult = {
    scenes: 0, locations: 0, characters: 0, links: 0, props: 0,
    propLinks: 0, lines: 0,
  };

  onProgress("creating locations…");
  // Locations first (scenes reference them).
  const locationIdByName = new Map<string, number>();
  if (accepted.scenes) {
    for (const loc of proposals.locations) {
      const id = await insert(exec, "location", { name: loc.name });
      locationIdByName.set(loc.name.toUpperCase(), id);
      result.locations += 1;
    }
  }

  onProgress("creating scenes…");
  /*
   * An imported script's scene numbers are the PRODUCTION's, not ours.
   * They may be gapped, out of sequence, or carry a meaning the app has
   * no way to reconstruct — so the project switches to fixed numbering
   * and the editor never renumbers them. A blank screenplay stays
   * derived. Chris can flip this in the project record.
   */
  const numbered = proposals.scenes.some((sc) =>
    Number.isFinite(parseInt(sc.sceneNumber, 10)));
  if (accepted.scenes && numbered) {
    await setNumberingMode(exec, "fixed");
  }

  // Scenes; remember heading line index -> scene id.
  const sceneIdByLineIndex = new Map<number, number>();
  if (accepted.scenes) {
    for (const scene of proposals.scenes) {
      const values: Record<string, unknown> = {
        name: scene.headingText.replace(/^\./, ""),
      };
      const n = parseInt(scene.sceneNumber, 10);
      if (Number.isFinite(n)) values["scene_number"] = n;
      const intExt = scene.intExt !== null
        ? INT_EXT_MAP[scene.intExt] : undefined;
      if (intExt !== undefined) values["int_ext"] = intExt;
      const time = scene.timeOfDay !== null
        ? TIME_MAP[scene.timeOfDay.toUpperCase()] : undefined;
      if (time !== undefined) values["time_of_day"] = time;
      const locId = scene.locationName !== null
        ? locationIdByName.get(scene.locationName.toUpperCase())
        : undefined;
      if (locId !== undefined) values["location_id"] = locId;
      const id = await insert(exec, "scene", values);
      sceneIdByLineIndex.set(scene.lineIndex, id);
      result.scenes += 1;
    }
  }

  onProgress("creating characters…");
  // Characters the user accepted (with any renames applied).
  const characterIdByCueKey = new Map<string, number>();
  for (const [cueKey, displayName] of accepted.characterNames) {
    const id = await insert(exec, "character", { name: displayName });
    characterIdByCueKey.set(cueKey, id);
    result.characters += 1;
  }

  // Props the user accepted (never by default).
  const propIdByKey = new Map<string, number>();
  for (const [key, displayName] of accepted.props) {
    const id = await insert(exec, "prop", { name: displayName });
    propIdByKey.set(key, id);
    result.props += 1;
  }

  onProgress("linking scenes and characters…");
  // Scene<->character links for accepted pairs.
  if (accepted.scenes) {
    for (const link of proposals.links) {
      const sceneId = sceneIdByLineIndex.get(link.sceneLineIndex);
      const charId =
        characterIdByCueKey.get(link.characterName.toUpperCase());
      if (sceneId === undefined || charId === undefined) continue;
      await insert(exec, "scene_character", {
        name: link.characterName,
        scene_id: sceneId,
        character_id: charId,
      }, false); // junctions have no identity columns in 2.3 — see insert()
      result.links += 1;
    }
  }

  // Place accepted props in the scenes they were read from. Without
  // this a prop arrives with no link to anywhere in the script, and the
  // evidence that produced it — which scene, which line — is thrown
  // away at the moment it would become useful.
  if (accepted.scenes) {
    onProgress("placing props…");
    for (const proposal of proposals.props) {
      const propId = propIdByKey.get(proposal.name.toUpperCase());
      if (propId === undefined) continue; // not accepted
      for (const sceneLine of proposal.sceneLines) {
        const sceneId = sceneIdByLineIndex.get(sceneLine);
        if (sceneId === undefined) continue;
        await insert(exec, "scene_prop", {
          scene_id: sceneId, prop_id: propId,
        }, false); // junctions have no identity columns in 2.3
        result.propLinks += 1;
      }
    }
  }

  // Thread assignments through the full stream, then store the editor's
  // document: blank-free blocks (blanks are never stored).
  const stream = linesToRows(doc);
  const lineOrderByDocIndex = new Map<number, number>();
  let order = 0;
  for (const line of doc.lines) {
    if (line.type === "title_page") continue;
    lineOrderByDocIndex.set(line.index, order++);
  }
  const sceneByLineOrder = new Map<number, number>();
  for (const [docIdx, sceneId] of sceneIdByLineIndex) {
    const lo = lineOrderByDocIndex.get(docIdx);
    if (lo !== undefined) sceneByLineOrder.set(lo, sceneId);
  }
  const characterByLineOrder = new Map<number, number>();
  for (const line of doc.lines) {
    if (line.type !== "character") continue;
    const key = normalizeCue(line.raw.trim()).name.toUpperCase();
    const charId = characterIdByCueKey.get(key);
    const lo = lineOrderByDocIndex.get(line.index);
    if (charId !== undefined && lo !== undefined) {
      characterByLineOrder.set(lo, charId);
    }
  }
  onProgress(`writing ${String(doc.lines.length)} screenplay lines…`);
  const assigned = applyAssignments(
    stream.lines, sceneByLineOrder, characterByLineOrder);
  const blocks = rowsToBlocks(assigned);
  const rows: ScreenplayRows = {
    bom: false,
    titlePage: stream.titlePage,
    lines: blocks.map((b, i) => ({
      lineOrder: i,
      lineType: b.type,
      content: b.text,
      sceneId: b.sceneId,
      characterId: b.characterId,
      locationId: b.locationId,
      metadata: b.metadata,
      uuid: b.id,
    })),
  };
  await writeScreenplay(exec, rows);
  result.lines = rows.lines.length;
  return result;
}

/** Default acceptance from the staging screen's initial state: the
 * best-guess thresholds (characters at high/medium; props none). */
export function defaultAcceptance(p: ProposalSet): AcceptedImport {
  const characterNames = new Map<string, string>();
  for (const c of p.characters) {
    if (c.confidence === "low") continue;
    characterNames.set(c.name.toUpperCase(), titleCase(c.name));
  }
  return { scenes: true, characterNames, props: new Map() };
}

export function titleCase(s: string): string {
  return /\p{Ll}/u.test(s) ? s
    : s.toLowerCase().replace(/(^|[\s\-'/.])\p{L}/gu,
                              (c) => c.toUpperCase());
}

export { serialize as serializeFountain };
