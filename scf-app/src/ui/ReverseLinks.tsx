// SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";
import { referenceGraph, registry, rowName, useStore }
  from "../state/store.ts";
import {
  isComposedLink, linkLabel, linkQualifiers, referenceFields,
} from "../state/displayName.ts";
import { q } from "@scf-core/db.ts";
import { useQuery } from "./useQuery.ts";
import { useRefNames } from "./useRefNames.ts";

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
  // Same rule as the subject view: name the far end, not the row we are
  // standing on.
  const composed = isComposedLink(edef);
  const targets = useMemo(() => edef === undefined || !composed ? []
    : referenceFields(edef)
        .filter((f) => f.name !== field)
        .map((f) => f.referenceEntity as string),
    [edef, composed, field]);
  const refNames = useRefNames(targets);
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
              {(composed ? linkLabel(edef, r, refNames, field) : null)
                ?? rowName(fromEntity, r)}
            </button>
            {composed && linkQualifiers(edef, r).map((qual) => (
              <span key={qual} className="scope-tag">{qual}</span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
