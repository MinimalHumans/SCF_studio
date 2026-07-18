import { q } from "@scf-core/db.ts";
import { registry, rowName, useStore } from "../state/store.ts";
import { useQuery } from "./useQuery.ts";

export function EntityList({ entity }: { entity: string }): JSX.Element {
  const edef = registry.entities.get(entity);
  const { openEntityRow } = useStore();
  const nameField = edef?.nameField ?? "name";
  const rows = useQuery(
    edef === undefined ? null :
    `SELECT * FROM ${q(entity)} ORDER BY ${q(nameField)} LIMIT 500`);

  if (edef === undefined) return <p className="muted">Unknown entity.</p>;

  return (
    <div className="entity-list">
      <header className="list-header">
        <span className="tree-icon">{edef.icon}</span>
        <h2>{edef.labelPlural}</h2>
        <span className="tree-count">{rows.length}</span>
        <button className="primary"
                onClick={() => void openEntityRow(entity, null)}>
          New {edef.label.toLowerCase()}
        </button>
      </header>
      {edef.description !== "" && (
        <p className="entity-description">{edef.description}</p>
      )}
      <ul className="rows">
        {rows.map((r) => (
          <li key={String(r["id"])}>
            <button className="row-link"
                    onClick={() =>
                      void openEntityRow(entity, r["id"] as number)}>
              {rowName(entity, r)}
            </button>
            {r["lifecycle_status"] !== null &&
             r["lifecycle_status"] !== undefined &&
             r["lifecycle_status"] !== "active" && (
              <span className="lifecycle-tag">
                {String(r["lifecycle_status"])}
              </span>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <p className="muted">
            No {edef.labelPlural.toLowerCase()} yet — create the first one.
          </p>
        )}
      </ul>
    </div>
  );
}
