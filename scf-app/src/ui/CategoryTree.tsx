import { useMemo } from "react";
import { q } from "@scf-core/db.ts";
import { entitiesByCategory } from "../state/registryGraph.ts";
import { registry, useStore } from "../state/store.ts";
import { useQuery } from "./useQuery.ts";

/** Tier/category tree — v1's browser, kept for schema-oriented work. */
export function CategoryTree(): JSX.Element {
  const { selectedEntityType, selectEntityType, schemaCollapsed,
          setSchemaCollapsed } = useStore();
  const groups = useMemo(() => entitiesByCategory(registry), []);
  // A fresh project starts collapsed — ~99 entities across the
  // categories is a wall — but the expansion then belongs to the
  // session, so switching tabs does not undo it. The store holds a
  // sentinel until the tree resolves it against the real names.
  const collapsed = useMemo(
    () => schemaCollapsed.has("\u0000all")
      ? new Set(groups.map(([category]) => category)) : schemaCollapsed,
    [schemaCollapsed, groups]);
  const setCollapsed = (next: Set<string>): void => {
    setSchemaCollapsed(next);
  };
  const counts = useEntityCounts();

  const toggle = (category: string): void => {
    const next = new Set(collapsed);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    setCollapsed(next);
  };

  const allCollapsed = collapsed.size >= groups.length;
  const toggleAll = (): void => {
    setCollapsed(allCollapsed
      ? new Set() : new Set(groups.map(([category]) => category)));
  };

  return (
    <div className="tree">
      <div className="tree-toolbar">
        <button className="ghost tiny" onClick={toggleAll}>
          {allCollapsed ? "expand all" : "collapse all"}
        </button>
      </div>
      {groups.map(([category, entities]) => {
        const total = entities.reduce(
          (n, e) => n + (counts.get(e.name) ?? 0), 0);
        return (
          <div key={category} className="tree-group">
            <button className="tree-category"
                    onClick={() => toggle(category)}>
              <span className="tree-caret">
                {collapsed.has(category) ? "▸" : "▾"}
              </span>
              {category}
              <span className="tree-count"
                    title={`${String(entities.length)} entity types`}>
                {entities.length}
              </span>
              {/* Blank, not zero: an empty category should read as
                  nothing to see, not as a measured emptiness. */}
              <span className="tree-rows">{total > 0 ? total : ""}</span>
            </button>
            {!collapsed.has(category) && entities.map((e) => {
              const rows = counts.get(e.name) ?? 0;
              return (
                <button key={e.name}
                        className={"tree-entity" +
                          (selectedEntityType === e.name ? " active" : "") +
                          (rows === 0 ? " tree-empty" : "")}
                        title={`${e.labelPlural} — tier ${String(e.tier)}` +
                          (rows > 0 ? `, ${String(rows)} rows` : "")}
                        onClick={() => selectEntityType(e.name)}>
                  <span className="tree-icon">{e.icon}</span>
                  <span className="tree-label">{e.labelPlural}</span>
                  <span className="tree-tier">t{e.tier}</span>
                  <span className="tree-rows">{rows > 0 ? rows : ""}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Row counts for every entity in one statement.
 *
 * 2.3 has enough entities that a COUNT per table would be a hundred
 * round trips on every write; a single UNION ALL is one. Empty tables
 * come back as zero and are rendered blank by the caller.
 */
function useEntityCounts(): Map<string, number> {
  const sql = useMemo(() => {
    const parts = [...registry.entities.keys()].map((name) =>
      `SELECT '${name}' AS e, COUNT(*) AS n FROM ${q(name)}`);
    return parts.length === 0 ? null : parts.join(" UNION ALL ");
  }, []);
  const rows = useQuery(sql);
  return useMemo(() => new Map(
    rows.map((r) => [String(r["e"]), Number(r["n"])])), [rows]);
}
