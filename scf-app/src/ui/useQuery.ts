// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import type { Row, SqlValue } from "@scf-core/db.ts";
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
