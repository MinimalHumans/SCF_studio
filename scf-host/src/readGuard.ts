// SPDX-License-Identifier: Apache-2.0
/**
 * readGuard.ts — what `query` will run.
 *
 * `query` is the one place a client hands the host SQL, so it is held to
 * reads twice over: the connection is opened read-only, and the text
 * must be a single SELECT/WITH statement or one of the schema-reading
 * pragmas. The second check is not the safety net — SQLite refuses the
 * write on a read-only handle — it is there so a client gets a clear
 * "bad_query" instead of a driver message, and so nothing odd (ATTACH,
 * a second statement) is ever prepared.
 */

const READ_PRAGMAS = new Set([
  "table_info", "table_xinfo", "table_list", "foreign_key_list",
  "index_list", "index_info", "index_xinfo", "user_version",
  "application_id", "integrity_check", "quick_check", "foreign_key_check",
]);

/** `sql` without comments and with string/identifier contents blanked. */
function skeleton(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
    } else if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += " ";
    } else if (c === "'" || c === "\"" || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === close) {
          if (close !== "]" && sql[i + 1] === close) { i += 2; continue; }
          break;
        }
        i += 1;
      }
      i += 1;
      out += "''";
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Returns a reason the statement is refused, or null if it may run. */
export function refuseQuery(sql: string): string | null {
  const s = skeleton(sql).trim().replace(/;+\s*$/, "").trim();
  if (s === "") return "empty statement";
  if (s.includes(";")) return "only one statement may be run at a time";
  const word = /^[A-Za-z]+/.exec(s)?.[0]?.toUpperCase();
  if (word === "SELECT" || word === "WITH") return null;
  if (word === "PRAGMA") {
    const m = /^PRAGMA\s+(?:\w+\.)?(\w+)\s*(.*)$/is.exec(s);
    const name = m?.[1]?.toLowerCase();
    if (name !== undefined && READ_PRAGMAS.has(name) &&
        !(m?.[2] ?? "").trimStart().startsWith("=")) return null;
    return "that pragma is not allowed";
  }
  return "only SELECT queries are allowed";
}
