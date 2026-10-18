// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import type { Row, SqlExec, SqlValue } from "@scf-core/db.ts";
import { exec, useStore } from "../state/store.ts";

/**
 * Run a query and re-run it whenever the store revision bumps (any write)
 * or the params change. Errors render as empty results and log; the
 * editor must never hard-crash on a query against a partial project.
 */
export function useQuery(
    sql: string | null, params: SqlValue[] = []): Row[] {
  const revision = useStore((s) => s.revision);
  // Views stay mounted for a tick while a project is being torn down and
  // rebuilt underneath them — closing one, opening another, or New
  // Project, which wipes the file and re-creates the format. Queries
  // fired in that window landed on a database that was closed ("no
  // database open") or mid-rebuild ("no such table: …"). Neither is a
  // real fault; both looked like one, and both filled the console during
  // ordinary use.
  const phase = useStore((s) => s.phase);
  const [rows, setRows] = useState<Row[]>([]);
  const key = JSON.stringify(params);
  useEffect(() => {
    let cancelled = false;
    if (sql === null || phase !== "open") {
      setRows([]);
      return;
    }
    exec(sql, params).then((r) => {
      if (!cancelled) setRows(r);
    }).catch((e: unknown) => {
      console.error("query failed:", sql, e);
      if (!cancelled) setRows([]);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, key, revision, phase]);
  return rows;
}

/**
 * Run a read from scf-core and keep its answer current, the way
 * `useQuery` does for one statement: it runs again when the store's
 * revision moves (any write, by any client) or the film changes, and a
 * failure renders as `empty` and logs rather than crashing the view.
 *
 * For a read that is several queries and some shaping — a shot list, a
 * storyboard — that scf-core owns, so the page and an MCP tool ask the
 * same question.
 */
export function useRead<T>(read: (exec: SqlExec) => Promise<T>,
                           empty: T): T {
  const revision = useStore((s) => s.revision);
  const phase = useStore((s) => s.phase);
  const [value, setValue] = useState<T>(empty);
  useEffect(() => {
    let cancelled = false;
    if (phase !== "open") {
      setValue(empty);
      return;
    }
    read(exec).then((v) => {
      if (!cancelled) setValue(v);
    }).catch((e: unknown) => {
      console.error("read failed:", e);
      if (!cancelled) setValue(empty);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, phase]);
  return value;
}
