import { referenceGraph, registry, rowName, useStore }
  from "../state/store.ts";
import { q } from "@scf-core/db.ts";
import { useQuery } from "./useQuery.ts";

/**
 * "What points here" — computed generically from the registry's reference
 * graph, the way v1's _get_relationship_data was per-case.
 */
export function ReverseLinks({ entity, id }: {
  entity: string; id: number;
}): JSX.Element {
  const refs = referenceGraph.get(entity) ?? [];
  return (
    <div className="reverse-links">
      <h3>Points here</h3>
      {refs.map((r) => (
        <ReverseSection key={`${r.fromEntity}.${r.field}`}
                        fromEntity={r.fromEntity} field={r.field} id={id} />
      ))}
      {refs.length === 0 && (
        <p className="muted">Nothing references this entity type.</p>
      )}
    </div>
  );
}

function ReverseSection({ fromEntity, field, id }: {
  fromEntity: string; field: string; id: number;
}): JSX.Element | null {
  const edef = registry.entities.get(fromEntity);
  const { openEntityRow } = useStore();
  const rows = useQuery(
    `SELECT * FROM ${q(fromEntity)} WHERE ${q(field)} = ? LIMIT 50`, [id]);
  if (edef === undefined || rows.length === 0) return null;
  return (
    <section className="reverse-section">
      <h4>
        {edef.icon} {edef.labelPlural}
        {field !== `${fromEntity}_id` && (
          <span className="via">via {field}</span>
        )}
      </h4>
      <ul>
        {rows.map((r) => (
          <li key={String(r["id"])}>
            <button className="row-link"
                    onClick={() =>
                      void openEntityRow(fromEntity, r["id"] as number)}>
              {rowName(fromEntity, r)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
