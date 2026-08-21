// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { q, type Row } from "@scf-core/db.ts";
import { exec, registry, rowName, useStore } from "../state/store.ts";
import { isComposedLink } from "../state/displayName.ts";

interface Hit {
  entity: string;
  row: Row;
}

/**
 * Client-side search over every entity's name field (v1's server-rendered
 * search does not port). LIKE per table is plenty at this scale; FTS is
 * the upgrade path if a real project ever makes it slow.
 */
export function SearchBox(): JSX.Element {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const { openEntityRow } = useStore();

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        const out: Hit[] = [];
        for (const name of registry.order) {
          if (out.length >= 24) break;
          const edef = registry.entities.get(name);
          if (edef === undefined) continue;
          // A link's name column is hidden cue text, not searchable
          // content — matching it returned four "ALEXIS" rows that
          // opened as link records.
          if (isComposedLink(edef)) continue;
          try {
            const rows = await exec(
              `SELECT * FROM ${q(name)} ` +
              `WHERE ${q(edef.nameField)} LIKE ? LIMIT 4`,
              [`%${term}%`]);
            for (const row of rows) out.push({ entity: name, row });
          } catch {
            // partial projects may lack a table; skip
          }
        }
        if (!cancelled) {
          setHits(out);
          setOpen(true);
        }
      })();
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="search">
      <input type="search" value={query} placeholder="Search everything"
             onChange={(e) => setQuery(e.target.value)}
             onFocus={() => setOpen(hits.length > 0)}
             onKeyDown={(e) => {
               if (e.key === "Escape") setOpen(false);
             }} />
      {open && hits.length > 0 && (
        <ul className="search-results">
          {hits.map((h) => (
            <li key={`${h.entity}:${String(h.row["id"])}`}>
              <button onClick={() => {
                void openEntityRow(h.entity, h.row["id"] as number);
                setOpen(false);
              }}>
                <span className="search-kind">
                  {registry.entities.get(h.entity)?.icon}{" "}
                  {registry.entities.get(h.entity)?.label}
                </span>
                {rowName(h.entity, h.row)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
