import { useMemo, useState } from "react";
import { entitiesByCategory } from "../state/registryGraph.ts";
import { registry, useStore } from "../state/store.ts";

/** Tier/category tree — v1's browser, kept for schema-oriented work. */
export function CategoryTree(): JSX.Element {
  const { selectedEntityType, selectEntityType } = useStore();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => entitiesByCategory(registry), []);

  const toggle = (category: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  return (
    <div className="tree">
      {groups.map(([category, entities]) => (
        <div key={category} className="tree-group">
          <button className="tree-category" onClick={() => toggle(category)}>
            <span className="tree-caret">
              {collapsed.has(category) ? "▸" : "▾"}
            </span>
            {category}
            <span className="tree-count">{entities.length}</span>
          </button>
          {!collapsed.has(category) && entities.map((e) => (
            <button key={e.name}
                    className={"tree-entity" +
                      (selectedEntityType === e.name ? " active" : "")}
                    onClick={() => selectEntityType(e.name)}>
              <span className="tree-icon">{e.icon}</span>
              <span className="tree-label">{e.labelPlural}</span>
              <span className="tree-tier">t{e.tier}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
