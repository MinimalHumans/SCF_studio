/**
 * identity.ts — making row identity observable.
 *
 * `uuid` is a framework column on all 99 entities since schema 2.3
 * (conventions §5), backfilled on open, and until now nothing in the
 * application ever showed one. Identity was therefore not merely
 * unverified but unobservable: a backfill that silently skipped a table,
 * a version chain that forked, a superseded row with no successor — all
 * of it invisible.
 *
 * This module answers three questions, and only reports:
 *
 *   auditIdentity  — does every row in this file have identity at all?
 *   findByUuid     — which row is this uuid, anywhere in the file?
 *   rowIdentity    — what is this row's identity, lineage and external
 *                    binding, and is any of it incoherent?
 *
 * Nothing here writes. A malformed chain is a finding, not something to
 * repair behind the author's back — the same rule §2 applies to every
 * other derivation in the format. Repair, if it is ever wanted, is a
 * separate call an author makes on purpose.
 *
 * All three stay total on half-placed data: a table with no uuid column
 * is reported as such rather than throwing, because a file that predates
 * a migration must still open.
 */

import { q, type Row, type SqlExec, type SqlValue } from "./db.ts";
import { junctionKeyFields } from "./junctions.ts";
import type { EntityDef, Registry } from "./registry.ts";

/** Canonical 8-4-4-4-12 hex form. Version-agnostic on purpose: a uuid
 *  minted by another tool is still a uuid, and refusing it here would
 *  report a foreign file as broken. */
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidShaped(value: unknown): boolean {
  return typeof value === "string" && UUID_SHAPE.test(value);
}

export type IdentityFindingKind =
  | "table-absent"
  | "no-uuid-column"
  | "no-unique-index"
  | "missing-uuid"
  | "malformed-uuid"
  | "duplicate-uuid"
  | "chain-cycle"
  | "chain-fork"
  | "chain-asymmetric"
  | "superseded-without-successor"
  | "successor-without-timestamp"
  | "self-parent"
  | "external-id-without-namespace";

export interface IdentityFinding {
  kind: IdentityFindingKind;
  table: string;
  /** Row id where the finding is row-specific; null when table-wide. */
  id: number | null;
  count: number;
  detail: string;
}

export interface TableIdentity {
  table: string;
  /** False for the screenplay-side tables in registry.uuidExtraTables. */
  registryEntity: boolean;
  present: boolean;
  hasUuidColumn: boolean;
  hasUniqueIndex: boolean;
  rows: number;
  withUuid: number;
  missingUuid: number;
  malformed: number;
  duplicated: number;
}

export interface IdentityAudit {
  schemaVersion: string;
  tables: TableIdentity[];
  totals: {
    tables: number;
    rows: number;
    withUuid: number;
    missingUuid: number;
    malformed: number;
    duplicated: number;
  };
  findings: IdentityFinding[];
  /** True when every present row in every present table has a
   *  well-formed, unique uuid. The one-line answer. */
  clean: boolean;
}

