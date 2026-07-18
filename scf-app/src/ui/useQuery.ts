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
  const [rows, setRows] = useState<Row[]>([]);
  const key = JSON.stringify(params);
  useEffect(() => {
    let cancelled = false;
    if (sql === null) {
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
  }, [sql, key, revision]);
  return rows;
}
