/**
 * findings.ts — the finding vocabulary. Spec §9.5.
 *
 * SCF describes and does not enforce (§9.1), so every problem in a file
 * is a FINDING: reported, never a reason to refuse the data. Six modules
 * already produced findings, each with its own shape, its own severity
 * words or none, and its own idea of what identifies the thing at fault.
 * That is fine inside one application and useless outside it — a
 * validator whose output cannot be compared between two runs, let alone
 * between two implementations, is a demonstration rather than a tool.
 *
 * This module does not replace those producers. Each one keeps its own
 * richly-typed result, because the panels that consume them need the
 * detail. What this adds is a NORMAL FORM: one shape, one code space,
 * one severity scale, that every producer can be projected into and that
 * a third party can depend on.
 *
 * Three properties are deliberate:
 *
 *   Codes are dotted strings, not numbers. `identity.uuid_missing` needs
 *   no central registry to allocate and says what it is when it turns up
 *   in someone's log. A numeric code would need a table to be readable
 *   and would eventually be reused wrongly.
 *
 *   Codes are a closed union. Adding one is a deliberate act with a
 *   catalog entry naming the spec section it comes from, so a finding
 *   can never be raised that the specification does not describe.
 *
 *   Severity is about the DATA, never about acceptance. `error` means
 *   two conforming readers would disagree about what the file says. It
 *   does not mean refuse the file, and nothing in SCF ever does.
 */

import type { Registry } from "./registry.ts";
import type { SqlExec } from "./db.ts";
import { auditIdentity } from "./identity.ts";
import { duplicateJunctions } from "./junctions.ts";
import { relationshipFindings } from "./relationships.ts";
import {
  deriveStructure, sceneOrderHint, structureFindings,
} from "./structure.ts";
import { listAssets, orphanIds } from "./assetIndex.ts";
import { fileIdentity } from "./fileIdentity.ts";
import { escapesRoot, parseIdentifier } from "./assets.ts";

/**
 * How much the finding matters to a CONSUMER of the file.
 *
 * Distinct from readiness.ts's `Severity`, which answers a different
 * question — see the note there.
 *
 * - `error`   the data contradicts itself or the specification, and two
 *             conforming readers would resolve it differently. Not a
 *             reason to refuse anything (§9.1) — a reason to fix it
 *             before anyone relies on the answer.
 * - `warning` resolvable, and probably not what the author meant.
 * - `info`    worth reporting; nothing is wrong.
 */
export type FindingSeverity = "error" | "warning" | "info";

export const FINDING_SEVERITY_RANK: Record<FindingSeverity, number> = {
  error: 0, warning: 1, info: 2,
};

/**
 * Every finding SCF can raise. Closed on purpose — see the header.
 *
 * Grouped by area, and within an area roughly by how much it costs the
 * reader.
 */
export type FindingCode =
  // Header and schema — spec §1.2, §11.2
  | "header.application_id_absent"
  | "header.schema_version_mismatch"
  | "header.schema_version_newer"
  // Row identity — spec §6.1
  | "identity.table_absent"
  | "identity.uuid_column_absent"
  | "identity.unique_index_absent"
  | "identity.uuid_missing"
  | "identity.uuid_malformed"
  | "identity.uuid_duplicate"
  | "identity.chain_cycle"
  | "identity.chain_fork"
  | "identity.chain_asymmetric"
  | "identity.superseded_without_successor"
  | "identity.successor_without_timestamp"
  | "identity.self_parent"
  | "identity.external_id_without_namespace"
  // Link natural keys — spec §6.3, §6.4
  | "junction.duplicate_key"
  | "junction.duplicate_key_conflicting"
  // Character relationships — spec §6.5
  | "relationship.duplicate_pair"
  | "relationship.contradictory_pair"
  | "relationship.self_pair"
  | "relationship.directionality_absent"
  | "relationship.endpoint_absent"
  // Spans — spec §5.4, §5.5
  | "structure.boundary_absent"
  | "structure.boundary_dangling"
  | "structure.boundary_shared"
  | "structure.sequence_act_mismatch"
  | "structure.boundary_unnumbered"
  | "structure.scenes_before_first_act"
  | "structure.scene_not_in_script"
  | "structure.shadow_row_unexplained"
  // Assets — spec §8.2, §8.6
  | "asset.identifier_absent"
  | "asset.identifier_escapes_root"
  | "asset.identifier_absolute"
  | "asset.orphan"
  // Extension content — spec §10.1
  | "extension.unknown_table";