async function presentTables(exec: SqlExec): Promise<Set<string>> {
  const rows = await exec(
    "SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set(rows.map((r) => String(r["name"])));
}

async function columnsOf(exec: SqlExec, table: string): Promise<Set<string>> {
  const rows = await exec(`PRAGMA table_info(${q(table)})`);
  return new Set(rows.map((r) => String(r["name"])));
}

async function hasUuidUniqueIndex(
  exec: SqlExec, table: string,
): Promise<boolean> {
  const indexes = await exec(`PRAGMA index_list(${q(table)})`);
  for (const idx of indexes) {
    if (Number(idx["unique"]) !== 1) continue;
    const cols = await exec(`PRAGMA index_info(${q(String(idx["name"]))})`);
    if (cols.length === 1 && String(cols[0]?.["name"]) === "uuid") return true;
  }
  return false;
}

function num(row: Row | undefined, key: string): number {
  const v = row?.[key];
  return typeof v === "number" ? v : Number(v ?? 0);
}

/**
 * Every table that should carry identity, and whether it does.
 *
 * Malformed and duplicate counts are computed in SQL rather than by
 * pulling uuids into memory, because a working file holds hundreds of
 * thousands of rows and this runs on a panel open.
 */
export async function auditIdentity(
  exec: SqlExec, registry: Registry,
): Promise<IdentityAudit> {
  const present = await presentTables(exec);
  const wanted: { table: string; registryEntity: boolean }[] = [
    ...registry.order.map((t) => ({ table: t, registryEntity: true })),
    ...registry.uuidExtraTables.map((t) => ({ table: t, registryEntity: false })),
  ];

  const tables: TableIdentity[] = [];
  const findings: IdentityFinding[] = [];

  for (const { table, registryEntity } of wanted) {
    const entry: TableIdentity = {
      table, registryEntity,
      present: present.has(table),
      hasUuidColumn: false, hasUniqueIndex: false,
      rows: 0, withUuid: 0, missingUuid: 0, malformed: 0, duplicated: 0,
    };

    if (!entry.present) {
      // Not a defect for the extra tables: the screenplay side only
      // exists once a script has been committed.
      if (registryEntity) {
        findings.push({
          kind: "table-absent", table, id: null, count: 1,
          detail: `registry table ${table} is missing from this file`,
        });
      }
      tables.push(entry);
      continue;
    }

    const cols = await columnsOf(exec, table);
    entry.hasUuidColumn = cols.has("uuid");
    entry.rows = num((await exec(
      `SELECT COUNT(*) AS n FROM ${q(table)}`))[0], "n");

    if (!entry.hasUuidColumn) {
      if (entry.rows > 0) {
        findings.push({
          kind: "no-uuid-column", table, id: null, count: entry.rows,
          detail: `${table} has no uuid column; ${entry.rows} row(s) ` +
                  `carry no identity at all`,
        });
      }
      tables.push(entry);
      continue;
    }

    entry.hasUniqueIndex = await hasUuidUniqueIndex(exec, table);
    if (!entry.hasUniqueIndex) {
      findings.push({
        kind: "no-unique-index", table, id: null, count: 1,
        detail: `${table}.uuid has no unique index; nothing prevents two ` +
                `rows claiming one identity`,
      });
    }

    entry.withUuid = num((await exec(
      `SELECT COUNT(*) AS n FROM ${q(table)} WHERE uuid IS NOT NULL ` +
      `AND uuid <> ''`))[0], "n");
    entry.missingUuid = entry.rows - entry.withUuid;

    // Shape test in SQL rather than in memory: a working file holds
    // hundreds of thousands of rows and this runs on a panel open.
    // GLOB is case-sensitive, so the class spells out both cases.
    const hex = "[0-9a-fA-F]";
    const pattern = [8, 4, 4, 4, 12].map((n) => hex.repeat(n)).join("-");
    entry.malformed = num((await exec(
      `SELECT COUNT(*) AS n FROM ${q(table)} ` +
      `WHERE uuid IS NOT NULL AND uuid <> '' AND uuid NOT GLOB ?`,
      [pattern]))[0], "n");

    entry.duplicated = num((await exec(
      `SELECT COUNT(*) AS n FROM (SELECT uuid FROM ${q(table)} ` +
      `WHERE uuid IS NOT NULL AND uuid <> '' ` +
      `GROUP BY uuid HAVING COUNT(*) > 1)`))[0], "n");

    if (entry.missingUuid > 0) {
      findings.push({
        kind: "missing-uuid", table, id: null, count: entry.missingUuid,
        detail: `${entry.missingUuid} row(s) in ${table} have no uuid; ` +
                `the open-time backfill did not reach them`,
      });
    }
    if (entry.malformed > 0) {
      findings.push({
        kind: "malformed-uuid", table, id: null, count: entry.malformed,
        detail: `${entry.malformed} row(s) in ${table} hold a uuid that ` +
                `is not in canonical 8-4-4-4-12 form`,
      });
    }
    if (entry.duplicated > 0) {
      findings.push({
        kind: "duplicate-uuid", table, id: null, count: entry.duplicated,
        detail: `${entry.duplicated} uuid(s) in ${table} appear on more ` +
                `than one row`,
      });
    }

    tables.push(entry);
  }

  const totals = tables.reduce((acc, t) => ({
    tables: acc.tables + (t.present ? 1 : 0),
    rows: acc.rows + t.rows,
    withUuid: acc.withUuid + t.withUuid,
    missingUuid: acc.missingUuid + t.missingUuid,
    malformed: acc.malformed + t.malformed,
    duplicated: acc.duplicated + t.duplicated,
  }), { tables: 0, rows: 0, withUuid: 0, missingUuid: 0, malformed: 0,
        duplicated: 0 });

  return {
    schemaVersion: registry.schemaVersion,
    tables, totals, findings,
    clean: findings.length === 0,
  };
}

export interface UuidHit {
  table: string;
  entityLabel: string;
  id: number;
  /** The row's name-field value, where it has one. */
  label: string | null;
}

/**
 * Where a uuid lives. Returns every hit rather than the first, because
 * more than one is exactly the condition worth seeing.
 */
export async function findByUuid(
  exec: SqlExec, registry: Registry, uuid: string,
): Promise<UuidHit[]> {
  const needle = uuid.trim();
  if (needle === "") return [];
  const present = await presentTables(exec);
  const hits: UuidHit[] = [];

  const candidates: { table: string; label: string; nameField: string | null }[] = [
    ...registry.order.map((t) => {
      const e = registry.entities.get(t);
      return {
        table: t,
        label: e?.label ?? t,
        nameField: e?.nameField ?? null,
      };
    }),
    ...registry.uuidExtraTables.map((t) => ({
      table: t, label: t, nameField: null,
    })),
  ];

  for (const c of candidates) {
    if (!present.has(c.table)) continue;
    const cols = await columnsOf(exec, c.table);
    if (!cols.has("uuid")) continue;
    const nameCol = c.nameField !== null && cols.has(c.nameField)
      ? c.nameField : null;
    const select = nameCol !== null
      ? `SELECT id, ${q(nameCol)} AS label FROM ${q(c.table)} WHERE uuid = ?`
      : `SELECT id, NULL AS label FROM ${q(c.table)} WHERE uuid = ?`;
    for (const row of await exec(select, [needle])) {
      hits.push({
        table: c.table,
        entityLabel: c.label,
        id: Number(row["id"]),
        label: row["label"] === null ? null : String(row["label"]),
      });
    }
  }
  return hits;
}

export interface UuidRow {
  id: number;
  uuid: string | null;
  label: string | null;
}

/**
 * A page of rows with their uuids, for a single table.
 *
 * The lookup box can only be used by someone who already has a uuid,
 * which for a format whose uuids are never printed anywhere is a closed
 * loop. This opens it: pick a table, read the identities off it.
 */
export async function browseUuids(
  exec: SqlExec, registry: Registry, table: string,
  limit = 50, offset = 0,
): Promise<{ rows: UuidRow[]; total: number }> {
  const present = await presentTables(exec);
  if (!present.has(table)) return { rows: [], total: 0 };
  const cols = await columnsOf(exec, table);
  if (!cols.has("uuid")) return { rows: [], total: 0 };

  const nameField = registry.entities.get(table)?.nameField ?? null;
  const nameCol = nameField !== null && cols.has(nameField) ? nameField : null;
  const total = num((await exec(
    `SELECT COUNT(*) AS n FROM ${q(table)}`))[0], "n");

  const select = nameCol !== null
    ? `SELECT id, uuid, ${q(nameCol)} AS label FROM ${q(table)} ` +
      `ORDER BY id LIMIT ? OFFSET ?`
    : `SELECT id, uuid, NULL AS label FROM ${q(table)} ` +
      `ORDER BY id LIMIT ? OFFSET ?`;

  const rows = (await exec(select, [limit, offset])).map((r) => ({
    id: Number(r["id"]),
    uuid: r["uuid"] === null || r["uuid"] === undefined
      ? null : String(r["uuid"]),
    label: r["label"] === null || r["label"] === undefined
      ? null : String(r["label"]),
  }));
  return { rows, total };
}

export interface VersionLink {
  id: number;
  uuid: string | null;
  versionLabel: string | null;
  lifecycleStatus: string | null;
  supersededAt: string | null;
  /** True for the row the chain was requested from. */
  self: boolean;
}

export interface NaturalKeyPart {
  field: string;
  value: SqlValue;
}

export interface RowIdentity {
  table: string;
  entityLabel: string;
  id: number;
  exists: boolean;
  uuid: string | null;
  uuidWellFormed: boolean;
  lifecycleStatus: string | null;
  externalId: string | null;
  externalIdNamespace: string | null;
  versionable: boolean;
  /** Root first, newest last. Empty for a non-versionable entity. */
  chain: VersionLink[];
  /** Index of this row within `chain`, or -1. */
  position: number;
  /** Set for link entities only (conventions §5). */
  naturalKey: NaturalKeyPart[] | null;
  findings: IdentityFinding[];
}

const CHAIN_LIMIT = 500;

async function fetchLink(
  exec: SqlExec, table: string, cols: Set<string>, id: number, self: boolean,
): Promise<VersionLink | null> {
  const pick = (name: string): string =>
    cols.has(name) ? q(name) : `NULL AS ${q(name)}`;
  const rows = await exec(
    `SELECT id, ${pick("uuid")}, ${pick("version_label")}, ` +
    `${pick("lifecycle_status")}, ${pick("superseded_at")} ` +
    `FROM ${q(table)} WHERE id = ?`, [id]);
  const row = rows[0];
  if (row === undefined) return null;
  const str = (k: string): string | null =>
    row[k] === null || row[k] === undefined ? null : String(row[k]);
  return {
    id: Number(row["id"]),
    uuid: str("uuid"),
    versionLabel: str("version_label"),
    lifecycleStatus: str("lifecycle_status"),
    supersededAt: str("superseded_at"),
    self,
  };
}

/**
 * One row's identity, lineage, and external binding.
 *
 * The chain is walked backwards on `parent_id` and forwards on
 * `superseded_by_id`, which are two separate claims about the same
 * order. Where they disagree the disagreement is reported rather than
 * reconciled: a fork means two rows name the same parent, and only the
 * author knows which was intended.
 */
export async function rowIdentity(
  exec: SqlExec, registry: Registry, table: string, id: number,
): Promise<RowIdentity> {
  const edef: EntityDef | undefined = registry.entities.get(table);
  const findings: IdentityFinding[] = [];
  const out: RowIdentity = {
    table,
    entityLabel: edef?.label ?? table,
    id,
    exists: false,
    uuid: null,
    uuidWellFormed: false,
    lifecycleStatus: null,
    externalId: null,
    externalIdNamespace: null,
    versionable: edef?.versionable ?? false,
    chain: [],
    position: -1,
    naturalKey: null,
    findings,
  };

  const present = await presentTables(exec);
  if (!present.has(table)) {
    findings.push({
      kind: "table-absent", table, id: null, count: 1,
      detail: `${table} does not exist in this file`,
    });
    return out;
  }

  const cols = await columnsOf(exec, table);
  const rows = await exec(`SELECT * FROM ${q(table)} WHERE id = ?`, [id]);
  const row = rows[0];
  if (row === undefined) return out;
  out.exists = true;

  const str = (k: string): string | null => {
    const v = row[k];
    return v === null || v === undefined || v === "" ? null : String(v);
  };

  out.uuid = str("uuid");
  out.uuidWellFormed = isUuidShaped(out.uuid);
  out.lifecycleStatus = str("lifecycle_status");
  out.externalId = str("external_id");
  out.externalIdNamespace = str("external_id_namespace");

  if (out.uuid === null) {
    findings.push({
      kind: "missing-uuid", table, id, count: 1,
      detail: "this row has no uuid; it cannot be matched across export " +
              "and re-import",
    });
  } else if (!out.uuidWellFormed) {
    findings.push({
      kind: "malformed-uuid", table, id, count: 1,
      detail: `uuid "${out.uuid}" is not in canonical 8-4-4-4-12 form`,
    });
  }

  if (out.externalId !== null && out.externalIdNamespace === null) {
    findings.push({
      kind: "external-id-without-namespace", table, id, count: 1,
      detail: "an external id with no namespace does not say which system " +
              "it belongs to (conventions §5)",
    });
  }

  // --- version chain -----------------------------------------------
  if (out.versionable && cols.has("parent_id")) {
    const ancestors: VersionLink[] = [];
    const seen = new Set<number>([id]);
    let cursor = row["parent_id"];
    let steps = 0;
    while (cursor !== null && cursor !== undefined && steps < CHAIN_LIMIT) {
      const parentId = Number(cursor);
      if (parentId === id && steps === 0) {
        findings.push({
          kind: "self-parent", table, id, count: 1,
          detail: "this row names itself as its own parent version",
        });
        break;
      }
      if (seen.has(parentId)) {
        findings.push({
          kind: "chain-cycle", table, id: parentId, count: 1,
          detail: `version chain loops back to row ${parentId}`,
        });
        break;
      }
      seen.add(parentId);
      const link = await fetchLink(exec, table, cols, parentId, false);
      if (link === null) {
        findings.push({
          kind: "chain-asymmetric", table, id: parentId, count: 1,
          detail: `parent_id points at row ${parentId}, which does not exist`,
        });
        break;
      }
      ancestors.unshift(link);
      const prow = (await exec(
        `SELECT parent_id FROM ${q(table)} WHERE id = ?`, [parentId]))[0];
      cursor = prow?.["parent_id"] ?? null;
      steps += 1;
    }

    const self = await fetchLink(exec, table, cols, id, true);
    const descendants: VersionLink[] = [];
    if (cols.has("superseded_by_id")) {
      let next = row["superseded_by_id"];
      let dsteps = 0;
      while (next !== null && next !== undefined && dsteps < CHAIN_LIMIT) {
        const nextId = Number(next);
        if (seen.has(nextId)) {
          findings.push({
            kind: "chain-cycle", table, id: nextId, count: 1,
            detail: `supersession loops back to row ${nextId}`,
          });
          break;
        }
        seen.add(nextId);
        const link = await fetchLink(exec, table, cols, nextId, false);
        if (link === null) {
          findings.push({
            kind: "chain-asymmetric", table, id: nextId, count: 1,
            detail: `superseded_by_id points at row ${nextId}, which does ` +
                    `not exist`,
          });
          break;
        }
        descendants.push(link);
        const nrow = (await exec(
          `SELECT superseded_by_id FROM ${q(table)} WHERE id = ?`,
          [nextId]))[0];
        next = nrow?.["superseded_by_id"] ?? null;
        dsteps += 1;
      }
    }

    out.chain = [...ancestors, ...(self === null ? [] : [self]),
                 ...descendants];
    out.position = ancestors.length;

    // Forks: more than one row naming this row as its parent.
    const children = await exec(
      `SELECT id FROM ${q(table)} WHERE parent_id = ?`, [id]);
    if (children.length > 1) {
      findings.push({
        kind: "chain-fork", table, id, count: children.length,
        detail: `${children.length} rows name this one as their parent ` +
                `version — the chain forks here`,
      });
    }

    // The two directions must agree.
    const successor = row["superseded_by_id"];
    if (successor !== null && successor !== undefined) {
      const back = (await exec(
        `SELECT parent_id FROM ${q(table)} WHERE id = ?`,
        [Number(successor)]))[0];
      if (back !== undefined &&
          Number(back["parent_id"] ?? -1) !== id) {
        findings.push({
          kind: "chain-asymmetric", table, id, count: 1,
          detail: `superseded_by_id names row ${Number(successor)}, but ` +
                  `that row does not name this one as its parent`,
        });
      }
      if (str("superseded_at") === null) {
        findings.push({
          kind: "successor-without-timestamp", table, id, count: 1,
          detail: "a successor is recorded but superseded_at is empty",
        });
      }
    } else if (out.lifecycleStatus === "superseded") {
      findings.push({
        kind: "superseded-without-successor", table, id, count: 1,
        detail: "marked superseded with no forward pointer to what " +
                "replaced it",
      });
    }
  }

  // --- natural key (links only, conventions §5) ---------------------
  if (edef !== undefined && edef.subject === "link") {
    const keyFields = junctionKeyFields(edef).filter((f) => cols.has(f));
    if (keyFields.length > 0) {
      out.naturalKey = keyFields.map((f) => ({
        field: f, value: (row[f] ?? null) as SqlValue,
      }));
    }
  }

  return out;
}
