/**
 * canonical.ts — the canonical dump. Spec §11.6.
 *
 * `conformance.md` §3 named this as an open question: the Writer role
 * rests on "open, save, lose nothing", and nobody had said what the
 * comparison is performed ON. It cannot be the bytes. SQLite is free to
 * reorder pages, reuse freelist space and change its file size without
 * any row changing, so two byte-different files routinely say exactly
 * the same thing. A byte comparison would fail constantly and mean
 * nothing when it passed.
 *
 * So the comparison is performed on a canonical dump: every table, every
 * row, in an order that depends only on content.
 *
 *   - Tables sorted by name, INCLUDING unknown ones. §10.1 requires a
 *     writer to preserve content it does not recognise, so a dump that
 *     skipped unknown tables could not detect the one failure the Writer
 *     role is most likely to have.
 *   - Rows sorted by uuid where the table has one, since row ids are
 *     local to a file (§6.2) and a rewrite may legitimately renumber
 *     them. Tables without uuids fall back to their full sorted content.
 *   - Columns sorted by name, so a column added at the end of a table by
 *     one implementation and in the middle by another still compares
 *     equal.
 *   - Row ids are EXCLUDED by default, for the same reason they cannot
 *     order rows: they are not identity.
 *
 * What survives all of that is what the file actually says. Two files
 * with the same canonical dump are the same SCF document, whatever their
 * bytes.
 */

import type { Row, SqlExec } from "./db.ts";
import { q } from "./db.ts";

export interface DumpOptions {
  /**
   * Include row ids. Off by default — see the header. Useful when
   * checking that a specific operation did not renumber anything, which
   * is a stricter question than document equality.
   */
  includeRowIds?: boolean;
  /** Tables to leave out. `_scf_meta` is excluded by default. */
  exclude?: readonly string[];
}

export interface CanonicalDump {
  /** Table name → rows, each row a sorted-key object. */
  tables: Record<string, Array<Record<string, unknown>>>;
  /** Table names present, sorted. Cheap to compare before the rows. */
  tableNames: string[];
  /** Total rows across all tables. */
  rowCount: number;
}

const DEFAULT_EXCLUDE = [
  // Carries an updated_at that changes on every save without the
  // document changing. Its schema_version is checked separately.
  "_scf_meta",
];

const sortedKeys = (row: Row, includeRowIds: boolean):
    Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    if (!includeRowIds && key === "id") continue;
    out[key] = row[key];
  }
  return out;
};

/**
 * Stable comparison of two rows with no uuid to order them. Compares
 * their serialised form, which is deterministic because the keys are
 * already sorted.
 */
const byContent = (a: Record<string, unknown>,
                   b: Record<string, unknown>): number =>
  JSON.stringify(a).localeCompare(JSON.stringify(b));

export async function canonicalDump(
    exec: SqlExec, opts: DumpOptions = {}): Promise<CanonicalDump> {
  const includeRowIds = opts.includeRowIds ?? false;
  const exclude = new Set([...DEFAULT_EXCLUDE, ...(opts.exclude ?? [])]);

  const tableRows = await exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' " +
    "AND name NOT LIKE 'sqlite_%' ORDER BY name");

  const tables: Record<string, Array<Record<string, unknown>>> = {};
  let rowCount = 0;

  for (const t of tableRows) {
    const name = String(t["name"]);
    if (exclude.has(name)) continue;

    const cols = await exec(`PRAGMA table_info(${q(name)})`);
    const hasUuid = cols.some((c) => String(c["name"]) === "uuid");

    const rows = await exec(`SELECT * FROM ${q(name)}`);
    const shaped = rows.map((r) => sortedKeys(r, includeRowIds));

    shaped.sort((a, b) => {
      if (hasUuid) {
        const ua = String(a["uuid"] ?? "");
        const ub = String(b["uuid"] ?? "");
        if (ua !== ub) return ua.localeCompare(ub);
      }
      return byContent(a, b);
    });

    tables[name] = shaped;
    rowCount += shaped.length;
  }

  return { tables, tableNames: Object.keys(tables).sort(), rowCount };
}

/** Stable serialisation, for diffing or hashing. */
export function dumpToJson(dump: CanonicalDump): string {
  return `${JSON.stringify(dump, null, 2)}\n`;
}

export interface DumpDifference {
  table: string;
  kind: "table-added" | "table-removed" | "row-count" | "rows";
  detail: string;
}

/**
 * Compare two dumps and describe what moved. Returns an empty array when
 * the two documents say the same thing.
 *
 * Reports differences rather than throwing, in keeping with §9.1: this
 * is a description of what changed, and whether that is a defect depends
 * on what the caller was doing between the two dumps.
 */
export function diffDumps(before: CanonicalDump,
                          after: CanonicalDump): DumpDifference[] {
  const out: DumpDifference[] = [];
  const names = new Set([...before.tableNames, ...after.tableNames]);

  for (const table of [...names].sort()) {
    const a = before.tables[table];
    const b = after.tables[table];
    if (a === undefined) {
      out.push({ table, kind: "table-added",
                 detail: `${String(b?.length ?? 0)} rows` });
      continue;
    }
    if (b === undefined) {
      out.push({ table, kind: "table-removed",
                 detail: `${String(a.length)} rows lost` });
      continue;
    }
    if (a.length !== b.length) {
      out.push({ table, kind: "row-count",
                 detail: `${String(a.length)} -> ${String(b.length)}` });
      continue;
    }
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    if (ja !== jb) {
      const firstChanged = a.findIndex(
        (row, i) => JSON.stringify(row) !== JSON.stringify(b[i]));
      out.push({
        table, kind: "rows",
        detail: `content differs, first at index ${String(firstChanged)}`,
      });
    }
  }
  return out;
}