export interface FindingSpec {
  severity: FindingSeverity;
  /** One line, stable, safe to show in a UI grouping header. */
  title: string;
  /** The specification section this finding comes from. */
  spec: string;
}

/**
 * The catalog. Severity lives HERE rather than at the point a finding is
 * raised, so that a producer cannot quietly disagree with another about
 * how bad the same condition is.
 */
export const FINDING_CATALOG: Record<FindingCode, FindingSpec> = {
  "header.application_id_absent": {
    severity: "info",
    title: "File header carries no SCF application id",
    spec: "§1.2",
  },
  "header.schema_version_mismatch": {
    severity: "warning",
    title: "Header user_version disagrees with _scf_meta.schema_version",
    spec: "§1.2",
  },
  "header.schema_version_newer": {
    severity: "info",
    title: "File was written by a newer schema version than this reader knows",
    spec: "§11.2",
  },

  "identity.table_absent": {
    severity: "info",
    title: "Registry table not present in this file",
    spec: "§1.3",
  },
  "identity.uuid_column_absent": {
    severity: "error",
    title: "Table carries no uuid column",
    spec: "§6.1",
  },
  "identity.unique_index_absent": {
    severity: "warning",
    title: "Table has no unique index on uuid",
    spec: "§6.1",
  },
  "identity.uuid_missing": {
    severity: "error",
    title: "Rows without a uuid",
    spec: "§6.1",
  },
  "identity.uuid_malformed": {
    severity: "error",
    title: "Rows whose uuid is not uuid-shaped",
    spec: "§6.1",
  },
  "identity.uuid_duplicate": {
    severity: "error",
    title: "Rows sharing a uuid within one table",
    spec: "§6.1",
  },
  "identity.chain_cycle": {
    severity: "error",
    title: "Version chain contains a cycle",
    spec: "§6.1",
  },
  "identity.chain_fork": {
    severity: "warning",
    title: "Two rows claim the same predecessor",
    spec: "§6.1",
  },
  "identity.chain_asymmetric": {
    severity: "warning",
    title: "Version chain links disagree with each other",
    spec: "§6.1",
  },
  "identity.superseded_without_successor": {
    severity: "warning",
    title: "Row marked superseded with nothing succeeding it",
    spec: "§6.1",
  },
  "identity.successor_without_timestamp": {
    severity: "info",
    title: "Successor row carries no timestamp",
    spec: "§6.1",
  },
  "identity.self_parent": {
    severity: "error",
    title: "Row is its own predecessor",
    spec: "§6.1",
  },
  "identity.external_id_without_namespace": {
    severity: "warning",
    title: "External id carries no namespace",
    spec: "§6.1",
  },

  "junction.duplicate_key": {
    severity: "warning",
    title: "Link rows sharing a natural key",
    spec: "§6.4",
  },
  "junction.duplicate_key_conflicting": {
    severity: "error",
    title: "Link rows sharing a natural key and disagreeing on content",
    spec: "§6.4",
  },

  "relationship.duplicate_pair": {
    severity: "warning",
    title: "One relationship entered twice",
    spec: "§6.5",
  },
  "relationship.contradictory_pair": {
    severity: "error",
    title: "One pair described as both mutual and directed",
    spec: "§6.5",
  },
  "relationship.self_pair": {
    severity: "warning",
    title: "Relationship names one character twice",
    spec: "§6.5",
  },
  "relationship.directionality_absent": {
    severity: "warning",
    title: "Relationship carries no directionality",
    spec: "§6.5",
  },
  "relationship.endpoint_absent": {
    severity: "error",
    title: "Relationship points at a character not in this file",
    spec: "§6.5",
  },

  "structure.boundary_absent": {
    severity: "warning",
    title: "Span has no start scene",
    spec: "§5.5",
  },
  "structure.boundary_dangling": {
    severity: "warning",
    title: "Span starts at a scene that is not present",
    spec: "§5.5",
  },
  "structure.boundary_shared": {
    severity: "warning",
    title: "Two spans of the same kind start at one scene",
    spec: "§5.5",
  },
  "structure.sequence_act_mismatch": {
    severity: "info",
    title: "Sequence crosses an act boundary",
    spec: "§5.3",
  },
  "structure.boundary_unnumbered": {
    severity: "info",
    title: "Span carries no number",
    spec: "§5.5",
  },
  "structure.scenes_before_first_act": {
    severity: "info",
    title: "Scenes precede the first act boundary",
    spec: "§5.5",
  },
  "structure.shadow_row_unexplained": {
    severity: "warning",
    title: "scene_sequence rows no span boundary explains",
    spec: "§5.4",
  },
  "structure.scene_not_in_script": {
    severity: "info",
    title: "Scene has no heading in the screenplay",
    spec: "§4.1",
  },

  "asset.identifier_absent": {
    severity: "warning",
    title: "Asset row carries no identifier",
    spec: "§8.2",
  },
  "asset.identifier_escapes_root": {
    severity: "error",
    title: "Asset identifier escapes its root",
    spec: "§8.2",
  },
  "asset.identifier_absolute": {
    severity: "warning",
    title: "Asset identifier is absolute and therefore non-portable",
    spec: "§8.2",
  },
  "asset.orphan": {
    severity: "info",
    title: "Asset referenced by nothing",
    spec: "§8.6",
  },

  "extension.unknown_table": {
    severity: "info",
    title: "Table not defined by the registry",
    spec: "§10.1",
  },
};

export interface Finding {
  code: FindingCode;
  severity: FindingSeverity;
  /** Table the finding is about, or null when it is file-wide. */
  table: string | null;
  /**
   * Rows at fault. Empty when the finding is about a table or the file
   * rather than particular rows. Several ids where the finding is
   * inherently about a set — two rows sharing a key, say.
   */
  rowIds: number[];
  /** One sentence, written for a person. */
  message: string;
  /** How many occurrences this finding stands for. Usually 1. */
  count: number;
}

export interface FindingReport {
  schemaVersion: string | null;
  findings: Finding[];
  counts: Record<FindingSeverity, number>;
  /** True when nothing at `error` was found. */
  clean: boolean;
}

const spec = (code: FindingCode): FindingSpec => FINDING_CATALOG[code];

function make(code: FindingCode, message: string,
              opts: { table?: string | null; rowIds?: number[];
                      count?: number } = {}): Finding {
  return {
    code,
    severity: spec(code).severity,
    table: opts.table ?? null,
    rowIds: opts.rowIds ?? [],
    message,
    count: opts.count ?? 1,
  };
}

/**
 * Deterministic order: severity, then code, then table, then first row
 * id. Two runs over one file must produce byte-identical output or the
 * report cannot be diffed, which is most of what a validator is for.
 */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) =>
    FINDING_SEVERITY_RANK[a.severity] - FINDING_SEVERITY_RANK[b.severity] ||
    a.code.localeCompare(b.code) ||
    (a.table ?? "").localeCompare(b.table ?? "") ||
    (a.rowIds[0] ?? 0) - (b.rowIds[0] ?? 0));
}

const IDENTITY_CODES: Record<string, FindingCode> = {
  "table-absent": "identity.table_absent",
  "no-uuid-column": "identity.uuid_column_absent",
  "no-unique-index": "identity.unique_index_absent",
  "missing-uuid": "identity.uuid_missing",
  "malformed-uuid": "identity.uuid_malformed",
  "duplicate-uuid": "identity.uuid_duplicate",
  "chain-cycle": "identity.chain_cycle",
  "chain-fork": "identity.chain_fork",
  "chain-asymmetric": "identity.chain_asymmetric",
  "superseded-without-successor": "identity.superseded_without_successor",
  "successor-without-timestamp": "identity.successor_without_timestamp",
  "self-parent": "identity.self_parent",
  "external-id-without-namespace": "identity.external_id_without_namespace",
};

const RELATIONSHIP_CODES: Record<string, FindingCode> = {
  "duplicate-pair": "relationship.duplicate_pair",
  "contradictory-pair": "relationship.contradictory_pair",
  "self-pair": "relationship.self_pair",
  "missing-directionality": "relationship.directionality_absent",
  "missing-endpoint": "relationship.endpoint_absent",
};

const STRUCTURE_CODES: Record<string, FindingCode> = {
  "no-boundary": "structure.boundary_absent",
  "dangling-boundary": "structure.boundary_dangling",
  "shared-boundary": "structure.boundary_shared",
  "act-mismatch": "structure.sequence_act_mismatch",
  "unnumbered-boundary": "structure.boundary_unnumbered",
  "scenes-before-first-act": "structure.scenes_before_first_act",
  "not-in-script": "structure.scene_not_in_script",
};

/**
 * Run every producer and project the results into the normal form.
 *
 * This is the engine a validator sits on. It is deliberately a library
 * function taking a `SqlExec`, so the same code serves a CLI, the
 * editor's panels, and a test — one implementation of "what is wrong
 * with this file", not three that drift.
 */
export async function collectFindings(
    exec: SqlExec, registry: Registry): Promise<FindingReport> {
  const out: Finding[] = [];

  // --- header and schema version (§1.2, §11.2) ---
  const identity = await fileIdentity(exec);
  let storedVersion: string | null = null;
  try {
    const rows = await exec(
      "SELECT value FROM _scf_meta WHERE key = 'schema_version'");
    const v = rows[0]?.["value"];
    storedVersion = v === undefined || v === null ? null : String(v);
  } catch { storedVersion = null; }

  if (!identity.isScf) {
    out.push(make("header.application_id_absent",
      "No SCF application id in the file header; identification by " +
      "content only."));
  }
  if (identity.headerSchemaVersion !== null && storedVersion !== null &&
      identity.headerSchemaVersion !== storedVersion) {
    out.push(make("header.schema_version_mismatch",
      `Header says schema ${identity.headerSchemaVersion}, ` +
      `_scf_meta says ${storedVersion}. _scf_meta is authoritative.`));
  }
  if (storedVersion !== null && storedVersion !== registry.schemaVersion) {
    const [fileMajor = 0, fileMinor = 0] = storedVersion.split(".").map(Number);
    const [ourMajor = 0, ourMinor = 0] =
      registry.schemaVersion.split(".").map(Number);
    if (fileMajor > ourMajor ||
        (fileMajor === ourMajor && fileMinor > ourMinor)) {
      out.push(make("header.schema_version_newer",
        `File is schema ${storedVersion}; this reader knows ` +
        `${registry.schemaVersion}. Unrecognised content is ignored.`));
    }
  }

  // --- row identity (§6.1) ---
  const audit = await auditIdentity(exec, registry);
  for (const f of audit.findings) {
    const code = IDENTITY_CODES[f.kind];
    if (code === undefined) continue;
    out.push(make(code, f.detail, {
      table: f.table,
      rowIds: f.id === null ? [] : [f.id],
      count: f.count,
    }));
  }

  // --- link natural keys (§6.4) ---
  for (const dup of await duplicateJunctions(exec, registry)) {
    out.push(make(
      dup.contentDiffers
        ? "junction.duplicate_key_conflicting" : "junction.duplicate_key",
      dup.message, { table: dup.entity, rowIds: dup.rowIds }));
  }

  // --- character relationships (§6.5) ---
  for (const f of await relationshipFindings(exec, registry)) {
    const code = RELATIONSHIP_CODES[f.kind];
    if (code === undefined) continue;
    out.push(make(code, f.message, {
      table: "character_relationship", rowIds: f.rowIds,
    }));
  }

  // --- spans (§5.5) ---
  const scenes = await exec("SELECT * FROM scene");
  const acts = await exec("SELECT * FROM act");
  const sequences = await exec("SELECT * FROM sequence");
  const headings = await exec(
    "SELECT scene_id, line_order FROM screenplay_lines " +
    "WHERE line_type = 'heading'");
  const hint = sceneOrderHint(headings);
  const structure = deriveStructure(scenes, acts, sequences, hint);
  for (const f of structureFindings(structure, acts, sequences, hint)) {
    const code = STRUCTURE_CODES[f.code];
    if (code === undefined) continue;
    out.push(make(code, f.message, {
      table: f.entity, rowIds: f.rowId === null ? [] : [f.rowId],
    }));
  }

  // --- shadow rows (§5.4) ---
  //
  // §5.4 requires these to be counted and reported as a finding, and
  // until 0.26 the catalog had no code for it — so §5.4 and §9.4 could
  // not both be obeyed. The detection existed only inside the editor's
  // commit path as a count on a result object, which means the one tool
  // a third party actually runs never mentioned them.
  //
  // Reported, never deleted: silently dropping someone's authored links
  // to satisfy a derivation is not a migration.
  try {
    const explained = new Set<string>();
    for (const span of structure.sequences) {
      for (const sceneId of span.sceneIds) {
        explained.add(`${String(sceneId)}:${String(span.id)}`);
      }
    }
    const orphaned = (await exec(
      "SELECT id, scene_id, sequence_id FROM scene_sequence"))
      .filter((r) => !explained.has(
        `${String(Number(r["scene_id"]))}:${String(Number(r["sequence_id"]))}`));
    if (orphaned.length > 0) {
      out.push(make("structure.shadow_row_unexplained",
        `${String(orphaned.length)} scene_sequence row(s) are explained ` +
        "by no sequence boundary; the boundary is the truth and these " +
        "are its shadow (§5.4).",
        { table: "scene_sequence",
          rowIds: orphaned.map((r) => Number(r["id"])).sort((a, b) => a - b),
          count: orphaned.length }));
    }
  } catch { /* table absent: not a finding */ }

  // --- assets (§8.2, §8.6) ---
  const assets = await listAssets(exec);
  const orphans = await orphanIds(exec, registry);
  for (const a of assets) {
    const id = a.identifier ?? "";
    if (id.trim() === "") {
      out.push(make("asset.identifier_absent",
        `Asset ${String(a.id)} has no identifier.`,
        { table: "asset", rowIds: [a.id] }));
      continue;
    }
    const parsed = parseIdentifier(id);
    if (parsed === null) {
      out.push(make("asset.identifier_absent",
        `Asset ${String(a.id)} has an identifier that does not parse.`,
        { table: "asset", rowIds: [a.id] }));
    } else if (escapesRoot(parsed.path)) {
      out.push(make("asset.identifier_escapes_root",
        `Asset identifier "${id}" contains a '..' segment and cannot ` +
        "be resolved.", { table: "asset", rowIds: [a.id] }));
    } else if (parsed.root === null) {
      out.push(make("asset.identifier_absolute",
        `Asset identifier "${id}" is absolute; it will not travel with ` +
        "the file.", { table: "asset", rowIds: [a.id] }));
    }
  }
  for (const id of orphans) {
    out.push(make("asset.orphan",
      `Asset ${String(id)} is referenced by nothing.`,
      { table: "asset", rowIds: [id] }));
  }

  // --- unknown tables (§10.1) ---
  // registry.knownTables, not a set assembled here: "what SCF owns" is
  // a fact about the format and belongs where the format is declared.
  // Assembling it at the call site is how the two title-page tables
  // came to be reported as third-party content in the first place.
  const known = registry.knownTables;
  const tables = await exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' " +
    "AND name NOT LIKE 'sqlite_%'");
  for (const t of tables) {
    const name = String(t["name"]);
    if (known.has(name)) continue;
    out.push(make("extension.unknown_table",
      `Table "${name}" is not defined by the registry; it is preserved ` +
      "and otherwise ignored.", { table: name }));
  }

  const findings = sortFindings(out);
  const counts: Record<FindingSeverity, number> = {
    error: 0, warning: 0, info: 0,
  };
  for (const f of findings) counts[f.severity] += 1;

  return {
    schemaVersion: storedVersion,
    findings,
    counts,
    clean: counts.error === 0,
  };
}
